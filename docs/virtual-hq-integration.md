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

## Incremental build

1. **Navigation and identity:** retain the existing room pages; register stable room IDs, purposes, and access policy; connect the floor map to the authenticated Corporate office directory. Verify a Founder traversal and a denied guest traversal.
2. **Presence and meetings:** add short-lived room presence, mission-bound meeting records, guest invitations, bounded disclosure, and revocation. Verify entry/exit, expiry, reconnect, and guest isolation.
3. **Media and persona floor control:** integrate a supported WebRTC meeting provider and approved voice identities. Start with one named persona and one controlled speaking turn; verify audible output, interruption, speaker attribution, and rollback before the 12-seat rollout.
4. **Evidence and governance:** attach briefings, decisions, meeting events, and receipts to the mission and Corporate Canon. Only then surface verified live status and Board actions.
5. **Immersive rendering:** add 2D/3D spatial presentation as a client over the same room and permission APIs. A headset or avatar is optional; desktop and mobile access remain first-class.

## Acceptance boundary

The current PCC pages are a navigable representation of HQ. They do not provide authenticated room presence, contractor meetings, live media, Board votes, or operational Systems telemetry. No production readiness claim follows from this design. Systems-side reporting and any engineering integration require the existing governed Systems authority and bridge receipts.
