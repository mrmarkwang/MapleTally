/** Domain regressions: money, unknowns, refunds, invalid dates and export formula injection. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldsSchema, emptyFields, warnings, duplicateKey, csvCell, normalizeFields, allocation } from '../server/domain.js';
const f = { ...emptyFields(), merchant: 'Maple Café', date: '2026-09-12', subtotal: 1000, tax: 130, tip: 200, total: 1330, category: 'Office Supplies' as const };
test('integer cents preserve arithmetic and two-cent rounding tolerance', () => {
  assert.deepEqual(warnings(f), []);
  assert.equal(warnings({ ...f, total: 1332 }).length, 0);
  assert.match(warnings({ ...f, total: 1400 })[0], /do not add up/);
  assert.equal(fieldsSchema.safeParse({ ...f, total: 13.3 }).success, false);
});
test('unknown values do not turn into zero; foreign currency and refunds are labelled', () => {
  assert.equal(fieldsSchema.parse(emptyFields()).total, null);
  assert.ok(warnings(emptyFields()).some(w => w.includes('unknown')));
  assert.ok(warnings({ ...f, currency: 'USD' }).some(w => w.includes('Foreign currency')));
  assert.ok(warnings({ ...f, subtotal: -1000, tax: -130, tip: -200, total: -1330 }).some(w => w.includes('Refund')));
});
test('date validation rejects calendar overflow and malformed values', () => {
  for (const date of ['2026-02-30', '2026-99-01', '09/12/2026', 'not-a-date']) assert.equal(fieldsSchema.safeParse({ ...f, date }).success, false);
  assert.equal(fieldsSchema.safeParse({ ...f, date: '2024-02-29' }).success, true);
});
test('duplicates normalize merchant formatting but preserve currency and amount', () => {
  assert.equal(duplicateKey(f), duplicateKey({ ...f, merchant: 'MAPLE-café!' }));
  assert.notEqual(duplicateKey(f), duplicateKey({ ...f, currency: 'USD' }));
  assert.equal(duplicateKey(emptyFields()), null);
});
test('CSV neutralizes formulas and escapes quotes and embedded newlines', () => {
  assert.equal(csvCell('=HYPERLINK("evil")'), '"\'=HYPERLINK(""evil"")"');
  assert.equal(csvCell('  +123'), '"\'  +123"');
  assert.equal(csvCell('a,b\nc'), '"a,b\nc"');
});
test('tax-ready normalization keeps legacy tax type unknown and derives tax year', () => {
  const fields = normalizeFields({ ...emptyFields(), merchant: 'Legacy shop', date: '2025-03-01', tax: 130, total: 1130 });
  assert.equal(fields.tax, 130);
  assert.equal(fields.gst, null);
  assert.equal(fields.hst, null);
  assert.equal(fields.tax_year, 2025);
  assert.equal(normalizeFields({ ...emptyFields(), date: '' }).tax_year, 'Unknown');
  assert.equal(fieldsSchema.parse({ ...fields, category: 'Office supplies' }).category, 'Office Supplies');
  assert.equal(normalizeFields({ ...fields, category: 'hardware' }).category, 'Uncategorized');
});
test('Mixed Use allocation preserves total cents and requires an explicit percentage', () => {
  assert.deepEqual(allocation(1000, 'Mixed Use', 65), { business_amount: 650, personal_amount: 350 });
  assert.deepEqual(allocation(1001, 'Mixed Use', 50), { business_amount: 501, personal_amount: 500 });
  assert.deepEqual(allocation(1000, 'Mixed Use', null), { business_amount: null, personal_amount: null });
  const parsed = fieldsSchema.parse({ ...emptyFields(), merchant: 'Studio', date: '2026-01-01', total: 1000, business_or_personal: 'Mixed Use', business_use_percent: 25, category: 'Office Expenses' });
  assert.deepEqual([parsed.business_amount, parsed.personal_amount], [250, 750]);
});
test('unresolved category and Mixed Use are review warnings', () => {
  const fields = normalizeFields({ ...emptyFields(), merchant: 'Unknown', date: '2026-01-01', total: 1000, business_or_personal: 'Mixed Use' });
  assert.ok(warnings(fields).some((warning) => warning.includes('category')));
  assert.ok(warnings(fields).some((warning) => warning.includes('Mixed Use')));
});
