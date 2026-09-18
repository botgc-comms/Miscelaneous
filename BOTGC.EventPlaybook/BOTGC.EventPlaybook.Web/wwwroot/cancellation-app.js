const apiJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || result.detail || result.title || `The service returned HTTP ${response.status}.`);
  }
  return result;
};

let activeRuntime = null;

const html = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const isoToday = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const addDays = (date, days) => {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const formatDate = value => {
  if (!value) return 'Not recorded';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: /^\d{4}-\d{2}-\d{2}$/.test(value) ? undefined : '2-digit',
    minute: /^\d{4}-\d{2}-\d{2}$/.test(value) ? undefined : '2-digit'
  }).format(parsed);
};

function normaliseResponse(context) {
  const cycleKey = `cancelled:${context.lifecycle.statusChangedAt || context.eventId}`;
  const saved = context.responseState?.cycleKey === cycleKey ? structuredClone(context.responseState) : {};
  const actions = saved.actions && typeof saved.actions === 'object' ? saved.actions : {};
  const response = {
    cycleKey,
    startedAt: saved.startedAt || new Date().toISOString(),
    updatedAt: saved.updatedAt || null,
    actions: {
      screens: { status: 'pending', mode: 'remove', ...actions.screens },
      email: { status: 'pending', subject: '', bodyHtml: '', categories: [], testAddress: '', testStatus: 'idle', ...actions.email },
      intelligentGolf: { status: 'pending', removeDiary: false, removePlanner: false, ...actions.intelligentGolf },
      bookings: { status: 'pending', ...actions.bookings },
      social: { status: 'pending', ...actions.social },
      print: { status: 'pending', ...actions.print }
    }
  };
  const interruptedMessages = {
    screens: 'The previous clubhouse-screen action was interrupted. Refresh the evidence, then retry the same action.',
    email: 'The previous email operation was interrupted. If it was a bulk send, check Intelligent Golf before retrying so members do not receive a duplicate message.',
    intelligentGolf: 'The previous Intelligent Golf removal was interrupted. The live links below have been refreshed before another attempt.'
  };
  for (const [name, message] of Object.entries(interruptedMessages)) {
    if (response.actions[name].status !== 'working') continue;
    response.actions[name].status = 'failed';
    response.actions[name].error = response.actions[name].error || message;
  }
  if (response.actions.email.testStatus === 'working') {
    response.actions.email.testStatus = 'failed';
    response.actions.email.testError = response.actions.email.testError || 'The previous test-email request was interrupted. Check the test inbox before trying again.';
  }
  return response;
}

function actionBadge(action, required = true) {
  const status = action?.status || 'pending';
  if (!required && status === 'pending') return '<span class="cancellation-state neutral">Not indicated</span>';
  const labels = {
    pending: 'Action required',
    working: 'Working…',
    complete: 'Complete',
    failed: 'Needs attention',
    'not-required': 'No action required'
  };
  return `<span class="cancellation-state ${html(status)}">${html(labels[status] || status)}</span>`;
}

function readPublicationEvidence(runtime) {
  const session = runtime.posterDocument?.session ?? {};
  const screen = session.screenPublication && Number(session.screenPublication.mediaId) > 0
    ? session.screenPublication
    : null;
  const email = session.emailPublication && session.emailPublication.sentAt
    ? session.emailPublication
    : null;
  const intelligentGolfDiaryKnown = runtime.intelligentGolf && Object.prototype.hasOwnProperty.call(runtime.intelligentGolf, 'diaryEntryId');
  const intelligentGolfPlannerKnown = runtime.intelligentGolf && Object.prototype.hasOwnProperty.call(runtime.intelligentGolf, 'plannerEntryId');
  const diaryId = intelligentGolfDiaryKnown
    ? Number(runtime.intelligentGolf.diaryEntryId) || null
    : Number(session.diaryPublication?.remoteId) || null;
  const plannerId = intelligentGolfPlannerKnown
    ? Number(runtime.intelligentGolf.plannerEntryId) || null
    : Number(session.diaryPublication?.externalId) || null;
  return {
    session,
    screen,
    email,
    diaryId,
    plannerId,
    clubhouseArtwork: session.artworkByOutput?.clubhouse || session.primaryArtworkDataUrl || '',
    socialPlanned: runtime.context.answers?.['social-media-required'] === true,
    bookingsPlanned: Boolean(runtime.context.answers?.['admission-arrangements']),
    printPossible: Boolean(session.artworkByOutput?.a4)
  };
}

function selectedAudience(runtime) {
  if (!Array.isArray(runtime.members)) return [];
  const selected = new Set(runtime.response.actions.email.categories || []);
  return runtime.members.filter(member => member.isActive === true && member.email && selected.has(member.membershipCategory || 'Uncategorised'));
}

