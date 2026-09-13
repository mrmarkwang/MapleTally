-- MapleTally: managed identities, RLS, atomic receipt mutations and fully fenced serverless jobs.
create table public.workspaces (
  id uuid primary key default gen_random_uuid(), user_id uuid unique not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 100), forwarding text unique not null default replace(gen_random_uuid()::text, '-', ''),
  customer text unique, subscription text, checkout_key uuid not null default gen_random_uuid(), checkout_session text, plan text not null default 'free' check (plan in ('free','paid')),
  paid_until timestamptz, deleting boolean not null default false, created timestamptz not null default now()
);
create function public.create_workspace() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspaces(user_id,name) values(new.id, left(coalesce(nullif(new.raw_user_meta_data->>'business',''), 'My business'),100));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_workspace();
create table public.receipts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  filename text not null, mime text not null, hash text not null, object_key text not null,
  state text not null default 'captured' check(state in ('captured','processing','needs_review','approved','failed','duplicate_candidate','exported')),
  fields jsonb not null, original jsonb, confidence jsonb not null default '{}', warnings jsonb not null default '[]',
  duplicate_key text, duplicate_of uuid, duplicate_ack boolean not null default false, error text,
  version integer not null default 1, approved_at timestamptz, created timestamptz not null default now(), updated timestamptz not null default now(),
  unique(workspace_id,hash)
);
create table public.uploads (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  filename text not null, mime text not null, receipt_id uuid references public.receipts on delete set null,
  expires timestamptz not null default now()+interval '2 hours', created timestamptz not null default now()
);
create table public.usage (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade, created timestamptz not null default now()
);
create table public.revisions (
  id uuid primary key default gen_random_uuid(), receipt_id uuid not null references public.receipts on delete cascade,
  fields jsonb not null, created timestamptz not null default now()
);
create table public.attempts (
  id uuid primary key default gen_random_uuid(), receipt_id uuid not null references public.receipts on delete cascade,
  status text not null, response jsonb, error text, usage jsonb, created timestamptz not null default now()
);
create table public.exports (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  format text not null check(format in ('csv','pdf','zip')), snapshot jsonb not null, status text not null default 'queued',
  object_key text, error text, created timestamptz not null default now()
);
create table public.jobs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  kind text not null check(kind in ('receipt','export','email','notification')), target uuid not null,
  payload jsonb not null default '{}', attempts integer not null default 0, run_at timestamptz not null default now(),
  lease_until timestamptz, lease_token uuid, status text not null default 'queued' check(status in ('queued','running','failed')),
  error text, created timestamptz not null default now(), unique(kind,target)
);
create table public.email_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  message_id text not null, storage_url text not null, status text not null default 'queued', created timestamptz not null default now(), unique(workspace_id,message_id)
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  message text not null, sent boolean not null default false, created timestamptz not null default now()
);
create table public.webhook_tokens(token text primary key, created timestamptz not null default now());
create table public.storage_deletions(bucket text not null, object_key text not null, due timestamptz not null default now(), primary key(bucket,object_key));
alter table public.storage_deletions enable row level security;
revoke all on public.storage_deletions from anon,authenticated;
grant all on public.storage_deletions to service_role;
create index receipts_workspace on public.receipts(workspace_id,created);
create index receipts_duplicates on public.receipts(workspace_id,duplicate_key);
create index job_ready on public.jobs(status,run_at);
create index usage_period on public.usage(workspace_id,created);

-- Read access only. All writes are validated in Next route handlers and server-only RPCs.
alter table public.workspaces enable row level security;
alter table public.receipts enable row level security;
alter table public.uploads enable row level security;
alter table public.usage enable row level security;
alter table public.revisions enable row level security;
alter table public.attempts enable row level security;
alter table public.exports enable row level security;
alter table public.jobs enable row level security;
alter table public.email_events enable row level security;
alter table public.notifications enable row level security;
alter table public.webhook_tokens enable row level security;
create policy workspace_read on public.workspaces for select to authenticated using(user_id=auth.uid());
create policy receipt_read on public.receipts for select to authenticated using(workspace_id in(select id from public.workspaces where user_id=auth.uid()));
create policy notification_read on public.notifications for select to authenticated using(workspace_id in(select id from public.workspaces where user_id=auth.uid()));
revoke all on public.workspaces, public.receipts, public.uploads, public.usage, public.revisions, public.attempts, public.exports, public.jobs, public.email_events, public.notifications, public.webhook_tokens from anon, authenticated;
grant select on public.workspaces,public.receipts,public.notifications to authenticated;
grant all on public.workspaces, public.receipts, public.uploads, public.usage, public.revisions, public.attempts, public.exports, public.jobs, public.email_events, public.notifications, public.webhook_tokens to service_role;

