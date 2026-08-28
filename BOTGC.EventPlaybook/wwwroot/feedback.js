(() => {
  const content = document.getElementById('feedbackContent');
  const token = new URLSearchParams(location.search).get('token');

  init();

  async function init() {
    if (!token) {
      renderUnavailable('Invalid feedback link', 'This link does not contain an event feedback token.');
      return;
    }

    try {
      const response = await fetch(`/api/feedback/public/${encodeURIComponent(token)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        renderUnavailable('Feedback is unavailable', payload.error || 'This form is not currently accepting responses.');
        return;
      }
      renderForm(payload);
    } catch {
      renderUnavailable('Unable to load the form', 'Please check your connection and try again.');
    }
  }

  function renderForm(campaign) {
    document.title = `${campaign.eventName} feedback | Burton-on-Trent Golf Club`;
    content.innerHTML = `
      <div class="feedback-intro">
        <span class="eyebrow">Event feedback</span>
        <h2>${escapeHtml(campaign.eventName)}</h2>
        ${campaign.eventDate ? `<p class="event-date">${formatDate(campaign.eventDate)}</p>` : ''}
        <p>Your feedback helps us improve future events. Responses are anonymous: this form does not ask for or store your name or contact details.</p>
      </div>
      <form id="feedbackForm" novalidate>
        <div class="feedback-fields">
          ${campaign.questions.map((question, index) => renderQuestion(question, index)).join('')}
        </div>
        <label class="bot-field" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
        <div id="formError" class="form-error" hidden></div>
        <button class="submit-button" type="submit">Send anonymous feedback</button>
        <p class="privacy-note">Please do not include names or other personal information in free-text answers.</p>
      </form>`;

    document.getElementById('feedbackForm').addEventListener('submit', submitForm);
  }

  function renderQuestion(question, index) {
    const required = question.required ? '<span class="required">Required</span>' : '<span class="optional">Optional</span>';
    const heading = `<div class="question-heading"><span class="question-number">${index + 1}</span><div><h3>${escapeHtml(question.label)}</h3>${required}</div></div>`;
    if (question.type === 'rating') {
      return `<fieldset class="feedback-question" data-question-id="${escapeHtml(question.id)}" ${question.required ? 'data-required="true"' : ''}>
        <legend>${heading}</legend>
        <div class="rating-options" aria-label="Rate from one to five">
          ${[1, 2, 3, 4, 5].map(value => `<label><input type="radio" name="${escapeHtml(question.id)}" value="${value}"><span>${value}</span></label>`).join('')}
        </div>
        <div class="rating-labels"><span>Poor</span><span>Excellent</span></div>
      </fieldset>`;
    }
    if (question.type === 'choice') {
      return `<fieldset class="feedback-question" data-question-id="${escapeHtml(question.id)}" ${question.required ? 'data-required="true"' : ''}>
        <legend>${heading}</legend>
        <div class="choice-options">${question.options.map(option => `<label><input type="radio" name="${escapeHtml(question.id)}" value="${escapeHtml(option)}"><span>${escapeHtml(option)}</span></label>`).join('')}</div>
      </fieldset>`;
    }
    return `<label class="feedback-question text-question" data-question-id="${escapeHtml(question.id)}" ${question.required ? 'data-required="true"' : ''}>
      ${heading}<textarea name="${escapeHtml(question.id)}" rows="4" maxlength="4000" placeholder="Share your thoughts"></textarea>
    </label>`;
  }

  async function submitForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const error = document.getElementById('formError');
    const answers = {};
    let missingRequired = false;

    form.querySelectorAll('[data-question-id]').forEach(field => {
      const questionId = field.dataset.questionId;
      const value = new FormData(form).get(questionId)?.toString().trim() || '';
      if (value) answers[questionId] = value;
      field.classList.toggle('has-error', field.dataset.required === 'true' && !value);
      if (field.dataset.required === 'true' && !value) missingRequired = true;
    });

    if (missingRequired) {
      error.textContent = 'Please answer the required questions before sending your feedback.';
      error.hidden = false;
      error.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    error.hidden = true;
    button.disabled = true;
    button.textContent = 'Sending feedback…';
    try {
      const response = await fetch(`/api/feedback/public/${encodeURIComponent(token)}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, website: form.elements.website.value })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Your feedback could not be sent.');
      content.innerHTML = `<div class="feedback-state success"><span class="feedback-state-mark">✓</span><h2>Thank you</h2><p>Your anonymous feedback has been recorded and will help the club improve future events.</p></div>`;
      content.focus();
    } catch (submissionError) {
      error.textContent = submissionError.message;
      error.hidden = false;
      button.disabled = false;
      button.textContent = 'Send anonymous feedback';
    }
  }

  function renderUnavailable(title, message) {
    content.innerHTML = `<div class="feedback-state"><span class="feedback-state-mark">!</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div>`;
  }

  function formatDate(value) {
    return new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  }
})();
