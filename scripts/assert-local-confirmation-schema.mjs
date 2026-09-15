/** Assert that local PostgREST exposes only the current receipt-confirmation RPC contract. */
import assert from "node:assert/strict";

const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
assert.ok(baseUrl, "NEXT_PUBLIC_SUPABASE_URL is required.");
assert.ok(secret, "SUPABASE_SECRET_KEY is required.");

const response = await fetch(`${baseUrl}/rest/v1/`, {
  headers: { apikey: secret, Authorization: `Bearer ${secret}` },
});
assert.equal(response.ok, true, `PostgREST schema request failed: ${response.status}`);
const schema = await response.json();
const current = schema.paths?.["/rpc/confirm_receipt"]?.post;
assert.ok(current, "PostgREST does not expose /rpc/confirm_receipt.");
assert.equal(
  schema.paths?.["/rpc/approve_receipt"],
  undefined,
  "PostgREST still exposes obsolete /rpc/approve_receipt.",
);
const bodyParameter = current.parameters?.find(
  (parameter) => parameter.in === "body" && parameter.name === "args",
);
assert.deepEqual(
  Object.keys(bodyParameter?.schema?.properties || {}).sort(),
  ["acknowledge", "expected", "receipt", "w"],
);
console.log("Local receipt-confirmation RPC schema is current.");
