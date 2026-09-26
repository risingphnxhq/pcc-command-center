-- Founder authorization on 2026-09-26 extends this allowlist by one bounded
-- Corporate meeting-draft capability. Existing entries remain unchanged.
alter table pcc_hq.command_authorizations
  drop constraint command_authorizations_capability_check;
alter table pcc_hq.command_authorizations
  add constraint command_authorizations_capability_check
  check (capability in (
    'PCC_CORPORATE_COMMAND_BEACON',
    'PCC_CORPORATE_TASK_QUEUE',
    'PCC_VIRTUAL_WAR_ROOM_MEETING_HOST'
  ));
