const assistantState = {
  revision: null,
  conversation: [],
  proposal: null,
  busy: false,
  notice: null,
  recorder: null,
  stream: null,
  chunks: [],
  recordingTimeout: null,
  discardRecording: false,
  hostObserver: null
};

export function mountPlaybookAssistant(options) {
  const host = document.getElementById('playbook-assistant-root');
  if (!host) return;
  if (assistantState.revision !== options.revision) {
    assistantState.revision = options.revision;
    assistantState.proposal = null;
    assistantState.notice = null;
  }
  host._playbookAssistantOptions = options;
  render(host);
}

function render(host) {
  const options = host._playbookAssistantOptions;
  const proposal = assistantState.proposal;
  const isRecording = assistantState.recorder?.state === 'recording';
  host.innerHTML = `
    <article class="playbook-assistant-card">
      <header class="playbook-assistant-heading">
        <div class="playbook-assistant-mark" aria-hidden="true">✦</div>
        <div>
          <span class="eyebrow">Club configuration assistant</span>
          <h3>Discuss the Playbook with AI</h3>
          <p>Describe how this club should ask a follow-up question or generate a task. Nothing changes until you review and apply a proposal.</p>
        </div>
        <div class="playbook-assistant-version">
          <strong>v${escapeHtml(options.schemaVersion || '—')}</strong>
          <span>revision ${Number(options.revision) || 0}</span>
        </div>
      </header>

      <div class="playbook-assistant-guardrails">
        <span><i aria-hidden="true">✓</i>${options.protectedQuestionIds.length} primary questions protected</span>
        <span><i aria-hidden="true">✓</i>Stable IDs preserve existing event answers</span>
        <span><i aria-hidden="true">✓</i>Every change requires approval</span>
      </div>

      <div class="playbook-assistant-body">
        <section class="playbook-assistant-conversation" aria-live="polite">
          ${assistantState.conversation.length
            ? assistantState.conversation.map(message => `<div class="assistant-message ${message.role}"><span>${message.role === 'assistant' ? 'Playbook Assistant' : 'You'}</span><p>${escapeHtml(message.text)}</p></div>`).join('')
            : `<div class="assistant-welcome"><strong>What would you like this club's Playbook to do differently?</strong><p>I can reword secondary questions and tasks, add conditional follow-up questions or tasks, and retire club-specific items without deleting their history.</p></div>`}
          ${proposal ? renderProposal(proposal) : ''}
          ${assistantState.notice ? `<div class="assistant-notice ${escapeHtml(assistantState.notice.tone)}" role="status">${escapeHtml(assistantState.notice.text)}</div>` : ''}
        </section>

        <form class="playbook-assistant-composer" id="playbook-assistant-form">
          <label for="playbook-assistant-input">Your instruction</label>
          <textarea id="playbook-assistant-input" rows="4" maxlength="5000" placeholder="For example: When catering is required, ask whether service is self-service or staffed, and create an event-day task if an adult server is needed." ${assistantState.busy || isRecording ? 'disabled' : ''}></textarea>
          <div class="assistant-suggestions" aria-label="Example requests">
            <button type="button" data-assistant-example="Reword a secondary question so that it gives a clear example of what it means.">Clarify a question</button>
            <button type="button" data-assistant-example="Add a follow-up question and task for a club-specific operational requirement.">Add a club requirement</button>
            <button type="button" data-assistant-example="Retire a secondary question that this club no longer uses, while preserving historic answers.">Retire a question</button>
          </div>
          <div class="playbook-assistant-actions">
            <div>
              <button class="button button-secondary assistant-voice-button${isRecording ? ' recording' : ''}" type="button" data-assistant-voice ${assistantState.busy ? 'disabled' : ''}>
                <span aria-hidden="true">${isRecording ? '■' : '●'}</span>${isRecording ? 'Stop recording' : 'Speak instruction'}
              </button>
              <small>${isRecording ? 'Listening… recording stops after 90 seconds.' : 'Audio is sent securely to the club’s AI service, then the transcript is returned here for review before sending.'}</small>
            </div>
            <button class="button button-primary" type="submit" ${assistantState.busy || isRecording ? 'disabled' : ''}>${assistantState.busy ? 'Preparing proposal…' : 'Discuss with assistant'}</button>
          </div>
        </form>
      </div>

      <footer class="playbook-assistant-footer">
        <div><strong>Core recovery</strong><span>The original bundled question set is always available. Existing event records are retained where IDs match.</span></div>
        <button class="button button-secondary" type="button" data-assistant-reset-core ${assistantState.busy ? 'disabled' : ''}>Restore bundled core</button>
      </footer>
    </article>`;

  bind(host);
}

function renderProposal(proposal) {
  const hasChanges = Array.isArray(proposal.changes) && proposal.changes.length > 0;
  return `
    <section class="assistant-proposal" aria-label="Proposed Playbook changes">
      <div class="assistant-proposal-heading">
        <div><span>Review proposal</span><h4>${hasChanges ? `${proposal.changes.length} suggested change${proposal.changes.length === 1 ? '' : 's'}` : 'No changes proposed yet'}</h4></div>
        <span class="assistant-proposal-status">Not applied</span>
      </div>
      ${hasChanges ? `<ol class="assistant-change-list">${proposal.changes.map(renderChange).join('')}</ol>` : ''}
      ${(proposal.warnings ?? []).length ? `<div class="assistant-warning-list"><strong>Check before applying</strong><ul>${proposal.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></div>` : ''}
      <div class="assistant-proposal-actions">
        <button class="button button-secondary" type="button" data-assistant-discard>Discard</button>
        <button class="button button-primary" type="button" data-assistant-apply ${hasChanges && !assistantState.busy ? '' : 'disabled'}>${assistantState.busy ? 'Applying…' : 'Apply approved proposal'}</button>
      </div>
    </section>`;
}

function renderChange(change) {
  const labels = {
    reword_question: 'Reword question',
    reword_task: 'Reword task',
    add_question: 'Add question',
    add_task: 'Add task',
    set_enabled: change.enabled ? 'Restore item' : 'Retire item'
  };
  const location = change.targetItemId || [change.moduleId, change.sectionId].filter(Boolean).join(' / ');
  const rows = [];

  if (change.type === 'reword_question' || change.type === 'reword_task') {
    rows.push(renderComparison('Wording', change.currentWording, change.wording));
    if (change.detail) rows.push(renderComparison(change.type === 'reword_question' ? 'Help text' : 'Detail', change.currentDetail, change.detail));
    if (change.type === 'reword_question' && change.example) rows.push(renderComparison('Example', change.currentExample, change.example));
  } else if (change.type === 'set_enabled') {
    rows.push(renderReviewField('Item', change.currentWording || change.targetItemId));
    rows.push(renderComparison('Status', change.currentEnabled === false ? 'Retired' : 'Enabled', change.enabled ? 'Enabled' : 'Retired'));
  } else if (change.type === 'add_question') {
    rows.push(renderReviewField('New item ID', change.newItemId));
    rows.push(renderReviewField('Wording', change.wording));
    rows.push(renderReviewField('Help text', change.detail || 'Not provided'));
    rows.push(renderReviewField('Example', change.example || 'Not provided'));
    rows.push(renderReviewField('Answer type', friendlyValue(change.answerType) || 'Not set'));
    if (['singleChoice', 'multiChoice'].includes(change.answerType)) {
      rows.push(renderReviewField('Answer options', (change.options ?? []).map(option => `${option.label} (${option.value})`).join('; ') || 'Not provided'));
    }
    rows.push(renderReviewField('Required', change.required ? 'Yes' : 'No'));
    rows.push(renderReviewField('Shown when', renderCondition(change)));
  } else if (change.type === 'add_task') {
    rows.push(renderReviewField('New item ID', change.newItemId));
    rows.push(renderReviewField('Task', change.wording));
    rows.push(renderReviewField('Detail', change.detail || 'Not provided'));
    rows.push(renderReviewField('Deadline', change.deadlineCode || 'Not set'));
    rows.push(renderReviewField('Owner', change.ownerRoleId || 'Not set'));
    rows.push(renderReviewField('Shown when', renderCondition(change)));
    rows.push(renderReviewField('Staff briefing phase', friendlyValue(change.staffBriefingPhase) || 'Not included'));
    rows.push(renderReviewField('Staff briefing audience', change.staffBriefingAudience || 'Not included'));
    rows.push(renderReviewField('Staff briefing instruction', change.staffBriefingInstruction || 'Not included'));
  }

  return `<li>
    <span class="assistant-change-number"></span>
    <div><span>${escapeHtml(labels[change.type] || change.type)}</span><strong>${escapeHtml(change.description || change.wording || 'Playbook change')}</strong><small>${escapeHtml(location)}</small><dl class="assistant-change-details">${rows.join('')}</dl></div>
  </li>`;
}

function renderComparison(label, currentValue, proposedValue) {
  return `<div class="assistant-change-comparison"><dt>${escapeHtml(label)}</dt><dd><span><i>Current</i>${escapeHtml(currentValue || 'Not provided')}</span><b aria-hidden="true">→</b><span><i>Proposed</i>${escapeHtml(proposedValue || 'Not provided')}</span></dd></div>`;
}

function renderReviewField(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || 'Not provided')}</dd></div>`;
}

