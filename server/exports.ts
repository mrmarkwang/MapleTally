/** Portable CSV/PDF/ZIP exports with approval status, warning details and immutable audit snapshots. */
import PDFDocument from "pdfkit";
import { csvCell } from "./domain";
import type { Row } from "./supabase";
export function exportCsv(rows: Row[]) {
  const columns = [
    "id",
    "filename",
    "state",
    "merchant",
    "date",
    "subtotal",
    "tax",
    "tip",
    "total",
    "currency",
    "category",
    "warnings",
    "approved_at",
  ];
  return (
    "\uFEFF" +
    [
      columns.map(csvCell).join(","),
      ...rows.map((r) =>
        columns
          .map((k) => {
            const value = ["subtotal", "tax", "tip", "total"].includes(k)
              ? r.fields[k] == null
                ? ""
                : (r.fields[k] / 100).toFixed(2)
              : k === "warnings"
                ? r.warnings.join("; ")
                : (r.fields[k] ?? r[k]);
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
  doc.fontSize(24).text("MapleTally").fontSize(14).text(workspace).moveDown();
  doc
    .fontSize(10)
    .text(
      `Receipt report · ${new Date().toISOString().slice(0, 10)} · ${rows.length} records`,
    )
    .moveDown();
  doc
    .text(
      "Amounts are in each receipt’s currency. Unapproved records are included and labelled. Warnings are arithmetic checks, not tax advice.",
    )
    .moveDown();
  for (const r of rows) {
    if (doc.y > 610) doc.addPage();
    doc
      .fontSize(13)
      .text(r.fields.merchant || r.filename)
      .fontSize(9);
    doc.text(
      `${r.fields.date || "Date unknown"} | ${r.state.replaceAll("_", " ")} | ${r.fields.category}`,
    );
    doc.text(
      `Subtotal: ${money(r.fields.subtotal)}  Tax: ${money(r.fields.tax)}  Tip: ${money(r.fields.tip)}  Total: ${money(r.fields.total)} ${r.fields.currency}`,
    );
    doc.text(`Original: ${r.filename} | ID: ${r.id}`);
    doc.text(`Approved: ${r.approved_at || "Not approved"}`);
    for (const warning of r.warnings) doc.text(`Check: ${warning}`);
    doc.moveDown();
  }
  doc.end();
  return result;
}
function money(n: number | null) {
  return n === null ? "unknown" : (n / 100).toFixed(2);
}
