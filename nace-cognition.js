// NACE source-bound guidance. No external model transmission.
// PSC-A-RPE-CORPORATE-NACE-GOVERNING-COGNITION-2026-09-29-001.
(function (root) {
  'use strict';
  const missions = list => list.reduce((n, x) => n + (Number(x.mission_count) || 0), 0);
  function create() {
    let selected = null;
    let lastTopic = 'brief';
    return {
      select(office) { selected = office; lastTopic = 'office'; },
      reset() { selected = null; lastTopic = 'brief'; },
      briefing(snapshot) {
        if (!snapshot) return 'I cannot read the Corporate source in this session. Please verify PCC entry.';
        const list = snapshot.offices || [];
        const missing = list.filter(x => !x.source_present).length;
        return `I have a current Corporate directory read: ${list.length} registered offices and ${missions(list)} registered missions. Registration is not worker activation. ${missing ? `PSC source is unverified for ${missing} offices.` : 'Office source coverage is present, but runtime activation needs separate receipts.'} I do not have a verified live task, test, market or receipt feed in this view. I can inspect an office or mission, or identify the next evidence needed.`;
      },
      respond(input, snapshot) {
        const q = String(input || '').toLowerCase().trim();
        if (!snapshot) return this.briefing(null);
        const list = snapshot.offices || [];
        if (/\b(brief|status|summary|what is happening|what changed)\b/.test(q)) { lastTopic = 'brief'; return this.briefing(snapshot) }
        if (/\b(next|priority|what should we do|what do you recommend)\b/.test(q)) { lastTopic = 'next'; return 'First, connect and read back the current Corporate task, test and receipt feeds. This directory alone cannot rank live work. Chad owns Corporate operating follow-through; Peggy owns business coordination. I can show an office mission now.' }
        if (/\b(source|evidence|how do you know|why)\b/.test(q)) return selected ? `${selected.display_name || selected.office_id} is in the authenticated Corporate directory. Its registration and mission counts do not establish an active worker or completed task.` : 'The authenticated Corporate directory supplies office and mission registration. It does not include a certified live task agenda or execution receipts in this view.';
        if (/\b(receipts?|verified|verification|completed|done)\b/.test(q)) { lastTopic = 'receipt'; return 'No execution receipt feed is connected to this view. I cannot certify a completed action from an office registration or conversation.' }
        if (/\b(office|who is here|team)\b/.test(q)) { lastTopic = 'offices'; return `${list.length} offices are registered. Select one to inspect its missions. Registration does not establish live cognition or worker activation.` }
        if (/\b(mission|workstream)\b/.test(q)) { lastTopic = 'missions'; return `${missions(list)} missions are registered across the Corporate directory. Select an office for its mission lineage; I cannot infer progress from registration.` }
        if (/\b(that|it|more|explain|tell me more)\b/.test(q)) {
          if (selected) return `${selected.display_name || selected.office_id} has ${Number(selected.mission_count)||0} registered missions and ${Number(selected.workstream_count)||0} workstreams. Ask for a specific mission to inspect its source lineage.`;
          return lastTopic === 'next' ? 'A task feed needs owner, state, blocker, evidence and receipt before I can rank current work.' : this.briefing(snapshot);
        }
        return 'I do not have a verified source or authorized route for that request. I can brief the Corporate directory, inspect an office or mission, or explain what evidence is missing.';
      }
    };
  }
  root.NACECognition = { create };
})(typeof window === 'undefined' ? globalThis : window);
