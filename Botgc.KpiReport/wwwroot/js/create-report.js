const financialLines = [
  { key: "turnover", label: "Turnover", type: "Income", displayOrder: 0 },
  { key: "other-income-subs", label: "Other Income / Subs", type: "Income", displayOrder: 1 },
  { key: "cost-of-sales", label: "Cost of Sales", type: "Expense", displayOrder: 2 },
  { key: "overheads", label: "Overheads", type: "Expense", displayOrder: 3 },
  { key: "depreciation", label: "Depreciation", type: "Expense", displayOrder: 4 }
];

const form = document.getElementById("create-report-form");
const titleInput = document.getElementById("title");
const financialYearStartInput = document.getElementById("financial-year-start");
const reportingPeriodStartInput = document.getElementById("reporting-period-start");
const reportingPeriodEndInput = document.getElementById("reporting-period-end");
const figuresCorrectAsAtInput = document.getElementById("figures-correct-as-at");
const headElement = document.getElementById("budget-table-head");
const bodyElement = document.getElementById("budget-table-body");
const statusElement = document.getElementById("create-status");
const createButton = document.getElementById("create-button");
let months = [];

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addMonths(date, count) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function addDays(date, count) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

function monthLabel(date) {
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" }).format(date);
}

function currency(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(value);
}

function financialYearName(start) {
  const end = addDays(addMonths(start, 12), -1);
  return `${start.getFullYear()}/${String(end.getFullYear()).slice(-2)}`;
}

function setStatus(message, kind = "") {
  statusElement.textContent = message;
  statusElement.className = `status-message${kind ? ` is-${kind}` : ""}`;
}

function calculateAnnualTotal(lineKey) {
  return months.reduce((total, _, index) => {
    const input = document.querySelector(`[data-line="${lineKey}"][data-month-index="${index}"]`);
    return total + Number(input?.value || 0);
  }, 0);
}

function updateAnnualTotal(lineKey) {
  const total = document.querySelector(`[data-annual-total="${lineKey}"]`);
  if (total) {
    total.textContent = currency(calculateAnnualTotal(lineKey));
  }
}

function renderBudgetTable() {
  const start = parseIsoDate(financialYearStartInput.value);
  months = Array.from({ length: 12 }, (_, index) => addMonths(start, index));

  const headerRow = document.createElement("tr");
  ["Budget line", ...months.map(monthLabel), "Annual"].forEach(label => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    headerRow.append(th);
  });
  headElement.replaceChildren(headerRow);
  bodyElement.replaceChildren();

  financialLines.forEach(line => {
    const row = document.createElement("tr");
    const labelCell = document.createElement("th");
    labelCell.scope = "row";
    labelCell.innerHTML = `<strong>${line.label}</strong><span>${line.type}</span>`;
    row.append(labelCell);

    months.forEach((_, index) => {
      const cell = document.createElement("td");
      const wrapper = document.createElement("label");
      wrapper.className = "currency-input";
      const prefix = document.createElement("span");
      prefix.textContent = "£";
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = "0.01";
      input.required = true;
      input.value = "0";
      input.dataset.line = line.key;
      input.dataset.monthIndex = String(index);
      input.setAttribute("aria-label", `${line.label}, ${monthLabel(months[index])} budget`);
      input.addEventListener("input", () => updateAnnualTotal(line.key));
      wrapper.append(prefix, input);
      cell.append(wrapper);
      row.append(cell);
    });

    const totalCell = document.createElement("td");
    totalCell.className = "annual-total";
    totalCell.dataset.annualTotal = line.key;
    totalCell.textContent = currency(0);
    row.append(totalCell);
    bodyElement.append(row);
  });
}

function initialiseDates() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 9, 1);
  const quarterEnd = addDays(addMonths(start, 3), -1);

  financialYearStartInput.value = toIsoDate(start);
  reportingPeriodStartInput.value = toIsoDate(start);
  reportingPeriodEndInput.value = toIsoDate(quarterEnd);
  figuresCorrectAsAtInput.value = toIsoDate(now);
  titleInput.value = `KPI Report: Q1 ${financialYearName(start)}`;
  renderBudgetTable();
}

financialYearStartInput.addEventListener("change", () => {
  if (!financialYearStartInput.value) {
    return;
  }

  const start = parseIsoDate(financialYearStartInput.value);
  reportingPeriodStartInput.value = toIsoDate(start);
  reportingPeriodEndInput.value = toIsoDate(addDays(addMonths(start, 3), -1));
  titleInput.value = `KPI Report: Q1 ${financialYearName(start)}`;
  renderBudgetTable();
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  setStatus("Creating report…");
  createButton.disabled = true;

  const request = {
    title: titleInput.value.trim(),
    financialYearStart: financialYearStartInput.value,
    reportingPeriodStart: reportingPeriodStartInput.value,
    reportingPeriodEnd: reportingPeriodEndInput.value,
    figuresCorrectAsAt: figuresCorrectAsAtInput.value,
    financialLines: financialLines.map(line => ({
      ...line,
      months: months.map((month, index) => ({
        year: month.getFullYear(),
        month: month.getMonth() + 1,
        budget: Number(document.querySelector(
          `[data-line="${line.key}"][data-month-index="${index}"]`).value)
      }))
    }))
  };

  try {
    const response = await fetch("/api/kpi-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      const messages = Object.entries(problem?.errors ?? {})
        .flatMap(([key, values]) => values.map(value => `${key}: ${value}`));
      throw new Error(messages.join(" ") || `The server returned ${response.status}.`);
    }

    const report = await response.json();
    window.location.assign(`/admin/edit.html?id=${encodeURIComponent(report.id)}`);
  } catch (error) {
    setStatus(error.message, "error");
    createButton.disabled = false;
  }
});

initialiseDates();
