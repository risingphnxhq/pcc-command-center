# PCC virtual Corporate HQ integration

## Controlling model

PCC is the digital headquarters. The existing Command Floor, Founder Suite, office pages, Council surface, War Room, and proposed Board Room are entrances into one institutional building. A rendered room is a view of governed Corporate state, not its authority source. The Corporate Canon and registries own offices, missions, authority, evidence, and receipts. Systems remains a separate domain reached through the governed PSC-C bridge.

The Council of 12 uses a distinct Board Room for internal governance. Authorized Corporate hosts meet outside contractors virtually in the War Room for a bounded matter. Jordan Hale carries receipted Systems status into Corporate briefings. Mason Briggs stays in Systems Command.

## State objects

| Object | Required fields | Authority and source |
| --- | --- | --- |
| Room | Stable ID, purpose, domain, access policy, scene/version | PCC room registry; Corporate owns Corporate rooms |
| Visit | Authenticated actor, current room, entry/exit, session expiry | PCC entry and room authorization |
| Presence | Actor/session, room, last heartbeat, visibility scope | Ephemeral presence service; absence of heartbeat means unknown/offline |
| Meeting | Host, mission/incident, agenda, invitees, time bounds, disclosure scope | Corporate mission and meeting authorization |
| Participant | Institutional office or guest identity, meeting role, consent/media state | Identity and invitation check; no identity from avatar alone |
| Guest grant | Named contractor principal, sponsor, meeting ID, room ID, permitted materials/actions, start/expiry, revocation state | Corporate guest-access service; default deny |
| Speaker | Persona ID, voice identity, turn ownership, active audio session | Voice registry and session controller; one active speaker by default |
| Briefing | Claim, source, as-of time, audience scope, evidence and receipt | Corporate source or governed Systems report |
| Decision | Motion, authority, approvals, dissent, outcome, evidence and receipt | Corporate decision contract and Canon |

## Room behavior

1. An authenticated visitor enters PCC and sees only rooms their current authority permits. The Founder can traverse the Corporate HQ without room links conferring Systems credentials.
2. The directory and floor map resolve room names and office occupants from registered state. A visual avatar or seat never proves that a person or persona is online.
3. A meeting host creates a mission-bound War Room session and invites named contractors with limited time and materials. The guest enters that meeting, not the full HQ or Board Room.
4. Live audio/video and chat join only after participant authorization. Persona speech resolves an approved voice for the room and records speaker identity; voice identity grants no execution authority.
5. Jordan may present Systems health or performance only from an authorized, scoped, fresh and receipted Systems update delivered through the bridge. Missing or stale data displays unavailable.
6. Board deliberation uses the 12 Council offices and any separately authorized Executive Command participants. Attendance, votes, decisions, and transcripts have their own authorization and retention rules.

## Contractor entry contract

The contractor receives a separate personal account or one-time verified invitation, with an authenticated identity bound to a single meeting grant. The invitation is not a transferable building key. The host and authorized Corporate approver specify the project/mission, War Room meeting, start/end, permitted media and materials, and any recording or confidentiality terms. Every join, disclosure, revocation, and exit is receipted. The guest can see only a guest vestibule and the authorized meeting; office floors, Board Room, Founder Suite, Corporate Console, Canon, and Systems Console remain denied. Guest media credentials are short lived and issued only after server-side authorization. Revocation or meeting expiry disconnects media and material access. A page-hidden link or browser session flag is not an authorization boundary.

The current PCC entry gateway issues a short-lived `PCC_REGISTERED_READ` session for internal entry. It does not identify individual contractors or authorize a meeting. Current static room pages can be requested directly. Do not invite a contractor, expose protected material, or treat the existing entry passphrase as a guest credential until server-side room and content authorization is deployed and tested.

The host draft route exists as `pcc-virtual-room-host` and calls a service-only RPC. `PCC_VIRTUAL_WAR_ROOM_MEETING_HOST` is now active for Chad's Corporate subject under `PSC-A-CORPORATE-PCC-VIRTUAL-WAR-ROOM-CHAD-HOST-DRAFT-AUTHORITY-2026-09-26-001`. The existing beacon, task queue, and read capabilities remain distinct. A database acceptance draft for `PCC-V1-ESTABLISH-HQ` was created and cancelled with receipts `1dff6665-46c9-43ae-b479-f76c589a58d1` and `66238321-6d66-44f2-9e0b-4c42963694f0`; closure is `PSC-A-CORPORATE-PCC-VIRTUAL-WAR-ROOM-HOST-DRAFT-ACCEPTANCE-2026-09-26-001`. This proves the database draft/cancel path only. No guest grant, browser host acceptance, meeting activation, or media is established.

The protected meeting read route `pcc-virtual-room-content` accepts an individual Supabase Auth JWT and a meeting ID. Its service-only `pcc_virtual_war_room_room_view` RPC returns only room name, meeting ID, mission, title, state, time bounds, and HOST/GUEST role. A current Corporate Chad host binding may read its own DRAFT/ACTIVE meeting; a guest must have an ACTIVE time-bounded grant and an ACTIVE meeting. Cancelled and closed meetings return no data. Materials, agenda, disclosure scope, participant lists, and media credentials are not served. The static War Room page remains a public shell with no protected meeting details. SQL checks found no guest grants, denied the cancelled acceptance meeting, and confirmed anon/authenticated cannot execute the RPC. A positive browser host/guest read still needs an individual Supabase Auth session; the PCC entry token is insufficient.

## Incremental build

1. **Navigation and identity:** retain the existing room pages; register stable room IDs, purposes, and access policy; connect the floor map to the authenticated Corporate office directory. Verify a Founder traversal and a denied guest traversal.
2. **Guest access, presence and meetings:** add individually authenticated guests, server-enforced room and content policy, short-lived room presence, mission-bound meeting records, invitations, bounded disclosure, and revocation. Verify denied direct URL/API access, entry/exit, expiry, reconnect, and isolation between guests and meetings.
3. **Media and persona floor control:** integrate a supported WebRTC meeting provider and approved voice identities. Start with one named persona and one controlled speaking turn; verify audible output, interruption, speaker attribution, and rollback before the 12-seat rollout.
4. **Evidence and governance:** attach briefings, decisions, meeting events, and receipts to the mission and Corporate Canon. Only then surface verified live status and Board actions.
5. **Immersive rendering:** add 2D/3D spatial presentation as a client over the same room and permission APIs. A headset or avatar is optional; desktop and mobile access remain first-class.

## Acceptance boundary

The current PCC pages are a navigable representation of HQ. They do not provide guest authentication, protected room content, authenticated room presence, contractor meetings, live media, Board votes, or operational Systems telemetry. No production readiness claim follows from this design. Systems-side reporting and any engineering integration require the existing governed Systems authority and bridge receipts.
