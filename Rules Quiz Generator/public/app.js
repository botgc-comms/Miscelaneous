const state = {
  library: { rules: [], counts: {}, publishing: {} },
  filter: "all",
  search: "",
  selectedFolder: null,
  detail: null,
  action: null,
  busy: false,
  jobs: new Map(),
};

const elements = {
  list: document.getElementById("rule-list"),
  detail: document.getElementById("rule-detail"),
  sidebarTotal: document.getElementById("sidebar-total"),
  search: document.getElementById("rule-search"),
  filters: document.getElementById("rule-filters"),
  compileAllButton: document.getElementById("compile-all-button"),
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
  compileDialog: document.getElementById("compile-dialog"),
  compileForm: document.getElementById("compile-form"),
  compileConfirmCopy: document.getElementById("compile-confirm-copy"),
  compileConfirmButton: document.getElementById("compile-confirm-button"),
  releaseDialog: document.getElementById("release-dialog"),
  releaseForm: document.getElementById("release-form"),
  releaseConfirmCopy: document.getElementById("release-confirm-copy"),
  releaseConfirmButton: document.getElementById("release-confirm-button"),
  activityPanel: document.getElementById("activity-panel"),
  activityList: document.getElementById("activity-list"),
  activityCount: document.getElementById("activity-count"),
  clearCompletedJobs: document.getElementById("clear-completed-jobs"),
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
  if (status.publishedCurrent) return "is-published";
  if (status.compiledCurrent) return "is-compiled";
  return "";
}

function safeGitHubUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

function statusLabel(status) {
  if (status.deployedCurrent) return "Live";
  if (status.publishedCurrent) return "Published to PR";
  if (status.compiledCurrent) return "Ready to publish";
  if (status.deployed || status.published) return "Changed";
  if (status.compiled) return "Needs recompile";
  return "Draft";
}

function filteredRules() {
  const search = state.search.toLowerCase();

  return state.library.rules.filter((rule) => {
    const matchesSearch = !search || [rule.title, rule.question, rule.ruleNumber, rule.ruleName, rule.group]
      .some((value) => String(value ?? "").toLowerCase().includes(search));
    const matchesFilter = state.filter === "all"
      || (state.filter === "drafts" && !rule.status.compiledCurrent)
      || (state.filter === "ready" && rule.status.compiledCurrent && !rule.status.publishedCurrent)
      || (state.filter === "published" && rule.status.publishedCurrent && !rule.status.deployedCurrent)
      || (state.filter === "deployed" && rule.status.deployedCurrent);
    return matchesSearch && matchesFilter;
  });
}

