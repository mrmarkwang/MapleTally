/** Direct-to-Storage ZIP/PDF generation: artifacts bypass response bodies and ephemeral disk. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unzipSync, strFromU8 } from "fflate";
import { processExport } from "../server/worker";
import { emptyFields } from "../server/domain";
test("export worker streams a ZIP larger than 4.5 MB into private Storage with exact originals", async () => {
  const original = randomBytes(5 * 1024 * 1024);
  const fields = {
    ...emptyFields(),
    merchant: "=Merchant",
    date: "2026-09-13",
    total: 1330,
  };
  const snapshot = [
    {
      id: "receipt-id",
      filename: "receipt.bin",
      object_key: "private-key",
      workspace_id: "workspace",
      hash: "hash",
      fields,
      original: fields,
      warnings: ["Check tax"],
      state: "approved",
      approved_at: "2026-09-13",
      version: 2,
      revisions: [],
    },
  ];
  let artifact: Buffer | undefined;
  let completed = false;
  const db = {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        single: async () => ({
          data:
            table === "exports"
              ? { id: "export-id", format: "zip", snapshot }
              : { name: "Studio" },
          error: null,
        }),
      };
      return q;
    },
    storage: {
      from(bucket: string) {
        return {
          createSignedUrl: async () => ({
            data: {
              signedUrl: `data:application/octet-stream;base64,${original.toString("base64")}`,
            },
            error: null,
          }),
          upload: async (_key: string, stream: AsyncIterable<Buffer>) => {
            assert.equal(bucket, "exports");
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(chunk);
            artifact = Buffer.concat(chunks);
            return { error: null };
          },
        };
      },
    },
    rpc: async (name: string) => {
      assert.equal(name, "complete_export_job");
      completed = true;
      return { data: true, error: null };
    },
  } as unknown as SupabaseClient;
  await processExport(db, {
    id: "job-id",
    target: "export-id",
    workspace_id: "workspace",
    lease_token: "lease",
  });
  assert.ok(completed);
  assert.ok(artifact!.length > 4.5 * 1024 * 1024);
  const zip = unzipSync(artifact!);
  assert.deepEqual(
    Buffer.from(zip["originals/receipt-id/receipt.bin"]),
    original,
  );
  assert.equal(
    Buffer.from(zip["report.pdf"]).subarray(0, 5).toString(),
    "%PDF-",
  );
  assert.match(strFromU8(zip["receipts.csv"]), /'=Merchant/);
  const record = JSON.parse(strFromU8(zip["records.json"]))[0];
  assert.equal(record.fields.total, 1330);
  assert.equal(record.approved_at, "2026-09-13");
  assert.equal(record.object_key, undefined);
});
test("export worker rejects cleanly when the streaming Storage upload fails", async () => {
  let removed = false;
  const db = {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({
          data:
            table === "exports"
              ? { id: "export-id", format: "zip", snapshot: [] }
              : { name: "Studio" },
          error: null,
        }),
      };
      return query;
    },
    storage: {
      from() {
        return {
          upload: async () => ({ error: { message: "provider unavailable" } }),
          remove: async () => {
            removed = true;
            return { error: null };
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  await assert.rejects(
    processExport(db, {
      id: "job-id",
      target: "export-id",
      workspace_id: "workspace",
      lease_token: "lease",
    }),
    /provider unavailable/,
  );
  assert.equal(removed, true);
});
