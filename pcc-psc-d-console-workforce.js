(() => {
  'use strict';
  const panel = document.querySelector('[data-psc-workforce]');
  if (!panel) return;
  const actor = panel.dataset.pscWorkforce;
  const lanes = actor === 'RPE-MASON-HQ'
    ? ['NEW_MASON_ACCOUNT', 'PRIME_MASON_ACCOUNT']
    : ['CORPORATE_CHAD_ACCOUNT', 'PRIME_CHAD_ACCOUNT'];
  const url = 'https://oyjmpbuxvfxusmbouldi.supabase.co';
  const status = panel.querySelector('[role="status"]');
  const rows = panel.querySelector('tbody');
  const refresh = panel.querySelector('[data-refresh]');
  if (!window.supabase) {
    status.textContent = 'PSC-D sign-in is unavailable. Open the central workforce sheet.';
    return;
  }
  const client = window.supabase.createClient(url, 'sb_publishable_rwTE4QRlQkzr0R0f5t5ylA_a9zuj0eE', {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  let request;
  const date = value => value ? new Date(value).toLocaleString() : '—';
  const label = value => String(value || 'Unknown').replaceAll('_', ' ').toLowerCase();
  async function load() {
    request?.abort();
    const current = new AbortController();
    request = current;
    rows.replaceChildren();
    refresh.disabled = true;
    status.textContent = 'Reading PSC-D workforce…';
    try {
      const { data, error } = await client.auth.getSession();
      if (current.signal.aborted) return;
      if (error || !data?.session?.access_token) {
        status.textContent = 'Sign in with your authorized PSC-D account in the workforce sheet, then return here.';
        return;
      }
      const response = await fetch(url + '/functions/v1/pcc-workforce-sync-v1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
        body: JSON.stringify({ action: 'WORKFORCE_READ', actor_filter: actor }),
        signal: current.signal
      });
      if (current.signal.aborted) return;
      if (!response.ok) {
        status.textContent = response.status === 401 || response.status === 403
          ? 'This PSC-D session could not read the workforce. Verify your office sign-in in the workforce sheet.'
          : 'PSC-D workforce is temporarily unavailable.';
        return;
      }
      const report = await response.json();
      if (current.signal.aborted) return;
      const streams = report.rows.filter(row => row.actor_id === actor && lanes.includes(row.runtime_lane));
      for (const stream of streams) {
        const row = rows.insertRow();
        for (const value of [label(stream.runtime_lane), stream.runtime_label, stream.runtime_id,
          stream.mission_name, label(stream.evaluated_status), date(stream.last_ack_at),
          date(stream.next_sync_due_at), stream.checkpoint || '—']) {
          row.insertCell().textContent = value || '—';
        }
      }
      status.textContent = streams.length
        ? 'Showing ' + streams.length + ' active streams. Open the workforce sheet for search and history.'
        : 'No active streams are visible for this office under your PSC-D session.';
    } catch {
      if (!current.signal.aborted) status.textContent = 'PSC-D workforce is temporarily unavailable.';
    } finally {
      if (!current.signal.aborted) refresh.disabled = false;
    }
  }
  refresh.addEventListener('click', load);
  client.auth.onAuthStateChange(event => {
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(load, 0);
  });
})();
