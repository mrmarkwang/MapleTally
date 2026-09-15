-- MapleTally: additive tax-year indexing for T1/T2125 preparation records.
-- Legacy tax values remain untouched and are never assigned a tax type.
update public.receipts
set fields = jsonb_set(fields, '{tax_year}', to_jsonb((fields->>'date')::integer), true)
where coalesce(fields->>'tax_year', '') = ''
  and fields->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  and substring(fields->>'date' from 1 for 4)::integer between 1900 and 2200;

create index if not exists receipts_tax_year
  on public.receipts(workspace_id, ((fields->>'tax_year')));
create index if not exists receipts_tax_category
  on public.receipts(workspace_id, ((fields->>'category')));
create index if not exists receipts_tax_usage
  on public.receipts(workspace_id, ((fields->>'business_or_personal')));