function renderCondition(change) {
  if (!change.conditionQuestionId) return 'Always shown';
  return `${change.conditionQuestionId} equals ${friendlyValue(change.conditionValue)}`;
}

function friendlyValue(value) {
  const clean = String(value ?? '').trim();
  if (clean === 'true') return 'Yes';
  if (clean === 'false') return 'No';
  const known = { yesNo: 'Yes / no', textarea: 'Long text', assignment: 'Person or role' };
  return known[clean] || clean.replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function bind(host) {
  const options = host._playbookAssistantOptions;
  const form = host.querySelector('#playbook-assistant-form');
  const input = host.querySelector('#playbook-assistant-input');

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const message = input?.value.trim() || '';
    if (!message || assistantState.busy) return;
    assistantState.busy = true;
    assistantState.notice = null;
    assistantState.proposal = null;
    assistantState.conversation.push({ role: 'user', text: message });
    render(host);
    try {
      const response = await fetch('/api/admin/playbook-assistant/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevision: options.revision,
          message,
          conversation: assistantState.conversation.slice(-11, -1)
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw apiError(response, result);
      assistantState.conversation.push({ role: 'assistant', text: result.reply });
      assistantState.proposal = result;
    } catch (error) {
      assistantState.notice = { tone: 'error', text: error.status === 409 ? `${error.message} Loading the latest configuration…` : error.message };
      if (error.status === 409) {
        assistantState.proposal = null;
        window.setTimeout(() => location.reload(), 1200);
      }
    } finally {
      assistantState.busy = false;
      render(host);
      host.querySelector('.playbook-assistant-conversation')?.scrollTo({ top: 999999, behavior: 'smooth' });
    }
  });

  host.querySelectorAll('[data-assistant-example]').forEach(button => {
    button.addEventListener('click', () => {
      if (!input) return;
      input.value = button.dataset.assistantExample || '';
      input.focus();
    });
  });

  host.querySelector('[data-assistant-discard]')?.addEventListener('click', () => {
    assistantState.proposal = null;
    assistantState.notice = { tone: 'neutral', text: 'The proposal was discarded. The live Playbook was not changed.' };
    render(host);
  });

  host.querySelector('[data-assistant-apply]')?.addEventListener('click', async () => {
    if (!assistantState.proposal || assistantState.busy) return;
    assistantState.busy = true;
    assistantState.notice = null;
    render(host);
    try {
      const response = await fetch('/api/admin/playbook-assistant/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevision: assistantState.proposal.baseRevision,
          proposalId: assistantState.proposal.proposalId,
          changes: assistantState.proposal.changes
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw apiError(response, result);
      assistantState.proposal = null;
      assistantState.conversation.push({ role: 'assistant', text: `Applied ${result.appliedChanges.length} approved change${result.appliedChanges.length === 1 ? '' : 's'} to the club Playbook.` });
      assistantState.notice = { tone: 'success', text: 'The approved proposal is now live for the club.' };
      assistantState.busy = false;
      options.onApplied(result);
    } catch (error) {
      assistantState.busy = false;
      assistantState.notice = { tone: 'error', text: error.status === 409 ? `${error.message} Loading the latest configuration…` : error.message };
      render(host);
      if (error.status === 409) window.setTimeout(() => location.reload(), 1200);
    }
  });

  host.querySelector('[data-assistant-reset-core]')?.addEventListener('click', async () => {
    if (assistantState.busy || !confirm('Restore the bundled core Playbook? Club-specific wording and additions will be removed from the live configuration. Existing event answers and task records are retained where IDs match.')) return;
    assistantState.busy = true;
    render(host);
    try {
      const response = await fetch('/api/admin/playbook/template/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: options.revision })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw apiError(response, result);
      assistantState.conversation = [];
      assistantState.proposal = null;
      assistantState.notice = { tone: 'success', text: 'The bundled core Playbook has been restored.' };
      assistantState.busy = false;
      options.onReset(result);
    } catch (error) {
      assistantState.busy = false;
      assistantState.notice = { tone: 'error', text: error.status === 409 ? `${error.message} Loading the latest configuration…` : error.message };
      render(host);
      if (error.status === 409) window.setTimeout(() => location.reload(), 1200);
    }
  });

  host.querySelector('[data-assistant-voice]')?.addEventListener('click', () => toggleVoice(host));
}

async function toggleVoice(host) {
  if (assistantState.recorder?.state === 'recording') {
    assistantState.recorder.stop();
    return;
  }
  if (assistantState.busy) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    assistantState.notice = { tone: 'error', text: 'Voice recording is not supported in this browser. Type the instruction instead.' };
    render(host);
    return;
  }
  try {
    assistantState.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type)) || '';
    assistantState.chunks = [];
    assistantState.discardRecording = false;
    assistantState.recorder = new MediaRecorder(assistantState.stream, preferredType ? { mimeType: preferredType } : undefined);
    assistantState.recorder.addEventListener('dataavailable', event => {
      if (event.data.size > 0) assistantState.chunks.push(event.data);
    });
    assistantState.recorder.addEventListener('stop', () => transcribeRecording(host), { once: true });
    assistantState.recorder.start(250);
    assistantState.recordingTimeout = window.setTimeout(() => {
      if (assistantState.recorder?.state === 'recording') assistantState.recorder.stop();
    }, 90_000);
    assistantState.hostObserver?.disconnect();
    assistantState.hostObserver = new MutationObserver(() => {
      if (!host.isConnected) cancelActiveRecording();
    });
    assistantState.hostObserver.observe(document.body, { childList: true, subtree: true });
    assistantState.notice = null;
    render(host);
  } catch (error) {
    stopVoiceTracks();
    assistantState.notice = { tone: 'error', text: error?.name === 'NotAllowedError' ? 'Microphone access was not allowed. Type the instruction instead.' : 'The microphone could not be started.' };
    render(host);
  }
}

