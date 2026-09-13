/** Private Storage with signed links, idempotent writes, and non-blocking durable cleanup. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { checked } from "./supabase";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { HttpError } from "./domain";
export function digest(b: Buffer | string) {
  return createHash("sha256").update(b).digest("hex");
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function sign(secret: string, text: string) {
  return createHmac("sha256", secret).update(text).digest("hex");
}
export class Storage {
  constructor(private db: SupabaseClient) {}
  async put(
    bucket: string,
    key: string,
    data: any,
    mime: string,
    upsert = false,
  ) {
    const { error } = await this.db.storage
      .from(bucket)
      .upload(key, data, { contentType: mime, upsert, duplex: "half" });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  }
  async get(bucket: string, key: string) {
    const { data, error } = await this.db.storage.from(bucket).download(key);
    if (error || !data)
      throw new Error("Original file is unavailable. Please retry.");
    return Buffer.from(await data.arrayBuffer());
  }
  async remove(bucket: string, keys: string[]) {
    if (!keys.length) return;
    const { error } = await this.db.storage.from(bucket).remove(keys);
    if (error) throw new Error(`Storage deletion failed: ${error.message}`);
  }
  async link(bucket: string, key: string, download?: string) {
    const { data, error } = await this.db.storage
      .from(bucket)
      .createSignedUrl(key, 300, download ? { download } : {});
    if (error || !data) throw new Error("Could not create file link.");
    return data.signedUrl;
  }
  async uploadLink(key: string) {
    const { data, error } = await this.db.storage
      .from("receipt-uploads")
      .createSignedUploadUrl(key);
    if (error || !data) throw new Error("Could not create upload link.");
    return data.signedUrl;
  }
}
export async function removeOrDefer(
  db: SupabaseClient,
  bucket: string,
  objectKey: string,
) {
  try {
    await new Storage(db).remove(bucket, [objectKey]);
  } catch {
    checked(
      await db.from("storage_deletions").upsert({
        bucket,
        object_key: objectKey,
        due: new Date().toISOString(),
      }),
    );
  }
}
export async function cleanupStorage(db: SupabaseClient, workspace?: string) {
  let query = db
    .from("storage_deletions")
    .select("*")
    .lte("due", new Date().toISOString())
    .order("due")
    .limit(100);
  if (workspace) query = query.like("object_key", `${workspace}/%`);
  const rows = checked(await query) || [];
  const storage = new Storage(db);
  for (const row of rows) {
    try {
      await storage.remove(row.bucket, [row.object_key]);
      checked(
        await db
          .from("storage_deletions")
          .delete()
          .eq("bucket", row.bucket)
          .eq("object_key", row.object_key),
      );
    } catch (error) {
      console.error(
        "Storage cleanup failed:",
        error instanceof Error ? error.message : "Unknown error",
      );
      const postponed = await db
        .from("storage_deletions")
        .update({ due: new Date(Date.now() + 5 * 60_000).toISOString() })
        .eq("bucket", row.bucket)
        .eq("object_key", row.object_key);
      if (postponed.error)
        console.error(
          "Could not postpone Storage cleanup:",
          postponed.error.message,
        );
    }
  }
}
export async function validateFile(data: Buffer): Promise<string> {
  if (data.length === 0 || data.length > 10 * 1024 * 1024)
    throw new HttpError(400, "Choose a non-empty receipt under 10 MB.");
  if (data.subarray(0, 5).toString() === "%PDF-") {
    if (!data.subarray(-2048).includes(Buffer.from("%%EOF")))
      throw new HttpError(
        400,
        "The PDF is incomplete. Try the original file again.",
      );
    return "application/pdf";
  }
  try {
    const m = await sharp(data, { limitInputPixels: 40_000_000 }).metadata();
    if (
      !["jpeg", "png", "webp", "heif"].includes(m.format || "") ||
      (m.pages || 1) > 1
    )
      throw new Error();
    return (
      {
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        heif: "image/heic",
      } as Record<string, string>
    )[m.format!];
  } catch {
    throw new HttpError(
      400,
      "Use a valid JPG, PNG, WebP, supported HEIC image, or PDF.",
    );
  }
}
