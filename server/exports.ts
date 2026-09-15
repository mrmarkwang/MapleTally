/** Portable CSV/PDF/ZIP exports with tax-ready summaries, unresolved labels, and immutable audit snapshots. */
import PDFDocument from "pdfkit";
import { csvCell } from "./domain";
import { normalizeFields, TAX_TYPES } from "./domain";
import type { Row } from "./supabase";
function exportRows(rows: Row[]): Row[] {
  return rows.map((row) => ({ ...row, fields: normalizeFields(row.fields) }));
}
export function exportCsv(rows: Row[]) {
  const columns = [
    "id",
    "filename",
    "state",
    "merchant",
    "date",
    "tax_year",
    "subtotal",
    "gst",
    "hst",
    "qst",
    "pst",
    "rst",
    "tax",
    "tip",
    "total",
    "currency",
    "payment_method",
    "province",
    "category",
    "category_status",
    "business_or_personal",
    "business_use_percent",
    "business_amount",
    "personal_amount",
    "itc_status",
    "review_status",
    "confidence",
    "warnings",
    "notes",
    "confirmed_at",
  ];
  const normalized = exportRows(rows);
  return (
    "\uFEFF" +
    [
      columns.map(csvCell).join(","),
      ...normalized.map((r) =>
        columns
          .map((k) => {
            const value = ["subtotal", "tax", "gst", "hst", "qst", "pst", "rst", "tip", "total", "business_amount", "personal_amount"].includes(k)
              ? r.fields[k] == null
                ? ""
                : (r.fields[k] / 100).toFixed(2)
              : k === "warnings"
                ? r.warnings.join("; ")
                : k === "confidence"
                  ? JSON.stringify(r.confidence || {})
                  : (r.fields[k] ?? r[k] ?? "");
            return csvCell(value);
          })
          .join(","),
      ),
    ].join("\r\n")
  );
}
export async function exportPdf(
  rows: Row[],
  workspace: string,
): Promise<Buffer> {
  const doc = new PDFDocument({
    margin: 48,
    size: "LETTER",
    info: { Title: "MapleTally receipt report" },
  });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const normalized = exportRows(rows);
  const summary = summarize(normalized);
  doc.fontSize(24).text("MapleTally").fontSize(14).text(workspace).moveDown();
  doc
    .fontSize(10)
    .text(
      `Receipt report · ${new Date().toISOString().slice(0, 10)} · ${rows.length} records`,
    )
    .moveDown();
  doc
    .text(
      "Canadian T1/T2125 preparation material only. Unresolved records are included and labelled. Verify current CRA rules or consult an accountant; this is not tax advice or a filed return.",
    )
    .moveDown();
  doc.fontSize(12).text("Annual preparation summary").fontSize(9);
  doc.text(`Records: ${summary.records} | Business portion: ${money(summary.business)} | Personal portion: ${money(summary.personal)}`);
  doc.text(`Tax totals: ${TAX_TYPES.map((key) => `${key.toUpperCase()} ${money(summary.taxes[key])}`).join("  ")}`);
  doc.text(`Possible ITC review: ${summary.possibleItc} | Needs review or incomplete: ${summary.needsReview}`);
  doc.moveDown();
  doc.fontSize(12).text("By T2125 category").fontSize(9);
  for (const [category, total] of Object.entries(summary.categories)) doc.text(`${category}: ${money(total)}`);
  doc.moveDown();
  for (const r of normalized) {
    if (doc.y > 610) doc.addPage();
    doc
      .fontSize(13)
      .text(r.fields.merchant || r.filename)
      .fontSize(9);
    doc.text(
      `${r.fields.date || "Date unknown"} | ${r.state.replaceAll("_", " ")} | ${r.fields.category}`,
    );
    doc.text(
      `Subtotal: ${money(r.fields.subtotal)}  GST/HST/QST/PST/RST: ${TAX_TYPES.map((key) => money(r.fields[key])).join("/")}  Tip: ${money(r.fields.tip)}  Total: ${money(r.fields.total)} ${r.fields.currency}`,
    );
    doc.text(`Usage: ${r.fields.business_or_personal} | Business: ${money(r.fields.business_amount)} | Personal: ${money(r.fields.personal_amount)} | ITC: ${r.fields.itc_status}`);
    doc.text(`Original: ${r.filename} | ID: ${r.id}`);
    doc.text(`Confirmed: ${r.confirmed_at || "Not confirmed"}`);
    for (const warning of r.warnings) doc.text(`Check: ${warning}`);
    doc.moveDown();
  }
  doc.end();
  return result;
}
function money(n: number | null) {
  return n === null ? "unknown" : (n / 100).toFixed(2);
}
function summarize(rows: Row[]) {
  const categories: Record<string, number> = {};
  const taxes = Object.fromEntries(TAX_TYPES.map((key) => [key, 0])) as Record<(typeof TAX_TYPES)[number], number>;
  let business = 0;
  let personal = 0;
  let possibleItc = 0;
  let needsReview = 0;
  for (const row of rows) {
    const fields = row.fields;
    if (fields.business_amount !== null) business += fields.business_amount;
    if (fields.personal_amount !== null) personal += fields.personal_amount;
    categories[fields.category] = (categories[fields.category] || 0) + (fields.business_amount ?? fields.total ?? 0);
    for (const key of TAX_TYPES) taxes[key] += fields[key] || 0;
    if (fields.itc_status === "Possible") possibleItc++;
    if (row.state !== "confirmed" && row.state !== "exported" || fields.category === "Uncategorized" || fields.review_status === "Needs Review") needsReview++;
  }
  return { records: rows.length, categories, taxes, business, personal, possibleItc, needsReview };
}
