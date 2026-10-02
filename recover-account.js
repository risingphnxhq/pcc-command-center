(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const status = message => { $('status').textContent = message; };
  const hash = new URLSearchParams(location.hash.slice(1));
  const recoveryLink = hash.get('type') === 'recovery';
  const linkError = hash.has('error') || new URLSearchParams(location.search).has('error');
  let recoveryReady = false;
  const cleanUrl = () => history.replaceState(null, '', location.pathname);
  const errorMessage = error => {
    if (error?.status === 429 || error?.code === 'over_email_send_rate_limit') return 'Recovery email limit reached. Wait before requesting another email.';
    if (/fetch|network/i.test(error?.message || '')) return 'PCC could not reach account authentication. Check your connection before trying again.';
    return 'Account recovery could not finish. Your password has not been changed. Use a fresh recovery email or try again later.';
  };
  if (!window.supabase) { cleanUrl(); status('Account recovery could not load. Please refresh the page.'); return; }
  // Recovery sessions remain in memory, separate from the existing PCC login.
  const client = window.supabase.createClient('https://ttkceizmjeckrorhkhfr.supabase.co', 'sb_publishable_v3-qGYPg-tSY-G4cX47HRg_TgMnYEbO', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: true, flowType: 'implicit' }
  });
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && recoveryLink && session) {
      recoveryReady = true;
      cleanUrl();
      $('requestForm').hidden = true;
      $('passwordForm').hidden = false;
      status('Recovery email verified. Choose your new password below.');
    }
  });
  client.auth.getSession().then(({error}) => {
    cleanUrl();
    if (recoveryReady) return;
    $('requestForm').hidden = false;
    status(error || linkError || recoveryLink ? 'This recovery link could not be verified. Request a fresh email when the email limit has cleared.' : 'Enter your account email to request a recovery link. If an email limit was reported, wait before requesting another.');
  }).catch(() => { cleanUrl(); status('Account authentication is unavailable. Please try again later.'); });
  $('requestForm').addEventListener('submit', async event => {
    event.preventDefault();
    $('requestButton').disabled = true;
    status('Requesting your recovery email…');
    try {
      const {error} = await client.auth.resetPasswordForEmail($('email').value.trim(), {redirectTo: 'https://command.risingphoenixhq.com/recover-account.html'});
      if (error) { status(errorMessage(error)); return; }
      status('If this email belongs to an eligible account, a recovery link will arrive. Open the newest email.');
      $('requestForm').hidden = true;
    } catch (error) { status(errorMessage(error)); }
    finally { /* No automatic retries or duplicate email requests. */ }
  });
  $('passwordForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!recoveryReady) { status('Open a verified recovery email before changing your password.'); return; }
    if ($('password').value.length < 12 || $('password').value !== $('confirm').value) { status('Use at least 12 characters and enter the same password twice.'); return; }
    $('saveButton').disabled = true;
    let saved = false;
    try {
      const {error} = await client.auth.updateUser({password: $('password').value});
      if (error) { status(errorMessage(error)); return; }
      saved = true;
      recoveryReady = false;
      $('passwordForm').hidden = true;
      status('Your password has been updated. Return to PCC and sign in with your new password.');
      // Local cleanup must not turn a completed password change into a failure.
      await client.auth.signOut({scope: 'local'}).catch(() => {});
    } catch (error) { if (!saved) status(errorMessage(error)); }
    finally { $('password').value = ''; $('confirm').value = ''; $('saveButton').disabled = false; }
  });
})();
