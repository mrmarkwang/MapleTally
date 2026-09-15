# Repair receipt confirmation migration plan

## Goal

Upgrade legacy MapleTally databases to the current confirmation schema and RPC contract so receipt confirmation works without data loss or expanded database access.

## Current Context

- `server/http.ts` posts confirmation requests to `confirm_receipt` with `w`, `receipt`, `expected`, and `acknowledge`.
- `supabase/migrations/202609130001_mapletally.sql` now defines the current contract, but commit `c2d4456` edited that already-applied migration in place.
- Before the first local draft was applied, the running Supabase OpenAPI schema exposed `approve_receipt` but not `confirm_receipt`, and its receipt rows used `approved` and `approved_at`; the local schema now exposes the repaired RPC and requires recovery only for snapshots changed by that draft.
- `complete_export_job` in the legacy schema recognizes `approved`, while current application behavior uses `confirmed`.
- At story start, `tests/persistence.test.ts` validated only fresh initialization; the worktree now contains a draft legacy-upgrade regression that must be reconciled with the final immutable-snapshot design.

## Decisions

- Add a forward-only migration that detects and upgrades the legacy schema; do not edit the original migration again.
- Drop the legacy receipt-state check before converting data, then enforce the exact current state set so `approved` cannot survive as a compatibility value.
- Recreate the receipt edit, confirmation, and export-completion functions with current behavior after renaming the column and migrating state values.
- Preserve every historical export snapshot unchanged. Add a separate export-only snapshot view in `server/receipts.ts`; keep the existing live API `view` strict, so obsolete persisted live values are not masked.
- Do not lock, requeue, or otherwise modify export jobs. In-flight and backoff behavior remains unchanged, and `complete_export_job` can finish legacy snapshots because it keys live state transitions by receipt ID and version rather than snapshot state text.
- Deploy the backward-compatible export-only reader before applying the schema migration. This ensures workers at either side of the database rollout can render legacy snapshots; the current RPC consumer is already incompatible with the legacy database, so the migration follows immediately.
- Production deployment is outside this local repair story. The production database migration must remain withheld until the application/worker release containing the snapshot adapter is deployed, application traffic is placed in maintenance mode so upload/retry routes cannot call `kickWorker`, scheduled and manual job invocation are disabled, at least the 800-second maximum duration has elapsed since the last invocation from any source or worker version, the migration completes, and application traffic plus worker invocation are re-enabled.
- Make the migration safe on both legacy and already-current schemas so fresh test databases can apply the entire migration set.
- Preserve service-role-only function grants and explicitly request a PostgREST schema reload.
- Reject an application fallback to `approve_receipt`: it would preserve schema drift and still return legacy state/field names that the current UI does not understand.

## Phased Tasks

### Phase 1 - Lock the legacy/current boundary

- [x] Record the legacy `approve_receipt` signature, receipt state constraint, approval timestamp column, and `complete_export_job` behavior from repository history and the running local schema.
- [x] Confirm the current HTTP route and receipt UI require `confirm_receipt`, `confirmed`, and `confirmed_at`.
- [x] Keep UI changes, new receipt states, and runtime compatibility fallbacks out of scope.

### Phase 2 - Deploy backward-compatible export reading

- [x] Add an export-only snapshot view to `server/receipts.ts` that normalizes legacy snapshot state/timestamp names while leaving the existing live API `view` strict.
- [x] Update `server/worker.ts` to use the export-only snapshot view for CSV, PDF, and ZIP generation.
- [x] Verify the backward-compatible worker production build succeeds and record that production migration remains withheld pending code-deployment evidence, maintenance-mode blocking of upload/retry `kickWorker` traffic, disabled scheduled/manual worker invocation, an 800-second all-source drain window, completed migration evidence, and explicit application/worker re-enablement.

### Phase 3 - Add the forward schema repair

- [x] Add a new migration under `supabase/migrations` that drops the legacy state constraint, migrates `approved` rows to `confirmed`, preserves timestamps by renaming `approved_at` to `confirmed_at` when needed, and reinstates the exact current state constraint.
- [x] Leave export snapshots, export rows, jobs, leases, attempts, retry schedules, and storage cleanup records unchanged by the migration.
- [x] Replace `edit_receipt` so post-upgrade edits clear `confirmed_at` and continue to preserve revision and duplicate behavior.
- [x] Replace the legacy approval function with `confirm_receipt(w, receipt, expected, acknowledge)` and remove `approve_receipt`.
- [x] Replace `complete_export_job` so matching `confirmed` receipts become `exported`.
- [x] Reapply service-role-only execution privileges and notify PostgREST to reload its schema.

### Phase 4 - Add regression coverage

