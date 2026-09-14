/** Next route dispatcher with post-upload worker kicks, verified identities, and fenced jobs. */
import { after, NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sessionClient } from "../src/lib/supabase/server";
import { adminClient, checked, listAll, rpc } from "./supabase";
import { fieldsSchema, warnings, duplicateKey, HttpError } from "./domain";
import { Storage, equal, digest, cleanupStorage } from "./storage";
import { completeUpload, view } from "./receipts";
import { Billing } from "./providers";
import { runJob, mailer, mailgunUrl } from "./worker";
const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const password = z.string().min(12).max(128);
const uuid = (id: string) => z.uuid().parse(id);
const origin = () => process.env.APP_ORIGIN || "http://localhost:3000";
const billing = () =>
  new Billing(
    process.env.STRIPE_SECRET_KEY || "",
    process.env.STRIPE_PRICE_ID || "",
    process.env.STRIPE_WEBHOOK_SECRET || "",
    origin(),
  );
async function body(req: Request) {
  const text = await req.text();
  if (text.length > 128_000)
    throw new HttpError(
      413,
      "Request is too large. Upload files directly to Storage.",
    );
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON request.");
  }
}
function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function kickWorker(db: ReturnType<typeof adminClient>) {
  after(async () => {
    await runJob(db).catch((error) =>
      console.error(
        "Post-request worker failed:",
        error instanceof Error ? error.message : "Unknown error",
      ),
    );
  });
}
async function removeFolder(
  storage: ReturnType<typeof adminClient>["storage"],
  bucket: string,
  prefix: string,
) {
  while (true) {
    const { data, error } = await storage
      .from(bucket)
      .list(prefix, { limit: 100 });
    if (error) throw error;
    if (!data?.length) return;
    for (const file of data) {
      const key = `${prefix}/${file.name}`;
      if (!file.id) await removeFolder(storage, bucket, key);
      else {
        const result = await storage.from(bucket).remove([key]);
        if (result.error) throw result.error;
      }
    }
  }
}
export async function handle(req: NextRequest) {
  try {
    return await dispatch(req);
  } catch (e) {
    if (e instanceof z.ZodError)
      return json(
        {
          error: e.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        400,
      );
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(
      "API request failed:",
      e instanceof Error ? e.message : "Unknown error",
    );
    return json(
      { error: "The request could not be completed. Please try again." },
      500,
    );
  }
}
async function dispatch(req: NextRequest): Promise<Response> {
  const path = req.nextUrl.pathname.replace(/^\/api/, "");
  const method = req.method;
  if (path === "/health" && method === "GET") {
    const required = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "APP_ORIGIN",
      "CRON_SECRET",
    ] as const;
    const missing = required.filter((name) => !process.env[name]);
    return json(
      {
        ok: missing.length === 0,
        configured: missing.length === 0,
        missing,
      },
      missing.length ? 503 : 200,
    );
  }
  if (path === "/jobs/run" && method === "GET") {
    const secret = process.env.CRON_SECRET;
    if (
      !secret ||
      !equal(req.headers.get("authorization") || "", `Bearer ${secret}`)
    )
      throw new HttpError(401, "Invalid worker authorization.");
    const db = adminClient();
    // Process several short jobs per invocation; OCR/exports have bounded per-job timeouts.
    await cleanupStorage(db);
    const results = await Promise.all([runJob(db), runJob(db)]);
    const pending = checked(
      await db
        .from("notifications")
        .select("*,workspaces(user_id)")
        .eq("sent", false)
        .limit(1),
    );
    for (const n of pending || []) {
      const { data } = await db.auth.admin.getUserById(n.workspaces.user_id);
      if (
        data.user?.email &&
        (await mailer()
          .notify(data.user.email, n.message)
          .catch(() => false))
      )
        checked(
          await db.from("notifications").update({ sent: true }).eq("id", n.id),
        );
    }
    const expired = checked(
      await db
        .from("uploads")
        .select("id,workspace_id")
        .is("receipt_id", null)
        .lt("expires", new Date().toISOString())
        .limit(100),
    );
    for (const u of expired || []) {
      await rpc(db, "cancel_upload", { w: u.workspace_id, upload_id: u.id });
    }
    return json({ results });
  }
  if (path === "/webhooks/stripe" && method === "POST") {
    const service = billing();
    const event = service.event(
      Buffer.from(await req.arrayBuffer()),
      req.headers.get("stripe-signature") || "",
    );
    if (
      [
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
      ].includes(event.type)
    ) {
      const object = event.data.object as any;
      const id =
        event.type === "checkout.session.completed"
          ? object.subscription
          : object.id;
      if (typeof id === "string") {
        const sub = await service.stripe!.subscriptions.retrieve(id);
        const customer =
          typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const paid =
          ["active", "trialing"].includes(sub.status) &&
          sub.items.data.some(
            (i) => i.price.id === process.env.STRIPE_PRICE_ID,
          );
        const db = adminClient();
        const w = checked(
          await db
            .from("workspaces")
            .select("*")
            .eq(
              "id",
              sub.metadata.workspaceId ||
                "00000000-0000-0000-0000-000000000000",
            )
            .maybeSingle(),
        );
        if (
          w &&
          (!w.customer || w.customer === customer) &&
          (!w.subscription || w.subscription === sub.id)
        ) {
          checked(
            await db
              .from("workspaces")
              .update({
                customer,
                subscription: ["canceled", "incomplete_expired"].includes(
                  sub.status,
                )
                  ? null
                  : sub.id,
                plan: paid ? "paid" : "free",
                ...(["canceled", "incomplete_expired"].includes(sub.status) &&
                w.subscription === sub.id
                  ? { checkout_key: randomUUID(), checkout_session: null }
                  : {}),
                paid_until: paid
                  ? new Date(
                      Math.max(
                        ...sub.items.data.map((i) => i.current_period_end),
                      ) * 1000,
                    ).toISOString()
                  : null,
              })
              .eq("id", w.id),
          );
        }
      }
    }
    return json({ received: true });
  }
  if (path === "/webhooks/mailgun" && method === "POST") {
    // Configure Mailgun route store(notify=...), not forward(): the callback contains no binaries.
    const data = Object.fromEntries(new URLSearchParams(await req.text()));
    mailer().verify(data);
    const storageUrl = mailgunUrl(
      data["message-url"] || data["storage-url"] || "",
    ).toString();
    const db = adminClient();
    const recipient = data.recipient || "";
    const w = checked(
      await db
        .from("workspaces")
        .select("*")
        .eq("forwarding", recipient.split("@")[0])
        .maybeSingle(),
    );
    if (
      !w ||
      w.deleting ||
      recipient.toLowerCase() !==
        `${w.forwarding}@${process.env.MAILGUN_DOMAIN}`.toLowerCase()
    )
      throw new HttpError(404, "Recipient not found.");
    const result = await rpc(db, "enqueue_email", {
      w: w.id,
      token: data.token,
      message_id: digest(storageUrl),
      storage_url: storageUrl,
    });
    return json({ received: true, id: result });
  }
  if (
    !["GET", "HEAD"].includes(method) &&
    (req.headers.get("X-MapleTally") !== "1" ||
      (req.headers.get("origin") && req.headers.get("origin") !== origin()))
  )
    throw new HttpError(403, "Request origin is not allowed.");
  const auth = await sessionClient();
  if (path === "/auth/register" && method === "POST") {
    const input = z
      .object({
        email,
        password,
        name: z.string().trim().min(1).max(100),
        business: z.string().trim().min(1).max(100),
      })
      .parse(await body(req));
    const { data, error } = await auth.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: { name: input.name, business: input.business },
        emailRedirectTo: `${origin()}/auth/confirm`,
      },
    });
    if (error) throw new HttpError(400, error.message);
    return json({ ok: true, confirmationRequired: !data.session }, 201);
  }
  if (path === "/auth/login" && method === "POST") {
    const input = z.object({ email, password }).parse(await body(req));
    const { error } = await auth.auth.signInWithPassword(input);
    if (error)
      throw new HttpError(
        401,
        "Unable to sign in. Check your email, password and email confirmation.",
      );
    return json({ ok: true });
  }
  const {
    data: { user },
    error: authError,
  } = await auth.auth.getUser();
  if (authError || !user) throw new HttpError(401, "Please sign in.");
  const db = adminClient();
  const w = checked(
    await db.from("workspaces").select("*").eq("user_id", user.id).single(),
  );
  const storage = new Storage(db);
  const getReceipt = async (id: string) => {
    const r = checked(
      await db
        .from("receipts")
        .select("*")
        .eq("id", uuid(id))
        .eq("workspace_id", w.id)
        .maybeSingle(),
    );
    if (!r) throw new HttpError(404, "Receipt not found.");
    return r;
  };
  if (path === "/auth/logout" && method === "POST") {
    await auth.auth.signOut();
    return json({ ok: true });
  }
  if (path === "/me" && method === "GET")
    return json({
      user: {
        name: user.user_metadata.name || user.email?.split("@")[0] || "You",
        email: user.email,
      },
      workspace: {
        name: w.name,
        forwarding: mailer().available()
          ? `${w.forwarding}@${process.env.MAILGUN_DOMAIN}`
          : null,
      },
      quota: await rpc(db, "quota", { w: w.id }),
      billingAvailable: billing().available(),
      hasCustomer: !!w.customer,
      hasSubscription: !!w.subscription,
      extractionAvailable: !!process.env.OPENAI_API_KEY,
      notifications: checked(
        await db
          .from("notifications")
          .select("id,message,created")
          .eq("workspace_id", w.id)
          .order("created", { ascending: false })
          .limit(20),
      ),
    });
  if (path === "/receipts" && method === "GET")
    return json((await listAll(db, "receipts", w.id)).reverse().map(view));
  if (path === "/uploads" && method === "POST") {
    const input = z
      .object({
        filename: z.string().min(1).max(200),
        mime: z.string().max(100),
        size: z.number().int().positive().max(10485760),
      })
      .parse(await body(req));
    const u = await rpc(db, "reserve_upload", {
      w: w.id,
      filename: input.filename.replaceAll(/[\\/]/g, "_"),
      mime: input.mime,
    });
    const url = await storage.uploadLink(`${w.id}/${u.id}`);
    await rpc(db, "activate_upload", { w: w.id, upload_id: u.id });
    return json({ id: u.id, url }, 201);
  }
  const upload = path.match(/^\/uploads\/([^/]+)(?:\/(complete))?$/);
  if (upload && method === "POST" && upload[2]) {
    const result = await completeUpload(db, w.id, uuid(upload[1]));
    if (!result.duplicate) kickWorker(db);
    return json(result);
  }
  if (upload && method === "DELETE") {
    const id = uuid(upload[1]);
    await rpc(db, "cancel_upload", { w: w.id, upload_id: id });
    return json({ ok: true });
  }
  const match = path.match(/^\/receipts\/([^/]+)(?:\/(confirm|retry|link))?$/);
  if (match) {
    const r = await getReceipt(match[1]);
    if (method === "GET" && match[2] === "link")
      return json({ url: await storage.link("receipts", r.object_key) });
    if (method === "GET" && !match[2])
      return json({
        ...view(r),
        revisions: checked(
          await db
            .from("revisions")
            .select("created,fields")
            .eq("receipt_id", r.id),
        ),
        attempts: checked(
          await db
            .from("attempts")
            .select("created,status,error,usage")
            .eq("receipt_id", r.id),
        ),
      });
    if (method === "PUT" && !match[2]) {
      const input = z
        .object({ fields: fieldsSchema, version: z.number().int() })
        .parse(await body(req));
      return json(
        view(
          await rpc(db, "edit_receipt", {
            w: w.id,
            receipt: r.id,
            expected: input.version,
            new_fields: input.fields,
            new_warnings: warnings(input.fields),
            new_key: duplicateKey(input.fields),
          }),
        ),
      );
    }
    if (method === "POST" && match[2] === "confirm") {
      const input = z
        .object({
          version: z.number().int(),
          acknowledgeDuplicate: z.boolean().default(false),
        })
        .parse(await body(req));
      const f = fieldsSchema.parse(r.fields);
      if (!f.merchant || !f.date || f.total === null)
        throw new HttpError(
          400,
          "Add merchant, date and total before confirmation.",
        );
      return json(
        view(
          await rpc(db, "confirm_receipt", {
            w: w.id,
            receipt: r.id,
            expected: input.version,
            acknowledge: input.acknowledgeDuplicate,
          }),
        ),
      );
    }
    if (method === "POST" && match[2] === "retry") {
      await rpc(db, "retry_receipt", { w: w.id, receipt: r.id });
      kickWorker(db);
      return json({ ok: true });
    }
    if (method === "DELETE" && !match[2]) {
      await rpc(db, "delete_receipt", { w: w.id, receipt: r.id });
      await cleanupStorage(db, w.id);
      return json({ ok: true });
    }
  }
  if (path === "/exports" && method === "POST") {
    const { format } = z
      .object({ format: z.enum(["csv", "pdf", "zip"]) })
      .parse(await body(req));
    return json(
      {
        id: await rpc(db, "create_export", { w: w.id, output_format: format }),
        status: "queued",
      },
      202,
    );
  }
  if (path === "/exports" && method === "GET")
    return json(
      checked(
        await db
          .from("exports")
          .select("id,format,status,error,created")
          .eq("workspace_id", w.id)
          .order("created", { ascending: false })
          .limit(20),
      ),
    );
  const exp = path.match(/^\/exports\/([^/]+)$/);
  if (exp && method === "GET") {
    const e = checked(
      await db
        .from("exports")
        .select("id,format,status,error,object_key")
        .eq("id", uuid(exp[1]))
        .eq("workspace_id", w.id)
        .maybeSingle(),
    );
    if (!e) throw new HttpError(404, "Export not found.");
    return json({
      id: e.id,
      status: e.status,
      error: e.error,
      url:
        e.status === "complete"
          ? await storage.link(
              "exports",
              e.object_key,
              `mapletally.${e.format}`,
            )
          : null,
    });
  }
  if (path === "/billing/checkout" && method === "POST") {
    if (w.subscription)
      throw new HttpError(
        409,
        "Manage your existing subscription in billing settings.",
      );
    const service = billing();
    if (!service.available())
      throw new HttpError(503, "Subscriptions are not configured yet.");
    let checkoutWorkspace = w;
    if (w.checkout_session) {
      const previous = await service.stripe!.checkout.sessions.retrieve(
        w.checkout_session,
      );
      if (previous.status === "open") return json({ url: previous.url });
      if (previous.status === "complete")
        throw new HttpError(
          409,
          "Your subscription is updating. Please refresh in a moment.",
        );
      checkoutWorkspace = await rpc(db, "rotate_checkout", {
        w: w.id,
        expected: w.checkout_key,
      });
    }
    const session = await service.checkout(
      w.id,
      user.email!,
      w.customer || undefined,
      checkoutWorkspace.checkout_key,
    );
    checked(
      await db
        .from("workspaces")
        .update({ checkout_session: session.id })
        .eq("id", w.id)
        .eq("checkout_key", checkoutWorkspace.checkout_key),
    );
    return json({ url: session.url });
  }
  if (path === "/billing/portal" && method === "POST") {
    if (!w.customer)
      throw new HttpError(400, "There is no billing account yet.");
    return json({ url: (await billing().portal(w.customer)).url });
  }
  if (path === "/account" && method === "PATCH") {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(100) })
      .parse(await body(req));
    checked(await db.from("workspaces").update({ name }).eq("id", w.id));
    return json({ ok: true });
  }
  if (path === "/account" && method === "DELETE") {
    const input = z
      .object({ password: z.string().max(128) })
      .parse(await body(req));
    const { error } = await auth.auth.signInWithPassword({
      email: user.email!,
      password: input.password,
    });
    if (error) throw new HttpError(401, "Password is incorrect.");
    if (w.subscription) await billing().cancel(w.subscription);
    checked(
      await db
        .from("workspaces")
        .update({ deleting: true, subscription: null })
        .eq("id", w.id),
    );
    const active = checked(
      await db
        .from("jobs")
        .select("id")
        .eq("workspace_id", w.id)
        .eq("status", "running")
        .gt("lease_until", new Date().toISOString()),
    );
    if (active?.length)
      throw new HttpError(
        409,
        "Processing is finishing. Your account is frozen for deletion; try again in ten minutes.",
      );
    for (const bucket of ["receipt-uploads", "receipts", "exports"])
      await removeFolder(db.storage, bucket, w.id);
    // Clean objects that an issued upload token or already-running export can create after this pass.
    const staged = checked(
      await db.from("uploads").select("id,expires").eq("workspace_id", w.id),
    );
    const deletions = (staged || []).flatMap((u) => {
      const due = new Date(
        Math.max(Date.now(), Date.parse(u.expires)) + 60_000,
      ).toISOString();
      return ["receipt-uploads", "receipts"].map((bucket) => ({
        bucket,
        object_key: `${w.id}/${u.id}`,
        due,
      }));
    });
    const leasedExports = checked(
      await db
        .from("jobs")
        .select("target,lease_token")
        .eq("workspace_id", w.id)
        .eq("kind", "export")
        .not("lease_token", "is", null),
    );
    const exportRows = checked(
      await db.from("exports").select("id,format").eq("workspace_id", w.id),
    );
    const formats = new Map(
      (exportRows || []).map((entry) => [entry.id, entry.format]),
    );
    for (const job of leasedExports || []) {
      const format = formats.get(job.target);
      if (format)
        deletions.push({
          bucket: "exports",
          object_key: `${w.id}/${job.target}/${job.lease_token}.${format}`,
          due: new Date(Date.now() + 15 * 60_000).toISOString(),
        });
    }
    if (deletions.length) {
      checked(await db.from("storage_deletions").upsert(deletions));
    }
    const result = await db.auth.admin.deleteUser(user.id);
    if (result.error) throw result.error;
    await auth.auth.signOut();
    return json({ ok: true });
  }
  throw new HttpError(404, "Endpoint not found.");
}
