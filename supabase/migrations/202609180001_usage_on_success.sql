-- Count successful processing once per receipt. Deletion intentionally keeps usage.
alter table public.usage add column if not exists receipt_id uuid references public.receipts on delete set null;
create unique index if not exists usage_receipt on public.usage(receipt_id) where receipt_id is not null;

create or replace function public.finish_upload(w uuid, upload_id uuid, file_hash text, object_key text, actual_mime text, empty_fields jsonb) returns public.receipts language plpgsql set search_path = '' as $$
declare u public.uploads; result public.receipts;
begin
 perform public.lock_workspace(w);
 select * into u from public.uploads where id=upload_id and workspace_id=w for update;
 if not found then raise exception 'upload not found'; end if;
 if u.receipt_id is not null then select * into result from public.receipts where id=u.receipt_id; return result; end if;
 if u.expires<now() then raise exception 'upload expired'; end if;
 select * into result from public.receipts where workspace_id=w and hash=file_hash;
 if found then update public.uploads set receipt_id=result.id where id=upload_id; return result; end if;
 insert into public.receipts(workspace_id,filename,mime,hash,object_key,fields) values(w,u.filename,actual_mime,file_hash,object_key,empty_fields) returning * into result;
 update public.uploads set receipt_id=result.id where id=upload_id;
 insert into public.jobs(workspace_id,kind,target) values(w,'receipt',result.id);
 return result;
end $$;

create or replace function public.complete_receipt_job(job uuid, token uuid, extracted jsonb, confidence jsonb, warnings jsonb, duplicate_key text, raw jsonb, usage jsonb) returns boolean language plpgsql set search_path = '' as $$
declare j public.jobs; r public.receipts; duplicate uuid;
begin
 j := public.lock_job(job,token);
 if j.id is null then return false; end if;
 select * into r from public.receipts where id=j.target for update;
 if not found or r.version<>(j.payload->>'version')::integer then delete from public.jobs where id=job; return false; end if;
 select id into duplicate from public.receipts where workspace_id=r.workspace_id and id<>r.id and receipts.duplicate_key=complete_receipt_job.duplicate_key order by created limit 1;
 insert into public.attempts(receipt_id,status,response,usage) values(r.id,'complete',raw,usage);
 update public.receipts set fields=extracted,original=extracted,confidence=complete_receipt_job.confidence,warnings=complete_receipt_job.warnings,
 duplicate_key=complete_receipt_job.duplicate_key,duplicate_of=duplicate,state=case when duplicate is null then 'needs_review' else 'duplicate_candidate' end,
 error=null,version=version+1,updated=now() where id=r.id;
 if duplicate is null then
   insert into public.usage(workspace_id,receipt_id) values(r.workspace_id,r.id) on conflict (receipt_id) do nothing;
 end if;
 delete from public.jobs where id=job;
 return true;
end $$;

create or replace function public.confirm_receipt(w uuid, receipt uuid, expected integer, acknowledge boolean) returns public.receipts language plpgsql set search_path = '' as $$
declare r public.receipts; duplicate uuid;
begin
 perform public.lock_workspace(w);
 select * into r from public.receipts where id=receipt and workspace_id=w for update;
 if not found then raise exception 'receipt not found'; end if;
 if r.version<>expected then raise exception 'stale receipt; reopen before confirming'; end if;
 if coalesce(r.fields->>'merchant','')='' or coalesce(r.fields->>'date','')='' or r.fields->>'total' is null then raise exception 'merchant, date and total required'; end if;
 select id into duplicate from public.receipts where workspace_id=w and id<>r.id and duplicate_key=r.duplicate_key order by created limit 1;
 if duplicate is not null and not acknowledge then raise exception 'duplicate: confirm this is a separate expense'; end if;
 update public.receipts set state='confirmed',duplicate_of=duplicate,duplicate_ack=acknowledge,confirmed_at=now(),updated=now(),version=version+1 where id=receipt returning * into r;
 if duplicate is null or acknowledge then
   insert into public.usage(workspace_id,receipt_id) values(w,r.id) on conflict (receipt_id) do nothing;
 end if;
 delete from public.jobs where kind='receipt' and target=receipt;
 return r;
end $$;