create function public.lock_workspace(w uuid) returns public.workspaces language plpgsql set search_path = '' as $$
declare result public.workspaces;
begin
 select * into result from public.workspaces where id=w for update;
 if not found or result.deleting then raise exception 'workspace not found or deleting'; end if;
 return result;
end $$;
create function public.quota(w uuid) returns jsonb language plpgsql set search_path = '' as $$
declare ws public.workspaces; used integer; reserved integer; paid boolean; maximum integer;
begin
 select * into ws from public.workspaces where id=w;
 paid := coalesce(ws.plan='paid' and ws.paid_until>now(),false); maximum:=case when paid then 500 else 25 end;
 select count(*) into used from public.usage where workspace_id=w and (not paid or created>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC');
 select count(*) into reserved from public.uploads where workspace_id=w and receipt_id is null and expires>now();
 return jsonb_build_object('plan',case when paid then 'paid' else 'free' end,'used',used,'reserved',reserved,'limit',maximum,'period',case when paid then 'this month' else 'lifetime' end,'canUpload',used+reserved<maximum);
end $$;
create function public.reserve_upload(w uuid, filename text, mime text) returns public.uploads language plpgsql set search_path = '' as $$
declare result public.uploads;
begin
 perform public.lock_workspace(w);
 if not (public.quota(w)->>'canUpload')::boolean then raise exception 'quota reached'; end if;
 insert into public.uploads(workspace_id,filename,mime) values(w,left(filename,200),mime) returning * into result;
 return result;
end $$;
create function public.finish_upload(w uuid, upload_id uuid, file_hash text, object_key text, actual_mime text, empty_fields jsonb) returns public.receipts language plpgsql set search_path = '' as $$
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
 insert into public.usage(workspace_id) values(w);
 insert into public.jobs(workspace_id,kind,target) values(w,'receipt',result.id);
 return result;
end $$;
create function public.finish_email_upload(w uuid, upload_id uuid, file_hash text, object_key text, actual_mime text, empty_fields jsonb, job uuid, token uuid) returns public.receipts language plpgsql set search_path = '' as $$
declare active_job public.jobs; result public.receipts;
begin
 perform public.lock_workspace(w);
 select * into active_job from public.jobs where id=finish_email_upload.job and workspace_id=w and kind='email' and lease_token=token and lease_until>now() for update;
 if not found then raise exception 'stale email job'; end if;
 result := public.finish_upload(w,upload_id,file_hash,object_key,actual_mime,empty_fields);
 return result;
end $$;
create function public.activate_upload(w uuid, upload_id uuid) returns public.uploads language plpgsql set search_path = '' as $$
declare result public.uploads;
begin
 perform public.lock_workspace(w);
 update public.uploads set expires=now()+interval '2 hours' where id=upload_id and workspace_id=w and receipt_id is null returning * into result;
 if not found then raise exception 'upload not found'; end if;
 return result;
end $$;
create function public.cancel_upload(w uuid, upload_id uuid) returns boolean language plpgsql set search_path = '' as $$
declare u public.uploads; cleanup_at timestamptz;
begin
 perform public.lock_workspace(w);
 select * into u from public.uploads where id=upload_id and workspace_id=w for update;
 if not found or u.receipt_id is not null then return false; end if;
 cleanup_at := greatest(u.expires,now())+interval '1 minute';
 insert into public.storage_deletions(bucket,object_key,due) values
  ('receipt-uploads',w::text||'/'||upload_id::text,cleanup_at),
  ('receipts',w::text||'/'||upload_id::text,cleanup_at)
 on conflict(bucket,object_key) do update set due=excluded.due;
 delete from public.uploads where id=upload_id;
 return true;
end $$;
create function public.edit_receipt(w uuid, receipt uuid, expected integer, new_fields jsonb, new_warnings jsonb, new_key text) returns public.receipts language plpgsql set search_path = '' as $$
declare r public.receipts; duplicate uuid;
begin
 perform public.lock_workspace(w);
 select * into r from public.receipts where id=receipt and workspace_id=w for update;
 if not found then raise exception 'receipt not found'; end if;
 if r.version<>expected then raise exception 'stale receipt; reopen before saving'; end if;
 select id into duplicate from public.receipts where workspace_id=w and id<>receipt and duplicate_key=new_key order by created limit 1;
 insert into public.revisions(receipt_id,fields) values(receipt,r.fields);
 update public.receipts set fields=new_fields,warnings=new_warnings,duplicate_key=new_key,duplicate_of=duplicate,duplicate_ack=false,
 state=case when duplicate is null then 'needs_review' else 'duplicate_candidate' end,approved_at=null,error=null,version=version+1,updated=now() where id=receipt returning * into r;
 delete from public.jobs where kind='receipt' and target=receipt;
 return r;
end $$;
create function public.approve_receipt(w uuid, receipt uuid, expected integer, acknowledge boolean) returns public.receipts language plpgsql set search_path = '' as $$
declare r public.receipts; duplicate uuid;
begin
 perform public.lock_workspace(w);
 select * into r from public.receipts where id=receipt and workspace_id=w for update;
 if not found then raise exception 'receipt not found'; end if;
 if r.version<>expected then raise exception 'stale receipt; reopen before approving'; end if;
 if coalesce(r.fields->>'merchant','')='' or coalesce(r.fields->>'date','')='' or r.fields->>'total' is null then raise exception 'merchant, date and total required'; end if;
 select id into duplicate from public.receipts where workspace_id=w and id<>receipt and duplicate_key=r.duplicate_key order by created limit 1;
 if duplicate is not null and not acknowledge then raise exception 'duplicate: confirm this is a separate expense'; end if;
 update public.receipts set state='approved',duplicate_of=duplicate,duplicate_ack=acknowledge,approved_at=now(),updated=now(),version=version+1 where id=receipt returning * into r;
 delete from public.jobs where kind='receipt' and target=receipt;
 return r;
end $$;
create function public.retry_receipt(w uuid, receipt uuid) returns void language plpgsql set search_path = '' as $$
declare r public.receipts;
begin
 perform public.lock_workspace(w);
 select * into r from public.receipts where id=receipt and workspace_id=w for update;
 if not found then raise exception 'receipt not found'; end if;
 if r.state<>'failed' then raise exception 'only failed receipts can retry'; end if;
 if (select count(*) from public.attempts where receipt_id=receipt)>=9 then raise exception 'retry limit reached; enter details manually'; end if;
 update public.receipts set state='captured',error=null,version=version+1 where id=receipt;
 insert into public.jobs(workspace_id,kind,target) values(w,'receipt',receipt) on conflict(kind,target) do update set status='queued',run_at=now(),lease_until=null,lease_token=null,attempts=0;
end $$;
create function public.create_export(w uuid, output_format text) returns uuid language plpgsql set search_path = '' as $$
declare result uuid; snapshot jsonb;
begin
 perform public.lock_workspace(w);
 if (select count(*) from public.exports where workspace_id=w and status in ('queued','processing'))>=2 then raise exception 'export already queued; wait for completion'; end if;
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('revisions',(select coalesce(jsonb_agg(to_jsonb(v)),'[]') from public.revisions v where v.receipt_id=r.id)) order by r.created),'[]') into snapshot from public.receipts r where r.workspace_id=w;
 insert into public.exports(workspace_id,format,snapshot) values(w,output_format,snapshot) returning id into result;
 insert into public.jobs(workspace_id,kind,target) values(w,'export',result);
 return result;
