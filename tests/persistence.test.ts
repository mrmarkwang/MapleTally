/** Execute the real migration in embedded PostgreSQL, including RLS and worker fencing regressions. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { emptyFields, duplicateKey, warnings } from "../server/domain";
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202609130001_mapletally.sql",
    import.meta.url,
  ),
  "utf8",
);
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const fields = {
  ...emptyFields(),
  merchant: "Maple Cafe",
  date: "2026-09-13",
  subtotal: 1000,
  tax: 130,
  tip: 200,
  total: 1330,
};
async function setup(t: any) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    grant usage on schema public,auth to authenticated,service_role,anon;
  `);
  await db.exec(migration);
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2),($3,$2)",
    [owner, { business: "My studio" }, other],
  );
  const w = (
    await db.query<any>("select * from public.workspaces where user_id=$1", [
      owner,
    ])
  ).rows[0];
  return { db, w };
}
async function call(db: PGlite, name: string, params: any[]) {
  return (
    await db.query<any>(
      `select to_jsonb(public.${name}(${params.map((_, i) => `$${i + 1}`).join(",")})) result`,
      params,
    )
  ).rows[0].result;
}
async function receipt(db: PGlite, w: any, hash = "first") {
  const upload = await call(db, "reserve_upload", [
    w.id,
    "receipt.png",
    "image/png",
  ]);
  return call(db, "finish_upload", [
    w.id,
    upload.id,
    hash,
    `${w.id}/${upload.id}`,
    "image/png",
    emptyFields(),
  ]);
}
test("migration creates private buckets and Auth-triggered workspaces; RLS isolates tenants", async (t) => {
  const { db, w } = await setup(t);
  const r = await receipt(db, w);
  assert.equal(
    (
      await db.query<any>(
        "select count(*) n from storage.buckets where not public",
      )
    ).rows[0].n,
    3,
  );
  await db.exec(
    `set role authenticated; set request.jwt.claim.sub='${owner}';`,
  );
  assert.equal(
    (await db.query("select * from public.receipts")).rows.length,
    1,
  );
  await assert.rejects(
    db.query("update public.receipts set state='confirmed'"),
    /permission denied/,
  );
  await assert.rejects(
    call(db, "confirm_receipt", [w.id, r.id, 1, true]),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select * from public.jobs"),
    /permission denied/,
  );
  await db.exec(`set request.jwt.claim.sub='${other}';`);
  assert.equal(
    (await db.query("select * from public.receipts")).rows.length,
    0,
  );
  await db.exec("reset role");
});
test("upload reservations enforce quota and hash deduplication only consumes one receipt", async (t) => {
  const { db, w } = await setup(t);
  const a = await receipt(db, w);
  const b = await receipt(db, w);
  assert.equal(a.id, b.id);
  assert.equal((await call(db, "quota", [w.id])).used, 1);
  for (let n = 0; n < 24; n++)
    await call(db, "reserve_upload", [w.id, `pending-${n}`, "image/png"]);
  await assert.rejects(
    call(db, "reserve_upload", [w.id, "overflow", "image/png"]),
    /quota/,
  );
  await db.query(
    "update public.uploads set expires=now()-interval '1 second' where receipt_id is null",
  );
  assert.equal((await call(db, "quota", [w.id])).canUpload, true);
});
test("upload cancellation preserves finalized originals and delays abandoned-key cleanup", async (t) => {
  const { db, w } = await setup(t);
  const finalizedUpload = await call(db, "reserve_upload", [
    w.id,
    "final.png",
    "image/png",
  ]);
  await call(db, "finish_upload", [
    w.id,
    finalizedUpload.id,
    "final",
    `${w.id}/${finalizedUpload.id}`,
    "image/png",
    emptyFields(),
  ]);
  assert.equal(
    await call(db, "cancel_upload", [w.id, finalizedUpload.id]),
    false,
  );
  const abandoned = await call(db, "reserve_upload", [
    w.id,
    "abandoned.png",
    "image/png",
  ]);
  assert.equal(await call(db, "cancel_upload", [w.id, abandoned.id]), true);
  assert.equal(
    (await db.query("select * from public.uploads where id=$1", [abandoned.id]))
      .rows.length,
    0,
  );
  const cleanup = (
    await db.query<any>(
      "select bucket,object_key,due>now() delayed from public.storage_deletions order by bucket",
    )
  ).rows;
  assert.deepEqual(
    cleanup.map((row) => [row.bucket, row.object_key, row.delayed]),
    [
      ["receipt-uploads", `${w.id}/${abandoned.id}`, true],
      ["receipts", `${w.id}/${abandoned.id}`, true],
    ],
  );
});
test("receipt edits preserve history, reject stale writes, and confirmation is explicit", async (t) => {
  const { db, w } = await setup(t);
  const r = await receipt(db, w);
  const edited = await call(db, "edit_receipt", [
    w.id,
    r.id,
    1,
    fields,
    warnings(fields),
    duplicateKey(fields),
  ]);
  assert.equal(edited.state, "needs_review");
  assert.equal(edited.confirmed_at, null);
  await assert.rejects(
    call(db, "edit_receipt", [w.id, r.id, 1, fields, [], duplicateKey(fields)]),
    /stale/,
  );
  const confirmed = await call(db, "confirm_receipt", [
    w.id,
    r.id,
    edited.version,
    false,
  ]);
  assert.equal(confirmed.state, "confirmed");
  assert.ok(confirmed.confirmed_at);
  const reedited = await call(db, "edit_receipt", [
    w.id,
    r.id,
    confirmed.version,
    fields,
    [],
    duplicateKey(fields),
  ]);
  assert.equal(reedited.confirmed_at, null);
  assert.equal(
    (await db.query("select * from public.revisions")).rows.length,
    2,
  );
});
test("duplicate confirmation is blocked unless the user acknowledges a separate expense", async (t) => {
  const { db, w } = await setup(t);
  const a = await receipt(db, w, "a");
  const b = await receipt(db, w, "b");
  await call(db, "edit_receipt", [
    w.id,
    a.id,
    1,
    fields,
    [],
    duplicateKey(fields),
  ]);
  const r = await call(db, "edit_receipt", [
    w.id,
    b.id,
    1,
    fields,
    [],
    duplicateKey(fields),
  ]);
  assert.equal(r.state, "duplicate_candidate");
  await assert.rejects(
    call(db, "confirm_receipt", [w.id, b.id, r.version, false]),
    /duplicate/,
  );
  assert.equal(
    (await call(db, "confirm_receipt", [w.id, b.id, r.version, true])).state,
    "confirmed",
  );
});
test("job leases are exclusive, expired leases are reclaimed and stale tokens cannot finish", async (t) => {
  const { db, w } = await setup(t);
  await receipt(db, w);
  const first = await call(db, "claim_job", []);
  assert.ok(first.lease_token);
  assert.equal(await call(db, "claim_job", []), null);
  await db.exec("update public.jobs set lease_until=now()-interval '1 second'");
  const second = await call(db, "claim_job", []);
  assert.notEqual(first.lease_token, second.lease_token);
  assert.equal(
    await call(db, "complete_receipt_job", [
      first.id,
      first.lease_token,
      fields,
      {},
      [],
      duplicateKey(fields),
      {},
      {},
    ]),
    false,
  );
  assert.equal(
    await call(db, "complete_receipt_job", [
      second.id,
      second.lease_token,
      fields,
      { total: 0.9 },
      [],
      duplicateKey(fields),
      { fixture: true },
      { input_tokens: 12 },
    ]),
    true,
  );
  const r = (await db.query<any>("select * from public.receipts")).rows[0];
  assert.equal(r.state, "needs_review");
  assert.equal(r.confirmed_at, null);
  assert.equal(
    (await db.query("select * from public.attempts")).rows.length,
    1,
  );
});
test("reclaiming an expired export lease schedules its possible artifact for cleanup", async (t) => {
  const { db, w } = await setup(t);
  const exportId = await call(db, "create_export", [w.id, "zip"]);
  const first = await call(db, "claim_job", []);
  assert.equal(first.kind, "export");
  await db.exec("update public.jobs set lease_until=now()-interval '1 second'");
  const second = await call(db, "claim_job", []);
  assert.notEqual(second.lease_token, first.lease_token);
  const cleanup = (
    await db.query<any>(
      "select object_key from public.storage_deletions where bucket='exports'",
    )
  ).rows;
  assert.deepEqual(cleanup, [
    { object_key: `${w.id}/${exportId}/${first.lease_token}.zip` },
  ]);
});
test("failed export completion schedules cleanup only while its lease job still exists", async (t) => {
  const { db, w } = await setup(t);
  const exportId = await call(db, "create_export", [w.id, "pdf"]);
  const job = await call(db, "claim_job", []);
  await call(db, "fail_job", [job.id, job.lease_token, "RPC failed", false]);
  const cleanup = (
    await db.query<any>(
      "select object_key from public.storage_deletions where bucket='exports'",
    )
  ).rows;
  assert.deepEqual(cleanup, [
    { object_key: `${w.id}/${exportId}/${job.lease_token}.pdf` },
  ]);
});
test("late OCR completion cannot overwrite manual edits", async (t) => {
  const { db, w } = await setup(t);
  const r = await receipt(db, w);
  const job = await call(db, "claim_job", []);
  await call(db, "edit_receipt", [
    w.id,
    r.id,
    1,
    { ...fields, merchant: "User correction" },
    [],
    "corrected",
  ]);
  assert.equal(
    await call(db, "complete_receipt_job", [
      job.id,
      job.lease_token,
      fields,
      {},
      [],
      duplicateKey(fields),
      {},
      {},
    ]),
    false,
  );
  assert.equal(
    (await db.query<any>("select fields from public.receipts")).rows[0].fields
      .merchant,
    "User correction",
  );
});
test("bounded failures remain visible and cancelled plans retain export access", async (t) => {
  const { db, w } = await setup(t);
  const r = await receipt(db, w);
  for (let n = 0; n < 3; n++) {
    const job = await call(db, "claim_job", []);
    await call(db, "fail_job", [
      job.id,
      job.lease_token,
      "Provider unavailable",
      false,
    ]);
    await db.exec("update public.jobs set run_at=now()-interval '1 second'");
  }
  assert.equal(await call(db, "claim_job", []), null);
  assert.equal(
    (await db.query<any>("select state from public.receipts")).rows[0].state,
    "failed",
  );
  const e = await call(db, "create_export", [w.id, "zip"]);
  assert.ok(e);
  const job = await call(db, "claim_job", []);
  assert.equal(job.kind, "export");
  assert.equal(
    await call(db, "complete_export_job", [
      job.id,
      job.lease_token,
      "exports/output.zip",
    ]),
    true,
  );
  assert.equal(
    (await db.query<any>("select status from public.exports")).rows[0].status,
    "complete",
  );
  await call(db, "retry_receipt", [w.id, r.id]);
  assert.ok(await call(db, "claim_job", []));
});
test("export snapshot is immutable and does not mark later corrections exported", async (t) => {
  const { db, w } = await setup(t);
  const r = await receipt(db, w);
  const edited = await call(db, "edit_receipt", [
    w.id,
    r.id,
    1,
    fields,
    [],
    duplicateKey(fields),
  ]);
  const confirmed = await call(db, "confirm_receipt", [
    w.id,
    r.id,
    edited.version,
    false,
  ]);
  await call(db, "create_export", [w.id, "csv"]);
  await call(db, "edit_receipt", [
    w.id,
    r.id,
    confirmed.version,
    { ...fields, total: 2000 },
    [],
    "changed",
  ]);
  const job = await call(db, "claim_job", []);
  await call(db, "complete_export_job", [
    job.id,
    job.lease_token,
    "output.csv",
  ]);
  assert.equal(
    (await db.query<any>("select snapshot from public.exports")).rows[0]
      .snapshot[0].fields.total,
    1330,
  );
  assert.equal(
    (await db.query<any>("select state from public.receipts")).rows[0].state,
    "needs_review",
  );
});
test("signed email callbacks enqueue once and reject replay tokens", async (t) => {
  const { db, w } = await setup(t);
  assert.ok(
    await call(db, "enqueue_email", [
      w.id,
      "token",
      "message",
      "https://storage.api.mailgun.net/message",
    ]),
  );
  assert.equal(
    await call(db, "enqueue_email", [
      w.id,
      "token",
      "another",
      "https://storage.api.mailgun.net/message2",
    ]),
    null,
  );
  assert.equal(
    await call(db, "enqueue_email", [
      w.id,
      "token2",
      "message",
      "https://storage.api.mailgun.net/message",
    ]),
    null,
  );
  assert.equal((await db.query("select * from public.jobs")).rows.length, 1);
});
test("expired email workers cannot finalize attachments or complete reclaimed jobs", async (t) => {
  const { db, w } = await setup(t);
  const event = await call(db, "enqueue_email", [
    w.id,
    "token",
    "message",
    "https://storage.api.mailgun.net/message",
  ]);
  const upload = await call(db, "reserve_upload", [
    w.id,
    "email.png",
    "image/png",
  ]);
  const first = await call(db, "claim_job", []);
  await db.exec("update public.jobs set lease_until=now()-interval '1 second'");
  const second = await call(db, "claim_job", []);
  await assert.rejects(
    call(db, "finish_email_upload", [
      w.id,
      upload.id,
      "hash",
      `${w.id}/${upload.id}`,
      "image/png",
      emptyFields(),
      first.id,
      first.lease_token,
    ]),
    /stale email job/,
  );
  assert.equal(
    await call(db, "complete_email_job", [first.id, first.lease_token]),
    false,
  );
  assert.equal(
    (
      await call(db, "finish_email_upload", [
        w.id,
        upload.id,
        "hash",
        `${w.id}/${upload.id}`,
        "image/png",
        emptyFields(),
        second.id,
        second.lease_token,
      ])
    ).workspace_id,
    w.id,
  );
  assert.equal(
    await call(db, "complete_email_job", [second.id, second.lease_token]),
    true,
  );
  assert.equal(
    (
      await db.query<any>(
        "select status from public.email_events where id=$1",
        [event],
      )
    ).rows[0].status,
    "complete",
  );
  assert.equal((await db.query("select * from public.jobs")).rows.length, 1);
});
test("receipt deletion atomically invalidates stored export copies and keeps durable cleanup tasks", async (t) => {
  const { db, w } = await setup(t);
  const r = await receipt(db, w);
  await call(db, "edit_receipt", [
    w.id,
    r.id,
    1,
    fields,
    [],
    duplicateKey(fields),
  ]);
  await call(db, "create_export", [w.id, "zip"]);
  await assert.rejects(
    call(db, "delete_receipt", [w.id, r.id]),
    /export is preparing/,
  );
  const job = await call(db, "claim_job", []);
  await call(db, "complete_export_job", [
    job.id,
    job.lease_token,
    "workspace/export.zip",
  ]);
  await call(db, "delete_receipt", [w.id, r.id]);
  assert.equal(
    (await db.query("select * from public.receipts")).rows.length,
    0,
  );
  assert.equal((await db.query("select * from public.exports")).rows.length, 0);
  assert.equal(
    (await db.query("select * from public.storage_deletions")).rows.length,
    2,
  );
  assert.equal((await call(db, "quota", [w.id])).used, 1);
});
