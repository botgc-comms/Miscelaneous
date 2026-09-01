(() => {
  const commercial = {
    illustrationConfigured: false,
    memberDirectory: null,
  };

  installHeaderLink();
  installNewTrophyFlow();
  installMemberDirectory();
  installIllustrationControl();
  installMatchEnhancer();
  refreshCapabilities();

  function installHeaderLink() {
    const actions = document.querySelector('.header-actions');
    if (!actions || actions.querySelector('.plans-link')) return;
    const link = document.createElement('a');
    link.className = 'plans-link';
    link.href = '/';
    link.textContent = 'Plans';
    actions.prepend(link);
  }

  function installNewTrophyFlow() {
    const heading = document.querySelector('.catalogue-heading');
    if (!heading || document.querySelector('#new-trophy-button')) return;
    const button = document.createElement('button');
    button.id = 'new-trophy-button';
    button.className = 'new-trophy-button';
    button.type = 'button';
    button.innerHTML = '<span aria-hidden="true">+</span><span><strong>Add trophy</strong><small>Photograph a new piece</small></span>';
    heading.append(button);

    const dialog = document.createElement('dialog');
    dialog.id = 'new-trophy-dialog';
    dialog.className = 'commercial-dialog';
    dialog.innerHTML = `
      <form id="new-trophy-form">
        <button class="commercial-dialog-close" type="button" aria-label="Close">×</button>
        <p class="step-label">New archive record</p>
        <h2>Add a trophy</h2>
        <p>Create the record first, then upload several photographs for inscription reading and a generated catalogue illustration.</p>
        <label><span>Trophy name</span><input name="name" maxlength="160" required placeholder="e.g. Ladies Challenge Cup"></label>
        <div class="commercial-form-grid">
          <label><span>Category</span><input name="category" maxlength="80" required placeholder="e.g. Golf, Rugby, Cricket"></label>
          <label><span>Reference code <em>optional</em></span><input name="code" maxlength="24" placeholder="Auto-generated"></label>
        </div>
        <label><span>Alternative name <em>optional</em></span><input name="secondaryName" maxlength="160" placeholder="Name engraved on the base"></label>
        <button class="commercial-submit" type="submit">Create trophy record</button>
        <p class="commercial-form-error" role="alert" hidden></p>
      </form>`;
    document.body.append(dialog);

    button.addEventListener('click', () => dialog.showModal());
    dialog.querySelector('.commercial-dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.querySelector('form').addEventListener('submit', createTrophy);
  }

  async function createTrophy(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const error = form.querySelector('.commercial-form-error');
    const submit = form.querySelector('[type="submit"]');
    error.hidden = true;
    submit.disabled = true;
    try {
      const values = new FormData(form);
      const data = await api('/api/trophies', {
        method: 'POST',
        body: JSON.stringify({
          name: values.get('name'),
          secondaryName: values.get('secondaryName') || null,
          category: values.get('category'),
          code: values.get('code') || null,
        }),
      });
      document.querySelector('#new-trophy-dialog').close();
      form.reset();
      await loadCatalogue();
      await openTrophy(data.trophy.id);
      showToast('Trophy created. Add photographs from several angles next.');
    } catch (exception) {
      error.textContent = exception.message;
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function installMemberDirectory() {
    const tools = document.querySelector('.catalogue-tools');
    if (!tools || document.querySelector('#member-directory-card')) return;
    const card = document.createElement('section');
    card.id = 'member-directory-card';
    card.className = 'member-directory-card';
    card.innerHTML = `
      <div class="member-directory-copy">
        <span class="member-directory-icon" aria-hidden="true">↔</span>
        <span><strong>Member matching</strong><small id="member-directory-summary">Upload a club member export to suggest likely identities.</small></span>
      </div>
      <div class="member-directory-actions">
        <label class="member-upload-button">Upload CSV / XLSX<input id="member-file-input" type="file" accept=".csv,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
        <button id="clear-member-directory" type="button" hidden>Remove</button>
      </div>
      <p class="member-privacy">Privacy by design: complete dates of birth are reduced to birth year during import; the original file is not retained.</p>`;
    tools.after(card);
    card.querySelector('#member-file-input').addEventListener('change', importMembers);
    card.querySelector('#clear-member-directory').addEventListener('click', clearMembers);
  }

  async function refreshCapabilities() {
    try {
      const auth = await api('/api/auth/status');
      commercial.illustrationConfigured = Boolean(auth.illustrationConfigured);
      if (auth.authenticated) await refreshMemberSummary();
      updateIllustrationControl();
    } catch { }
  }

  async function refreshMemberSummary() {
    try {
      const data = await api('/api/members');
      commercial.memberDirectory = data.directory;
      const summary = document.querySelector('#member-directory-summary');
      const clear = document.querySelector('#clear-member-directory');
      if (!summary || !clear) return;
      if (data.directory.memberCount) {
        summary.textContent = `${data.directory.memberCount} members loaded · ${data.directory.withBirthYearCount} with a birth year`;
        clear.hidden = false;
      } else {
        summary.textContent = 'Upload a club member export to suggest likely identities.';
        clear.hidden = true;
      }
    } catch { }
  }

  async function importMembers(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file, file.name);
    setBusy(true, 'Importing member directory…', 'Normalising names and reducing dates of birth to birth year.');
    try {
      const data = await api('/api/members/import', { method: 'POST', body: form });
      commercial.memberDirectory = data.directory;
      await refreshMemberSummary();
      if (state.current) await refreshCurrent();
      showToast(`${data.result.importedCount} members imported and compared with the winners archive.`);
    } catch (exception) {
      showToast(exception.message, true, 6500);
    } finally {
      event.target.value = '';
      setBusy(false);
    }
  }

  async function clearMembers() {
    if (!confirm('Remove the imported member directory and all suggested matches? Trophy winners will not be changed.')) return;
    try {
      await api('/api/members', { method: 'DELETE', body: '{}' });
      await refreshMemberSummary();
      if (state.current) await refreshCurrent();
      showToast('Member directory removed.');
    } catch (exception) {
      showToast(exception.message, true);
    }
  }

  function installIllustrationControl() {
    const heading = document.querySelector('.detail-heading');
    if (!heading || document.querySelector('#generate-illustration-button')) return;
    const button = document.createElement('button');
    button.id = 'generate-illustration-button';
    button.className = 'generate-illustration-button';
    button.type = 'button';
    button.innerHTML = '<span aria-hidden="true">✦</span><span><strong>Create illustration</strong><small>Use up to four trophy angles</small></span>';
    heading.append(button);
    button.addEventListener('click', generateIllustration);

    const observer = new MutationObserver(updateIllustrationControl);
    observer.observe(document.querySelector('#detail-title'), { childList: true, subtree: true });
    observer.observe(document.querySelector('#photo-strip'), { childList: true, subtree: true });
    updateIllustrationControl();
  }

  function updateIllustrationControl() {
    const button = document.querySelector('#generate-illustration-button');
    if (!button) return;
    const trophy = state.current;
    const photoCount = trophy?.evidence?.filter(item => item.kind === 'photo').length ?? 0;
    button.disabled = !trophy || photoCount === 0 || !commercial.illustrationConfigured;
    const title = button.querySelector('strong');
    const copy = button.querySelector('small');
    if (!commercial.illustrationConfigured) {
      title.textContent = 'Illustration unavailable';
      copy.textContent = 'Connect the image model';
    } else if (photoCount === 0) {
      title.textContent = 'Create illustration';
      copy.textContent = 'Add trophy photographs first';
    } else if (trophy.illustrationGenerationCount > 0) {
      title.textContent = 'Regenerate illustration';
      copy.textContent = `Use ${plural(Math.min(photoCount, 4), 'saved angle')}`;
    } else {
      title.textContent = 'Create illustration';
      copy.textContent = `Use ${plural(Math.min(photoCount, 4), 'saved angle')}`;
    }
  }

  async function generateIllustration() {
    if (!state.current) return;
    const id = state.current.id;
    setBusy(true, 'Creating the trophy illustration…', 'Reconciling up to four photographed angles into one faithful catalogue portrait. This may take a minute.');
    try {
      const data = await api(`/api/trophies/${encodeURIComponent(id)}/illustration`, { method: 'POST', body: '{}' });
      if (state.current?.id !== id) return;
      state.current = data.trophy;
      renderDetail();
      updateIllustrationControl();
      await loadCatalogue();
      showToast('Catalogue illustration created.');
    } catch (exception) {
      showToast(exception.message, true, 7000);
    } finally {
      setBusy(false);
    }
  }

  function installMatchEnhancer() {
    const list = document.querySelector('#winner-list');
    if (!list) return;
    const observer = new MutationObserver(enhanceMatches);
    observer.observe(list, { childList: true, subtree: true });
    enhanceMatches();
  }

  function enhanceMatches() {
    const winners = state.current?.winners || [];
    for (const winner of winners) {
      if (!winner.memberMatch) continue;
      const row = document.querySelector(`#winner-list [data-winner-id="${cssEscape(winner.id)}"]`);
      const nameLabel = row?.querySelector('.winner-name');
      if (!nameLabel || nameLabel.querySelector('.member-match')) continue;
      const match = winner.memberMatch;
      const badge = document.createElement('span');
      badge.className = `member-match is-${match.state}`;
      badge.title = match.explanation;
      badge.innerHTML = `<b>${match.state === 'strong' ? 'Likely member' : 'Possible member'}</b><span>${escapeHtml(match.memberName)}${match.membershipNumber ? ` · #${escapeHtml(match.membershipNumber)}` : ''}${match.birthYear ? ` · born ${match.birthYear}` : ''}</span><em>${Math.round(match.confidence * 100)}%</em>`;
      nameLabel.append(badge);
    }
  }

  function cssEscape(value) {
    return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }
})();
