/** Server-only service credentials and paginated data helpers; never imported by client components. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./domain";
export type Row = Record<string, any>;
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new HttpError(
      503,
      "Supabase server configuration is missing. See README.",
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function checked<T>(result: { data: T; error: any }): T {
  if (result.error) {
    const message = result.error.message || "Database request failed.";
    if (message.includes("quota"))
      throw new HttpError(
        402,
        "Receipt allowance reached. Existing records remain accessible.",
      );
    if (message.includes("stale") || message.includes("duplicate") || message.includes("export is preparing") || message.includes("export already queued"))
      throw new HttpError(409, message);
    if (message.includes("not found"))
      throw new HttpError(404, "Record not found.");
    throw new Error(message);
  }
  return result.data;
}
export async function rpc(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
) {
  return checked(await db.rpc(name, args));
}
export async function listAll(
  db: SupabaseClient,
  table: string,
  workspace: string,
) {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    const batch =
      checked(
        await db
          .from(table)
          .select("*")
          .eq("workspace_id", workspace)
          .order("created")
          .order("id")
          .range(offset, offset + 499),
      ) || [];
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}
