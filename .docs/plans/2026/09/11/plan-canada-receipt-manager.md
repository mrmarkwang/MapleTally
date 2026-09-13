# Architecture plan: Canada receipt manager MVP

## Goal

Deliver the receipt workflow using Next.js on Vercel and Supabase Auth, Postgres and private Storage, preserving capture, review, approval, exports and subscription-independent data access.

## Current Context

- The initial React/Vite + Express + SQLite implementation exists locally; 14 domain/API tests passed before migration. Browser tests were written but not yet run.
- On 2026-09-13 the user explicitly requested Next.js + Vercel + Supabase. This supersedes SQLite and local storage.
- No production data, Supabase credentials, Vercel project or Git repository exists here. Prepare deployable code; external provisioning and live checks require configured services.

## Decisions

- Next.js App Router hosts the React client and Node route handlers. Supabase SSR cookies replace custom sessions/passwords; verified Supabase identities authorize API calls. Support email confirmation.
- Supabase Postgres stores relational records with RLS. Narrowly granted server-only transactional RPCs enforce quotas, deduplication, optimistic revisions and job leases. Browsers cannot set approvals, entitlements, usage or job state directly.
- Originals upload directly to private Supabase Storage using signed upload tokens. Completion validates actual bytes, hashes content and atomically deduplicates/enqueues OCR. No receipt binaries pass through Vercel request bodies.
- Durable Postgres jobs use SKIP LOCKED, fencing tokens, bounded retries and lease expiry recovery. Vercel Cron invokes the authenticated worker every minute (Pro or higher). No in-memory timer or local database fallback.
- Exports are asynchronous jobs: save immutable snapshots and private generated artifacts, return signed download URLs. ZIP originals stream directly into private Storage so archive size is not constrained by ephemeral disk.
- Mailgun store-and-notify callbacks contain attachment references to avoid Vercel payload limits. Verify signatures, recipient, sender and replay identity. Fetch only allowlisted Mailgun storage URLs.
- Retain OpenAI adapter, cents-based arithmetic warnings, explicit approval, corrections, Stripe and subscription-independent data access.
- No bank APIs, native billing, accounting sync, compatibility servers or simulated production data.

## Phased Tasks

### Phase 1 - Architecture

- [x] Inspect the app and document the user-selected migration.
- [x] Specify direct uploads, asynchronous exports, managed authentication and durable leases.
- [x] Update E2E spec for confirmation, direct upload, asynchronous export and RLS.

### Phase 2 - Foundation

- [x] Replace Vite/Express with Next.js, Vercel configuration and Supabase clients.
- [x] Add SQL migration: schema, workspace creation, RLS, bucket permissions and transactional RPCs.
- [x] Remove SQLite, local storage, custom auth and the continuous worker.

### Phase 3 - Features

- [x] Migrate receipt APIs, upload completion, review, approval, retry and deletion.
- [x] Migrate extraction/export workers with retries, fencing and signed downloads.
- [x] Migrate Stripe, Mailgun and account management.
- [x] Adapt UI for Supabase confirmation, direct transfers, asynchronous exports and configuration errors.

### Phase 4 - Verification

- [x] Make permanent upload keys deterministic in `server/receipts.ts`, preserve committed originals across ambiguous RPC failures and clean abandoned keys from expired/cancelled uploads.
- [x] Add transactional email completion and attachment-finalization fencing in `supabase/migrations/202609130001_mapletally.sql` and cover stale lease rejection in `tests/persistence.test.ts`.
- [x] Stream ZIP generation directly to private Storage in `server/worker.ts` and use the supported Vercel Pro function duration so archive size is not constrained by ephemeral disk.
- [x] Make workspace polling visibility-aware in `src/main.tsx` and require all essential deployment variables in `/api/health`.
- [x] Run domain and PostgreSQL migration/RLS/transaction tests with npm test.
- [x] Run npm run typecheck and npm run build.
- [x] Run npm run test:e2e; distinguish browser contract fixtures from live Supabase verification.
- [x] Review isolation, secrets, serverless limits, retries and stale code; fix major findings.

### Phase 5 - Handoff

- [x] Document Supabase/Vercel setup, providers, queue operation, backups and rollback.
- [x] Record verification evidence and pending live-service/device checks.

## Validation

Test the actual SQL migration in embedded PostgreSQL with only Supabase-owned auth/storage schemas supplied by the harness. Verify RLS, ownership, atomic quotas/deduplication, stale revisions and job recovery. Browser contract tests exercise the Next UI without paid providers. Live Supabase smoke tests remain necessary to verify Auth and Storage services.

Final local evidence on 2026-09-13: `npm test` passed 24 tests; `npm run typecheck` passed; `npm run build` completed the Next.js production build; `npm run test:e2e` passed 4 desktop/mobile browser contracts. CR passed with no major flaws. Live Supabase Auth/Storage isolation, Vercel Cron, OpenAI, Mailgun, Stripe and physical-device checks remain pending because this workspace has no configured external projects or credentials.

## Rollback / Risk

- Apply the initial migration to a new Supabase project. No local production data was identified; never remove an existing data directory during migration.
- Roll back application code through Vercel; do not drop populated tables.
- Back up Postgres and Storage objects separately; database backups do not include files.
- Leases outlive function execution. Manual edits fence out late OCR; failed jobs remain visible.
- AR passed: no blocking architecture flaws. Credentials and live provider tests remain deployment prerequisites.