function renderAudience(runtime) {
  if (runtime.membersLoading) return '<p class="cancellation-muted">Retrieving the current active-member directory…</p>';
  if (!Array.isArray(runtime.members)) {
    return '<button class="button button-secondary" type="button" data-cancellation-load-audience>Retrieve active members</button>';
  }
  const groups = new Map();
  for (const member of runtime.members.filter(item => item.isActive === true && item.email)) {
    const category = member.membershipCategory || 'Uncategorised';
    groups.set(category, (groups.get(category) || 0) + 1);
  }
  if (groups.size === 0) return '<p class="cancellation-warning">No active members with an email address were returned.</p>';
  const selected = new Set(runtime.response.actions.email.categories || []);
  return `<div class="cancellation-audience">
    ${[...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([category, count]) => `
      <label><input type="checkbox" data-cancellation-email-category="${html(category)}" ${selected.has(category) ? 'checked' : ''}><span>${html(category)} <small>${count}</small></span></label>`).join('')}
  </div>
  <p class="cancellation-muted">${selectedAudience(runtime).length} active member${selectedAudience(runtime).length === 1 ? '' : 's'} selected. The earlier campaign did not retain its exact recipient list, so confirm this audience before sending.</p>`;
}

function renderOperationalNotice(runtime) {
  const notice = runtime.context.lifecycle.statusNotification;
  const sent = ['sent', 'not-required', 'legacy-recorded'].includes(notice?.deliveryStatus);
  return `<article class="cancellation-card ${sent ? 'complete' : 'attention'}">
    <div class="cancellation-card-heading">
      <div><span class="eyebrow">Internal coordination</span><h3>Operational leads</h3></div>
      <span class="cancellation-state ${sent ? 'complete' : 'pending'}">${sent ? 'Update recorded' : 'Check status update'}</span>
    </div>
    <p>${sent
      ? `The cancellation decision has been recorded for operational leads${notice?.completedAt ? ` (${html(formatDate(notice.completedAt))})` : ''}.`
      : 'The operational status update is not confirmed as complete. Use Manage status to review or retry it.'}</p>
    ${notice?.error ? `<div class="cancellation-inline-error">${html(notice.error)}</div>` : ''}
    ${sent ? '' : '<button class="button button-secondary" type="button" data-cancellation-manage-status>Review status update</button>'}
  </article>`;
}

function renderScreens(runtime, evidence) {
  if (runtime.posterCheckFailed) {
    return `<article class="cancellation-card attention">
      <div class="cancellation-card-heading"><div><span class="eyebrow">Clubhouse screens</span><h3>Digital display</h3></div><span class="cancellation-state failed">Could not verify</span></div>
      <p>The Communications Centre record could not be checked, so Cancellation Control cannot safely say whether screen artwork is still live.</p>
      <span class="cancellation-muted">Use “Try again” above before deciding that no screen action is required.</span>
    </article>`;
  }
  if (!runtime.context.yodeckEnabled) {
    return `<article class="cancellation-card unavailable">
      <div class="cancellation-card-heading"><div><span class="eyebrow">Clubhouse screens</span><h3>Digital display</h3></div><span class="cancellation-state neutral">Yodeck disabled</span></div>
      <p>${evidence.screen ? 'A previous screen publication is recorded, but Yodeck is currently disabled. Enable the Yodeck plugin to remove it or replace it with a cancellation notice.' : 'No screen action is available while the Yodeck plugin is disabled.'}</p>
    </article>`;
  }

  const action = runtime.response.actions.screens;
  if (!evidence.screen && action.status !== 'complete') {
    return `<article class="cancellation-card complete">
      <div class="cancellation-card-heading"><div><span class="eyebrow">Clubhouse screens</span><h3>Digital display</h3></div>${actionBadge({ status: 'not-required' })}</div>
      <p>No active screen publication is recorded for this event, so there is nothing to withdraw.</p>
    </article>`;
  }

  const defaultEnd = runtime.context.eventDate >= isoToday() ? runtime.context.eventDate : addDays(isoToday(), 7);
  const endDate = action.endDate || defaultEnd;
  return `<article class="cancellation-card ${html(action.status)}">
    <div class="cancellation-card-heading"><div><span class="eyebrow">Clubhouse screens</span><h3>Withdraw or replace the screen artwork</h3></div>${actionBadge(action)}</div>
    <p>${evidence.screen
      ? `Artwork “${html(evidence.screen.mediaName || runtime.context.eventName)}” is recorded in ${html(evidence.screen.destinationName || 'the clubhouse rotation')} until ${html(formatDate(evidence.screen.endDate))}.`
      : 'The recorded cancellation action is complete.'}</p>
    ${action.status === 'complete' ? `<div class="cancellation-success">${html(action.detail || 'The clubhouse-screen action was completed.')}</div>` : `
      <div class="cancellation-choice-grid">
        <label class="cancellation-choice"><input type="radio" name="cancellation-screen-mode" value="remove" ${action.mode !== 'notice' ? 'checked' : ''}><span><strong>Take it down now</strong><small>Remove the event artwork from the screen rotation and push the change.</small></span></label>
        <label class="cancellation-choice ${evidence.clubhouseArtwork ? '' : 'disabled'}"><input type="radio" name="cancellation-screen-mode" value="notice" ${action.mode === 'notice' ? 'checked' : ''} ${evidence.clubhouseArtwork ? '' : 'disabled'}><span><strong>Show a cancellation notice</strong><small>${evidence.clubhouseArtwork ? 'Keep the approved design and apply an exact CANCELLED banner.' : 'No completed clubhouse artwork is available to adapt.'}</small></span></label>
      </div>
      ${action.mode === 'notice' && evidence.clubhouseArtwork ? `
        <div class="cancellation-screen-preview"><img src="${html(evidence.clubhouseArtwork)}" alt="Original clubhouse artwork"><span>CANCELLED</span></div>
        <label class="field cancellation-end-date"><span>Show cancellation notice until</span><input type="date" data-cancellation-screen-end min="${html(isoToday())}" value="${html(endDate)}"></label>` : ''}
      <button class="button button-primary" type="button" data-cancellation-screen-action ${action.status === 'working' ? 'disabled' : ''}>${action.status === 'failed' ? 'Try screen action again' : action.mode === 'notice' ? 'Publish cancellation notice' : 'Take artwork down'}</button>
    `}
    ${action.error ? `<div class="cancellation-inline-error">${html(action.error)}</div>` : ''}
  </article>`;
}