end $$;
create function public.claim_job() returns public.jobs language plpgsql set search_path = '' as $$
declare candidate uuid; j public.jobs; r public.receipts;
begin
 select jobs.workspace_id into candidate from public.jobs join public.workspaces on workspaces.id=jobs.workspace_id
 where not workspaces.deleting and ((attempts<3 and run_at<=now() and (status='queued' or (status='running' and lease_until<now()))) or (attempts>=3 and status='running' and lease_until<now())) order by run_at limit 1;
 if not found then return null; end if;
 perform public.lock_workspace(candidate);
 insert into public.storage_deletions(bucket,object_key,due)
 select 'exports',jobs.workspace_id::text||'/'||exports.id::text||'/'||jobs.lease_token::text||'.'||exports.format,now()
 from public.jobs join public.exports on exports.id=jobs.target
 where jobs.workspace_id=candidate and jobs.kind='export' and jobs.status='running' and jobs.lease_until<now() and jobs.lease_token is not null
 on conflict(bucket,object_key) do update set due=excluded.due;
 -- Exhausted jobs stay visible after worker crashes, rather than disappearing from the queue.
 update public.jobs set status='failed',error='Worker interrupted repeatedly' where workspace_id=candidate and attempts>=3 and status='running' and lease_until<now();
 update public.receipts set state='failed',error=failed_job.error from public.jobs failed_job where failed_job.workspace_id=candidate and failed_job.kind='receipt' and failed_job.target=receipts.id and failed_job.status='failed' and receipts.state in ('captured','processing');
 update public.exports set status='failed',error=failed_job.error from public.jobs failed_job where failed_job.workspace_id=candidate and failed_job.kind='export' and failed_job.target=exports.id and failed_job.status='failed' and exports.status in ('queued','processing');
 select * into j from public.jobs where attempts<3 and run_at<=now() and (status='queued' or (status='running' and lease_until<now()))
 and workspace_id=candidate order by run_at for update skip locked limit 1;
 if not found then return null; end if;
 if j.kind='receipt' then
   select * into r from public.receipts where id=j.target for update;
   if not found then delete from public.jobs where id=j.id; return null; end if;
   update public.receipts set state='processing' where id=r.id;
   j.payload:=jsonb_build_object('version',r.version);
 elsif j.kind='export' then update public.exports set status='processing' where id=j.target;
 end if;
 update public.jobs set status='running', attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes',payload=j.payload where id=j.id returning * into j;
 return j;
