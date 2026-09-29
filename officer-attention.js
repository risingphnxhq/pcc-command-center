(() => {
  'use strict';
  const gateway = 'https://ttkceizmjeckrorhkhfr.supabase.co/functions/v1/pcc-entry-gateway';
  const $ = id => document.getElementById(id);
  const state = $('officerAttentionState');
  if (!state) return;
  let loading = false;
  async function refresh() {
    if (loading) return;
    const token = sessionStorage.getItem('pccEntrySession');
    const list = $('officerAttentionList');
    list.replaceChildren();
    if (!token) { $('officerAttentionCount').textContent = '—'; state.textContent = 'Enter HQ to see officer requests.'; return; }
    loading = true; state.textContent = 'Checking officer requests…';
    try {
      const response = await fetch(gateway + '/officer-attention', {
        headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw Error(response.status === 401 ? 'HQ visit expired. Re-enter to see requests.' : 'Officer request feed unavailable.');
      const body = await response.json();
      if (!Array.isArray(body.requests)) throw Error('Officer request feed unavailable.');
      const open = body.requests.filter(item => ['REQUESTED', 'PRESENTED', 'ACKNOWLEDGED', 'SCHEDULED_OR_ROUTED'].includes(item.status));
      const waiting = open.filter(item => ['REQUESTED', 'PRESENTED'].includes(item.status));
      $('officerAttentionCount').textContent = String(waiting.length);
      state.textContent = open.length ? waiting.length + ' need your attention · ' + open.length + ' open' :
        'No verified officer requests are open as of ' + new Date(body.checked_at).toLocaleTimeString() + '.';
      for (const item of open) {
        const card = document.createElement('div'); card.className = 'floor-note';
        card.style.cssText = 'border-top:1px solid rgba(255,255,255,.13);padding:12px 0';
        const heading = document.createElement('strong');
        heading.textContent = (item.priority === 'URGENT' ? 'URGENT · ' : '') + item.requesting_office + ' · ' + item.category;
        card.append(heading);
        for (const value of [item.subject, item.reason_and_requested_outcome,
          'Requested: ' + item.requested_contact + ' · Due: ' + (item.due_at ? new Date(item.due_at).toLocaleString() : 'No deadline stated') +
          ' · Evidence: ' + item.source_or_evidence_ref]) {
          const line = document.createElement('p'); line.textContent = value; card.append(line);
        }
        const link = document.createElement('a'); link.href = 'office.html?office_id=' + encodeURIComponent(item.requesting_office);
        link.className = 'floor-btn'; link.style.cssText = 'display:inline-block;text-decoration:none;margin-top:8px';
        link.textContent = 'Visit officer →'; card.append(link);
        if (['REQUESTED', 'PRESENTED'].includes(item.status)) {
          const ack = document.createElement('button'); ack.type = 'button'; ack.className = 'floor-btn';
          ack.style.marginTop = '8px'; ack.textContent = 'Acknowledge';
          ack.addEventListener('click', async () => {
            ack.disabled = true;
            try {
              const result = await fetch(gateway + '/officer-attention-ack', {
                method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ request_id: item.request_id }), cache: 'no-store',
              });
              if (!result.ok) throw Error('Acknowledgment unavailable.');
              await refresh();
            } catch (error) { ack.disabled = false; state.textContent = error.message; }
          });
          card.append(ack);
        }
        list.append(card);
      }
    } catch (error) { $('officerAttentionCount').textContent = '—'; state.textContent = error.message || 'Officer request feed unavailable.'; }
    finally { loading = false; }
  }
  $('refreshOfficerAttention').addEventListener('click', refresh);
  window.addEventListener('focus', refresh);
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  refresh();
})();
