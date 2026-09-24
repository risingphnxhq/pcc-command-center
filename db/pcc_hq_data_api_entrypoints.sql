-- Narrow Data API entry points. No PCC table is exposed to anon or authenticated roles.
-- Private RPCs enforce the Corporate actor/read-authorization scope using auth.uid().
create or replace function public.pcc_corporate_command_snapshot()
returns jsonb language sql stable security invoker set search_path to ''
as $function$ select pcc_hq.corporate_command_snapshot() $function$;
create or replace function public.pcc_corporate_mission_detail(p_mission_id text)
returns jsonb language sql stable security invoker set search_path to ''
as $function$ select pcc_hq.corporate_mission_detail(p_mission_id) $function$;
revoke all on function public.pcc_corporate_command_snapshot() from public, anon;
revoke all on function public.pcc_corporate_mission_detail(text) from public, anon;
grant execute on function public.pcc_corporate_command_snapshot() to authenticated;
grant execute on function public.pcc_corporate_mission_detail(text) to authenticated;
