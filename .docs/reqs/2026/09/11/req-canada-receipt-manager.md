# Requirements: Canada receipt manager MVP

## Problem

Canadian freelancers and sole proprietors need a simple way to capture receipts, understand GST/HST-related anomalies, and hand organized records to an accountant. Existing accounting suites are often too complex for this workflow, while receipt scanners can leave users uncertain about OCR accuracy, duplicates, omissions, and data portability.

## Requirement

Provide a mobile-friendly web MVP that lets a user upload or forward a receipt, review extracted expense fields, see basic GST/HST validation results, and export a complete record package. The product must keep the original receipt linked to its structured record and make uncertain or failed processing visible to the user.

## Acceptance Criteria

- [ ] A user can create an account and manage one business workspace.
- [ ] A user can upload an image or PDF receipt from a phone or desktop.
- [ ] A user can forward an email receipt to a unique workspace address and have supported attachments enter the processing queue.
- [ ] The system extracts merchant, date, subtotal, tax, tip, total, currency, and category when available.
- [ ] The user can review and edit extracted fields before approval.
- [ ] The system validates arithmetic consistency and provides basic GST/HST warnings without presenting them as tax advice.
- [ ] The system marks processing, review, approved, failed, duplicate-candidate, and exported states visibly.
- [ ] A user can export structured data as CSV and a readable report as PDF, with the original files included in a ZIP package.
- [ ] A user can delete account data and export their records without being locked out because of subscription status.
- [ ] The system supports a free allowance and a paid web subscription, with cancellation available from the web account.
- [ ] The mobile web flow works for camera capture/upload, orientation, retry after transient failure, and low-bandwidth conditions.

## Constraints

- Use Next.js on Vercel with Supabase Auth, Postgres and private Storage (user decision, 2026-09-13). Processing must survive serverless invocation boundaries; large files must bypass Vercel request/response bodies.

- One developer must be able to operate and maintain the system.
- Web/PWA is the first client; native iOS/Android is out of scope for the MVP.
- Bank API connections, QuickBooks/Xero bidirectional sync, payroll, inventory, and automated tax filing are out of scope.
- Sensitive receipt data must be access-controlled, encrypted in transit, and separated by workspace.
- AI output is advisory and must not be written to a final approved record without user confirmation.
- Processing providers must be replaceable behind a small internal adapter.

## Non-Goals

- Full double-entry accounting.
- Automatic filing or professional tax advice.
- Direct bank credential connections.
- Native mobile application distribution.
- Multi-tenant accountant administration beyond a simple share/export workflow.