function renderEmail(runtime, evidence) {
  const action = runtime.response.actions.email;
  const emailRecommended = Boolean(evidence.email);
  const emailEvidenceUnknown = runtime.posterCheckFailed;
  const canSend = action.status !== 'working' && selectedAudience(runtime).length > 0 && action.subject?.trim() && action.bodyHtml?.trim();
  const canTest = action.status !== 'working' && action.testStatus !== 'working' && action.testAddress?.trim() && action.subject?.trim() && action.bodyHtml?.trim();
  return `<article class="cancellation-card cancellation-card-wide ${html(action.status)}">
    <div class="cancellation-card-heading">
      <div><span class="eyebrow">Member communications</span><h3>Cancellation email</h3></div>
      ${actionBadge(action, emailRecommended || emailEvidenceUnknown)}
    </div>
    <p>${emailEvidenceUnknown
      ? 'The earlier member-email record could not be checked. Confirm whether members received an event email before deciding whether a corrective message is needed.'
      : emailRecommended
      ? `A member campaign was sent to ${Number(evidence.email.sent || evidence.email.recipientCount || 0) || 'an'} audience${evidence.email.sentAt ? ` on ${html(formatDate(evidence.email.sentAt))}` : ''}. Email cannot be recalled, so send a clear corrective message.`
      : 'No earlier member email is recorded for this event. A cancellation email is optional, but can still be sent if members may know about the event through another channel.'}</p>
    ${action.status === 'complete' ? `<div class="cancellation-success">Cancellation email sent to ${Number(action.sent || 0)} member${Number(action.sent || 0) === 1 ? '' : 's'} on ${html(formatDate(action.completedAt))}.</div>` : `
      <div class="cancellation-email-toolbar"><button class="button button-secondary" type="button" data-cancellation-generate-email ${action.status === 'working' ? 'disabled' : ''}>${action.subject ? 'Regenerate cancellation email' : 'Create cancellation email'}</button><small>The reason and authoritative member update are used as the source wording.</small></div>
      ${action.subject || action.bodyHtml ? `
        <label class="field"><span>Email subject</span><input type="text" maxlength="250" data-cancellation-email-subject value="${html(action.subject)}"></label>
        <label class="field"><span>Email body (HTML)</span><textarea rows="10" data-cancellation-email-body>${html(action.bodyHtml)}</textarea></label>
        <details class="cancellation-email-preview"><summary>Preview cancellation email</summary><iframe title="Cancellation email preview" sandbox srcdoc="${html(action.bodyHtml)}"></iframe></details>
        <div class="cancellation-email-test-row">
          <label class="field"><span>Send a test to</span><input type="email" maxlength="320" placeholder="name@example.com" data-cancellation-email-test-address value="${html(action.testAddress)}"></label>
          <button class="button button-secondary" type="button" data-cancellation-send-test ${canTest ? '' : 'disabled'}>${action.testStatus === 'working' ? 'Sending test…' : 'Send test'}</button>
        </div>
        ${action.testStatus === 'complete' ? `<div class="cancellation-success">${html(action.testMessage || `Test email sent to ${action.testAddress}.`)}</div>` : ''}
        ${action.testError ? `<div class="cancellation-inline-error">${html(action.testError)}</div>` : ''}
        <div class="cancellation-audience-panel"><strong>Recipients</strong>${renderAudience(runtime)}</div>
        <button class="button button-primary" type="button" data-cancellation-send-email ${canSend ? '' : 'disabled'}>Send cancellation email</button>` : ''}
    `}
    ${action.error ? `<div class="cancellation-inline-error">${html(action.error)}</div>` : ''}
  </article>`;
}

