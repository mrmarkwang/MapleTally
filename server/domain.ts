/** Receipt contract and deterministic checks. Amounts use integer cents; AI never approves. */
import { z } from "zod";
export const amount = z
  .number()
  .int()
  .min(-100_000_000)
  .max(100_000_000)
  .nullable();
export const fieldsSchema = z.object({
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
  category: z.string().trim().max(80),
});
export type Fields = z.infer<typeof fieldsSchema>;
export const emptyFields = (): Fields => ({
  merchant: "",
  date: "",
  subtotal: null,
  tax: null,
  tip: null,
  total: null,
  currency: "CAD",
  category: "Uncategorized",
});
export type ReceiptState =
  | "captured"
  | "processing"
  | "needs_review"
  | "approved"
  | "failed"
  | "duplicate_candidate"
  | "exported";
export function warnings(
  f: Fields,
  confidence: Record<string, number> = {},
): string[] {
  const result: string[] = [];
  if (!f.merchant || !f.date || f.total === null)
    result.push("Missing merchant, date or total. Check the original receipt.");
  if (Object.values(confidence).some((v) => v < 0.8))
    result.push(
      "Some extracted fields have low confidence. Check them against the original.",
    );
  if ([f.subtotal, f.tax, f.tip, f.total].every((v) => v !== null)) {
    const expected = f.subtotal! + f.tax! + f.tip!;
    if (Math.abs(expected - f.total!) > 2)
      result.push(
        `Amounts do not add up: subtotal + tax + tip = ${(expected / 100).toFixed(2)}, total = ${(f.total! / 100).toFixed(2)} ${f.currency}.`,
      );
  }
  if (f.currency !== "CAD")
    result.push(
      "Foreign currency: Canadian tax checks are not applied. No currency conversion has been made.",
    );
  else if (f.tax === null)
    result.push("Tax is unknown. Verify any GST/HST on the original.");
  else if (f.subtotal !== null && Math.abs(f.tax) > Math.abs(f.subtotal) * 0.2)
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
