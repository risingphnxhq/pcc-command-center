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
      briefing(snapshot, agenda) {
        if (!snapshot) return 'I cannot read the Corporate source in this session. Please verify PCC entry.';
        const list = snapshot.offices || [];
        const missing = list.filter(x => !x.source_present).length;
        const work = agenda ? ` The private task queue reports ${agenda.open_task_count} open tasks at ${agenda.generated_at}. ${agenda.tasks?.find(x=>!['CANCELLED','COMPLETED'].includes(x.state))?.title || 'No open task is listed in this projection.'} Systems runtime remains unknown without a PSC-C feed.` : ' The private task agenda is unavailable until individual Founder sign-in. Systems runtime remains unknown without a PSC-C feed.';
        return `I have a current Corporate directory read: ${list.length} registered offices and ${missions(list)} registered missions. Registration is not worker activation. ${missing ? `PSC source is unverified for ${missing} offices.` : 'Office source coverage is present, but runtime activation needs separate receipts.'}${work}`;
      },
      respond(input, snapshot, agenda) {
        const q = String(input || '').toLowerCase().trim();
        if (!snapshot) return this.briefing(null);
        const list = snapshot.offices || [];
        if (/\b(brief|status|summary|what is happening|what changed)\b/.test(q)) { lastTopic = 'brief'; return this.briefing(snapshot, agenda) }
        if (/\b(next|priority|what should we do|what do you recommend)\b/.test(q)) { lastTopic = 'next'; const open=agenda?.tasks?.find(x=>!['CANCELLED','COMPLETED'].includes(x.state)); return open ? `The first visible open Corporate task is ${open.title}, assigned to ${open.assignment_id}, state ${open.state}. Chad should review its evidence and owner before acting. I cannot rank Systems work without its bounded feed.` : 'No open Corporate task is visible in the private agenda. Chad should establish a bounded mission order through the authenticated console. I cannot rank Systems work without its bounded feed.' }
        if (/\b(source|evidence|how do you know|why)\b/.test(q)) return selected ? `${selected.display_name || selected.office_id} is in the authenticated Corporate directory. Its registration and mission counts do not establish an active worker or completed task.` : 'The authenticated Corporate directory supplies office and mission registration. It does not include a certified live task agenda or execution receipts in this view.';
        if (/\b(receipts?|verified|verification|completed|done)\b/.test(q)) { lastTopic = 'receipt'; return agenda ? `The task projection links ${agenda.current_action_receipt_count} current-action receipts. This count does not prove independent verification or Canon closure; inspect a specific task receipt.` : 'The private task receipt projection is unavailable until individual Founder sign-in. I cannot certify completion from an office registration.' }
        if (/\b(office|who is here|team)\b/.test(q)) { lastTopic = 'offices'; return `${list.length} offices are registered. Select one to inspect its missions. Registration does not establish live cognition or worker activation.` }
        if (/\b(mission|workstream)\b/.test(q)) { lastTopic = 'missions'; return `${missions(list)} missions are registered across the Corporate directory. Select an office for its mission lineage; I cannot infer progress from registration.` }
        if (/\b(that|it|more|explain|tell me more)\b/.test(q)) {
          if (selected) return `${selected.display_name || selected.office_id} has ${Number(selected.mission_count)||0} registered missions and ${Number(selected.workstream_count)||0} workstreams. Ask for a specific mission to inspect its source lineage.`;
          return lastTopic === 'next' ? 'The visible task needs an owner, evidence, verification and receipt before closure.' : this.briefing(snapshot, agenda);
        }
        return 'I do not have a verified source or authorized route for that request. I can brief the Corporate directory, inspect an office or mission, or explain what evidence is missing.';
      }
    };
  }
  root.NACECognition = { create };
})(typeof window === 'undefined' ? globalThis : window);
