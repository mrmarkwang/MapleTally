# Receipt extraction

## Problem

After a receipt upload completes, the receipt remains in a captured/queued state with blank detail fields instead of automatically showing extracted merchant, date, amounts, currency, and category. This forces manual entry and makes the primary capture workflow appear broken.

## Requirement

When a valid receipt upload is finalized and automatic extraction is configured and available, the queued receipt job must be processed and its extracted fields must be persisted and shown when the receipt is opened or refreshed. If extraction cannot run, the receipt must expose a specific actionable error and remain safely editable manually.

## Acceptance Criteria

- [ ] A valid uploaded receipt creates a receipt extraction job that is processed by the configured worker path.
- [ ] Successful extraction persists merchant, date, subtotal, tax, tip, total, currency, category, confidence, warnings, and extraction metadata, and the review screen displays the persisted values after refresh.
- [ ] Provider, worker, authentication, and configuration failures are surfaced as an actionable receipt error without losing the original upload.
- [ ] A failed extraction remains manually editable and can be retried when retryable/configuration conditions are corrected.
- [ ] Regression coverage verifies the upload-to-extracted-details path and the manual fallback path.

## Constraints

- Preserve the existing queue, lease fencing, idempotency, duplicate detection, and human approval requirements.
- Preserve private Storage handling and never expose provider credentials or receipt bytes to the browser unnecessarily.
- Follow the repository's Next.js 16 route-handler conventions and existing server-only provider boundary.
- Do not claim automatic extraction when the required provider/worker configuration is absent.

## Non-Goals

- Changing the extraction provider or adding a second OCR provider.
- Automatically approving receipts based on model output.
- Redesigning the receipt review screen or changing quota/billing behavior.