async function transcribeRecording(host) {
  window.clearTimeout(assistantState.recordingTimeout);
  assistantState.recordingTimeout = null;
  const mimeType = assistantState.recorder?.mimeType || 'audio/webm';
  const blob = new Blob(assistantState.chunks, { type: mimeType });
  stopVoiceTracks();
  assistantState.hostObserver?.disconnect();
  assistantState.hostObserver = null;
  assistantState.recorder = null;
  assistantState.chunks = [];
  if (assistantState.discardRecording || !host.isConnected) {
    assistantState.discardRecording = false;
    return;
  }
  if (blob.size === 0) {
    assistantState.notice = { tone: 'error', text: 'No audio was recorded.' };
    render(host);
    return;
  }
  assistantState.busy = true;
  assistantState.notice = { tone: 'neutral', text: 'Transcribing your instruction…' };
  render(host);
  try {
    const formData = new FormData();
    formData.append('audio', blob, mimeType.includes('mp4') ? 'instruction.mp4' : 'instruction.webm');
    const response = await fetch('/api/admin/playbook-assistant/voice', { method: 'POST', body: formData });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw apiError(response, result);
    assistantState.notice = { tone: 'success', text: 'The recording has been transcribed. Review the wording, then send it when you are ready.' };
    assistantState.busy = false;
    render(host);
    const input = host.querySelector('#playbook-assistant-input');
    if (input) {
      input.value = result.text || '';
      input.focus();
    }
  } catch (error) {
    assistantState.busy = false;
    assistantState.notice = { tone: 'error', text: error.message };
    render(host);
  }
}

function stopVoiceTracks() {
  assistantState.stream?.getTracks().forEach(track => track.stop());
  assistantState.stream = null;
}

function cancelActiveRecording() {
  if (assistantState.recorder?.state === 'recording') {
    assistantState.discardRecording = true;
    assistantState.recorder.stop();
  } else {
    stopVoiceTracks();
  }
  window.clearTimeout(assistantState.recordingTimeout);
  assistantState.recordingTimeout = null;
}

window.addEventListener('pagehide', cancelActiveRecording);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelActiveRecording();
});

function apiError(response, payload) {
  const error = new Error(payload.error || payload.detail || payload.title || `The request failed (${response.status}).`);
  error.status = response.status;
  error.current = payload.current;
  return error;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
