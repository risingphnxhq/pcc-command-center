(() => {
  'use strict';
  const gateway = 'https://ttkceizmjeckrorhkhfr.supabase.co/functions/v1/pcc-entry-gateway';
  const authBase = 'https://ttkceizmjeckrorhkhfr.supabase.co';
  const publishableKey = 'sb_publishable_v3-qGYPg-tSY-G4cX47HRg_TgMnYEbO';
  const $ = id => document.getElementById(id);
  const state = $('officerAttentionState');
  if (!state) return;
  let loading = false;
  const form = $('officerAttentionSignIn');
  async function refresh() {
    if (loading) return;
    const token = sessionStorage.getItem('pccEntrySession');
    const list = $('officerAttentionList');
    list.replaceChildren();
    if (!token) { $('officerAttentionCount').textContent = '—'; form.hidden = false; state.textContent = 'Enter HQ to see officer requests.'; return; }
    const privateSession = sessionStorage.getItem('pccFounderPrivateSession');
    if (!privateSession) { $('officerAttentionCount').textContent = '—'; form.hidden = false; state.textContent = 'Verify your individual access to see private officer requests.'; return; }
    loading = true; state.textContent = 'Checking officer requests…';
    try {
      const response = await fetch(gateway + '/officer-attention', {
        headers: { Authorization: 'Bearer ' + token, 'X-PCC-Founder-Session': privateSession }, cache: 'no-store', signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401) { sessionStorage.removeItem('pccFounderPrivateSession'); form.hidden = false; }
      if (!response.ok) throw Error(response.status === 401 ? 'HQ or individual session expired. Re-enter to see requests.' : 'Officer request feed unavailable.');
      form.hidden = true;
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
                method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-PCC-Founder-Session': privateSession, 'Content-Type': 'application/json' },
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
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const entry = sessionStorage.getItem('pccEntrySession');
    if (!entry) { state.textContent = 'Enter HQ before verifying private requests.'; return; }
    const button = form.querySelector('button'); button.disabled = true; state.textContent = 'Verifying individual access…';
    try {
      const auth = await fetch(authBase + '/auth/v1/token?grant_type=password', {
        method: 'POST', headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: $('officerAttentionEmail').value.trim().toLowerCase(), password: $('officerAttentionPassword').value }), cache: 'no-store',
      });
      $('officerAttentionPassword').value = '';
      if (!auth.ok) throw Error('Individual sign-in was not verified.');
      const signedIn = await auth.json();
      if (!signedIn.access_token) throw Error('Individual sign-in was not verified.');
      const verified = await fetch(gateway + '/authorize-private', {
        method: 'POST', headers: { Authorization: 'Bearer ' + entry,
          'X-PCC-Individual-Authorization': 'Bearer ' + signedIn.access_token }, cache: 'no-store',
      });
      if (!verified.ok) throw Error(verified.status === 503 ? 'Private request access is not configured yet.' : 'This individual account is not approved for private officer requests.');
      const result = await verified.json();
      if (!result.session) throw Error('Private request session unavailable.');
      sessionStorage.setItem('pccFounderPrivateSession', result.session);
      form.hidden = true; await refresh();
    } catch (error) { state.textContent = error.message; }
    finally { $('officerAttentionPassword').value = ''; button.disabled = false; }
  });
  $('refreshOfficerAttention').addEventListener('click', refresh);
  window.addEventListener('focus', refresh);
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  refresh();
})();
