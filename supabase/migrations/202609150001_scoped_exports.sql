drop function if exists public.create_export(uuid,text);

create function public.create_export(w uuid, output_format text, receipt_ids uuid[] default null) returns uuid language plpgsql set search_path = '' as $$
declare result uuid; snapshot jsonb;
begin
 perform public.lock_workspace(w);
 if (select count(*) from public.exports where workspace_id=w and status in ('queued','processing'))>=2 then raise exception 'export already queued; wait for completion'; end if;
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('revisions',(select coalesce(jsonb_agg(to_jsonb(v)),'[]') from public.revisions v where v.receipt_id=r.id)) order by r.created),'[]') into snapshot
 from public.receipts r
 where r.workspace_id=w and (receipt_ids is null or r.id = any(receipt_ids));
 insert into public.exports(workspace_id,format,snapshot) values(w,output_format,snapshot) returning id into result;
 insert into public.jobs(workspace_id,kind,target) values(w,'export',result);
 return result;
end $$;

revoke all on function public.create_export(uuid,text,uuid[]) from public,anon,authenticated;
grant execute on function public.create_export(uuid,text,uuid[]) to service_role;