function renderIntelligentGolf(runtime, evidence) {
  if (runtime.intelligentGolfCheckFailed) {
    return `<article class="cancellation-card attention"><div class="cancellation-card-heading"><div><span class="eyebrow">Intelligent Golf</span><h3>Planner and Members’ Diary</h3></div><span class="cancellation-state failed">Could not verify</span></div><p>The live Intelligent Golf links could not be checked. Retry the evidence check before concluding that no planner or diary record exists.</p></article>`;
  }
  if (!runtime.context.intelligentGolfEnabled) {
    return `<article class="cancellation-card unavailable"><div class="cancellation-card-heading"><div><span class="eyebrow">Intelligent Golf</span><h3>Planner and Members’ Diary</h3></div><span class="cancellation-state neutral">Plugin disabled</span></div><p>Enable the Intelligent Golf plugin to inspect or remove linked planner and diary entries.</p></article>`;
  }
  const action = runtime.response.actions.intelligentGolf;
  const anythingLinked = Boolean(evidence.plannerId || evidence.diaryId);
  if (anythingLinked && runtime.intelligentGolf?.available === false) {
    return `<article class="cancellation-card unavailable"><div class="cancellation-card-heading"><div><span class="eyebrow">Intelligent Golf</span><h3>Planner and Members’ Diary</h3></div><span class="cancellation-state failed">Connection unavailable</span></div><p>The saved planner or diary link still exists, but Intelligent Golf is not currently available. Restore the connection before attempting permanent removal.</p></article>`;
  }
  if (!anythingLinked && action.status !== 'complete') {
    return `<article class="cancellation-card complete"><div class="cancellation-card-heading"><div><span class="eyebrow">Intelligent Golf</span><h3>Planner and Members’ Diary</h3></div>${actionBadge({ status: 'not-required' })}</div><p>No linked Intelligent Golf planner or Members’ Diary entry was found.</p></article>`;
  }
  const removeDiary = Boolean(evidence.diaryId && action.removeDiary === true);
  const removePlanner = Boolean(evidence.plannerId && action.removePlanner === true);
  return `<article class="cancellation-card ${html(action.status)}">
    <div class="cancellation-card-heading"><div><span class="eyebrow">Intelligent Golf</span><h3>Planner and Members’ Diary</h3></div>${actionBadge(action)}</div>
    ${anythingLinked ? `<p>Choose which linked Intelligent Golf records should be removed. The diary is always removed before its planner entry.</p>
      <div class="cancellation-record-list">
        <label class="cancellation-choice ${evidence.diaryId ? '' : 'disabled'}"><input type="checkbox" data-cancellation-remove-diary ${removeDiary ? 'checked' : ''} ${evidence.diaryId ? '' : 'disabled'}><span><strong>Members’ Diary entry ${evidence.diaryId ? html(evidence.diaryId) : ''}</strong><small>${evidence.diaryId ? 'Remove the public diary entry linked to this event.' : 'No linked diary entry.'}</small></span></label>
        <label class="cancellation-choice ${evidence.plannerId ? '' : 'disabled'}"><input type="checkbox" data-cancellation-remove-planner ${removePlanner ? 'checked' : ''} ${evidence.plannerId ? '' : 'disabled'}><span><strong>Planner entry ${evidence.plannerId ? html(evidence.plannerId) : ''}</strong><small>${evidence.plannerId ? 'Permanently remove the cancelled planner record after its diary entry.' : 'No linked planner entry.'}</small></span></label>
      </div>
      <button class="button button-primary" type="button" data-cancellation-remove-ig ${action.status === 'working' || (!removeDiary && !removePlanner) ? 'disabled' : ''}>${action.status === 'failed' ? 'Try Intelligent Golf removal again' : 'Remove selected Intelligent Golf records'}</button>`
      : `<div class="cancellation-success">${html(action.detail || 'The selected Intelligent Golf records were removed.')}</div>`}
    ${action.error ? `<div class="cancellation-inline-error">${html(action.error)}</div>` : ''}
  </article>`;
}

function renderManualCard(runtime, evidence, id, title, copy, relevant) {
  const action = runtime.response.actions[id];
  const complete = action.status === 'complete';
  return `<article class="cancellation-card manual ${complete ? 'complete' : ''}">
    <div class="cancellation-card-heading"><div><span class="eyebrow">Manual check</span><h3>${html(title)}</h3></div>${actionBadge(action, relevant)}</div>
    <p>${html(copy)}</p>
    ${relevant ? `<button class="button ${complete ? 'button-secondary' : 'button-primary'}" type="button" data-cancellation-manual="${html(id)}">${complete ? 'Mark as needing review' : 'Confirm dealt with'}</button>` : '<span class="cancellation-muted">The planning answers do not indicate that this channel was used.</span>'}
  </article>`;
}

