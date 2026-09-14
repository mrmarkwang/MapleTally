# Receipt extraction implementation plan

## Goal

Make the receipt upload flow reliably transition from a queued receipt to persisted extracted details when the configured worker can run, while preserving a clear editable manual fallback for failures.

## Current Context

- `src/main.tsx` uploads directly to Storage, finalizes through `POST /api/uploads/:id/complete`, refreshes the receipt, and polls while receipt state is `captured` or `processing`.
- `server/receipts.ts` finalizes the upload and the database `finish_upload` function inserts the receipt extraction job with empty fields.
- `server/http.ts` exposes `GET /api/jobs/run`, authenticates it with `CRON_SECRET`, and invokes `runJob` twice before cleaning expired uploads.
- `server/worker.ts` claims a receipt job, downloads the private original, calls `OpenAIExtractor`, and persists the result through `complete_receipt_job`; failures call `fail_job`.
- `server/providers.ts` requires `OPENAI_API_KEY`, converts images with Sharp, calls the Responses API, and validates the structured result against `fieldsSchema`.
- `vercel.json` schedules `/api/jobs/run` once per minute. `README.md` documents `OPENAI_API_KEY` as optional and the cron configuration as required for deployment.
- Existing unit and Playwright coverage exercises upload and manual correction but mocks the receipt as failed; it does not prove successful worker extraction or the real worker endpoint contract.
- Next.js route-handler guidance was checked in `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`; the current `app/api/[...path]/route.ts` is compatible with the documented Web Request/Response handler model.

## Decisions

- Trace and fix the existing queue/worker contract first; do not add a client-side OCR fallback or duplicate extraction implementation.
- Keep provider access server-only and retain the current structured-output validation and integer-cent amount contract.
- Make configuration and worker failures distinguishable in the user-visible receipt state, while retaining manual editing and bounded retry behavior.
- Add focused regression tests around the worker success/failure path and an E2E contract for the observable upload-to-review transition.
- Do not introduce feature flags, new environment variables, a second provider, or a schema migration unless discovery proves an existing contract cannot satisfy the requirement.

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [x] Reproduce the uploaded-receipt state transition locally or with the existing test doubles and identify whether the fault is in job creation, cron authorization/routing, job claiming, provider invocation, structured parsing, or persistence.
- [x] Inspect existing worker, API, migration, environment, and deployment contracts to distinguish missing deployment configuration from a code defect.
- [x] Confirm the exact persisted state/error semantics needed for configured, unavailable, transient-failure, and successful extraction cases.

### Phase 2 - Foundation changes

- [x] Update the smallest affected server/client contract so a configured worker's result is observable after polling and actionable failures are not mistaken for a still-running extraction.
- [x] Preserve lease fencing, idempotency, duplicate detection, and the original object when changing error or retry handling.
- [x] Add source-file comment blocks required by the repository workflow to each edited source file and keep them current.

### Phase 3 - Feature implementation

- [x] Implement the root-cause fix in the existing upload → job → worker → persistence path, without adding client-side extraction or automatic approval.
- [x] Wire the relevant retry/status behavior so a failed receipt can be retried after a retryable failure and remains manually editable in all failure cases.
- [x] Verify the provider payload and parsed structured result continue to satisfy the domain schema and amount/date conventions.

### Phase 4 - Tests and verification wiring

- [x] Add a unit regression test for successful receipt extraction persistence through the worker boundary, including extracted fields and metadata.
- [x] Add unit coverage for the identified failure/configuration path and its retry/manual-edit behavior.
- [x] Extend `tests/e2e/receipts.spec.ts` or add a focused E2E scenario proving a successful extraction result is displayed after the upload flow, while retaining the existing manual fallback scenario.
- [x] Run `npm run typecheck`, `npm test`, `npm run build`, and the focused/full Playwright suite as applicable; record exact results.

### Phase 5 - Documentation and status

- [x] Update `README.md` only if the verified deployment/configuration contract changes or the troubleshooting instructions need correction.
- [x] Mark completed plan tasks only after code changes and verification evidence exist.
- [x] Record the final root cause, affected path, fix, and verification evidence for the receipt-extraction requirement.

## Validation

- Unit: `npm test` must pass, including the new worker success/failure regression coverage.
- Static: `npm run typecheck` must pass.
- Build: `npm run build` must pass with the existing webpack build configuration.
- E2E: `npm run test:e2e -- tests/e2e/receipts.spec.ts` must pass, including successful extraction and manual fallback scenarios with explicit mocks.
- Manual/operational: inspect a queued receipt's state and job/error transition, then confirm the review screen shows persisted extracted fields after refresh; if the root cause is deployment-only, verify the required environment and cron contract is documented rather than masking it in UI code.

Verification evidence (2026-09-13): `npm test` passed 26/26 tests; `npm run typecheck` passed; `npm run build` passed; `npm run test:e2e -- tests/e2e/receipts.spec.ts` passed 8/8 desktop/mobile tests. The E2E scenarios verify delayed extraction updates in an open review and preservation of manually edited fields. A real-provider smoke test remains an operational deployment check because this checkout has no `OPENAI_API_KEY`.

## Rollback / Risk

- The highest risk is changing queue state transitions or retry semantics and leaving jobs orphaned; keep database RPC contracts unchanged unless required and verify lease-fenced completion.
- Provider API/schema changes can produce parsing failures or incorrect amounts; retain strict validation and test integer cents, null unknowns, and dates.
- If the defect is solely missing production configuration, the code change should be limited to diagnostics/documentation and deployment verification; do not weaken authentication or silently bypass the worker.
- Roll back by reverting only the story files and redeploying the last known-good application version; do not edit or roll back the already-applied initial migration.
