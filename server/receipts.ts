/** Receipt ingestion plus strict live and backward-compatible immutable-export views. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { checked, rpc, type Row } from "./supabase";
import { Storage, validateFile, digest, removeOrDefer } from "./storage";
import { emptyFields, HttpError } from "./domain";
export function view(r: Row) {
  const { object_key, hash, duplicate_key, workspace_id, ...publicFields } = r;
  return publicFields;
}
export async function completeUpload(
  db: SupabaseClient,
  workspace: string,
  uploadId: string,
  bytes?: Buffer,
  emailJob?: { id: string; token: string },
) {
  const stage = `${workspace}/${uploadId}`;
  const key = `${workspace}/${uploadId}`;
  const u = checked(
    await db
      .from("uploads")
      .select("*")
      .eq("id", uploadId)
      .eq("workspace_id", workspace)
      .maybeSingle(),
  );
  if (!u) throw new HttpError(404, "Upload not found.");
  const finalized = async (receiptId: string) => {
    const receipt = checked(
      await db
        .from("receipts")
        .select("id,object_key")
        .eq("id", receiptId)
        .eq("workspace_id", workspace)
        .single(),
    );
    if (!receipt) throw new Error("Finalized receipt is unavailable.");
    const duplicate = receipt.object_key !== key;
    if (duplicate) await removeOrDefer(db, "receipts", key);
    await removeOrDefer(db, "receipt-uploads", stage);
    return { id: receipt.id, duplicate };
  };
  if (u.receipt_id) return finalized(u.receipt_id);
  if (new Date(u.expires).getTime() < Date.now())
    throw new HttpError(410, "Upload expired. Choose your file again.");
  const storage = new Storage(db);
  const data = bytes || (await storage.get("receipt-uploads", stage));
  let mime: string;
  try {
    mime = await validateFile(data);
  } catch (e) {
    await rpc(db, "cancel_upload", { w: workspace, upload_id: u.id });
    throw e;
  }
  await storage.put("receipts", key, data, mime, true);
  let r: Row;
  try {
    r = await rpc(db, emailJob ? "finish_email_upload" : "finish_upload", {
      w: workspace,
      upload_id: u.id,
      file_hash: digest(data),
      object_key: key,
      actual_mime: mime,
      empty_fields: emptyFields(),
      ...(emailJob ? { job: emailJob.id, token: emailJob.token } : {}),
    });
  } catch (e) {
    const result = await db
      .from("uploads")
      .select("receipt_id")
      .eq("id", u.id)
      .eq("workspace_id", workspace)
      .maybeSingle();
    if (!result.error && result.data?.receipt_id)
      return finalized(result.data.receipt_id);
    throw e;
  }
  return finalized(r.id);
}
