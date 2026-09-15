# E2E scenarios: Canadian tax-ready receipt records

## Scenario 0: Confirm the first-phase product boundary

1. Open the signed-in workspace or onboarding surface.
2. Verify the product describes itself as preparation support for Canadian individual/self-employed T1 and T2125 records.
3. Verify the workspace offers or clearly stages business income/invoice/platform-income, vehicle mileage, home-office, and equipment/capital-asset records.
4. Verify there is no T2, payroll, shareholder compensation/dividend, full personal tax-calculation, or direct CRA-submission workflow.

## Scenario 1: Review and allocate a Mixed Use receipt

1. Sign in and upload a valid receipt fixture.
2. Open the receipt after processing.
3. Enter `merchant`, `date`, `subtotal`, one explicit tax field such as `gst` or `hst`, `tip`, `total`, `province`, `payment_method`, and a supported `category`.
4. Set `business_or_personal` to Mixed Use and enter `business_use_percent`.
5. Save and confirm the record.
6. Verify the review view displays `business_amount`, `personal_amount`, separate tax fields, `tax_year`, `category_status`, and `itc_status`.
7. Verify the record is still labelled as organization/review data and does not claim deductibility.

## Scenario 2: Filter the receipt ledger

1. Create or use receipts across two transaction years, categories, provinces, tax types, vendors, usage classifications, and review states.
2. Filter by tax year, month/date, category, province, tax type, usage classification, review status, and vendor.
3. Verify the result set composes the selected filters and unknown values remain findable through the review/unknown status.

## Scenario 3: Export an unresolved annual set

1. Keep at least one receipt Uncategorized, one Needs Review, one with Unknown tax/ITC state, and one duplicate candidate.
2. Request CSV, PDF, and ZIP exports for the selected tax year.
3. Verify export creation is not blocked.
4. Verify CSV includes the required receipt detail and status columns, PDF includes category/business/personal/tax summaries and review lists, and ZIP includes CSV/PDF plus original receipt files.
5. Verify every artifact labels unresolved values and includes the reminder to verify current CRA rules or consult an accountant.

## Scenario 4: Prepare a self-employed annual handoff

1. Create business income records from an invoice or platform-income source, receipt expenses, a vehicle mileage record, a home-office record, and an equipment/capital-asset record, or verify the explicit staged state for any not-yet-implemented record type.
2. Select a tax year and open the annual preparation summary.
3. Verify the summary separates business income from T2125 expense categories and lists mileage, home office, and capital assets in review sections rather than treating them as ordinary receipt expenses.
4. Verify PDF, CSV, and receipt ZIP output is described as material for the user's T1/T2125 return or accountant handoff, not as a completed tax return.