function renderWorkspace(runtime) {
  const root = runtime.root;
  if (!root?.isConnected) return;
  if (runtime.loading) {
    root.innerHTML = '<section class="cancellation-loading"><span></span><div><strong>Checking published event information…</strong><p>Reading the Communications Centre and linked integration records.</p></div></section>';
    return;
  }
  const evidence = readPublicationEvidence(runtime);
  const wasActioned = action => action && action.status !== 'pending' && action.status !== 'not-required';
  const relevantActions = [
    runtime.posterCheckFailed || evidence.screen || wasActioned(runtime.response.actions.screens) ? runtime.response.actions.screens : null,
    runtime.posterCheckFailed || evidence.email || wasActioned(runtime.response.actions.email) ? runtime.response.actions.email : null,
    runtime.intelligentGolfCheckFailed || evidence.diaryId || evidence.plannerId || wasActioned(runtime.response.actions.intelligentGolf) ? runtime.response.actions.intelligentGolf : null,
    evidence.bookingsPlanned ? runtime.response.actions.bookings : null,
    evidence.socialPlanned ? runtime.response.actions.social : null,
    evidence.printPossible ? runtime.response.actions.print : null
  ].filter(Boolean);
  const completed = relevantActions.filter(action => ['complete', 'not-required'].includes(action.status)).length;
  const failed = relevantActions.filter(action => action.status === 'failed').length;

  root.innerHTML = `
    <section class="cancellation-overview">
      <div>
        <span class="eyebrow">Cancellation response</span>
        <h2>Unwind the event without missing a published channel</h2>
        <p>This workspace is tied to the cancellation recorded on ${html(formatDate(runtime.context.lifecycle.statusChangedAt))}. It checks actual integration records before suggesting an action.</p>
      </div>
      <div class="cancellation-progress ${failed ? 'attention' : completed === relevantActions.length && relevantActions.length ? 'complete' : ''}"><strong>${completed}/${relevantActions.length}</strong><span>${failed ? 'actions need attention' : 'identified actions complete'}</span></div>
    </section>
    <section class="cancellation-decision-record">
      <div><span>Event</span><strong>${html(runtime.context.eventName)}</strong><small>${html(formatDate(runtime.context.eventDate))}</small></div>
      <div><span>Cancellation reason</span><strong>${html(runtime.context.lifecycle.reason || 'No reason recorded')}</strong></div>
      <div><span>Agreed member wording</span><strong>${html(runtime.context.lifecycle.memberUpdate || 'No member update recorded')}</strong></div>
    </section>
    ${runtime.loadError ? `<div class="cancellation-page-error"><strong>Some publication records could not be checked.</strong><span>${html(runtime.loadError)}</span><button class="button button-secondary" data-cancellation-refresh>Try again</button></div>` : ''}
    <section class="cancellation-grid">
      ${renderOperationalNotice(runtime)}
      ${renderScreens(runtime, evidence)}
      ${renderEmail(runtime, evidence)}
      ${renderIntelligentGolf(runtime, evidence)}
      ${renderManualCard(runtime, evidence, 'bookings', 'Booking, registration and payments', 'Close public booking or sales links, preserve attendee and purchaser records, and begin any agreed refunds or transfers.', evidence.bookingsPlanned)}
      ${renderManualCard(runtime, evidence, 'social', 'Social media', 'Remove or clearly correct organiser-managed social posts so they no longer advertise the event as proceeding.', evidence.socialPlanned)}
      ${renderManualCard(runtime, evidence, 'print', 'Printed material', 'Withdraw posters, table notices or other printed publicity that may still be visible at the club.', evidence.printPossible)}
    </section>`;
  bindWorkspace(runtime);
}

function updateResponse(runtime, actionName, patch) {
  runtime.response.actions[actionName] = { ...runtime.response.actions[actionName], ...patch };
  runtime.response.updatedAt = new Date().toISOString();
  runtime.context.onStateChange?.(structuredClone(runtime.response));
}

async function readPosterDocument(eventId) {
  const response = await fetch(`/api/poster/session?key=${encodeURIComponent(eventId)}`, { cache: 'no-store' });
  if (response.status === 404) return { key: eventId, revision: 0, session: {} };
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `The Communications Centre record could not be read (${response.status}).`);
  return result;
}

