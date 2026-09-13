/** Node App Router endpoints with the Vercel Pro window used by durable Cron jobs. */
import { handle } from "../../../../server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;
export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
};
