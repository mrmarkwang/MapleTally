-- Align quota and export access with the Free and Pro product plans.
create or replace function public.quota(w uuid) returns jsonb language plpgsql set search_path = '' as $$
declare ws public.workspaces; used integer; reserved integer; paid boolean; maximum integer;
begin
 select * into ws from public.workspaces where id=w;
 paid := coalesce(ws.plan='paid' and ws.paid_until>now(),false); maximum:=case when paid then 200 else 20 end;
 select count(*) into used from public.usage where workspace_id=w and created>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
 select count(*) into reserved from public.uploads where workspace_id=w and receipt_id is null and expires>now();
 return jsonb_build_object('plan',case when paid then 'paid' else 'free' end,'used',used,'reserved',reserved,'limit',maximum,'period','this month','canUpload',used+reserved<maximum);
end $$;

create or replace function public.create_export(w uuid, output_format text, receipt_ids uuid[] default null) returns uuid language plpgsql set search_path = '' as $$
declare result uuid; snapshot jsonb; paid boolean;
begin
 perform public.lock_workspace(w);
 paid := coalesce((select plan='paid' and paid_until>now() from public.workspaces where id=w),false);
 if not paid and output_format <> 'csv' then raise exception 'PDF and ZIP exports require Pro'; end if;
 if (select count(*) from public.exports where workspace_id=w and status in ('queued','processing'))>=2 then raise exception 'export already queued; wait for completion'; end if;
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('revisions',(select coalesce(jsonb_agg(to_jsonb(v)),'[]') from public.revisions v where v.receipt_id=r.id)) order by r.created),'[]') into snapshot from public.receipts r where r.workspace_id=w and (receipt_ids is null or r.id=any(receipt_ids));
 insert into public.exports(workspace_id,format,snapshot) values(w,output_format,snapshot) returning id into result;
 insert into public.jobs(workspace_id,kind,target) values(w,'export',result);
 return result;
end $$;