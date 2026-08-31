const state = {
  library: { rules: [], counts: {} },
  filter: "all",
  search: "",
  selectedFolder: null,
  detail: null,
  action: null,
  busy: false,
};

const elements = {
  list: document.getElementById("rule-list"),
  detail: document.getElementById("rule-detail"),
  sidebarTotal: document.getElementById("sidebar-total"),
  search: document.getElementById("rule-search"),
  filters: document.getElementById("rule-filters"),
  releaseButton: document.getElementById("release-button"),
  addRuleButton: document.getElementById("add-rule-button"),
  addRuleDialog: document.getElementById("add-rule-dialog"),
  addRuleForm: document.getElementById("add-rule-form"),
  createRuleButton: document.getElementById("create-rule-button"),
  newRuleDescription: document.getElementById("new-rule-description"),
  actionDialog: document.getElementById("action-dialog"),
  actionForm: document.getElementById("action-form"),
  actionTitle: document.getElementById("action-title"),
  actionCopy: document.getElementById("action-copy"),
  actionLabel: document.getElementById("action-label"),
  actionInstructions: document.getElementById("action-instructions"),
  actionSubmit: document.getElementById("action-submit"),
  releaseDialog: document.getElementById("release-dialog"),
  releaseForm: document.getElementById("release-form"),
  releaseConfirmCopy: document.getElementById("release-confirm-copy"),
  releaseConfirmButton: document.getElementById("release-confirm-button"),
  jobBanner: document.getElementById("job-banner"),
  jobTitle: document.getElementById("job-title"),
  jobMessage: document.getElementById("job-message"),
  jobProgress: document.getElementById("job-progress"),
  toasts: document.getElementById("toast-region"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();

  if (response.status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
    throw new Error("Your session has expired. Redirecting to sign in…");
  }

  if (!response.ok) {
    throw new Error(typeof body === "object" ? body.error ?? `Request failed (${response.status})` : body);
  }

  return body;
}

function toast(message, error = false) {
  const item = document.createElement("div");
  item.className = `toast${error ? " is-error" : ""}`;
  item.textContent = message;
  elements.toasts.append(item);
  setTimeout(() => item.remove(), 5500);
}

function statusClass(status) {
  if (status.deployedCurrent) return "is-live";
  if (status.compiledCurrent) return "is-compiled";
  return "";
}

function statusLabel(status) {
  if (status.deployedCurrent) return "Live";
  if (status.compiledCurrent) return "Ready to release";
  if (status.deployed) return "Changed";
  if (status.compiled) return "Needs recompile";
  return "Draft";
}

function filteredRules() {
  const search = state.search.toLowerCase();

  return state.library.rules.filter((rule) => {
    const matchesSearch = !search || [rule.title, rule.question, rule.ruleNumber, rule.ruleName, rule.group]
      .some((value) => String(value ?? "").toLowerCase().includes(search));
    const matchesFilter = state.filter === "all"
      || (state.filter === "unpublished" && rule.status.unpublished)
      || (state.filter === "compiled" && rule.status.compiledCurrent)
      || (state.filter === "deployed" && rule.status.deployedCurrent);
    return matchesSearch && matchesFilter;
  });
}

function renderCounts() {
  elements.sidebarTotal.textContent = state.library.counts.total ?? 0;
  document.getElementById("count-all").textContent = state.library.counts.total ?? 0;
  document.getElementById("count-unpublished").textContent = state.library.counts.unpublished ?? 0;
  document.getElementById("count-compiled").textContent = state.library.counts.compiled ?? 0;
  document.getElementById("count-deployed").textContent = state.library.counts.deployed ?? 0;
  elements.releaseButton.textContent = `Release ${state.library.counts.unpublished ?? 0} unpublished`;
  elements.releaseButton.disabled = state.busy || !(state.library.counts.unpublished > 0);
}

function renderList() {
  const rules = filteredRules();

  if (!rules.length) {
    elements.list.innerHTML = '<div class="list-empty">No rules match this view.</div>';
    return;
  }

  elements.list.innerHTML = rules.map((rule) => `
    <button class="rule-link${state.selectedFolder === rule.folderName ? " is-active" : ""}" type="button" data-folder="${escapeHtml(rule.folderName)}">
      <span class="rule-link-top">
        <span class="rule-number">${escapeHtml(rule.ruleNumber || "Rule")}</span>
        <span class="mini-status ${statusClass(rule.status)}" title="${escapeHtml(statusLabel(rule.status))}"></span>
      </span>
      <span class="rule-link-title">${escapeHtml(rule.title)}</span>
    </button>
  `).join("");
}

function statusBadges(status) {
  const current = status.deployedCurrent
    ? '<span class="status-badge status-live">Live</span>'
    : status.compiledCurrent
      ? '<span class="status-badge status-ready">Compiled · ready to release</span>'
      : '<span class="status-badge status-draft">Unpublished changes</span>';
  const history = status.deployed && !status.deployedCurrent
    ? '<span class="status-badge status-muted">Previous version is live</span>'
    : "";
  return current + history;
}

function formatDate(value) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function renderChoices(question) {
  const correct = new Set((question.correctAnswers ?? []).map((item) => item.toLowerCase()));
  return `<ul class="choices">${(question.choices ?? []).map((choice) => `
    <li class="choice${correct.has(choice.id.toLowerCase()) ? " is-correct" : ""}">
      <span class="choice-id">${escapeHtml(choice.id.toUpperCase())}</span>
      <span>${escapeHtml(choice.text)}</span>
    </li>
  `).join("")}</ul>`;
}

function renderQuestion(question, label, audience) {
  if (!question) return "";
  return `
    <div class="question-block">
      <div class="question-heading">
        <div>
          <p class="question-label">${escapeHtml(label)}</p>
          <h3>${escapeHtml(question.title)}</h3>
        </div>
        <span class="audience-chip">${escapeHtml(audience)}</span>
      </div>
      <p class="question-text">${escapeHtml(question.question)}</p>
      ${renderChoices(question)}
      <p class="explanation">${escapeHtml(question.explanation)}</p>
    </div>
  `;
}

function renderDetail() {
  const rule = state.detail;

  if (!rule) return;

  const releaseLabel = rule.status.compiledCurrent ? "Release this rule" : "Compile & release";
  elements.detail.innerHTML = `
    <div class="detail-header">
      <div class="detail-title">
        <div class="status-row">${statusBadges(rule.status)}</div>
        <h2>${escapeHtml(rule.title)}</h2>
        <p>${escapeHtml(rule.ruleNumber)} · ${escapeHtml(rule.ruleName || rule.group)}</p>
      </div>
      <div class="detail-actions">
        <button class="button button-ghost" type="button" data-action="question">Edit questions</button>
        <button class="button button-ghost" type="button" data-action="image">Replace artwork</button>
        <button class="button button-secondary" type="button" data-action="compile" ${rule.status.compiledCurrent ? "disabled" : ""}>${rule.status.compiledCurrent ? "Compiled" : "Compile"}</button>
        <button class="button button-primary" type="button" data-action="deploy" ${rule.status.deployedCurrent ? "disabled" : ""}>${rule.status.deployedCurrent ? "Live" : releaseLabel}</button>
      </div>
    </div>

    <div class="release-summary" aria-label="Publishing status">
      <div class="release-summary-item"><span>Working version</span><strong>${rule.status.compiledCurrent ? "Compiled" : "Draft changes"}</strong></div>
      <div class="release-summary-item"><span>Last compiled</span><strong>${escapeHtml(formatDate(rule.status.compiledAtUtc))}</strong></div>
      <div class="release-summary-item"><span>Public version</span><strong>${rule.status.deployedCurrent ? "Current" : rule.status.deployed ? "Older version live" : "Not released"}</strong></div>
      <div class="release-summary-item"><span>Last released</span><strong>${escapeHtml(formatDate(rule.status.deployedAtUtc))}</strong></div>
    </div>

    <div class="detail-grid">
      <div class="content-stack">
        <article class="panel">
          <div class="panel-header"><h3>Artwork preview</h3><span class="status-badge status-muted">${escapeHtml(rule.files.image ?? "Missing")}</span></div>
          ${rule.imageUrl
            ? `<div class="image-stage"><img src="${escapeHtml(rule.imageUrl)}" alt="${escapeHtml(rule.metadata.imageAlt ?? rule.title)}"></div>`
            : '<div class="image-stage empty-state"><p>No illustration is available.</p></div>'}
          <div class="image-caption"><span>Working-library asset</span><strong>${rule.status.deployedCurrent ? "Published" : "Not yet public"}</strong></div>
        </article>

        <details class="panel prompt-disclosure">
          <summary><span>Artwork generation prompt</span><span class="prompt-meta">${escapeHtml(rule.files.prompt ?? "Missing")}</span></summary>
          <pre class="prompt">${escapeHtml(rule.imagePrompt)}</pre>
        </details>
      </div>

      <article class="panel">
        <div class="panel-header"><h3>Quiz content</h3><span class="status-badge status-muted">${rule.juniorQuestion ? "2 audiences" : "Standard only"}</span></div>
        <div class="panel-body">
          ${renderQuestion(rule.standardQuestion, "Standard question", "All golfers")}
          ${renderQuestion(rule.juniorQuestion, "Junior-friendly question", "Junior golfers")}
        </div>
      </article>
    </div>
  `;
}

async function loadLibrary(preferredFolder = state.selectedFolder) {
  state.library = await api("/api/library");
  renderCounts();

  if (preferredFolder && state.library.rules.some((rule) => rule.folderName === preferredFolder)) {
    state.selectedFolder = preferredFolder;
  } else if (!state.selectedFolder && state.library.rules.length) {
    state.selectedFolder = state.library.rules[0].folderName;
  }

  renderList();

  if (state.selectedFolder) {
    await selectRule(state.selectedFolder, false);
  }
}

async function selectRule(folderName, updateList = true) {
  state.selectedFolder = folderName;
  if (updateList) renderList();
  elements.detail.innerHTML = '<div class="empty-state"><h2>Loading rule…</h2></div>';

  try {
    state.detail = await api(`/api/rules/${encodeURIComponent(folderName)}`);
    renderDetail();
  } catch (error) {
    toast(error.message, true);
  }
}

async function runRuleAction(label, action) {
  if (state.busy) return;
  state.busy = true;
  renderCounts();
  toast(`${label} started.`);

  try {
    await action();
    await loadLibrary(state.selectedFolder);
    toast(`${label} complete.`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.busy = false;
    renderCounts();
  }
}

function openActionDialog(type) {
  state.action = type;
  elements.actionInstructions.value = "";

  if (type === "question") {
    elements.actionTitle.textContent = "Revise this question";
    elements.actionCopy.textContent = "Describe what should change. New versioned standard and junior-friendly question files will be created; the live rule will not change until you release it.";
    elements.actionLabel.textContent = "Revision instructions";
    elements.actionSubmit.textContent = "Generate revisions";
    elements.actionInstructions.placeholder = "Make the situation less ambiguous and simplify answer B…";
  } else {
    elements.actionTitle.textContent = "Generate a new image";
    elements.actionCopy.textContent = "Describe the correction or replacement. A new versioned illustration and prompt will be created without changing the live rule.";
    elements.actionLabel.textContent = "Image instructions";
    elements.actionSubmit.textContent = "Generate image";
    elements.actionInstructions.placeholder = "Move the ball closer to the bunker edge and remove the second flag…";
  }

  elements.actionDialog.showModal();
  elements.actionInstructions.focus();
}

function showJob(job, title) {
  elements.jobBanner.hidden = false;
  elements.jobTitle.textContent = title;
  elements.jobMessage.textContent = job.message ?? "Working…";
  const percent = job.total > 0 ? Math.max(5, Math.round((job.processed / job.total) * 100)) : 8;
  elements.jobProgress.style.width = `${Math.min(100, percent)}%`;
}

async function watchJob(job, title) {
  state.busy = true;
  renderCounts();
  let current = job;

  while (["queued", "running"].includes(current.status)) {
    showJob(current, title);
    await new Promise((resolve) => setTimeout(resolve, 1400));
    current = await api(`/api/jobs/${encodeURIComponent(current.id)}`);
  }

  showJob(current, title);
  state.busy = false;
  renderCounts();

  if (current.status === "failed") {
    throw new Error(current.error ?? current.errors?.[0] ?? "The job did not complete.");
  }

  elements.jobProgress.style.width = "100%";
  setTimeout(() => { elements.jobBanner.hidden = true; }, 3500);
  return current;
}

elements.list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-folder]");
  if (button) void selectRule(button.dataset.folder);
});

