/** Vercel worker with fenced receipt, email, and immutable export job completion. */
import type { SupabaseClient } from "@supabase/supabase-js";
import path from "node:path";
import { Readable } from "node:stream";
import archiver from "archiver";
import { checked, rpc, type Row } from "./supabase";
import { Storage, removeOrDefer } from "./storage";
import { warnings, duplicateKey } from "./domain";
import { OpenAIExtractor, type Extractor, Mailer } from "./providers";
import { exportCsv, exportPdf } from "./exports";
import { completeUpload, view } from "./receipts";
export function mailer() {
  return new Mailer(
    process.env.MAILGUN_DOMAIN || "",
    process.env.MAILGUN_SIGNING_KEY || "",
    process.env.MAILGUN_API_KEY || "",
    process.env.MAILGUN_API_BASE || "https://api.mailgun.net",
  );
}
export function mailgunUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !/^(storage(?:-[a-z0-9]+)*\.api\.mailgun\.net|(?:api|api\.eu)\.mailgun\.net)$/.test(
      url.hostname,
    )
  )
    throw new Error("Untrusted Mailgun storage URL.");
  return url;
}
async function mailgunFetch(url: string) {
  return fetch(mailgunUrl(url), {
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString("base64")}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
}
async function readLimited(response: globalThis.Response, limit: number) {
  if (!response.ok || !response.body)
    throw new Error("Mailgun could not retrieve the stored receipt.");
  if (Number(response.headers.get("content-length") || 0) > limit)
    throw new Error("Email attachment exceeds 10 MB.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit)
        throw new Error("Email attachment exceeds the size limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
async function processEmail(db: SupabaseClient, job: Row) {
  const event = checked(
    await db.from("email_events").select("*").eq("id", job.target).single(),
  );
  const w = checked(
    await db.from("workspaces").select("*").eq("id", job.workspace_id).single(),
  );
  if (!w || !event) throw new Error("Email workspace no longer exists.");
  const { data, error } = await db.auth.admin.getUserById(w.user_id);
  if (error) throw error;
  const message = JSON.parse(
    (
      await readLimited(await mailgunFetch(event.storage_url), 1024 * 1024)
    ).toString(),
  );
  const headers: [string, string][] = message["message-headers"] || [];
  const spf = headers
    .find(([k]) => k.toLowerCase() === "x-mailgun-spf")?.[1]
    ?.toLowerCase();
  if (
    String(message.sender || "").toLowerCase() !==
      data.user?.email?.toLowerCase() ||
    spf !== "pass"
  )
    throw new Error(
      "Forward from your account email using a sender that passes SPF.",
    );
  const attachments = message.attachments || [];
  if (!attachments.length || attachments.length > 5)
    throw new Error("Forward between 1 and 5 receipt attachments.");
  for (const attachment of attachments) {
    const bytes = await readLimited(
      await mailgunFetch(attachment.url),
      10 * 1024 * 1024,
    );
    // Redeliveries deduplicate by verified content hash before reserving another allowance.
    const { digest } = await import("./storage");
    const existing = checked(
      await db
        .from("receipts")
        .select("id")
        .eq("workspace_id", w.id)
        .eq("hash", digest(bytes))
        .maybeSingle(),
    );
    if (existing) continue;
    const u = await rpc(db, "reserve_upload", {
      w: w.id,
      filename: path.basename(attachment.name || "email-receipt"),
      mime: attachment["content-type"] || "application/octet-stream",
    });
    await completeUpload(db, w.id, u.id, bytes, {
      id: job.id,
      token: job.lease_token,
    });
  }
  await rpc(db, "complete_email_job", {
    job: job.id,
    token: job.lease_token,
  });
}
export async function processExport(db: SupabaseClient, job: Row) {
  const e = checked(
    await db.from("exports").select("*").eq("id", job.target).single(),
  );
  const storage = new Storage(db);
  const key = `${job.workspace_id}/${e.id}/${job.lease_token}.${e.format}`;
  const rows: Row[] = e.snapshot;
  const publicRows = rows.map(view);
  const csv = exportCsv(publicRows);
  if (e.format === "csv")
    await storage.put("exports", key, Buffer.from(csv), "text/csv");
  else {
    const w = checked(
      await db
        .from("workspaces")
        .select("name")
        .eq("id", job.workspace_id)
        .single(),
    );
    if (!w) throw new Error("Export workspace no longer exists.");
    const pdf = await exportPdf(publicRows, w.name);
    if (e.format === "pdf")
      await storage.put("exports", key, pdf, "application/pdf");
    else {
      // Archiver is the upload body, so archive size is not bounded by Vercel's ephemeral disk.
      const archive = archiver("zip", { zlib: { level: 6 } });
      const upload = storage.put("exports", key, archive, "application/zip");
      const uploadFailure = upload.then<never>(
        () => new Promise<never>(() => {}),
        (error) => Promise.reject(error),
      );
      uploadFailure.catch(() => {});
      archive.on("error", () => {});
      archive.on("warning", (error) => archive.destroy(error));
      try {
        archive.append(csv, { name: "receipts.csv" });
        archive.append(pdf, { name: "report.pdf" });
        archive.append(JSON.stringify(publicRows, null, 2), {
          name: "records.json",
        });
        for (const r of rows) {
          const url = await storage.link("receipts", r.object_key);
          const response = await fetch(url, {
            signal: AbortSignal.timeout(30_000),
          });
          if (!response.ok || !response.body)
            throw new Error("An original file is unavailable.");
          const stream = Readable.fromWeb(response.body as any);
          archive.append(stream, {
            name: `originals/${r.id}/${r.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
          });
          await Promise.race([
            new Promise<void>((resolve, reject) => {
              const cleanup = () => {
                stream.off("end", done);
                stream.off("error", failed);
                archive.off("error", failed);
              };
              const done = () => {
                cleanup();
                resolve();
              };
              const failed = (error: Error) => {
                cleanup();
                reject(error);
              };
              stream.once("end", done);
              stream.once("error", failed);
              archive.once("error", failed);
            }),
            uploadFailure,
          ]);
        }
        await Promise.all([archive.finalize(), upload]);
      } catch (error) {
        archive.abort();
        await upload.catch(() => {});
        await removeOrDefer(db, "exports", key);
        throw error;
      }
    }
  }
  const accepted = await rpc(db, "complete_export_job", {
    job: job.id,
    token: job.lease_token,
    object_key: key,
  });
  if (!accepted) await removeOrDefer(db, "exports", key);
}
export async function runJob(
  db: SupabaseClient,
  extractor: Extractor = new OpenAIExtractor(
    process.env.OPENAI_API_KEY || "",
    process.env.OPENAI_MODEL || "gpt-4.1-mini",
  ),
) {
  const job = await rpc(db, "claim_job");
  if (!job?.id) return { processed: false };
  try {
    if (job.kind === "receipt") {
      const r = checked(
        await db.from("receipts").select("*").eq("id", job.target).single(),
      );
      const result = await extractor.extract(
        await new Storage(db).get("receipts", r.object_key),
        r.mime,
      );
      await rpc(db, "complete_receipt_job", {
        job: job.id,
        token: job.lease_token,
        extracted: result.fields,
        confidence: result.confidence,
        warnings: warnings(result.fields, result.confidence),
        duplicate_key: duplicateKey(result.fields),
        raw: result.raw,
        usage: result.usage || {},
      });
    } else if (job.kind === "export") await processExport(db, job);
    else if (job.kind === "email") await processEmail(db, job);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Processing failed.";
    await rpc(db, "fail_job", {
      job: job.id,
      token: job.lease_token,
      message,
      permanent: message.includes("not configured"),
    });
  }
  return { processed: true, kind: job.kind };
}
