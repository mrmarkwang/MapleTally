# Plan: Canadian tax-ready receipt records

## Goal
Make MapleTally a reliable Canadian T1/T2125 preparation workspace for self-employed individuals that starts with receipts, preserves tax detail and business-use allocation, and provides a clear path for income, mileage, home-office, and capital-asset records. It must produce qualified annual summaries and exports without blocking unresolved records.

## Current Context
- [server/domain.ts](../../../server/domain.ts) validates a compact `Fields` object with one nullable `tax` value and emits arithmetic/foreign-currency warnings.
- [supabase/migrations/202609130001_mapletally.sql](../../../supabase/migrations/202609130001_mapletally.sql) stores receipt facts in `receipts.fields` JSONB, with immutable export snapshots and RPCs for upload, edit, confirm, extraction completion, and export completion.
- [server/http.ts](../../../server/http.ts) validates edits with `fieldsSchema`, confirms only merchant/date/total, and creates CSV/PDF/ZIP export jobs.
- [server/worker.ts](../../../server/worker.ts) sends the current fields contract to the extractor and renders immutable snapshots through [server/exports.ts](../../../server/exports.ts).
- [src/main.tsx](../../../src/main.tsx) exposes upload, review, status/date/search filtering, confirmation, and export actions, but does not expose tax-year, tax-type, category, province, usage, or ITC filters/fields.
- Existing tests cover domain arithmetic, formula-safe CSV, migrations/RLS, persistence, providers, exports, and a receipt E2E flow. The current migration test assembles selected migration files, so the new migration must be included there.
- The existing public field names (`merchant`, `date`, `tax`) are used by OCR, RPCs, exports, and tests. The implementation must preserve compatibility while introducing the tax-ready contract.
- The product boundary is individual/self-employed T1 plus T2125 preparation; T2, payroll, shareholder compensation/dividends, full personal tax calculation, and direct CRA submission are explicitly out of scope.

## Decisions
- Use the canonical JSON keys `merchant`, `date`, `subtotal`, `tip`, `total`, `currency`, `payment_method`, `province`, `tax_year`, `gst`, `hst`, `qst`, `pst`, `rst`, `category`, `category_status`, `business_or_personal`, `business_use_percent`, `business_amount`, `personal_amount`, `itc_status`, and `notes`; monetary values remain nullable integer cents. Keep legacy `tax` readable as `legacy_tax`/unknown tax type and never infer GST/HST/QST/PST/RST from it.
- Validate category against Advertising, Meals and Entertainment, Travel, Motor Vehicle Expenses, Office Expenses, Office Supplies, Professional Fees, Insurance, Rent, Utilities, Bank Charges, Delivery/Freight, Capital Assets/CCA Review, and Other Expenses. Use `category_status` and `review_status` values Suggested, Confirmed, or Needs Review; retain receipt workflow `state` separately.
- Calculate `business_amount` and `personal_amount` from `total` and `business_use_percent` using integer-cent rounding; Business is 100%, Personal is 0%, and Mixed Use requires an explicit 0-100 percentage. Unknown totals or percentages remain unknown.
- Store normalized `tax_year` in the fields JSON and derive it with one shared helper from a valid `date`; missing dates use `Unknown`. The GET API accepts repeated query parameters (`taxYear`, `month`, `category`, `province`, `taxType`, `usage`, `reviewStatus`, `vendor`) and composes them server-side over the tenant-scoped row set.
- Add additive migration `supabase/migrations/202609190001_canadian_tax_ready_receipts.sql` to backfill only safe `tax_year` values and add any query/index support chosen during implementation. `tests/persistence.test.ts` must load this migration after the existing repair migrations. Old JSON rows and old export snapshots remain readable through compatibility normalization.
- Preserve confirmation as a workflow action, not tax approval: it may require merchant/date/total and valid usage/category structure, but it must allow Suggested, Needs Review, Unknown, Uncategorized, and unresolved ITC states while keeping those labels visible.
- Define CSV order as `id,filename,state,merchant,date,tax_year,subtotal,gst,hst,qst,pst,rst,tax,tip,total,currency,payment_method,province,category,category_status,business_or_personal,business_use_percent,business_amount,personal_amount,itc_status,review_status,confidence,warnings,notes,confirmed_at`; old snapshots render blank new columns and label legacy `tax` as unknown.
- Generate annual summary data from the export snapshot in the worker so CSV/PDF/ZIP remain immutable and consistent. Include unresolved rows and explicit warnings instead of blocking the job.
- Keep ITC as a review classification (`possible`, `not_indicated`, `needs_review`, `unknown`) with explanatory notes, not an eligibility decision.
- Add focused UI controls to the existing review and receipt-list surfaces; preserve the established upload, confirmation, and export flows rather than introducing a second receipt editor.
- Keep income, invoice/platform-income, mileage, home-office, and capital-asset records as separate domain concepts or staged capabilities; do not model them as receipt expenses just to satisfy an export shape.

## Phased Tasks
### Phase 1 - Discovery and scope lock
- [ ] Inspect all `Fields` consumers in `server/providers.ts`, `server/receipts.ts`, `server/http.ts`, `server/worker.ts`, `server/exports.ts`, `src/main.tsx`, and tests to enumerate every legacy `tax` assumption.
- [ ] Inspect the full `Review` component and current filter/export UI in `src/main.tsx` to locate the smallest editor and filtering changes.
- [ ] Confirm the SQL migration/test loading order and whether existing production rows can be backfilled without assuming a tax type for legacy `tax`.
- [ ] Record the final compatibility mapping for legacy `tax` as `tax_type = unknown` unless receipt evidence supplies a type.

