begin;
create table if not exists public.pcc_workspace_writing_drafts_v1 (
  writing_draft_id uuid primary key default gen_random_uuid(),
  source_system_subject uuid not null,
  intake_id uuid not null,
  dispatch_action_id uuid not null,
  review_action_id uuid not null,
  approval_id uuid not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  content_kind text not null check (content_kind in ('BOOK','SERIES')),
  title text not null check (length(trim(title)) between 1 and 200),
  content_text text not null check (length(trim(content_text)) between 1 and 250000),
  writing_context jsonb not null default '{}'::jsonb check (jsonb_typeof(writing_context)='object'),
  route_receipt jsonb not null check (jsonb_typeof(route_receipt)='object'),
  draft_state text not null default 'DRAFT_INTAKE' check (draft_state='DRAFT_INTAKE'),
  canon_status text not null default 'UNAPPROVED' check (canon_status='UNAPPROVED'),
  publication_eligible boolean not null default false check (publication_eligible=false),
  created_at timestamptz not null default now(),
  unique (intake_id, dispatch_action_id)
);
alter table public.pcc_workspace_writing_drafts_v1 enable row level security;
revoke all on public.pcc_workspace_writing_drafts_v1 from public, anon, authenticated;
grant select, insert on public.pcc_workspace_writing_drafts_v1 to service_role;
revoke update, delete, truncate, references, trigger on public.pcc_workspace_writing_drafts_v1 from service_role;

create or replace function public.pcc_workspace_writing_draft_create_v1(
  p_source_system_subject uuid,
  p_intake_id uuid,
  p_dispatch_action_id uuid,
  p_review_action_id uuid,
  p_approval_id uuid,
  p_payload_sha256 text,
  p_content_kind text,
  p_title text,
  p_content_text text,
  p_writing_context jsonb,
  p_route_receipt jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_row public.pcc_workspace_writing_drafts_v1%rowtype;
begin
  if p_source_system_subject is null or p_intake_id is null or p_dispatch_action_id is null
     or p_review_action_id is null or p_approval_id is null
     or p_payload_sha256 !~ '^[a-f0-9]{64}$'
     or p_content_kind not in ('BOOK','SERIES')
     or length(trim(coalesce(p_title,''))) not between 1 and 200
     or length(trim(coalesce(p_content_text,''))) not between 1 and 250000
     or jsonb_typeof(coalesce(p_writing_context,'{}'::jsonb)) is distinct from 'object'
     or jsonb_typeof(p_route_receipt) is distinct from 'object'
     or p_route_receipt->>'resolution_status' <> 'RESOLVED_HELD'
     or p_route_receipt->>'execution_eligible' <> 'false'
     or p_route_receipt->>'publication_eligible' <> 'false' then
    return jsonb_build_object('ok',false,'error','WRITING_DRAFT_FIELDS_INVALID');
  end if;

  insert into public.pcc_workspace_writing_drafts_v1 (
    source_system_subject,intake_id,dispatch_action_id,review_action_id,approval_id,
    payload_sha256,content_kind,title,content_text,writing_context,route_receipt
  ) values (
    p_source_system_subject,p_intake_id,p_dispatch_action_id,p_review_action_id,p_approval_id,
    p_payload_sha256,p_content_kind,trim(p_title),p_content_text,
    coalesce(p_writing_context,'{}'::jsonb),p_route_receipt
  ) on conflict (intake_id,dispatch_action_id) do nothing;

  select * into v_row from public.pcc_workspace_writing_drafts_v1
   where intake_id=p_intake_id and dispatch_action_id=p_dispatch_action_id;
  if not found then
    return jsonb_build_object('ok',false,'error','WRITING_DRAFT_PERSISTENCE_FAILED');
  end if;
  if v_row.source_system_subject<>p_source_system_subject
     or v_row.review_action_id<>p_review_action_id
     or v_row.approval_id<>p_approval_id
     or v_row.payload_sha256<>p_payload_sha256
     or v_row.content_kind<>p_content_kind
     or v_row.title<>trim(p_title)
     or v_row.content_text<>p_content_text
     or v_row.writing_context<>coalesce(p_writing_context,'{}'::jsonb)
     or v_row.route_receipt<>p_route_receipt then
    return jsonb_build_object('ok',false,'error','WRITING_DRAFT_IDEMPOTENCY_MISMATCH');
  end if;

  return jsonb_build_object(
    'ok',true,'duplicate',v_row.created_at < clock_timestamp() - interval '1 second',
    'writing_draft_id',v_row.writing_draft_id,'producer_job_id',v_row.writing_draft_id::text,
    'script_state','BOOK_DRAFT_STORED','canon_status',v_row.canon_status,
    'publication_eligible',v_row.publication_eligible
  );
end;
$function$;
revoke all on function public.pcc_workspace_writing_draft_create_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.pcc_workspace_writing_draft_create_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb) to service_role;
commit;