elements.search.addEventListener("input", () => {
  state.search = elements.search.value.trim();
  renderList();
});

elements.filters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  elements.filters.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
  renderList();
});

elements.detail.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || !state.detail) return;
  const folder = state.detail.folderName;

  if (button.dataset.action === "question" || button.dataset.action === "image") {
    openActionDialog(button.dataset.action);
  } else if (button.dataset.action === "compile") {
    void runRuleAction("Compile", () => api(`/api/rules/${encodeURIComponent(folder)}/compile`, { method: "POST" }));
  } else if (button.dataset.action === "deploy") {
    void runRuleAction("Release", () => api(`/api/rules/${encodeURIComponent(folder)}/deploy`, { method: "POST" }));
  }
});

elements.addRuleButton.addEventListener("click", () => {
  elements.newRuleDescription.value = "";
  elements.addRuleDialog.showModal();
  elements.newRuleDescription.focus();
});

elements.addRuleForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  elements.createRuleButton.disabled = true;

  try {
    const job = await api("/api/rules", {
      method: "POST",
      body: JSON.stringify({ description: elements.newRuleDescription.value }),
    });
    elements.addRuleDialog.close();
    const completed = await watchJob(job, "Creating new rule");
    const folderName = completed.result?.folderName;
    await loadLibrary(folderName);
    toast("New rule created. It is unpublished until you release it.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    elements.createRuleButton.disabled = false;
    state.busy = false;
    renderCounts();
  }
});

