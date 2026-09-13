# MapleTally

MapleTally is a Next.js receipt manager for Canadian freelancers. Supabase provides Auth, Postgres, and private Storage; Vercel serves the app and invokes its durable worker.

## Local setup

Requirements: Node.js 22.13 or newer, npm, Docker, and the Supabase CLI.

```sh
npm install
npx supabase start
npx supabase db reset
```

Copy the API URL and keys printed by `supabase status` into `.env.local`. Set `APP_ORIGIN=http://localhost:3000`, choose a non-empty `CRON_SECRET`, then run:

```sh
npm run dev
```

Local Auth uses the redirect configured in `supabase/config.toml`. Email confirmation remains enabled; use the local Supabase inbox URL printed by `supabase status` to open confirmation messages.

## Environment

Set these variables in local development and in every applicable Vercel environment:

| Variable                               | Required          | Purpose                                                                                                                                  |
| -------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes               | Supabase project API URL.                                                                                                                |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes               | Browser-safe publishable key used for cookie-backed Auth.                                                                                |
| `SUPABASE_SECRET_KEY`                  | Yes               | Server-only secret/service-role key for privileged database, Auth, and Storage operations. Never expose it with a `NEXT_PUBLIC_` prefix. |
| `APP_ORIGIN`                           | Yes in deployment | Canonical HTTPS origin used for Auth redirects, origin checks, Stripe redirects, and portal returns.                                     |
| `CRON_SECRET`                          | Yes               | Bearer token required by `GET /api/jobs/run`. Vercel sends it automatically for cron requests.                                           |
| `OPENAI_API_KEY`                       | Optional          | Enables automatic receipt extraction. Without it, uploads remain available for manual entry.                                             |
| `OPENAI_MODEL`                         | Optional          | Responses API model; defaults to `gpt-4.1-mini`.                                                                                         |
| `STRIPE_SECRET_KEY`                    | Optional as a set | Enables checkout, portal, and cancellation with the other Stripe variables.                                                              |
| `STRIPE_PRICE_ID`                      | Optional as a set | Recurring web subscription price.                                                                                                        |
| `STRIPE_WEBHOOK_SECRET`                | Optional as a set | Verifies `POST /api/webhooks/stripe`.                                                                                                    |
| `MAILGUN_DOMAIN`                       | Optional as a set | Receiving and notification domain.                                                                                                       |
| `MAILGUN_SIGNING_KEY`                  | Optional as a set | Verifies `POST /api/webhooks/mailgun`.                                                                                                   |
| `MAILGUN_API_KEY`                      | Optional as a set | Retrieves stored messages and sends failure notifications.                                                                               |
| `MAILGUN_API_BASE`                     | Optional          | Defaults to `https://api.mailgun.net`; use `https://api.eu.mailgun.net` for the EU region.                                               |

Provider variables are optional only as complete feature sets. A partially configured provider is reported as unavailable; existing receipt read, export, and deletion access remains available.

## Supabase deployment

Create a new Supabase project, keep email confirmation enabled, and add `<APP_ORIGIN>/auth/confirm` to the Auth redirect allowlist. Link the CLI and apply the checked-in migration:

```sh
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The migration creates the Auth workspace trigger, relational schema, private `receipt-uploads`, `receipts`, and `exports` buckets, RLS read policies, and service-role-only transactional functions. Do not grant privileged RPCs or Storage object access to `anon` or `authenticated`; the app issues narrow signed URLs instead.

Apply schema changes forward with new migrations. Do not edit an already-applied production migration.

## Vercel and providers

Import the repository into Vercel, set the environment variables, and deploy. `vercel.json` schedules `/api/jobs/run` every minute, which requires a Vercel plan that supports one-minute cron frequency. Confirm `GET /api/health` returns `{"ok":true,"configured":true}` after deployment.

Configure Stripe to send `checkout.session.completed` and subscription create, update, and delete events to `<APP_ORIGIN>/api/webhooks/stripe`. Use a recurring price for `STRIPE_PRICE_ID` and enable the Stripe customer portal.

Configure a Mailgun route for the receiving domain that stores the message and notifies `<APP_ORIGIN>/api/webhooks/mailgun`. Use Mailgun's `store(notify=...)` action rather than forwarding binaries. The callback must include the signed token, recipient, and Mailgun message/storage URL; attachments are fetched only from allowlisted Mailgun HTTPS hosts. Forwarded mail is accepted only when the envelope sender matches the account email and the stored message reports an SPF pass.

## Queue operations

Receipt extraction, exports, and forwarded email use rows in `public.jobs`. Each cron invocation claims up to two ready jobs with `FOR UPDATE SKIP LOCKED`. A claim receives a fencing token and a 10-minute lease; completion with a stale token is ignored. Transient failures retry with exponential minute delays, and jobs become visibly failed after three worker attempts. A user may retry a failed receipt, up to the receipt attempt limit, or enter fields manually.

Use Vercel function logs and these tables to investigate incidents:

- `jobs`: queue status, next run, attempts, lease expiry, and last error.
- `receipts` and `exports`: user-visible processing status and error.
- `attempts`: extraction outcome and provider usage.
- `email_events` and `notifications`: forwarded-message outcome and persisted user notification.
- `storage_deletions`: durable cleanup work for originals and invalidated exports.

Do not manually complete a running job or reuse its lease token. Fix the provider or deployment issue and allow the lease to expire; the next cron safely reclaims it. A permanently failed receipt remains editable and exportable.

## Verification

Run the checks in this order:

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
```

`npm test` executes the actual SQL migration in embedded Postgres and verifies RLS, quotas, deduplication, revisions, lease fencing, retries, immutable export snapshots, and webhook replay handling. Playwright runs desktop and mobile browser contracts with hosted-service responses mocked explicitly.

Before production use, separately smoke-test Supabase email confirmation, direct Storage upload/download, cross-account RLS isolation, the Vercel cron, real OCR, Mailgun delivery, Stripe checkout/portal/cancellation, and account deletion. These checks require configured external services and are not proven by the browser contract suite.

## Backup and rollback

Enable Supabase database backups appropriate to the project plan and periodically test a restore into a separate project. Back up the three private Storage buckets separately; database backups contain object metadata and keys, not receipt or export bytes. Record the database backup and Storage copy timestamps together so they form a consistent recovery point.

For an application regression, redeploy the previous known-good Vercel deployment. For a schema regression, ship a forward corrective migration; never drop populated tables or roll back the initial migration in place. Restore into a new Supabase project for disaster recovery, restore Storage objects, apply any later forward migrations, update Vercel's Supabase URL and keys, and smoke-test Auth, RLS, signed links, and cron processing before switching traffic.

Account deletion and receipt deletion enqueue or perform object cleanup separately from relational cascades. Before declaring a restore or deletion incident resolved, inspect `storage_deletions` and verify the affected bucket prefixes directly.
