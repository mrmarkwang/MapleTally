/** Request-scoped Supabase SSR session client. Cookies are set only inside route handlers. */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { HttpError } from "../../../server/domain";
export function publicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new HttpError(
      503,
      "Connect Supabase to open your workspace. Set the Supabase environment variables described in README.",
    );
  return { url, key };
}
export async function sessionClient() {
  const { url, key } = publicConfig();
  const jar = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value, options }) =>
          jar.set(name, value, options),
        );
      },
    },
  });
}
