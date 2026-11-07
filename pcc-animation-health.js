(() => {
  'use strict';
  const panel = document.querySelector('[data-animation-health]');
  if (!panel || !window.supabase) return;
  const base = 'https://ttkceizmjeckrorhkhfr.supabase.co';
  const key = 'sb_publishable_v3-qGYPg-tSY-G4cX47HRg_TgMnYEbO';
  const client = window.supabase.createClient(base, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  const gauge = panel.querySelector('.pcc-gauge');
  const status = panel.querySelector('[data-animation-status]');
  const jobs = panel.querySelector('[data-animation-jobs]');
  const time = panel.querySelector('[data-animation-time]');
  const button = panel.querySelector('[data-animation-refresh]');
  let request;
  function display(state, label, reason) {
    gauge.dataset.state = state;
    gauge.querySelector('span').textContent = { current: '✓', attention: '!', problematic: '×', unverified: '—' }[state];
    panel.querySelector('strong').textContent = label;
    status.textContent = reason;
  }
  function assess(admission, connection) {
    if (admission?.state === 'PRODUCTION_BLOCKED') return ['problematic', 'Problematic', 'Production is blocked by the engine’s admission checks.'];
    if (['WORKER_API_UNHEALTHY', 'WORKER_API_UNREACHABLE', 'WORKER_CAPABILITY_CONTRACT_MISMATCH',
      'POD_PROFILE_MISMATCH', 'COST_LIMIT_EXCEEDED', 'CONTROL_PLANE_UNREACHABLE'].includes(connection?.state)) {
      return ['problematic', 'Problematic', 'The GPU connection or worker failed a required check.'];
    }
    if (admission?.state !== 'PRODUCTION_ADMITTED') return ['unverified', 'No reading', 'Production admission could not be verified.'];
    if (connection?.state === 'WORKER_READY') return ['current', 'Good', 'Production admission passed and the GPU worker responded. Each render still requires authorization.'];
    if (['POD_STOPPED', 'API_CONNECTED', 'NOT_CONFIGURED', 'POD_METADATA_INVALID'].includes(connection?.state)) {
      return ['attention', 'Concern', 'Production admission passed. A ready GPU worker has yet to be verified.'];
    }
    return ['unverified', 'No reading', 'GPU worker status could not be verified.'];
  }
  function describeJobs(records) {
    if (!Array.isArray(records)) return 'Job history unavailable for this session.';
    const failed = records.filter(job => job.status === 'FAILED').length;
    const latest = Math.max(...records.filter(job => job.status === 'COMPLETE')
      .map(job => Date.parse(job.updated_at)).filter(Number.isFinite));
    const completion = Number.isFinite(latest) ? 'Latest completed job updated ' + new Date(latest).toLocaleString() + '.'
      : 'No completed job in the visible records.';
    return completion + (failed ? ' Failed jobs in view: ' + failed + '.' : '');
  }
  async function load() {
    request?.abort();
    const current = new AbortController();
    request = current;
    display('unverified', 'No reading', 'Checking production and GPU status…');
    jobs.textContent = '';
    time.textContent = '';
    button.disabled = true;
    try {
      const { data, error } = await client.auth.getSession();
      if (current.signal.aborted) return;
      if (error || !data?.session?.access_token) {
        display('unverified', 'No reading', 'Sign in to the authorized PCC Founder account to see engine readings.');
        return;
      }
      const read = async action => {
        const response = await fetch(base + '/functions/v1/pcc-animation-control-v1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + data.session.access_token },
          body: JSON.stringify({ action, payload: {} }),
          signal: AbortSignal.any([current.signal, AbortSignal.timeout(15000)]),
          cache: 'no-store'
        });
        return response.ok ? response.json() : null;
      };
      const readings = await Promise.allSettled([read('PMF_PRODUCTION_READINESS'), read('RUNPOD_CONNECTION_STATUS'), read('LIST')]);
      if (current.signal.aborted) return;
      const [production, gpu, history] = readings.map(reading => reading.value);
      const reading = assess(production?.readiness, gpu?.connection);
      display(...reading);
      jobs.textContent = describeJobs(history?.jobs);
      if (reading[0] !== 'unverified') time.textContent = 'Last verified ' + new Date().toLocaleString() + '.';
    } catch {
      if (!current.signal.aborted) display('unverified', 'No reading', 'The engine readings could not be loaded.');
    } finally {
      if (!current.signal.aborted) button.disabled = false;
    }
  }
  button.addEventListener('click', load);
  client.auth.onAuthStateChange(event => {
    if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) setTimeout(load, 0);
  });
  setInterval(() => { if (!document.hidden && !button.disabled) load(); }, 60000);
})();
