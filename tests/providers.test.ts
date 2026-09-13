/** Binary validation, idempotent ingestion, and provider trust boundaries. */
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateFile, sign } from "../server/storage";
import { Mailer } from "../server/providers";
import { mailgunUrl } from "../server/worker";
import { completeUpload } from "../server/receipts";
test("upload validation inspects actual bytes and enforces size limits", async () => {
  const image = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  assert.equal(await validateFile(image), "image/png");
  for (const invalid of [
    Buffer.from("<svg/>"),
    Buffer.from("%PDF-incomplete"),
    Buffer.alloc(10485761),
  ])
    await assert.rejects(validateFile(invalid));
});
test("Mailgun signatures expire and stored attachments cannot redirect credentials to another host", () => {
  const m = new Mailer(
    "example.ca",
    "signing",
    "key",
    "https://api.mailgun.net",
  );
  const timestamp = String(Math.floor(Date.now() / 1000));
  m.verify({
    timestamp,
    token: "test",
    signature: sign("signing", timestamp + "test"),
  });
  assert.throws(() =>
    m.verify({
      timestamp: "0",
      token: "test",
      signature: sign("signing", "0test"),
    }),
  );
  assert.throws(() =>
    m.verify({ timestamp, token: "test", signature: "wrong" }),
  );
  for (const url of [
    "https://evil.example/file",
    "https://storage.api.mailgun.net.evil.example/file",
    "http://storage.api.mailgun.net/file",
    "https://user:pass@storage.api.mailgun.net/file",
  ])
    assert.throws(() => mailgunUrl(url));
  assert.equal(
    mailgunUrl("https://storage-us-east4.api.mailgun.net/v3/message").hostname,
    "storage-us-east4.api.mailgun.net",
  );
});
test("lost finalization responses preserve and reconcile committed originals", async () => {
  const workspace = "11111111-1111-4111-8111-111111111111";
  const upload = "22222222-2222-4222-8222-222222222222";
  const receipt = "33333333-3333-4333-8333-333333333333";
  const key = `${workspace}/${upload}`;
  const bytes = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  let committed = false;
  const removed: string[] = [];
  const db = {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data:
            table === "uploads"
              ? {
                  id: upload,
                  workspace_id: workspace,
                  receipt_id: committed ? receipt : null,
                  expires: new Date(Date.now() + 60_000).toISOString(),
                }
              : null,
          error: null,
        }),
        single: async () => ({
          data: table === "receipts" ? { id: receipt, object_key: key } : null,
          error: null,
        }),
      };
      return query;
    },
    storage: {
      from(bucket: string) {
        return {
          upload: async (
            objectKey: string,
            _data: unknown,
            options: { upsert: boolean },
          ) => {
            assert.equal(bucket, "receipts");
            assert.equal(objectKey, key);
            assert.equal(options.upsert, true);
            return { error: null };
          },
          remove: async (keys: string[]) => {
            removed.push(...keys.map((value) => `${bucket}:${value}`));
            return { error: null };
          },
        };
      },
    },
    rpc: async () => {
      committed = true;
      return { data: null, error: { message: "response lost" } };
    },
  } as unknown as SupabaseClient;
  assert.deepEqual(await completeUpload(db, workspace, upload, bytes), {
    id: receipt,
    duplicate: false,
  });
  assert.ok(removed.includes(`receipt-uploads:${key}`));
  assert.ok(!removed.includes(`receipts:${key}`));
});
