(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const setStatus = message => { $('status').textContent = message; };
  const projectUrl = 'https://ttkceizmjeckrorhkhfr.supabase.co';
  const publishableKey = 'sb_publishable_v3-qGYPg-tSY-G4cX47HRg_TgMnYEbO';
  const allowedScopes = new Set(['openid', 'email', 'profile', 'offline_access']);
  const authorizationId = new URLSearchParams(location.search).get('authorization_id');
  let details = null;

  const fail = message => {
    details = null;
    $('consent').hidden = true;
    $('approve').disabled = true;
    $('deny').disabled = true;
    setStatus(message);
  };
  const validAuthorizationId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,200}$/.test(value);
  const validCallback = value => {
    try {
      const url = new URL(value);
      return url.origin === 'https://chatgpt.com' && /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(url.pathname);
    } catch {
      return false;
    }
  };

  if (!validAuthorizationId(authorizationId)) {
    fail('Start Connect from the RPE Corporate PSC-D Web plugin to create a fresh request.');
    return;
  }
  if (!window.supabase) {
    fail('Corporate sign-in could not load. Refresh this page and start Connect again.');
    return;
  }

  const client = window.supabase.createClient(projectUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  async function reviewRequest() {
    $('consent').hidden = true;
    details = null;
    const sessionResult = await client.auth.getSession();
    if (sessionResult.error || !sessionResult.data.session) {
      $('signIn').hidden = false;
      setStatus('Sign in with Chad’s Corporate PCC account to review this request.');
      return;
    }

    const userResult = await client.auth.getUser();
    if (userResult.error || !userResult.data.user) {
      fail('Corporate Supabase could not verify this account. No access was approved.');
      return;
    }

    const requestResult = await client.auth.oauth.getAuthorizationDetails(authorizationId);
    if (requestResult.error || !requestResult.data) {
      fail('Corporate Supabase could not verify this request. No access was approved. Start Connect again.');
      return;
    }

    const request = requestResult.data;
    if (!('authorization_id' in request)) {
      if (validCallback(request.redirect_url)) {
        setStatus('This connection was already approved. Returning to ChatGPT…');
        location.replace(request.redirect_url);
      } else {
        fail('The return destination could not be verified. No access was approved.');
      }
      return;
    }

    const scopes = typeof request.scope === 'string' ? request.scope.split(/\s+/).filter(Boolean) : [];
    if (
      request.authorization_id !== authorizationId ||
      !request.client?.name ||
      request.user?.id !== userResult.data.user.id ||
      !validCallback(request.redirect_uri) ||
      scopes.length === 0 ||
      !scopes.includes('openid') ||
      scopes.some(scope => !allowedScopes.has(scope))
    ) {
      fail('The signed-in account, requested access, or return destination did not match. No access was approved.');
      return;
    }

    details = request;
    $('clientName').textContent = request.client.name;
    $('scopes').textContent = scopes.join(', ');
    $('consent').hidden = false;
    $('approve').disabled = false;
    $('deny').disabled = false;
    setStatus('Confirm that this is the Corporate PSC-D connection you started.');
  }

  $('signIn').addEventListener('submit', async event => {
    event.preventDefault();
    $('signInButton').disabled = true;
    try {
      const result = await client.auth.signInWithPassword({
        email: $('email').value.trim(),
        password: $('password').value
      });
      $('password').value = '';
      if (result.error) {
        setStatus('Sign-in failed. Check the Corporate PCC account credentials.');
        return;
      }
      await reviewRequest();
    } catch {
      setStatus('Corporate sign-in is unavailable. Try again.');
    } finally {
      $('signInButton').disabled = false;
    }
  });

  async function decide(approve) {
    if (!details) return;
    $('approve').disabled = true;
    $('deny').disabled = true;
    setStatus(approve ? 'Approving the Corporate connection…' : 'Canceling the connection…');
    try {
      const result = approve
        ? await client.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : await client.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (result.error || !validCallback(result.data?.redirect_url)) {
        fail('Corporate Supabase could not complete this request. Start Connect again.');
        return;
      }
      location.replace(result.data.redirect_url);
    } catch {
      fail('Corporate Supabase could not complete this request. Start Connect again.');
    }
  }

  $('approve').addEventListener('click', () => decide(true));
  $('deny').addEventListener('click', () => decide(false));
  reviewRequest().catch(() => fail('Corporate Supabase is unavailable. No access was approved.'));
})();