end $$;
create function public.lock_job(job uuid, token uuid) returns public.jobs language plpgsql set search_path = '' as $$
declare workspace uuid; result public.jobs;
begin
 select workspace_id into workspace from public.jobs where id=job and lease_token=token and lease_until>now();
 if not found then return null; end if;
 perform 1 from public.workspaces where id=workspace for update;
 select * into result from public.jobs where id=job and lease_token=token and lease_until>now() for update;
 return result;
end $$;
create function public.complete_receipt_job(job uuid, token uuid, extracted jsonb, confidence jsonb, warnings jsonb, duplicate_key text, raw jsonb, usage jsonb) returns boolean language plpgsql set search_path = '' as $$
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
 delete from public.jobs where id=job;
 return true;
end $$;
create function public.complete_export_job(job uuid, token uuid, object_key text) returns boolean language plpgsql set search_path = '' as $$
declare j public.jobs; e public.exports; entry jsonb;
begin
 j := public.lock_job(job,token);
 if j.id is null then return false; end if;
 update public.exports set status='complete',object_key=complete_export_job.object_key,error=null where id=j.target returning * into e;
 for entry in select * from jsonb_array_elements(e.snapshot) loop
   update public.receipts set state='exported' where id=(entry->>'id')::uuid and version=(entry->>'version')::integer and state='approved';
 end loop;
 delete from public.jobs where id=job; return true;
end $$;
create function public.complete_email_job(job uuid, token uuid) returns boolean language plpgsql set search_path = '' as $$
declare j public.jobs;
begin
 j := public.lock_job(job,token);
 if j.id is null or j.kind<>'email' then return false; end if;
 update public.email_events set status='complete' where id=j.target;
 delete from public.jobs where id=j.id;
 return true;