### Phase 2 - Foundation changes
- [ ] Extend `server/domain.ts` with the exact canonical fields, supported Canadian tax/category/usage/ITC/review enums, nullable tax breakdown, tax-year derivation, allocation arithmetic, and warnings for incomplete or inconsistent tax-ready records.
- [ ] Extend the validated fields contract and empty defaults while normalizing legacy `tax` to a labelled unknown tax type and accepting old snapshots during the read/migration compatibility window.
- [ ] Add `supabase/migrations/202609190001_canadian_tax_ready_receipts.sql`, backfill only deterministic `tax_year` values, add needed query/index support without changing RLS, and include it explicitly in `tests/persistence.test.ts`.
- [ ] Update `server/http.ts` edit/confirm validation so Mixed Use percentages and review metadata are validated, and confirmation never converts Suggested/Needs Review tax data into confirmed tax advice.
- [ ] Update extraction/provider prompts and parsing in `server/providers.ts` to request separate tax types, payment method, province, category suggestion, usage clues, and confidence while retaining unknowns.

### Phase 3 - Feature implementation
- [ ] Update `server/receipts.ts` view normalization so legacy and new rows expose stable tax-ready fields without leaking storage internals.
- [ ] Implement annual summary aggregation in a shared server module, grouping by tax year and CRA/T2125-aligned category and separately totaling business/personal portions and each tax type.
- [ ] Update `server/exports.ts` and `server/worker.ts` so CSV contains the required detail columns, PDF includes annual summary and qualified review sections, and ZIP includes summary/detail/originals while retaining unresolved records.
- [ ] Add GET `/receipts` support for repeated `taxYear`, `month`, `category`, `province`, `taxType`, `usage`, `reviewStatus`, and `vendor` parameters, composing filters after tenant scoping and returning the same normalized receipt shape.
- [ ] Extend the review UI with tax breakdown, province/payment method, category status/confidence, Business/Personal/Mixed Use allocation, ITC review state, notes, and special-limit prompts.
- [ ] Extend the receipt list with tax-year/category/province/tax-type/usage/review/vendor filters and an annual-summary/export entry point that visibly warns about unresolved records.
- [ ] Ensure UI copy explicitly says MapleTally organizes records for user/accountant review and does not complete filing or guarantee deductibility.
- [ ] Add the Phase 1 product boundary and positioning to user-facing copy: Canadian individual/self-employed T1/T2125 preparation, with the agreed English promise and explicit exclusion of T2/payroll/shareholder/full-tax-calculation features.
- [ ] Define the first data contracts or staged backlog boundaries for business income/invoices/platform income, vehicle mileage, home office, and equipment/capital assets, including their annual-summary treatment and review prompts.

### Phase 4 - Tests and verification wiring
- [ ] Add domain tests for tax breakdown validation, unknown preservation, tax-year derivation, business/personal allocation, Mixed Use requirements, category status, ITC status, and warnings.
- [ ] Extend persistence/migration tests for legacy `tax` compatibility, new fields, indexes/RLS, edit/confirm behavior, and immutable export snapshots.
- [ ] Extend export tests for required CSV columns, annual PDF summary sections, unresolved-record inclusion, formula neutralization, and ZIP originals.
- [ ] Extend provider tests for separate GST/HST/QST/PST/RST extraction and low-confidence/unknown handling.
- [ ] Add E2E coverage for editing the canonical Mixed Use fields, filtering by tax year/category/tax type/review status, and exporting with unresolved records.
- [ ] Run `npm run typecheck`, `npm test`, and the focused Playwright spec; run `npm run build` after the API/schema changes.

### Phase 5 - Documentation and status
- [ ] Update README/user-facing documentation with supported receipt fields, annual summary semantics, export contents, and CRA/accountant qualification language.
- [ ] Mark the requirement and plan tasks complete only after code, migration, tests, and observable export behavior are verified.
- [ ] Record any legacy-data ambiguity, provider limitation, or pre-existing test failure in the final implementation status.

## Validation
- `npm run typecheck` must pass with the expanded client/server contracts.
- `npm test` must pass, including domain, provider, persistence, and export regressions.
- `npm run build` must pass after route and worker changes.
- `npx playwright test tests/e2e/receipts.spec.ts tests/e2e/canadian-tax-ready-receipts.spec.ts` must cover the edited receipt and export flow; add the dedicated spec when the existing fixture cannot cover filters and annual summaries.
- Observable checks must show: unknown tax remains unknown; Mixed Use allocation sums to the total within cent precision; legacy records remain readable; a Needs Review/Uncategorized row appears in CSV/PDF/ZIP; and exports contain a current-CRA/accountant reminder.
- Scope checks must show: the app copy identifies T1/T2125 self-employed preparation, annual output has a business-income section or an explicit staged/empty state, and no corporate T2/payroll/shareholder workflow is exposed.

## Rollback / Risk
- JSONB shape changes can affect old extraction results and immutable snapshots. Keep read compatibility and only write the new shape after schema validation.
- A generic legacy tax amount cannot be safely assigned to GST/HST/QST/PST/RST; preserve it as unknown and flag it for review rather than guessing.
- Annual aggregation can mislead if amounts are missing, foreign currency, refunded, or mixed-use. Summaries must carry unknown/review counts and the same qualification text as detail exports.
- SQL migration rollback should be additive: new nullable columns/indexes/functions can be removed independently, while old `fields` JSON remains intact.
- Worker/export changes must retain lease fencing and storage cleanup. If summary rendering fails, the export job should fail visibly and never mark receipts exported prematurely.
