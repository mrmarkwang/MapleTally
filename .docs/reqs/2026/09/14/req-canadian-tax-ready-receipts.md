# Canadian tax-ready receipt records

## Problem
MapleTally currently stores one undifferentiated tax amount and a general category. It cannot preserve the tax types, business-use allocation, Canadian tax-year metadata, ITC review state, or tax-specific review notes needed to organize receipts for a later T2125-oriented summary. Its exports therefore cannot give a user or accountant a reliable, clearly qualified record set without re-reading every original receipt.

## Product Scope
MapleTally is a tax-information organization and tax-return preparation app for Canadian individuals and self-employed people. Phase 1 focuses on sole proprietors, contractors, freelancers, gig workers, and other people reporting self-employed business activity in a personal T1 return using CRA T2125 business income and expenses. It may optionally organize GST/HST/QST records, but it does not file a return or make final tax decisions.

The first-phase audience includes platform drivers such as Uber, DoorDash, and Skip workers; photographers, designers, programmers, real-estate agents, cleaners, renovators, repair workers, small online-store operators, independent consultants, and other unincorporated sole proprietors. The product language should consistently describe records as preparation material for the user's T1/T2125 filing or accountant handoff.

## Requirement
For image, PDF, and verified forwarded-email receipts, MapleTally must retain OCR/extracted receipt facts and the original file while allowing the user to review and correct them. Each receipt must support vendor, transaction date, subtotal, tip, total, currency, payment method, original-file metadata, province, tax year, separate GST/HST/QST/PST/RST tax fields, a CRA/T2125-aligned suggested category, category confidence and review status, Business/Personal/Mixed Use, business-use percentage, calculated business and personal portions, ITC review status, and notes.

The broader Phase 1 ledger must also have a path for business income and invoice/platform-income records, vehicle mileage, home-office records, and equipment/capital-asset records so the annual preparation package can identify them and provide the appropriate review prompt. Receipt capture remains the first implementation slice; income, mileage, home-office, and asset records must not be represented as ordinary receipt expenses merely to fit the existing model.

The system must keep tax fields separate from expense categories, never turn uncertain tax or classification data into confirmed deductibility, and surface concise review prompts for meals, vehicles, home office, equipment/capital assets, missing tax, arithmetic mismatches, date anomalies, blurry/low-confidence extraction, duplicates, and suspected personal expenses.

The canonical receipt field names are: `merchant`, `date`, `subtotal`, `tip`, `total`, `currency`, `payment_method`, `province`, `tax_year`, `gst`, `hst`, `qst`, `pst`, `rst`, `category`, `category_status`, `business_or_personal`, `business_use_percent`, `business_amount`, `personal_amount`, `itc_status`, and `notes`. All monetary fields are nullable integer cents; tax fields are never collapsed into `category`. `category` is one of Advertising, Meals and Entertainment, Travel, Motor Vehicle Expenses, Office Expenses, Office Supplies, Professional Fees, Insurance, Rent, Utilities, Bank Charges, Delivery/Freight, Capital Assets/CCA Review, or Other Expenses. `category_status` and `review_status` use Suggested, Confirmed, or Needs Review. `business_or_personal` uses Business, Personal, or Mixed Use; Mixed Use requires `business_use_percent` from 0 through 100. `tax_year` is derived from a valid `date`; missing dates use Unknown. `itc_status` uses Possible, Not Indicated, Needs Review, or Unknown.

Users must be able to filter records by tax year, month/date, category, province, tax type, business-use classification, review status, and vendor. Annual summaries must include T2125-category totals, business and personal portions, each tax type, possible ITC items, special-limitation review items, and incomplete/uncategorized/duplicate records. CSV detail, PDF summary, and ZIP original-receipt exports must remain available even when records are Uncategorized, Unknown, or Needs Review, with those labels and a clear non-tax-advice qualification included in the artifacts.

MapleTally must describe the output as tax-ready organization only. It must not claim to file taxes or guarantee deductibility, ITC eligibility, CCA treatment, meal limits, vehicle treatment, or home-office treatment; users must be directed to current CRA guidance or an accountant for final decisions.

## Acceptance Criteria
- [ ] Extracted and manually edited records preserve separate nullable GST, HST, QST, PST, and RST values, plus subtotal, tip, total, currency, payment method, province, and original-file metadata.
- [ ] Every record has a validated tax year derived from its transaction date, and records with missing or invalid dates are explicitly marked Unknown/Needs Review rather than silently assigned.
- [ ] The canonical field names, category enum, usage enum, ITC enum, and nullable/required semantics are enforced by the server schema and are documented for the client/API.
- [ ] Category suggestions are limited to the supported CRA/T2125-aligned category set and expose confidence plus Suggested, Confirmed, or Needs Review status.
- [ ] Every record has Business, Personal, or Mixed Use; Mixed Use requires a 0-100 business-use percentage, and business/personal amounts are calculated from the total expense amount without absorbing tips or tax into a category label.
- [ ] ITC is represented as a review state such as Possible, Not indicated, or Needs Review and is never presented as guaranteed eligible.
- [ ] Validation detects duplicate candidates, missing tax amounts, arithmetic mismatches, anomalous dates, low-confidence/blurred extraction, and suspected personal expenses, while retaining the original receipt.
- [ ] The receipt list can filter by tax year, month/date, category, province, tax type, Business/Personal/Mixed Use, review status, and vendor.
- [ ] Annual summary output includes category totals, business portion, personal portion, GST/HST/QST/PST/RST totals, possible ITC records, special-limitation records, and incomplete/uncategorized/duplicate lists.
- [ ] The product scope and annual preparation model include business income/invoice/platform-income records, vehicle mileage, home-office records, and equipment/capital-asset records as distinct record types or explicitly staged capabilities, with no silent conversion into ordinary receipt expenses.
- [ ] CSV, PDF, and ZIP exports are not blocked by unresolved records; exports label Uncategorized, Unknown, Needs Review, and unresolved tax/ITC states and include a reminder to verify current CRA rules or consult an accountant.
- [ ] Unit, persistence/migration, and user-facing E2E coverage verifies schema validation, allocation arithmetic, tax-year grouping, filters, annual totals, and export inclusion of unresolved records.

## Constraints
- Preserve integer-cents arithmetic and nullable unknown values; do not coerce unknown values to zero.
- Preserve tenant isolation, signed original-file access, immutable export snapshots, existing upload/email ingestion, quota behavior, and optimistic version checks.
- Existing records and exports must remain readable during migration; legacy single `tax` data needs an explicit compatibility mapping or clearly labelled legacy value.
- Tax categories and review prompts are organizational guidance, not tax advice. Do not make automated legal or deductibility determinations.
- Keep exports formula-safe and avoid exposing private storage keys or unrelated workspace data.

## Non-Goals
- Filing or directly submitting a T1, T2125, GST/HST return, or any other tax return on the user's behalf.
- Guaranteeing ITC eligibility, CCA treatment, meal deductibility, vehicle deductibility, or home-office deductibility.
- Corporate T2 filing, incorporated-company accounting, payroll, shareholder salary, shareholder dividends, or other complex corporate features.
- Full personal tax calculation, automated CRA submission, or automatic judgment of every deduction qualification.
- Automatic bank reconciliation, exchange-rate conversion, or accountant portal sharing.
- Replacing OCR/provider abstractions or redesigning authentication, billing, storage, and worker leasing beyond fields needed for this requirement.

## Positioning
The first-phase product promise is: “Track your freelance expenses today. Prepare your Canadian tax return with confidence next year.” This is preparation support for T1/T2125 self-employed business records, not completed tax filing or tax advice.