end $$;
create function public.fail_job(job uuid, token uuid, message text, permanent boolean default false) returns void language plpgsql set search_path = '' as $$
declare j public.jobs;
begin
 j := public.lock_job(job,token);
 if j.id is null then return; end if;
 if j.kind='export' and j.lease_token is not null then
   insert into public.storage_deletions(bucket,object_key,due)
   select 'exports',j.workspace_id::text||'/'||exports.id::text||'/'||j.lease_token::text||'.'||exports.format,now() from public.exports where id=j.target
   on conflict(bucket,object_key) do update set due=excluded.due;
 end if;
 update public.jobs set status=case when permanent or attempts>=3 then 'failed' else 'queued' end,error=left(message,500),lease_token=null,lease_until=null,run_at=now()+interval '1 minute'*power(2,attempts) where id=job;
 if j.kind='receipt' then
   insert into public.attempts(receipt_id,status,error) select j.target,'failed',left(message,500) where exists(select 1 from public.receipts where id=j.target);
   update public.receipts set state='failed',error=left(message,500) where id=j.target and version=(j.payload->>'version')::integer;
 elsif j.kind='export' then update public.exports set status=case when permanent or j.attempts>=3 then 'failed' else 'queued' end,error=left(message,500) where id=j.target;
 elsif j.kind='email' and (permanent or j.attempts>=3) then
   update public.email_events set status='failed' where id=j.target;
   insert into public.notifications(workspace_id,message) values(j.workspace_id,'A forwarded receipt failed: '||left(message,400));
 end if;
end $$;

create function public.enqueue_email(w uuid, token text, message_id text, storage_url text) returns uuid language plpgsql set search_path = '' as $$
declare result uuid;
begin
 perform public.lock_workspace(w);
 insert into public.webhook_tokens(token) values(enqueue_email.token) on conflict do nothing;
 if not found then return null; end if;
 insert into public.email_events(workspace_id,message_id,storage_url) values(w,enqueue_email.message_id,enqueue_email.storage_url) on conflict on constraint email_events_workspace_id_message_id_key do nothing returning id into result;
 if result is not null then insert into public.jobs(workspace_id,kind,target) values(w,'email',result); end if;
 return result;
end $$;
create function public.delete_receipt(w uuid, receipt uuid) returns void language plpgsql set search_path = '' as $$
declare r public.receipts; e public.exports;
begin
 perform public.lock_workspace(w);
 select * into r from public.receipts where id=receipt and workspace_id=w for update;
 if not found then raise exception 'receipt not found'; end if;
 if exists(select 1 from public.exports where workspace_id=w and status in ('queued','processing')) then raise exception 'export is preparing; retry deletion after it finishes'; end if;
 insert into public.storage_deletions(bucket,object_key) values('receipts',r.object_key) on conflict do nothing;
 for e in select * from public.exports where workspace_id=w and snapshot @> jsonb_build_array(jsonb_build_object('id',receipt)) loop
   if e.object_key is not null then insert into public.storage_deletions(bucket,object_key) values('exports',e.object_key) on conflict do nothing; end if;
   delete from public.jobs where kind='export' and target=e.id;
   delete from public.exports where id=e.id;
 end loop;
 delete from public.jobs where kind='receipt' and target=receipt;
 delete from public.receipts where id=receipt;
end $$;
create function public.rotate_checkout(w uuid, expected uuid) returns public.workspaces language plpgsql set search_path = '' as $$
declare result public.workspaces;
begin
 result:=public.lock_workspace(w);
 if result.checkout_key=expected then
   update public.workspaces set checkout_key=gen_random_uuid(),checkout_session=null where id=w returning * into result;
 end if;
 return result;
end $$;
-- Service role only: neither anonymous clients nor users may call privileged RPCs.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_workspace','lock_workspace','lock_job','quota','reserve_upload','activate_upload','finish_upload','finish_email_upload','cancel_upload','edit_receipt','approve_receipt','retry_receipt','create_export','claim_job','complete_receipt_job','complete_export_job','complete_email_job','fail_job','enqueue_email','rotate_checkout','delete_receipt') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

-- No client Storage policies: server issues narrowly scoped signed upload/download URLs.
insert into storage.buckets(id,name,public,file_size_limit) values
 ('receipt-uploads','receipt-uploads',false,10485760),
 ('receipts','receipts',false,10485760),
 ('exports','exports',false,null)
on conflict(id) do nothing;