function renderCounts() {
  elements.sidebarTotal.textContent = state.library.counts.total ?? 0;
  document.getElementById("count-all").textContent = state.library.counts.total ?? 0;
  document.getElementById("count-drafts").textContent = state.library.counts.drafts ?? 0;
  document.getElementById("count-ready").textContent = state.library.counts.ready ?? 0;
  document.getElementById("count-published").textContent = state.library.counts.published ?? 0;
  document.getElementById("count-deployed").textContent = state.library.counts.deployed ?? 0;
  const ready = state.library.counts.ready ?? 0;
  const drafts = state.library.counts.drafts ?? 0;
  const configured = Boolean(state.library.publishing?.configured);
  elements.compileAllButton.textContent = `Compile ${drafts} draft${drafts === 1 ? "" : "s"}`;
  elements.compileAllButton.disabled = state.busy || drafts === 0;
  elements.releaseButton.textContent = configured ? `Publish ${ready} ready` : "Publishing not configured";
  elements.releaseButton.title = configured ? "Create a RulesReady content pull request" : "Configure the RulesReady GitHub repository and token on Render first.";
  elements.releaseButton.disabled = state.busy || !configured || ready === 0;
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
    : status.publishedCurrent
      ? '<span class="status-badge status-published">Published to PR · awaiting deployment</span>'
    : status.compiledCurrent
      ? '<span class="status-badge status-ready">Compiled · ready to publish</span>'
      : '<span class="status-badge status-draft">Unpublished changes</span>';
  const history = status.deployed && !status.deployedCurrent
    ? '<span class="status-badge status-muted">Previous version is live</span>'
    : status.published && !status.publishedCurrent
      ? '<span class="status-badge status-muted">Previous version was published</span>'
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

  const publishingConfigured = Boolean(state.library.publishing?.configured);
  const publishDisabled = !publishingConfigured || !rule.status.compiledCurrent || rule.status.publishedCurrent;
  const publishLabel = rule.status.publishedCurrent
    ? "Published"
    : rule.status.compiledCurrent
      ? "Publish to RulesReady"
      : "Compile first";
  const pullRequestUrl = safeGitHubUrl(rule.status.pullRequestUrl);
  const repositoryState = rule.status.publishedCurrent
    ? pullRequestUrl
      ? `<a href="${escapeHtml(pullRequestUrl)}" target="_blank" rel="noopener">PR #${escapeHtml(rule.status.pullRequestNumber)}</a>`
      : `PR #${escapeHtml(rule.status.pullRequestNumber)}`
    : rule.status.published
      ? "Older revision published"
      : "Not published";
  const liveState = rule.status.deployedCurrent
    ? "Current revision"
    : rule.status.deployed
      ? "Older revision live"
      : rule.status.publishedCurrent
        ? "Awaiting merge and deployment"
        : "Not live";
  const verificationState = !rule.status.deploymentVerificationConfigured
    ? "Not configured"
    : rule.status.deploymentVerificationAvailable
      ? formatDate(rule.status.deployedAtUtc)
      : `Unavailable${rule.status.deploymentVerificationError ? ` · ${rule.status.deploymentVerificationError}` : ""}`;
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
        <button class="button button-primary" type="button" data-action="publish" ${publishDisabled ? "disabled" : ""}>${publishLabel}</button>
      </div>
    </div>

    <div class="release-summary" aria-label="Publishing status">
      <div class="release-summary-item"><span>Working version</span><strong>${rule.status.compiledCurrent ? "Compiled" : "Draft changes"}</strong></div>
      <div class="release-summary-item"><span>Last compiled</span><strong>${escapeHtml(formatDate(rule.status.compiledAtUtc))}</strong></div>
      <div class="release-summary-item"><span>RulesReady repository</span><strong>${repositoryState}</strong></div>
      <div class="release-summary-item"><span>Live site</span><strong>${escapeHtml(liveState)}</strong><small>Checked: ${escapeHtml(verificationState)}</small></div>
    </div>

    <div class="detail-grid">
      <div class="content-stack">
        <article class="panel">
          <div class="panel-header"><h3>Artwork preview</h3><span class="status-badge status-muted">${escapeHtml(rule.files.image ?? "Missing")}</span></div>
          ${rule.imageUrl
            ? `<div class="image-stage"><img src="${escapeHtml(rule.imageUrl)}" alt="${escapeHtml(rule.metadata.imageAlt ?? rule.title)}"></div>`
            : '<div class="image-stage empty-state"><p>No illustration is available.</p></div>'}
          <div class="image-caption"><span>Working-library asset</span><strong>${rule.status.deployedCurrent ? "Live" : rule.status.publishedCurrent ? "Published to PR" : "Not public"}</strong></div>
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
    elements.actionCopy.textContent = "Describe what should change. New versioned standard and junior-friendly question files will be created; the live rule will not change until a release PR is merged and deployed.";
    elements.actionLabel.textContent = "Revision instructions";
    elements.actionSubmit.textContent = "Generate revisions";
    elements.actionInstructions.placeholder = "Make the situation less ambiguous and simplify answer B…";
  } else {
    elements.actionTitle.textContent = "Generate a new image";
    elements.actionCopy.textContent = "Describe the correction or replacement. A new versioned illustration and prompt will be created without changing the live rule until it is compiled, published, and deployed.";
    elements.actionLabel.textContent = "Image instructions";
    elements.actionSubmit.textContent = "Generate image";
    elements.actionInstructions.placeholder = "Move the ball closer to the bunker edge and remove the second flag…";
  }

  elements.actionDialog.showModal();
  elements.actionInstructions.focus();
}

function isFinishedJob(job) {
  return ["completed", "failed"].includes(job.status);
}

function jobStatusLabel(status) {
  if (status === "completed") return "Complete";
  if (status === "failed") return "Needs attention";
  if (status === "running") return "In progress";
  return "Queued";
}

function renderActivity() {
  const jobs = [...state.jobs.values()].sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
  elements.activityPanel.hidden = jobs.length === 0;
  elements.activityCount.textContent = jobs.length;
  elements.clearCompletedJobs.disabled = !jobs.some(isFinishedJob);

  elements.activityList.innerHTML = jobs.map((job) => {
    const percent = job.status === "completed"
      ? 100
      : job.total > 0
        ? Math.max(5, Math.round((job.processed / job.total) * 100))
        : 8;
    const folderName = job.result?.folderName;
    const pullRequestUrl = safeGitHubUrl(job.result?.pullRequestUrl);
    const pullRequestNumber = job.result?.pullRequestNumber;
    const details = job.error ?? job.errors?.[0] ?? job.message ?? "Working…";
    const actions = isFinishedJob(job) ? `
      <div class="activity-actions">
        ${folderName ? `<button type="button" data-open-job="${escapeHtml(folderName)}">Open draft</button>` : ""}
        ${pullRequestUrl ? `<a href="${escapeHtml(pullRequestUrl)}" target="_blank" rel="noopener">Open PR${pullRequestNumber ? ` #${escapeHtml(pullRequestNumber)}` : ""}</a>` : ""}
        <button type="button" data-dismiss-job="${escapeHtml(job.id)}">Dismiss</button>
      </div>
    ` : "";

    return `
      <article class="activity-card is-${escapeHtml(job.status)}">
        <div class="activity-card-heading">
          <strong>${escapeHtml(job.uiTitle)}</strong>
          <span>${escapeHtml(jobStatusLabel(job.status))}</span>
        </div>
        <p>${escapeHtml(details)}</p>
        <div class="progress-track${job.total === 0 && !isFinishedJob(job) ? " is-indeterminate" : ""}">
          <div class="progress-value" style="width:${Math.min(100, percent)}%"></div>
        </div>
        ${actions}
      </article>
    `;
  }).join("");
}

