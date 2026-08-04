const listElement = document.getElementById("report-list");
const countElement = document.getElementById("report-count");
const statusElement = document.getElementById("admin-status");

function formatDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function formatTimestamp(value) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function setStatus(message, kind = "") {
  statusElement.textContent = message;
  statusElement.className = `status-message${kind ? ` is-${kind}` : ""}`;
}

async function deleteReport(report) {
  const confirmed = window.confirm(`Delete "${report.title}"? This removes its JSON file.`);
  if (!confirmed) {
    return;
  }

  const response = await fetch(
    `/api/kpi-reports/${encodeURIComponent(report.id)}?version=${report.version}`,
    { method: "DELETE" });

  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new Error(problem?.message ?? `The server returned ${response.status}.`);
  }
}

function renderReports(reports) {
  listElement.replaceChildren();
  countElement.textContent = `${reports.length} ${reports.length === 1 ? "report" : "reports"}`;

  if (reports.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<h3>No KPI reports yet</h3><p>Create the first report and enter its annual budget.</p>";
    listElement.append(empty);
    return;
  }

  reports.forEach(report => {
    const card = document.createElement("article");
    card.className = "report-list-item";

    const details = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = report.title;
    const period = document.createElement("p");
    period.textContent = `${formatDate(report.reportingPeriodStart)} – ${formatDate(report.reportingPeriodEnd)}`;
    const metadata = document.createElement("p");
    metadata.className = "report-meta";
    metadata.textContent = `Updated ${formatTimestamp(report.updatedAtUtc)} · Version ${report.version}`;
    details.append(title, period, metadata);

    const actions = document.createElement("div");
    actions.className = "row-actions";

    const viewLink = document.createElement("a");
    viewLink.className = "button button--secondary button--small";
    viewLink.href = `/?id=${encodeURIComponent(report.id)}`;
    viewLink.textContent = "View";

    const editLink = document.createElement("a");
    editLink.className = "button button--small";
    editLink.href = `/admin/edit.html?id=${encodeURIComponent(report.id)}`;
    editLink.textContent = "Enter actuals";

    const deleteButton = document.createElement("button");
    deleteButton.className = "button button--danger button--small";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", async () => {
      deleteButton.disabled = true;
      try {
        await deleteReport(report);
        await loadReports();
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        deleteButton.disabled = false;
      }
    });

    actions.append(viewLink, editLink, deleteButton);
    card.append(details, actions);
    listElement.append(card);
  });
}

async function loadReports() {
  setStatus("Loading reports…");

  try {
    const response = await fetch("/api/kpi-reports", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`The server returned ${response.status}.`);
    }

    const reports = await response.json();
    renderReports(reports);
    setStatus("");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

loadReports();
