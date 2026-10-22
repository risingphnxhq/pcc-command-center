create table spider_private.kids_control (
 channel_key text primary key check(channel_key='phnx_kids'),
 enabled boolean not null default true,
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 updated_by text not null default 'Founder-authorized installation'
);
insert into spider_private.kids_control(channel_key) values ('phnx_kids');
alter table spider_private.kids_control enable row level security;
revoke all on spider_private.kids_control from public,anon,authenticated;
grant select,update on spider_private.kids_control to service_role;
create table spider_private.kids_control_events (
 event_id uuid primary key default gen_random_uuid(),
 action text not null, actor text not null, slot_id uuid,
 detail jsonb not null default '{}',created_at timestamptz not null default now()
);
alter table spider_private.kids_control_events enable row level security;
revoke all on spider_private.kids_control_events from public,anon,authenticated;
grant select,insert on spider_private.kids_control_events to service_role;
create table spider_private.kids_slots (
 slot_id uuid primary key default gen_random_uuid(),
 channel_key text not null default 'phnx_kids' check(channel_key='phnx_kids'),
 kind text not null check(kind in ('short','episode')),
 publish_at timestamptz not null,
 state text not null default 'planned' check(state in ('planned','ready','uploading','scheduled','failed','uncertain')),
 title text, description text, sha256 text, size_bytes bigint,
 source_evidence jsonb not null default '{}',
 artifact_library_id text,
 capability_sha256 text, capability_expires timestamptz,
 video_id text, receipt jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(channel_key,kind,publish_at)
);
alter table spider_private.kids_slots enable row level security;
revoke all on spider_private.kids_slots from public,anon,authenticated;
grant select,insert,update on spider_private.kids_slots to service_role;
create function public.pmf_kids_slot_v1(p_action text,p_args jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r spider_private.kids_slots; result jsonb;
begin
 if current_user not in ('service_role','postgres') then raise exception 'service role required'; end if;
 if p_action='claim' then
  perform 1 from spider_private.kids_control where channel_key='phnx_kids' and enabled for share;
  if not found then return null; end if;
  update spider_private.kids_slots set state='uploading',updated_at=now()
  where slot_id=(p_args->>'slot_id')::uuid and state='ready'
  and capability_sha256=p_args->>'token_hash' and capability_expires>now()
  and publish_at>now()+interval '10 minutes'
  and title is not null and description is not null and sha256 ~ '^[0-9a-f]{64}$'
  and size_bytes between 1000 and 67108864 and artifact_library_id is not null
  and source_evidence->>'license_checked'='true' and source_evidence->>'qa_passed'='true'
  returning * into r;
  if r.slot_id is null then return null; end if;
  return to_jsonb(r)-'capability_sha256';
 elsif p_action='finish' then
  if p_args->>'state' not in ('scheduled','failed','uncertain') then raise exception 'bad state'; end if;
  update spider_private.kids_slots set state=p_args->>'state',video_id=p_args->>'video_id',
   receipt=p_args->'receipt',capability_sha256=null,capability_expires=null,updated_at=now()
  where slot_id=(p_args->>'slot_id')::uuid and state='uploading' returning * into r;
  return to_jsonb(r)-'capability_sha256';
 else raise exception 'unsupported action'; end if;
end $$;
revoke all on function public.pmf_kids_slot_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.pmf_kids_slot_v1(text,jsonb) to service_role;
create function public.pmf_kids_dashboard_v1(p_action text,p_args jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c spider_private.kids_control; r spider_private.kids_slots;
begin
 if current_user not in ('postgres','service_role') then raise exception 'service role required'; end if;
 if p_action='status' then
  return jsonb_build_object(
   'control',(select to_jsonb(x) from spider_private.kids_control x where channel_key='phnx_kids'),
   'slots',coalesce((select jsonb_agg(jsonb_build_object('slot_id',s.slot_id,'kind',s.kind,'publish_at',s.publish_at,'state',s.state,'title',s.title,'artifact_library_id',s.artifact_library_id,'video_id',s.video_id,'sha256',s.sha256,'size_bytes',s.size_bytes,'receipt',s.receipt,'updated_at',s.updated_at) order by s.publish_at) from spider_private.kids_slots s),'[]'::jsonb),
   'events',coalesce((select jsonb_agg(to_jsonb(e)) from (select event_id,action,slot_id,created_at,detail from spider_private.kids_control_events order by created_at desc limit 20) e),'[]'::jsonb),
   'production_evidence',(select jsonb_build_object('psc_id',psc_id,'state',canon_state,'summary',structured_summary,'created_at',created_at) from public.phoenix_canon_records where psc_id like 'PMF-KIDS-AUTO-EXEC-%' order by created_at desc limit 1));
 elsif p_action in ('pause','resume') then
  update spider_private.kids_control set enabled=(p_action='resume'),version=version+1,updated_at=now(),updated_by=p_args->>'actor'
  where channel_key='phnx_kids' and version=(p_args->>'expected_version')::integer returning * into c;
  if c.channel_key is null then raise exception 'CONTROL_VERSION_CONFLICT'; end if;
  insert into spider_private.kids_control_events(action,actor,detail) values(p_action,p_args->>'actor',jsonb_build_object('enabled',c.enabled,'version',c.version));
  return to_jsonb(c);
 elsif p_action='retry' then
  update spider_private.kids_slots set state='planned',capability_sha256=null,capability_expires=null,updated_at=now()
  where slot_id=(p_args->>'slot_id')::uuid and state='failed' and video_id is null and publish_at>now()+interval '1 hour' returning * into r;
  if r.slot_id is null then raise exception 'RETRY_NOT_SAFE_OR_SLOT_EXPIRED'; end if;
  insert into spider_private.kids_control_events(action,actor,slot_id,detail) values('retry_production',p_args->>'actor',r.slot_id,jsonb_build_object('previous_receipt',r.receipt));
  return jsonb_build_object('slot_id',r.slot_id,'state',r.state);
 else raise exception 'unsupported action'; end if;
end $$;
revoke all on function public.pmf_kids_dashboard_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.pmf_kids_dashboard_v1(text,jsonb) to service_role;