function trackJob(job, title) {
  const previous = state.jobs.get(job.id);
  state.jobs.set(job.id, { ...previous, ...job, uiTitle: title ?? previous?.uiTitle ?? "Background job" });
  renderActivity();
}

async function watchJob(job, title) {
  let current = job;
  trackJob(current, title);

  try {
    while (["queued", "running"].includes(current.status)) {
      await new Promise((resolve) => setTimeout(resolve, 1400));
      current = await api(`/api/jobs/${encodeURIComponent(current.id)}`);
      trackJob(current, title);
    }
  } catch (error) {
    trackJob({ ...current, status: "failed", error: error.message, message: error.message }, title);
    throw error;
  }

  if (current.status === "failed") {
    throw new Error(current.error ?? current.errors?.[0] ?? "The job did not complete.");
  }

  return current;
}

async function runPublication(endpoint, title) {
  if (state.busy) return;
  state.busy = true;
  renderCounts();

  try {
    const job = await api(endpoint, { method: "POST" });
    const completed = await watchJob(job, title);
    await loadLibrary(state.selectedFolder);
    const number = completed.result?.pullRequestNumber;
    toast(number ? `RulesReady pull request #${number} is ready for review.` : "The RulesReady release pull request is ready for review.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.busy = false;
    renderCounts();
  }
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
  } else if (button.dataset.action === "publish") {
    void runPublication(
      `/api/rules/${encodeURIComponent(folder)}/publish`,
      `Publishing · ${state.detail.title}`
    );
  }
});

elements.activityList.addEventListener("click", (event) => {
  const openButton = event.target.closest("[data-open-job]");
  const dismissButton = event.target.closest("[data-dismiss-job]");

  if (openButton) {
    void selectRule(openButton.dataset.openJob);
  } else if (dismissButton) {
    state.jobs.delete(dismissButton.dataset.dismissJob);
    renderActivity();
  }
});

elements.clearCompletedJobs.addEventListener("click", () => {
  for (const [jobId, job] of state.jobs) {
    if (isFinishedJob(job)) state.jobs.delete(jobId);
  }
  renderActivity();
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
  const description = elements.newRuleDescription.value.trim();

  try {
    const job = await api("/api/rules", {
      method: "POST",
      body: JSON.stringify({ description }),
    });
    elements.addRuleDialog.close();
    elements.newRuleDescription.value = "";
    const summary = description.length > 52 ? `${description.slice(0, 49)}…` : description;
    void watchJob(job, `New rule · ${summary}`)
      .then(async () => {
        await loadLibrary(state.selectedFolder);
        toast("A new draft rule is ready. Open it from Background activity.");
      })
      .catch((error) => toast(error.message, true));
    toast("Rule creation queued. You can add another now.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    elements.createRuleButton.disabled = false;
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

elements.compileAllButton.addEventListener("click", () => {
  const count = state.library.counts.drafts ?? 0;
  elements.compileConfirmCopy.textContent = `${count} draft rule${count === 1 ? "" : "s"} will be validated and their selected artwork converted into optimized WebP release assets.`;
  elements.compileDialog.showModal();
});

elements.compileForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  elements.compileConfirmButton.disabled = true;
  elements.compileDialog.close();
  state.busy = true;
  renderCounts();

  try {
    const job = await api("/api/compilations/drafts", { method: "POST" });
    await watchJob(job, "Compiling draft rules");
    toast("Draft compilation complete. The successful rules are ready to publish.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    await loadLibrary(state.selectedFolder).catch((error) => toast(error.message, true));
    elements.compileConfirmButton.disabled = false;
    state.busy = false;
    renderCounts();
  }
});

elements.releaseButton.addEventListener("click", () => {
  const count = state.library.counts.ready ?? 0;
  const repository = state.library.publishing?.repository ?? "the configured RulesReady repository";
  const branch = state.library.publishing?.targetBranch ?? "main";
  elements.releaseConfirmCopy.textContent = `${count} compiled rule${count === 1 ? "" : "s"} will be committed to a new branch in ${repository} and proposed against ${branch}.`;
  elements.releaseDialog.showModal();
});

elements.releaseForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  elements.releaseConfirmButton.disabled = true;
  elements.releaseDialog.close();
  try {
    await runPublication("/api/publications/ready", "Publishing compiled rules to RulesReady");
  } finally {
    elements.releaseConfirmButton.disabled = false;
  }
});

loadLibrary().catch((error) => {
  elements.list.innerHTML = '<div class="list-empty">The library could not be loaded.</div>';
  toast(error.message, true);
});
