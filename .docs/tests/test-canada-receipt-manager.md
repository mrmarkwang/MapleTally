# Canada receipt manager E2E scenarios

1. Register an account and show the Supabase email-confirmation state before entering an empty workspace. After confirmation, sign out and sign back in; invalid credentials fail visibly.
2. Request a signed private Storage upload URL, upload an image directly from desktop and mobile viewport sizes without proxying bytes through Next.js, then complete the upload and show its receipt record. Processing failure remains visible and supports retry/manual entry. Reject unsupported files and files over 10 MB.
3. Edit merchant, date, amounts, currency and category. Show deterministic warnings. Confirm only after user action. Editing a confirmed receipt clears confirmation.
4. Upload identical bytes; identify the existing receipt without creating another expense. Similar merchant/date/total records require explicit duplicate acknowledgement.
5. Queue immutable CSV/PDF/ZIP export snapshots, poll their asynchronous status, then follow a signed private Storage download URL. Verify original bytes, confirmed values, warnings, corrections, confirmation metadata and formula-safe CSV. Unconfirmed receipts remain clearly labelled in full-data exports.
6. Using live Supabase identities, verify RLS prevents another account from reading, modifying, approving, deleting, exporting or retrieving signed originals from the first workspace. Keep this live-service isolation check separate from mocked browser contract tests.
7. Verify signed email delivery, sender validation, redelivery idempotency, unsupported attachment failure, and failure notification persistence using provider fixtures.
8. Verify free limit and paid monthly limit, authenticated checkout/customer portal, signed billing events and cancellation. Read/export/delete continue after cancellation.
9. Delete account with password confirmation; verify sessions, relational records, and original objects are removed. Subscription cancellation failure must prevent deletion.

Automation: `npm test` covers server/domain/provider boundaries, including embedded-Postgres RLS and transactional RPC behavior; `npm run test:e2e` exercises the browser contract with hosted-service responses mocked explicitly. Live Supabase Auth/Storage isolation, physical iPhone Safari/Android Chrome, real OCR, Mailgun delivery and Stripe checkout require a configured deployment and are tracked separately.
