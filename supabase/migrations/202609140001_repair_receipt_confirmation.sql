-- Forward repair for databases initialized before approval terminology changed to confirmation.

-- The legacy constraint rejects the replacement value, so remove it before data conversion.
alter table public.receipts drop constraint if exists receipts_state_check;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='receipts' and column_name='approved_at'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='receipts' and column_name='confirmed_at'
  ) then
    alter table public.receipts rename column approved_at to confirmed_at;
  elsif exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='receipts' and column_name='approved_at'
  ) then
    update public.receipts
    set confirmed_at=coalesce(confirmed_at,approved_at);
    alter table public.receipts drop column approved_at;
  end if;
end $$;

update public.receipts set state='confirmed' where state='approved';

alter table public.receipts add constraint receipts_state_check check(
  state in ('captured','processing','needs_review','confirmed','failed','duplicate_candidate','exported')
);

create or replace function public.edit_receipt(w uuid, receipt uuid, expected integer, new_fields jsonb, new_warnings jsonb, new_key text) returns public.receipts language plpgsql set search_path = '' as $$
declare r public.receipts; duplicate uuid;
begin
 perform public.lock_workspace(w);
 select * into r from public.receipts where id=receipt and workspace_id=w for update;
 if not found then raise exception 'receipt not found'; end if;
 if r.version<>expected then raise exception 'stale receipt; reopen before saving'; end if;
 select id into duplicate from public.receipts where workspace_id=w and id<>receipt and duplicate_key=new_key order by created limit 1;
 insert into public.revisions(receipt_id,fields) values(receipt,r.fields);
 update public.receipts set fields=new_fields,warnings=new_warnings,duplicate_key=new_key,duplicate_of=duplicate,duplicate_ack=false,
 state=case when duplicate is null then 'needs_review' else 'duplicate_candidate' end,confirmed_at=null,error=null,version=version+1,updated=now() where id=receipt returning * into r;
 delete from public.jobs where kind='receipt' and target=receipt;
 return r;
end $$;

drop function if exists public.approve_receipt(uuid,uuid,integer,boolean);

create or replace function public.confirm_receipt(w uuid, receipt uuid, expected integer, acknowledge boolean) returns public.receipts language plpgsql set search_path = '' as $$
declare r public.receipts; duplicate uuid;
begin
 perform public.lock_workspace(w);
 select * into r from public.receipts where id=receipt and workspace_id=w for update;
 if not found then raise exception 'receipt not found'; end if;
 if r.version<>expected then raise exception 'stale receipt; reopen before confirming'; end if;
 if coalesce(r.fields->>'merchant','')='' or coalesce(r.fields->>'date','')='' or r.fields->>'total' is null then raise exception 'merchant, date and total required'; end if;
 select id into duplicate from public.receipts where workspace_id=w and id<>receipt and duplicate_key=r.duplicate_key order by created limit 1;
 if duplicate is not null and not acknowledge then raise exception 'duplicate: confirm this is a separate expense'; end if;
 update public.receipts set state='confirmed',duplicate_of=duplicate,duplicate_ack=acknowledge,confirmed_at=now(),updated=now(),version=version+1 where id=receipt returning * into r;
 delete from public.jobs where kind='receipt' and target=receipt;
 return r;
end $$;

create or replace function public.complete_export_job(job uuid, token uuid, object_key text) returns boolean language plpgsql set search_path = '' as $$
declare j public.jobs; e public.exports; entry jsonb;
begin
 j := public.lock_job(job,token);
 if j.id is null then return false; end if;
 update public.exports set status='complete',object_key=complete_export_job.object_key,error=null where id=j.target returning * into e;
 for entry in select * from jsonb_array_elements(e.snapshot) loop
  update public.receipts set state='exported' where id=(entry->>'id')::uuid and version=(entry->>'version')::integer and state='confirmed';
 end loop;
 delete from public.jobs where id=job; return true;
end $$;

revoke all on function public.edit_receipt(uuid,uuid,integer,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.confirm_receipt(uuid,uuid,integer,boolean) from public,anon,authenticated;
revoke all on function public.complete_export_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.edit_receipt(uuid,uuid,integer,jsonb,jsonb,text) to service_role;
grant execute on function public.confirm_receipt(uuid,uuid,integer,boolean) to service_role;
grant execute on function public.complete_export_job(uuid,uuid,text) to service_role;

notify pgrst, 'reload schema';