async function patchPosterDocument(runtime, update) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await readPosterDocument(runtime.context.eventId);
    const session = structuredClone(current.session || {});
    update(session);
    const response = await fetch(`/api/poster/session?key=${encodeURIComponent(runtime.context.eventId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: Number(current.revision || 0), session })
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 409) continue;
    if (!response.ok) throw new Error(result.error || `The Communications Centre record could not be updated (${response.status}).`);
    runtime.posterDocument = result;
    return;
  }
  throw new Error('The Communications Centre changed while the cancellation action was being saved. Try again.');
}

async function loadRuntime(runtime) {
  runtime.loading = true;
  runtime.loadError = '';
  runtime.posterCheckFailed = false;
  runtime.intelligentGolfCheckFailed = false;
  renderWorkspace(runtime);
  const errors = [];
  const [poster, intelligentGolf] = await Promise.all([
    readPosterDocument(runtime.context.eventId).catch(error => {
      runtime.posterCheckFailed = true;
      errors.push(error.message);
      return { key: runtime.context.eventId, revision: 0, session: {} };
    }),
    runtime.context.intelligentGolfEnabled
      ? apiJson(`/api/integrations/intelligent-golf/events/${encodeURIComponent(runtime.context.eventId)}`, { cache: 'no-store' }).catch(error => {
          runtime.intelligentGolfCheckFailed = true;
          errors.push(error.message);
          return {};
        })
      : Promise.resolve({})
  ]);
  runtime.posterDocument = poster;
  runtime.intelligentGolf = intelligentGolf;
  runtime.loading = false;
  runtime.loadError = errors.join(' ');
  renderWorkspace(runtime);
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The existing clubhouse artwork could not be loaded.'));
    image.src = source;
  });
}

function drawWrappedText(context, text, centreX, startY, maxWidth, lineHeight, maxLines = 3) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !current) current = candidate;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  lines.slice(0, maxLines).forEach((line, index) => context.fillText(line, centreX, startY + index * lineHeight));
}

async function createCancellationArtwork(source, reason) {
  const image = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  context.fillStyle = 'rgba(5, 25, 34, .46)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const bandHeight = Math.round(canvas.height * .24);
  const bandY = Math.round((canvas.height - bandHeight) / 2);
  context.fillStyle = 'rgba(166, 41, 34, .94)';
  context.fillRect(0, bandY, canvas.width, bandHeight);
  context.strokeStyle = 'rgba(255, 239, 201, .96)';
  context.lineWidth = Math.max(8, Math.round(canvas.width * .006));
  context.strokeRect(context.lineWidth / 2, bandY + context.lineWidth / 2, canvas.width - context.lineWidth, bandHeight - context.lineWidth);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#fff8e7';
  context.font = `900 ${Math.round(canvas.width * .14)}px Georgia, serif`;
  context.fillText('CANCELLED', canvas.width / 2, bandY + bandHeight * .43, canvas.width * .9);
  if (reason) {
    context.font = `700 ${Math.round(canvas.width * .035)}px Arial, sans-serif`;
    drawWrappedText(context, reason, canvas.width / 2, bandY + bandHeight * .73, canvas.width * .82, canvas.height * .026, 2);
  }
  return canvas.toDataURL('image/png');
}

async function performScreenAction(runtime) {
  const evidence = readPublicationEvidence(runtime);
  const action = runtime.response.actions.screens;
  updateResponse(runtime, 'screens', { status: 'working', error: '' });
  renderWorkspace(runtime);
  try {
    if (action.mode === 'notice') {
      if (!evidence.clubhouseArtwork) throw new Error('No completed clubhouse artwork is available for the cancellation notice.');
      const endDate = action.endDate || runtime.context.eventDate || addDays(isoToday(), 7);
      if (endDate < isoToday()) throw new Error('Choose a cancellation-notice end date that is today or later.');
      const artwork = await createCancellationArtwork(
        evidence.clubhouseArtwork,
        runtime.context.lifecycle.memberUpdate || 'This event will no longer take place.');
      const result = await apiJson('/api/poster/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: runtime.context.eventId,
          eventName: runtime.context.eventName,
          eventDate: endDate,
          startDate: isoToday(),
          mediaName: `${runtime.context.eventName} — CANCELLED`,
          tags: ['event-playbook', 'cancelled', 'cancellation-notice'],
          digitalScreenAsset: { outputId: 'clubhouse', name: 'Cancellation notice', dataUrl: artwork },
          sendToClubhouseScreens: true
        })
      });
      const published = result.clubhouseScreens;
      await patchPosterDocument(runtime, session => {
        session.screenPublication = {
          mediaId: Number(published.artworkId),
          mediaName: published.artworkName,
          destinationName: published.destinationName,
          startDate: published.startDate,
          endDate: published.endDate,
          pushConfirmed: published.pushConfirmed === true,
          pushStatus: published.pushStatus || '',
          screenCount: Number(published.screenCount || 0),
          uploadConfirmed: published.uploadConfirmed === true,
          mediaSource: published.mediaSource || 'uploaded-file',
          width: Number(published.width || 0),
          height: Number(published.height || 0),
          updatedAt: new Date().toISOString()
        };
      });
      updateResponse(runtime, 'screens', { status: 'complete', completedAt: new Date().toISOString(), detail: `Cancellation notice published until ${formatDate(endDate)}.`, mediaId: Number(published.artworkId), error: '' });
    } else {
      await apiJson('/api/poster/take-down', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: runtime.context.eventId, eventName: runtime.context.eventName, mediaId: evidence.screen?.mediaId || action.mediaId || null })
      });
      await patchPosterDocument(runtime, session => { session.screenPublication = null; });
      updateResponse(runtime, 'screens', { status: 'complete', completedAt: new Date().toISOString(), detail: 'The event artwork was removed from the clubhouse rotation and the screen change was pushed.', error: '' });
    }
  } catch (error) {
    updateResponse(runtime, 'screens', { status: 'failed', error: error.message || 'The clubhouse-screen action failed.' });
  }
  renderWorkspace(runtime);
}

async function generateCancellationEmail(runtime) {
  updateResponse(runtime, 'email', { status: 'working', error: '', testStatus: 'idle', testMessage: '', testError: '' });
  renderWorkspace(runtime);
  try {
    const result = await apiJson('/api/poster/member-email/cancellation-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: runtime.context.eventId,
        eventName: runtime.context.eventName,
        eventDate: runtime.context.eventDate,
        reason: runtime.context.lifecycle.reason || '',
        memberUpdate: runtime.context.lifecycle.memberUpdate || ''
      })
    });
    updateResponse(runtime, 'email', { status: 'pending', subject: result.subject || '', bodyHtml: result.bodyHtml || '', generatedAt: new Date().toISOString(), error: '' });
  } catch (error) {
    updateResponse(runtime, 'email', { status: 'failed', error: error.message || 'The cancellation email could not be created.' });
  }
  renderWorkspace(runtime);
}

async function loadAudience(runtime) {
  runtime.membersLoading = true;
  renderWorkspace(runtime);
  try {
    const result = await apiJson('/api/poster/member-email/members?refresh=true', { cache: 'no-store' });
    runtime.members = Array.isArray(result) ? result : Array.isArray(result.members) ? result.members : [];
    const categories = [...new Set(runtime.members.filter(member => member.isActive === true && member.email).map(member => member.membershipCategory || 'Uncategorised'))];
    if (!(runtime.response.actions.email.categories || []).length) updateResponse(runtime, 'email', { categories });
  } catch (error) {
    updateResponse(runtime, 'email', { status: 'failed', error: error.message || 'The active-member directory could not be loaded.' });
  } finally {
    runtime.membersLoading = false;
    renderWorkspace(runtime);
  }
}

async function sendCancellationEmail(runtime) {
  const action = runtime.response.actions.email;
  const members = selectedAudience(runtime);
  if (!members.length || !action.subject.trim() || !action.bodyHtml.trim()) return;
  if (!window.confirm(`Send this cancellation email to ${members.length} active member${members.length === 1 ? '' : 's'} now?`)) return;
  updateResponse(runtime, 'email', { status: 'working', error: '' });
  renderWorkspace(runtime);
  try {
    const result = await apiJson('/api/poster/member-email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberNumbers: members.map(member => member.memberNumber),
        subject: action.subject,
        bodyHtml: action.bodyHtml,
        eventId: runtime.context.eventId,
        eventName: runtime.context.eventName,
        operation: 'cancellation'
      })
    });
    updateResponse(runtime, 'email', { status: 'complete', requested: Number(result.requested || members.length), sent: Number(result.sent || 0), completedAt: new Date().toISOString(), error: '' });
  } catch (error) {
    updateResponse(runtime, 'email', { status: 'failed', error: error.message || 'The cancellation email could not be sent.' });
  }
  renderWorkspace(runtime);
}

async function sendCancellationEmailTest(runtime) {
  const action = runtime.response.actions.email;
  const input = runtime.root.querySelector('[data-cancellation-email-test-address]');
  if (!input?.checkValidity()) {
    input?.reportValidity();
    return;
  }
  const recipientEmail = action.testAddress?.trim() || '';
  if (!recipientEmail || !action.subject?.trim() || !action.bodyHtml?.trim()) return;
  updateResponse(runtime, 'email', { testStatus: 'working', testError: '', testMessage: '' });
  renderWorkspace(runtime);
  try {
    await apiJson('/api/poster/member-email/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientEmail, subject: action.subject, bodyHtml: action.bodyHtml })
    });
    updateResponse(runtime, 'email', {
      testStatus: 'complete',
      testMessage: `Test email sent to ${recipientEmail}.`,
      testError: ''
    });
  } catch (error) {
    updateResponse(runtime, 'email', {
      testStatus: 'failed',
      testMessage: '',
      testError: error.message || 'The cancellation test email could not be sent.'
    });
  }
  renderWorkspace(runtime);
}

async function removeIntelligentGolfRecords(runtime) {
  const evidence = readPublicationEvidence(runtime);
  const action = runtime.response.actions.intelligentGolf;
  const removeDiary = Boolean(evidence.diaryId && action.removeDiary === true);
  const removePlanner = Boolean(evidence.plannerId && action.removePlanner === true);
  if (!removeDiary && !removePlanner) return;
  if (removePlanner && readPublicationEvidence(runtime).diaryId && !removeDiary) {
    updateResponse(runtime, 'intelligentGolf', {
      status: 'failed',
      error: 'Select the linked Members’ Diary entry as well. It must be removed before the planner entry.'
    });
    renderWorkspace(runtime);
    return;
  }
  if (!window.confirm(`Permanently remove the selected Intelligent Golf record${removeDiary && removePlanner ? 's' : ''}? This cannot be undone from Event Playbook.`)) return;
  updateResponse(runtime, 'intelligentGolf', { status: 'working', error: '' });
  renderWorkspace(runtime);
  try {
    const result = await apiJson(`/api/integrations/intelligent-golf/events/${encodeURIComponent(runtime.context.eventId)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeDiary, removePlanner })
    });
    runtime.intelligentGolf = { ...runtime.intelligentGolf, plannerEntryId: result.plannerEntryId || null, diaryEntryId: result.diaryEntryId || null };
    const recordsRemain = Boolean(result.plannerEntryId || result.diaryEntryId);
    updateResponse(runtime, 'intelligentGolf', {
      status: recordsRemain ? 'pending' : 'complete',
      removeDiary: false,
      removePlanner: false,
      completedAt: recordsRemain ? null : new Date().toISOString(),
      detail: recordsRemain
        ? 'The selected Intelligent Golf record was removed. Another linked record remains available for review.'
        : 'The selected Intelligent Golf records were removed and the saved links were cleared.',
      result,
      error: ''
    });
  } catch (error) {
    updateResponse(runtime, 'intelligentGolf', { status: 'failed', error: error.message || 'The Intelligent Golf records could not be removed.' });
    runtime.intelligentGolf = await apiJson(`/api/integrations/intelligent-golf/events/${encodeURIComponent(runtime.context.eventId)}`, { cache: 'no-store' }).catch(() => runtime.intelligentGolf);
  }
  renderWorkspace(runtime);
}