- [x] Update `tests/persistence.test.ts` to apply every SQL migration in order.
- [x] Add a legacy-upgrade regression that constructs the pre-rename schema state; snapshots receipt IDs, fields, versions, all timestamps, duplicate metadata, jobs, retry state, and export records; applies the repair; and verifies only live receipt terminology changed.
- [x] In `tests/persistence.test.ts`, cover edit-confirm-edit behavior, exact state-constraint enforcement (including rejection of `approved`), byte-identical legacy export snapshots/jobs, confirmed export completion, and explicit `service_role` / `authenticated` / `anon` privileges for all three repaired RPCs.
- [x] In `tests/exports.test.ts`, prove the export-only snapshot view normalizes legacy state/timestamps for CSV, PDF, and ZIP inputs while the ordinary live API view leaves an obsolete live state visible instead of masking it.
- [x] Apply the full migration sequence to an already-current fresh schema and verify the repair migration is safe there too.
- [x] Add `scripts/assert-local-confirmation-schema.mjs` to load the Supabase URL and secret from the process environment, fetch `/rest/v1/` with the required `apikey` and bearer headers, and assert the current/obsolete RPC paths and parameter names.
- [x] Run the persistence tests and typecheck, recording their exact results.

### Phase 5 - Verify the deployed contract and user path

- [x] Run `npx --yes supabase@2.117.0 db dump --local --data-only --file /private/tmp/mapletally-pre-confirmation-repair-data.sql` and verify the dump is non-empty before changing the local database.
- [x] Restrict `/private/tmp/mapletally-pre-confirmation-repair-data.sql` to mode `0600` and verify it is outside the repository and cannot be staged.
- [x] Before restoration, capture current export/job IDs, statuses, object keys, errors, run times, attempts, and leases; separately record that backup-era export `4df61f09-…` legitimately advanced from queued to complete and its old job was removed.
- [x] Create `/private/tmp/restore-mapletally-export-snapshots.mjs` to parse only the two affected export snapshot values from the backup and submit one `BEGIN` / two targeted `UPDATE public.exports` / `COMMIT` transaction through `docker exec -i supabase_db_mapletally psql -v ON_ERROR_STOP=1`.
- [x] Run the narrow restoration, verify canonical snapshot JSON equals the backup, and verify every non-snapshot export/job field equals the fresh pre-restoration capture; do not compare lifecycle metadata to the older backup or replay the full auth-bearing dump.
- [x] Validate the corrected migration from a deterministic legacy database through `tests/persistence.test.ts`; do not rely on rerunning an amended migration version that local Supabase already records as applied.
- [x] Run `node --env-file=.env.local scripts/assert-local-confirmation-schema.mjs` against the local PostgREST OpenAPI document to verify `/rpc/confirm_receipt` has `w`, `receipt`, `expected`, and `acknowledge` and `/rpc/approve_receipt` is absent.
- [x] Run `npm run test:e2e -- --grep "Next receipt UI"`; its existing deterministic mocked account and review-ready receipt exercise the browser’s save-then-confirm contract, while the persistence regression proves the real upgraded RPC behavior.

## Validation

- `npm test` passes, including the legacy migration regression.
- `npm run typecheck` passes.
- `npm run build` passes.
- Local Supabase OpenAPI lists `/rpc/confirm_receipt` with `w`, `receipt`, `expected`, and `acknowledge`, and omits `/rpc/approve_receipt`.
- PostgreSQL privilege assertions show `service_role` can execute `edit_receipt`, `confirm_receipt`, and `complete_export_job`, while `anon` and `authenticated` cannot.
- `npm run test:e2e -- --grep "Next receipt UI"` passes, proving the browser changes a confirmed response to `confirmed` without an error alert; the migration regression proves the upgraded database returns that response.

## Rollback / Risk

- The migration changes persisted state and a timestamp column; all operations must remain in the migration transaction so any failure rolls back atomically before the new contract becomes visible.
- Capture and verify `/private/tmp/mapletally-pre-confirmation-repair-data.sql` before applying the migration outside the embedded regression database; pair it with the pre-migration application revision and original migration for full restore.
- Function replacement briefly changes the PostgREST schema surface, so the migration explicitly reloads the schema cache after commit.
- Historical export snapshots intentionally retain legacy keys; `server/receipts.ts` owns their presentation-only normalization for every current export format.
- Production rollout order is worker/application code first, schema migration second. Reversing the order can let an old worker render legacy snapshot terminology incorrectly.
- The production migration runbook must quiesce every worker source: block application traffic (including upload completion and retry), disable cron/manual invocation, wait 800 seconds after the final invocation, apply the migration, verify the RPC schema, then re-enable workers and application traffic.
- The earlier local draft changed queued snapshots; restore those exact snapshot values from the verified backup, then compare job/export metadata before treating local validation as current.
- Keep the mode-`0600` backup only through successful restoration and final verification, then delete both temporary recovery files and verify neither appears in Git status.
- Do not roll back by restoring legacy names or state values after new confirmations exist. Recover with a forward corrective migration or restore the pre-migration database backup together with the matching pre-migration application version.
