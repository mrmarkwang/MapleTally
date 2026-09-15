/** Receipt contract and deterministic checks. Amounts use integer cents; AI never confirms. Canadian tax-ready fields normalize legacy receipts without guessing tax types. */
import { z } from "zod";
const amount = z
  .number()
  .int()
  .min(-100_000_000)
  .max(100_000_000)
  .nullable();
export const TAX_TYPES = ["gst", "hst", "qst", "pst", "rst"] as const;
export const CATEGORIES = [
  "Advertising",
  "Meals and Entertainment",
  "Travel",
  "Motor Vehicle Expenses",
  "Office Expenses",
  "Office Supplies",
  "Professional Fees",
  "Insurance",
  "Rent",
  "Utilities",
  "Bank Charges",
  "Delivery/Freight",
  "Capital Assets/CCA Review",
  "Other Expenses",
  "Uncategorized",
] as const;
export const USAGE_TYPES = ["Business", "Personal", "Mixed Use"] as const;
export const REVIEW_STATUSES = ["Suggested", "Confirmed", "Needs Review"] as const;
export const ITC_STATUSES = ["Possible", "Not Indicated", "Needs Review", "Unknown"] as const;
const optionalAmount = amount.optional();
const rawFieldsSchema = z.object({
  merchant: z.string().trim().max(200),
  date: z
    .string()
    .refine(
      (v) =>
        v === "" ||
        (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
          Number.isFinite(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v),
      "Use a valid date",
    ),
  subtotal: amount,
  tax: amount,
  tip: amount,
  total: amount,
  currency: z.string().regex(/^[A-Z]{3}$/),
  category: z.enum(CATEGORIES).default("Uncategorized"),
  payment_method: z.string().trim().max(80).default(""),
  province: z.string().trim().max(40).default(""),
  tax_year: z.union([z.number().int().min(1900).max(2200), z.literal("Unknown")]).default("Unknown"),
  gst: optionalAmount,
  hst: optionalAmount,
  qst: optionalAmount,
  pst: optionalAmount,
  rst: optionalAmount,
  category_status: z.enum(REVIEW_STATUSES).default("Confirmed"),
  business_or_personal: z.enum(USAGE_TYPES).default("Business"),
  business_use_percent: z.number().int().min(0).max(100).nullable().optional(),
  business_amount: optionalAmount,
  personal_amount: optionalAmount,
  itc_status: z.enum(ITC_STATUSES).default("Unknown"),
  review_status: z.enum(REVIEW_STATUSES).default("Needs Review"),
  notes: z.string().trim().max(2000).default(""),
});
export type Fields = z.infer<typeof rawFieldsSchema> & {
  business_use_percent: number | null;
  gst: number | null;
  hst: number | null;
  qst: number | null;
  pst: number | null;
  rst: number | null;
  business_amount: number | null;
  personal_amount: number | null;
};
export function taxYearFromDate(date: string): number | "Unknown" {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
    ? Number(date.slice(0, 4))
    : "Unknown";
}
export function allocation(total: number | null, usage: Fields["business_or_personal"], percent: number | null) {
  if (total === null) return { business_amount: null, personal_amount: null };
  const businessPercent = usage === "Business" ? 100 : usage === "Personal" ? 0 : percent;
  if (businessPercent === null || businessPercent === undefined) return { business_amount: null, personal_amount: null };
  const businessAmount = Math.round((total * businessPercent) / 100);
  return { business_amount: businessAmount, personal_amount: total - businessAmount };
}
export function normalizeFields(input: unknown): Fields {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const categoryAliases: Record<string, (typeof CATEGORIES)[number]> = {
    "office supplies": "Office Supplies",
    "office expenses": "Office Expenses",
    "meals & entertainment": "Meals and Entertainment",
    "meals and entertainment": "Meals and Entertainment",
    "professional services": "Professional Fees",
    "software & services": "Office Expenses",
    vehicle: "Motor Vehicle Expenses",
    uncategorized: "Uncategorized",
  };
  const rawCategory = typeof value.category === "string" ? value.category.trim() : "";
  const category = categoryAliases[rawCategory.toLowerCase()] || rawCategory || "Uncategorized";
  const parsed = rawFieldsSchema.parse({
    ...value,
    category,
    tax: value.tax ?? null,
    gst: value.gst ?? null,
    hst: value.hst ?? null,
    qst: value.qst ?? null,
    pst: value.pst ?? null,
    rst: value.rst ?? null,
    business_use_percent: value.business_use_percent ?? null,
  });
  const taxYear = taxYearFromDate(parsed.date);
  const usage = parsed.business_or_personal;
  return {
    ...parsed,
    tax_year: taxYear,
    ...allocation(parsed.total, usage, parsed.business_use_percent ?? null),
  } as Fields;
}
export const fieldsSchema = z.preprocess(
  (input) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    return {
      ...value,
      category: value.category || "Uncategorized",
      tax: value.tax ?? null,
      gst: value.gst ?? null,
      hst: value.hst ?? null,
      qst: value.qst ?? null,
      pst: value.pst ?? null,
      rst: value.rst ?? null,
      business_use_percent: value.business_use_percent ?? null,
    };
  },
  rawFieldsSchema.transform((value) => normalizeFields(value)),
) as unknown as z.ZodType<Fields>;
export const emptyFields = (): Fields => normalizeFields({
  merchant: "",
  date: "",
  subtotal: null,
  tax: null,
  tip: null,
  total: null,
  currency: "CAD",
  category: "Uncategorized",
});
export function warnings(
  f: Fields,
  confidence: Record<string, number> = {},
): string[] {
  const result: string[] = [];
  if (!f.merchant || !f.date || f.total === null)
    result.push("Missing merchant, date or total. Check the original receipt.");
  if (f.business_or_personal === "Mixed Use" && f.business_use_percent === null)
    result.push("Mixed Use requires a business-use percentage.");
  if (f.category === "Uncategorized" || f.category_status === "Needs Review")
    result.push("Expense category is unresolved. Review it before using the annual summary.");
  if (f.business_or_personal === "Mixed Use" && (f.business_amount === null || f.personal_amount === null))
    result.push("Business and personal portions are unknown until usage is reviewed.");
  if (Object.values(confidence).some((v) => v < 0.8))
    result.push(
      "Some extracted fields have low confidence. Check them against the original.",
    );
  const taxTotal = f.tax !== null ? f.tax : TAX_TYPES.reduce((sum, key) => sum + (f[key] || 0), 0);
  const hasTax = f.tax !== null || TAX_TYPES.some((key) => f[key] !== null);
  if ([f.subtotal, f.tip, f.total].every((v) => v !== null) && hasTax) {
    const expected = f.subtotal! + taxTotal + f.tip!;
    if (Math.abs(expected - f.total!) > 2)
      result.push(
        `Amounts do not add up: subtotal + tax + tip = ${(expected / 100).toFixed(2)}, total = ${(f.total! / 100).toFixed(2)} ${f.currency}.`,
      );
  }
  if (f.currency !== "CAD")
    result.push(
      "Foreign currency: Canadian tax checks are not applied. No currency conversion has been made.",
    );
  else if (!hasTax)
    result.push("Tax is unknown. Verify any GST/HST/QST/PST/RST on the original.");
  else if (f.subtotal !== null && Math.abs(taxTotal) > Math.abs(f.subtotal) * 0.2)
    result.push(
      "Tax exceeds 20% of subtotal. Check the tax amount and what it includes.",
    );
  if (f.total !== null && f.total < 0)
    result.push(
      "Refund / credit: confirm negative amounts match the original.",
    );
  return result;
}
export function duplicateKey(f: Fields): string | null {
  if (!f.merchant || !f.date || f.total === null) return null;
  return [
    f.merchant.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""),
    f.date,
    f.total,
    f.currency,
  ].join("|");
}
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