function bindWorkspace(runtime) {
  const root = runtime.root;
  root.querySelector('[data-cancellation-refresh]')?.addEventListener('click', () => loadRuntime(runtime));
  root.querySelector('[data-cancellation-manage-status]')?.addEventListener('click', () => runtime.context.onManageStatus?.());
  root.querySelectorAll('input[name="cancellation-screen-mode"]').forEach(input => input.addEventListener('change', () => {
    updateResponse(runtime, 'screens', { mode: input.value });
    renderWorkspace(runtime);
  }));
  root.querySelector('[data-cancellation-screen-end]')?.addEventListener('change', event => updateResponse(runtime, 'screens', { endDate: event.target.value }));
  root.querySelector('[data-cancellation-screen-action]')?.addEventListener('click', () => performScreenAction(runtime));
  root.querySelector('[data-cancellation-generate-email]')?.addEventListener('click', () => generateCancellationEmail(runtime));
  root.querySelector('[data-cancellation-load-audience]')?.addEventListener('click', () => loadAudience(runtime));
  const updateEmailControls = () => {
    const action = runtime.response.actions.email;
    const hasCopy = Boolean(action.subject?.trim() && action.bodyHtml?.trim());
    const send = root.querySelector('[data-cancellation-send-email]');
    const test = root.querySelector('[data-cancellation-send-test]');
    if (send) send.disabled = action.status === 'working' || !hasCopy || selectedAudience(runtime).length === 0;
    if (test) test.disabled = action.status === 'working' || action.testStatus === 'working' || !hasCopy || !action.testAddress?.trim();
  };
  root.querySelector('[data-cancellation-email-subject]')?.addEventListener('input', event => {
    updateResponse(runtime, 'email', { subject: event.target.value, testStatus: 'idle', testMessage: '', testError: '' });
    updateEmailControls();
  });
  root.querySelector('[data-cancellation-email-body]')?.addEventListener('input', event => {
    updateResponse(runtime, 'email', { bodyHtml: event.target.value, testStatus: 'idle', testMessage: '', testError: '' });
    const preview = root.querySelector('.cancellation-email-preview iframe');
    if (preview) preview.srcdoc = event.target.value;
    updateEmailControls();
  });
  root.querySelector('[data-cancellation-email-test-address]')?.addEventListener('input', event => {
    updateResponse(runtime, 'email', { testAddress: event.target.value, testStatus: 'idle', testError: '', testMessage: '' });
    updateEmailControls();
  });
  root.querySelector('[data-cancellation-send-test]')?.addEventListener('click', () => sendCancellationEmailTest(runtime));
  root.querySelectorAll('[data-cancellation-email-category]').forEach(input => input.addEventListener('change', () => {
    const categories = [...root.querySelectorAll('[data-cancellation-email-category]:checked')].map(item => item.dataset.cancellationEmailCategory);
    updateResponse(runtime, 'email', { categories });
    renderWorkspace(runtime);
  }));
  root.querySelector('[data-cancellation-send-email]')?.addEventListener('click', () => sendCancellationEmail(runtime));
  root.querySelector('[data-cancellation-remove-diary]')?.addEventListener('change', event => {
    updateResponse(runtime, 'intelligentGolf', {
      removeDiary: event.target.checked,
      removePlanner: event.target.checked ? runtime.response.actions.intelligentGolf.removePlanner : false
    });
    renderWorkspace(runtime);
  });
  root.querySelector('[data-cancellation-remove-planner]')?.addEventListener('change', event => {
    const diaryAvailable = Boolean(readPublicationEvidence(runtime).diaryId);
    updateResponse(runtime, 'intelligentGolf', {
      removePlanner: event.target.checked,
      removeDiary: event.target.checked && diaryAvailable
        ? true
        : runtime.response.actions.intelligentGolf.removeDiary
    });
    renderWorkspace(runtime);
  });
  root.querySelector('[data-cancellation-remove-ig]')?.addEventListener('click', () => removeIntelligentGolfRecords(runtime));
  root.querySelectorAll('[data-cancellation-manual]').forEach(button => button.addEventListener('click', () => {
    const name = button.dataset.cancellationManual;
    const current = runtime.response.actions[name];
    updateResponse(runtime, name, current.status === 'complete'
      ? { status: 'pending', completedAt: null }
      : { status: 'complete', completedAt: new Date().toISOString() });
    renderWorkspace(runtime);
  }));
}

export function mountCancellationWorkspace(context) {
  const root = document.getElementById('cancellationWorkspace');
  if (!root || context.lifecycle?.status !== 'cancelled') return;
  const cycleKey = `cancelled:${context.lifecycle.statusChangedAt || context.eventId}`;
  if (activeRuntime?.context.eventId === context.eventId && activeRuntime.response.cycleKey === cycleKey) {
    activeRuntime.root = root;
    activeRuntime.context = context;
    context.onStateChange?.(structuredClone(activeRuntime.response));
    void loadRuntime(activeRuntime);
    return;
  }
  const runtime = {
    root,
    context,
    response: normaliseResponse(context),
    posterDocument: null,
    intelligentGolf: null,
    members: null,
    membersLoading: false,
    loading: true,
    loadError: '',
    posterCheckFailed: false,
    intelligentGolfCheckFailed: false
  };
  activeRuntime = runtime;
  context.onStateChange?.(structuredClone(runtime.response));
  void loadRuntime(runtime);
}
