-- PCC low-stock notices for quality-approved Animation Engine outputs.
-- Inventory means approved, private, unpublished output awaiting an authorized release path.
begin;

create table if not exists public.pcc_animation_replenishment_alerts_v1 (
  channel_key text not null check (channel_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$'),
  output_type text not null check (output_type in (
    'EPISODE','SERIES_EPISODE','ANIMATION','AD','REEL','MICRO_DRAMA','NOVEL',
    'BOOK_MANUSCRIPT','BOOK_CHAPTER','BOOK_SCENE','CORPORATE_MARKETING',
    'CORPORATE_JINGLE','TV_SPOT','TV_COMMERCIAL','SOCIAL_MEDIA_CAMPAIGN','OTHER'
  )),
  series_key text not null check (length(series_key) between 1 and 160),
  threshold integer not null default 3 check (threshold = 3),
  ready_unpublished_count integer not null default 0 check (ready_unpublished_count >= 0),
  alert_state text not null default 'RESOLVED' check (alert_state in ('OPEN','RESOLVED')),
  notification_generation integer not null default 0 check (notification_generation >= 0),
  opened_at timestamptz,
  last_notified_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (channel_key, output_type, series_key)
);

alter table public.pcc_animation_replenishment_alerts_v1 enable row level security;
revoke all on public.pcc_animation_replenishment_alerts_v1 from public, anon, authenticated;
grant select, insert, update, delete on public.pcc_animation_replenishment_alerts_v1 to service_role;

create or replace function public.pcc_animation_refresh_replenishment_v1(
  p_channel_key text, p_output_type text, p_series_key text
) returns void
language plpgsql
security definer
set search_path = 'pg_catalog','public','pg_temp'
as $function$
declare
  v_count integer;
begin
  if p_channel_key is null or p_output_type is null or p_series_key is null then
    raise exception 'PCC_ANIMATION_INVENTORY_KEY_REQUIRED';
  end if;

  select count(*)::integer into v_count
    from public.pcc_animation_jobs j
   where j.channel_key = p_channel_key
     and j.output_type = p_output_type
     and coalesce(nullif(btrim(j.request_payload->>'series_context'), ''), '__UNSCOPED__') = p_series_key
     and j.status in ('QA','COMPLETE')
     and j.render_review_state = 'APPROVED'
     and j.artifact_manifest->>'quality_approved' = 'true'
     and j.artifact_manifest->>'private' = 'true'
     and j.artifact_manifest->>'distribution_performed' = 'false';


  insert into public.pcc_animation_replenishment_alerts_v1(
    channel_key,output_type,series_key,ready_unpublished_count,alert_state,
    notification_generation,opened_at,last_notified_at,resolved_at,updated_at
  ) values (
    p_channel_key,p_output_type,p_series_key,v_count,
    case when v_count <= 3 then 'OPEN' else 'RESOLVED' end,
    case when v_count <= 3 then 1 else 0 end,
    case when v_count <= 3 then now() else null end,
    case when v_count <= 3 then now() else null end,
    case when v_count > 3 then now() else null end,
    now()
  )
  on conflict (channel_key,output_type,series_key) do update set
    ready_unpublished_count=excluded.ready_unpublished_count,
    alert_state=excluded.alert_state,
    notification_generation=public.pcc_animation_replenishment_alerts_v1.notification_generation
      + case when public.pcc_animation_replenishment_alerts_v1.alert_state='RESOLVED' and excluded.alert_state='OPEN' then 1 else 0 end,
    opened_at=case when public.pcc_animation_replenishment_alerts_v1.alert_state='RESOLVED' and excluded.alert_state='OPEN'
      then now() else public.pcc_animation_replenishment_alerts_v1.opened_at end,
    last_notified_at=case when public.pcc_animation_replenishment_alerts_v1.alert_state='RESOLVED' and excluded.alert_state='OPEN'
      then now() else public.pcc_animation_replenishment_alerts_v1.last_notified_at end,
    resolved_at=case when excluded.alert_state='RESOLVED' and public.pcc_animation_replenishment_alerts_v1.alert_state='OPEN'
      then now() when excluded.alert_state='OPEN' then null
      else public.pcc_animation_replenishment_alerts_v1.resolved_at end,
    updated_at=now();
end;
$function$;

create or replace function public.pcc_animation_replenishment_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog','public','pg_temp'
as $function$
declare
  v_old_series text;
  v_new_series text;
begin
  if tg_op <> 'INSERT' then
    v_old_series := coalesce(nullif(btrim(old.request_payload->>'series_context'), ''), '__UNSCOPED__');
    perform public.pcc_animation_refresh_replenishment_v1(old.channel_key,old.output_type,v_old_series);
  end if;
  if tg_op <> 'DELETE' then
    v_new_series := coalesce(nullif(btrim(new.request_payload->>'series_context'), ''), '__UNSCOPED__');
    perform public.pcc_animation_refresh_replenishment_v1(new.channel_key,new.output_type,v_new_series);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists pcc_animation_replenishment_alert_v1 on public.pcc_animation_jobs;
create trigger pcc_animation_replenishment_alert_v1
after insert or update or delete on public.pcc_animation_jobs
for each row execute function public.pcc_animation_replenishment_trigger_v1();

create or replace function public.pcc_animation_replenishment_read_v1(p_subject uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public','pg_temp'
as $function$
begin
  if p_subject is null then raise exception 'PCC_ANIMATION_SUBJECT_REQUIRED'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(a) order by a.ready_unpublished_count asc,a.channel_key,a.output_type,a.series_key)
      from public.pcc_animation_replenishment_alerts_v1 a
     where a.alert_state='OPEN'
  ),'[]'::jsonb);
end;
$function$;

revoke all on function public.pcc_animation_refresh_replenishment_v1(text,text,text),
  public.pcc_animation_replenishment_trigger_v1(),
  public.pcc_animation_replenishment_read_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.pcc_animation_replenishment_read_v1(uuid) to service_role;

-- Seed current groups so PCC immediately reflects existing low inventory.
do $seed$
declare r record;
begin
  for r in
    select distinct channel_key,output_type,
      coalesce(nullif(btrim(request_payload->>'series_context'), ''), '__UNSCOPED__') as series_key
    from public.pcc_animation_jobs
  loop
    perform public.pcc_animation_refresh_replenishment_v1(r.channel_key,r.output_type,r.series_key);
  end loop;
end;
$seed$;

comment on table public.pcc_animation_replenishment_alerts_v1 is
'PCC low-stock notices: counts only human-quality-approved outputs that remain unpublished; opens an alert at three or fewer.';

commit;