elements.actionForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const type = state.action;
  const folder = state.selectedFolder;
  const instructions = elements.actionInstructions.value;
  elements.actionSubmit.disabled = true;

  try {
    const suffix = type === "question" ? "suggest-question-edit" : "regenerate-image";
    elements.actionDialog.close();
    await runRuleAction(type === "question" ? "Question revision" : "Image generation", () =>
      api(`/api/rules/${encodeURIComponent(folder)}/${suffix}`, {
        method: "POST",
        body: JSON.stringify({ instructions }),
      })
    );
  } finally {
    elements.actionSubmit.disabled = false;
  }
});

elements.releaseButton.addEventListener("click", () => {
  const count = state.library.counts.unpublished ?? 0;
  elements.releaseConfirmCopy.textContent = `${count} unpublished rule${count === 1 ? "" : "s"} will be compiled and made available to RulesReady.golf.`;
  elements.releaseDialog.showModal();
});

elements.releaseForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  elements.releaseConfirmButton.disabled = true;
  elements.releaseDialog.close();

  try {
    const job = await api("/api/releases/unpublished", { method: "POST" });
    await watchJob(job, "Releasing unpublished rules");
    await loadLibrary(state.selectedFolder);
    toast("The library release is live.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    elements.releaseConfirmButton.disabled = false;
    state.busy = false;
    renderCounts();
  }
});

loadLibrary().catch((error) => {
  elements.list.innerHTML = '<div class="list-empty">The library could not be loaded.</div>';
  toast(error.message, true);
});
