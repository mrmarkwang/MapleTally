-- Reclaim reservations left behind by clients that disappeared before cancellation.
create or replace function public.quota(w uuid) returns jsonb language plpgsql set search_path = '' as $$
declare ws public.workspaces; used integer; reserved integer; paid boolean; maximum integer;
begin
 select * into ws from public.workspaces where id=w;
 paid := coalesce(ws.plan='paid' and ws.paid_until>now(),false); maximum:=case when paid then 500 else 25 end;

 insert into public.storage_deletions(bucket,object_key,due)
 select bucket, w::text||'/'||u.id::text, now()
 from public.uploads u
 cross join (values ('receipt-uploads'::text),('receipts'::text)) paths(bucket)
 where u.workspace_id=w and u.receipt_id is null
   and u.created < now()-interval '10 minutes'
 on conflict(bucket,object_key) do update set due=excluded.due;
 delete from public.uploads
 where workspace_id=w and receipt_id is null
   and created < now()-interval '10 minutes';

 select count(*) into used from public.usage where workspace_id=w and (not paid or created>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC');
 select count(*) into reserved from public.uploads where workspace_id=w and receipt_id is null and expires>now();
 return jsonb_build_object('plan',case when paid then 'paid' else 'free' end,'used',used,'reserved',reserved,'limit',maximum,'period',case when paid then 'this month' else 'lifetime' end,'canUpload',used+reserved<maximum);
end $$;