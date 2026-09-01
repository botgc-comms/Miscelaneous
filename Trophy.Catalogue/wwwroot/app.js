(() => {
  const loginForm = document.querySelector('#login-form');
  const signupForm = document.querySelector('#signup-form');
  const clubForm = document.querySelector('#club-setup-form');
  const originalArchiveForm = document.querySelector('#original-archive-form');
  const loginPassword = document.querySelector('#login-password');
  if (loginPassword) loginPassword.id = 'password-input';

  loginForm?.addEventListener('submit', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    accountSignIn(event.currentTarget);
  }, true);
  signupForm?.addEventListener('submit', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    accountSignUp(event.currentTarget);
  }, true);
  clubForm?.addEventListener('submit', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    saveClub(event.currentTarget);
  }, true);
  originalArchiveForm?.addEventListener('submit', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    accountOriginalArchiveSignIn(event.currentTarget);
  }, true);
  document.querySelector('#logout-button')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    accountSignOut();
  }, true);
  document.querySelector('#setup-signout-button')?.addEventListener('click', accountSignOut);
  document.querySelector('#show-login-button')?.addEventListener('click', () => showAuthTab('login'));
  document.querySelector('#show-signup-button')?.addEventListener('click', () => showAuthTab('signup'));
  document.querySelector('#club-logo-input')?.addEventListener('change', previewClubLogo);

  const coreScript = document.createElement('script');
  coreScript.src = '/app-core.js';
  coreScript.onload = () => {
    accountInitialise();
    window.dispatchEvent(new CustomEvent('trophy-app-ready'));
  };
  document.head.append(coreScript);

  async function accountInitialise() {
    try {
      const auth = await api('/api/auth/status');
      state.auth = auth;
      state.aiConfigured = auth.aiConfigured;
      if (!auth.authenticated) {
        showAuthTab(location.hash === '#signup' ? 'signup' : 'login');
        document.querySelector('#login-screen').hidden = false;
        return;
      }
      if (auth.onboardingRequired) {
        showClubSetup(auth);
        return;
      }
      applyClubBranding(auth.club);
      document.querySelector('#login-screen').hidden = true;
      document.querySelector('#club-setup-screen').hidden = true;
    } catch (exception) {
      showAccountError('#login-error', exception.message);
    }
  }

  async function accountSignIn(form) {
    const submit = form.querySelector('[type="submit"]');
    const error = document.querySelector('#login-error');
    submit.disabled = true;
    error.hidden = true;
    try {
      const auth = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.querySelector('#login-email').value.trim(),
          password: loginPassword.value,
        }),
      });
      state.auth = auth;
      state.aiConfigured = auth.aiConfigured;
      loginPassword.value = '';
      if (auth.onboardingRequired) {
        showClubSetup(auth);
        return;
      }
      await enterArchive(auth);
    } catch (exception) {
      showAccountError('#login-error', exception.message);
    } finally {
      submit.disabled = false;
    }
  }

  async function accountOriginalArchiveSignIn(form) {
    const submit = form.querySelector('[type="submit"]');
    const error = document.querySelector('#original-archive-error');
    submit.disabled = true;
    error.hidden = true;
    try {
      const auth = await api('/api/auth/original-archive', {
        method: 'POST',
        body: JSON.stringify({ password: document.querySelector('#original-password').value || null }),
      });
      state.auth = auth;
      document.querySelector('#original-password').value = '';
      await enterArchive(auth);
      showToast('Original 102-trophy archive restored.');
    } catch (exception) {
      showAccountError('#original-archive-error', exception.message);
    } finally {
      submit.disabled = false;
    }
  }

  async function accountSignUp(form) {
    const submit = form.querySelector('[type="submit"]');
    const error = document.querySelector('#signup-error');
    submit.disabled = true;
    error.hidden = true;
    try {
      const auth = await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          displayName: document.querySelector('#signup-name').value.trim(),
          email: document.querySelector('#signup-email').value.trim(),
          password: document.querySelector('#signup-password').value,
        }),
      });
      state.auth = auth;
      state.aiConfigured = auth.aiConfigured;
      form.reset();
      showClubSetup(auth);
    } catch (exception) {
      showAccountError('#signup-error', exception.message);
    } finally {
      submit.disabled = false;
    }
  }

  async function saveClub(form) {
    const submit = form.querySelector('.setup-submit');
    const error = document.querySelector('#club-setup-error');
    const logo = document.querySelector('#club-logo-input').files?.[0];
    if (!logo) {
      showAccountError('#club-setup-error', 'Add the club logo before creating the archive.');
      return;
    }
    submit.disabled = true;
    error.hidden = true;
    try {
      setBusy(true, 'Creating your club archive…', 'Saving the club identity and preparing a separate trophy collection.');
      await api('/api/club', {
        method: 'PUT',
        body: JSON.stringify({
          name: document.querySelector('#club-name-input').value.trim(),
          sport: document.querySelector('#club-sport-input').value.trim(),
          country: document.querySelector('#club-country-input').value.trim(),
          website: document.querySelector('#club-website-input').value.trim() || null,
        }),
      });
      const logoForm = new FormData();
      logoForm.append('logo', logo, logo.name);
      await api('/api/club/logo', { method: 'POST', body: logoForm });
      const auth = await api('/api/auth/status');
      if (auth.onboardingRequired) throw new Error('The club setup is incomplete. Check the details and logo, then try again.');
      state.auth = auth;
      state.aiConfigured = auth.aiConfigured;
      await enterArchive(auth);
      showToast(`${auth.club.name} is ready. Add the first trophy whenever you’re ready.`);
    } catch (exception) {
      showAccountError('#club-setup-error', exception.message);
    } finally {
      setBusy(false);
      submit.disabled = false;
    }
  }

  async function enterArchive(auth) {
    applyClubBranding(auth.club);
    document.querySelector('#login-screen').hidden = true;
    document.querySelector('#club-setup-screen').hidden = true;
    if (['#signup', '#login', ''].includes(location.hash)) history.replaceState({}, '', '#catalogue');
    await loadCatalogue();
    const trophyId = trophyIdFromHash();
    if (trophyId) await openTrophy(trophyId, false);
    else closeTrophy(false);
  }

  function showClubSetup(auth) {
    document.querySelector('#login-screen').hidden = true;
    document.querySelector('#club-setup-screen').hidden = false;
    const club = auth.club;
    if (club) {
      document.querySelector('#club-name-input').value = club.name || '';
      document.querySelector('#club-sport-input').value = club.sport || '';
      document.querySelector('#club-country-input').value = club.country || '';
      document.querySelector('#club-website-input').value = club.website || '';
    }
    setTimeout(() => document.querySelector('#club-name-input').focus(), 50);
  }

  function showAuthTab(tab) {
    const signup = tab === 'signup';
    document.querySelector('#login-form').hidden = signup;
    document.querySelector('#signup-form').hidden = !signup;
    const loginButton = document.querySelector('#show-login-button');
    const signupButton = document.querySelector('#show-signup-button');
    loginButton.classList.toggle('is-active', !signup);
    signupButton.classList.toggle('is-active', signup);
    loginButton.setAttribute('aria-selected', String(!signup));
    signupButton.setAttribute('aria-selected', String(signup));
    document.querySelector('#login-error').hidden = true;
    document.querySelector('#signup-error').hidden = true;
    const originalAccess = document.querySelector('#original-archive-access');
    const originalAvailable = Boolean(state.auth?.originalArchiveAvailable);
    const originalPasswordRequired = Boolean(state.auth?.originalArchivePasswordRequired);
    originalAccess.hidden = signup || !originalAvailable;
    document.querySelector('#original-password-label').hidden = !originalPasswordRequired;
    document.querySelector('#original-password').required = originalPasswordRequired;
    setTimeout(() => document.querySelector(signup ? '#signup-name' : '#login-email').focus(), 30);
  }

  function previewClubLogo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const preview = document.querySelector('#club-logo-preview');
    const objectUrl = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${objectUrl}" alt="Selected club logo"><small>Tap to choose a different logo</small>`;
    preview.querySelector('img').addEventListener('load', () => URL.revokeObjectURL(objectUrl), { once: true });
  }

  function applyClubBranding(club) {
    if (!club) return;
    document.querySelector('#club-name').textContent = club.name;
    document.querySelector('#club-subtitle').textContent = `${club.sport} · Trophy Archive`;
    const monogram = document.querySelector('#club-monogram');
    const logo = document.querySelector('#club-logo');
    monogram.textContent = club.name.trim().charAt(0).toUpperCase() || 'T';
    if (club.logoUrl) {
      logo.src = club.logoUrl;
      logo.alt = `${club.name} logo`;
      logo.hidden = false;
      monogram.hidden = true;
      logo.onerror = () => { logo.hidden = true; monogram.hidden = false; };
    } else {
      logo.hidden = true;
      monogram.hidden = false;
    }
    document.title = `Trophy Archive · ${club.name}`;
  }

  async function accountSignOut() {
    try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch { }
    stopAnalysisPolling();
    state.auth = null;
    state.current = null;
    state.trophies = [];
    document.querySelector('#club-setup-screen').hidden = true;
    document.querySelector('#login-screen').hidden = false;
    document.querySelector('#club-logo').hidden = true;
    document.querySelector('#club-monogram').hidden = false;
    document.querySelector('#club-monogram').textContent = 'T';
    document.querySelector('#club-name').textContent = 'Your club';
    document.querySelector('#club-subtitle').textContent = 'Trophy Archive';
    try { state.auth = await api('/api/auth/status'); } catch { state.auth = null; }
    showAuthTab('login');
    history.replaceState({}, '', '#login');
  }

  function showAccountError(selector, message) {
    const element = document.querySelector(selector);
    element.textContent = message;
    element.hidden = false;
  }
})();
