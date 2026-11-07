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
  const accounts = panel.querySelector('[data-psc-accounts]');
  const refresh = panel.querySelector('[data-refresh]');
  const summary = panel.querySelector('[data-psc-summary]');
  const gauge = panel.querySelector('[data-psc-gauge]');
  const gaugeNote = panel.querySelector('[data-psc-gauge-note]');
  const attentionOnly = panel.querySelector('[data-psc-attention-only]');
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
  function renderGauge(total, attention) {
    if (!gauge || !gaugeNote) return;
    const hasReading = Number.isInteger(total) && total > 0 && Number.isInteger(attention);
    const current = hasReading ? total - attention : 0;
    const percentage = hasReading ? Math.round(current / total * 100) : 0;
    gauge.style.setProperty('--reading', percentage + '%');
    gauge.dataset.state = !hasReading ? 'unverified' : attention === 0 ? 'current' : 'attention';
    gauge.querySelector('span').textContent = hasReading ? percentage + '%' : '—';
    const description = hasReading ? current + ' of ' + total + ' conversations up to date'
      : total === 0 ? 'No active conversations' : 'No verified reading';
    gauge.setAttribute('aria-label', 'Workforce check-in gauge: ' + description);
    gaugeNote.textContent = description;
  }
  async function load() {
    request?.abort();
    const current = new AbortController();
    request = current;
    rows.replaceChildren();
    accounts?.replaceChildren();
    renderGauge();
    if (summary) {
      for (const reading of summary.querySelectorAll('[data-psc-active], [data-psc-synced], [data-psc-attention]')) reading.textContent = '—';
    }
    refresh.disabled = true;
    status.textContent = 'Reading PSC-D workforce…';
    try {
      const { data, error } = await client.auth.getSession();
      if (current.signal.aborted) return;
      if (error || !data?.session?.access_token) {
        status.textContent = 'Sign in with your authorized PSC-D account in the workforce sheet, then return here.';
        return;
      }
      const read = statusFilter => fetch(url + '/functions/v1/pcc-workforce-sync-v1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
        body: JSON.stringify({ action: 'WORKFORCE_READ', actor_filter: actor, status: statusFilter }),
        signal: current.signal
      });
      const [response, attentionResponse] = await Promise.all([read(''), summary ? read('ATTENTION') : null]);
      if (current.signal.aborted) return;
      if (!response.ok) {
        status.textContent = response.status === 401 || response.status === 403
          ? 'This PSC-D session could not read the workforce. Verify your office sign-in in the workforce sheet.'
          : 'PSC-D workforce is temporarily unavailable.';
        return;
      }
      const report = await response.json();
      const attention = attentionResponse?.ok ? await attentionResponse.json() : null;
      if (current.signal.aborted) return;
      if (accounts) {
        for (const account of report.connections || []) {
          if (account.actor_id !== actor || !lanes.includes(account.lane)) continue;
          const item = document.createElement('li');
          item.textContent = account.label + ' · ' + label(account.binding_state) + ' · ' + account.registered_streams + ' registered streams';
          accounts.append(item);
        }
      }
      const streams = report.rows.filter(row => row.actor_id === actor && lanes.includes(row.runtime_lane));
      if (summary) {
        summary.querySelector('[data-psc-active]').textContent = report.total;
        const counted = Number.isInteger(attention?.total) && attention.total >= 0 && attention.total <= report.total;
        summary.querySelector('[data-psc-synced]').textContent = counted ? report.total - attention.total : '—';
        summary.querySelector('[data-psc-attention]').textContent = counted ? attention.total : '—';
        renderGauge(report.total, counted ? attention.total : null);
      }
      for (const stream of streams) {
        const row = rows.insertRow();
        row.dataset.attention = String(stream.evaluated_status !== 'SYNCHRONIZED');
        for (const value of [label(stream.runtime_lane), stream.runtime_label, stream.runtime_id,
          stream.mission_name, label(stream.evaluated_status), date(stream.last_ack_at),
          date(stream.next_sync_due_at), stream.checkpoint || '—']) {
          row.insertCell().textContent = value || '—';
        }
      }
      filterRows();
      status.textContent = summary && streams.length
        ? 'Loaded ' + streams.length + ' of ' + report.total + ' active conversations · Last read ' + date(report.generated_at) + '. Existing check-ins determine the readings.'
        : streams.length
        ? 'Showing ' + streams.length + ' active streams. Open the workforce sheet for search and history.'
        : 'No active streams are visible for this office under your PSC-D session.';
    } catch {
      if (!current.signal.aborted) status.textContent = 'PSC-D workforce is temporarily unavailable.';
    } finally {
      if (!current.signal.aborted) refresh.disabled = false;
    }
  }
  function filterRows() {
    if (!attentionOnly) return;
    for (const row of rows.rows) {
      row.hidden = attentionOnly.checked && row.dataset.attention !== 'true';
    }
  }
  attentionOnly?.addEventListener('change', filterRows);
  refresh.addEventListener('click', load);
  if (summary) setInterval(() => {
    if (!document.hidden && !refresh.disabled) load();
  }, 60000);
  client.auth.onAuthStateChange(event => {
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(load, 0);
  });
})();
