/** Supabase email confirmation callback: exchange a PKCE code or a template token hash. */
import { NextRequest, NextResponse } from "next/server";
import { sessionClient } from "../../../lib/supabase/server";
export async function GET(req: NextRequest) {
  const auth = await sessionClient();
  const code = req.nextUrl.searchParams.get("code");
  const token = req.nextUrl.searchParams.get("token_hash");
  const result = code
    ? await auth.auth.exchangeCodeForSession(code)
    : token
      ? await auth.auth.verifyOtp({ token_hash: token, type: "email" })
      : { error: true };
  return NextResponse.redirect(
    new URL(
      result.error ? "/?confirmation=failed" : "/",
      process.env.APP_ORIGIN || req.nextUrl.origin,
    ),
  );
}
