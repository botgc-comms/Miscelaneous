const reportId = new URLSearchParams(window.location.search).get("id");
const form = document.getElementById("edit-report-form");
const loadPanel = document.getElementById("load-panel");
const loadStatus = document.getElementById("load-status");
const statusElement = document.getElementById("edit-status");
const saveButton = document.getElementById("save-button");
const headElement = document.getElementById("actuals-table-head");
const bodyElement = document.getElementById("actuals-table-body");

const importMembershipButton =
  document.getElementById("import-membership-button");

const membershipImportStatus =
  document.getElementById("membership-import-status");

const membershipSection =
  document.getElementById("membership-section");

const membershipBreakdowns =
  document.getElementById("membership-breakdowns");

const playingMembershipBreakdownBody =
  document.getElementById("playing-membership-breakdown-body");

const nonPlayingMembershipBreakdownBody =
  document.getElementById("non-playing-membership-breakdown-body");

const importTeeTimeButton =
  document.getElementById(
    "import-tee-time-button"
  );

const teeTimeImportStatus =
  document.getElementById(
    "tee-time-import-status"
  );

const teeTimeSection =
  document.getElementById(
    "tee-time-section"
  );

const teeTimeStartDateInput =
  document.getElementById(
    "tee-time-start-date"
  );

const teeTimeEndDateInput =
  document.getElementById(
    "tee-time-end-date"
  );

let report = null;
let hasUnsavedChanges = false;
let membershipImportInProgress = false;
let teeTimeImportInProgress = false;

const defaultMembershipNarrative =
  "At the start of each subscription year, we assume that playing " +
  "membership will reduce by approximately 8%. This is a pattern " +
  "we have seen consistently over a number of years and is built " +
  "into all of our budgets. Our aim is to recruit enough new " +
  "playing members during the year to recover that reduction and " +
  "return playing membership to the level recorded at the start " +
  "of the subscription year.";

const supportingFinancialDefinitions = [
  {
    key: "visitorGreenFees",
    label: "Visitor green fees"
  },
  {
    key: "foodAndBeverageContribution",
    label: "Food & beverage contribution"
  },
  {
    key: "visitorBarAndCatering",
    label: "Visitor bar & catering"
  },
  {
    key: "memberBarAndCatering",
    label: "Member bar & catering"
  },
  {
    key: "membershipSubscriptionFees",
    label: "Membership subscription fees"
  }
];

const outgoingsFinancialDefinitions = [
  {
    key: "administrativeExpenditure",
    label: "Administrative expenditure"
  },
  {
    key: "courseExpenditure",
    label: "Course expenditure"
  },
  {
    key: "competitionExpenditure",
    label: "Competition expenditure"
  },
  {
    key: "buggyExpenditure",
    label: "Buggy expenditure"
  }
];

function monthDate(month) {
  return new Date(month.year, month.month - 1, 1);
}

function monthLabel(month) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "2-digit"
  }).format(monthDate(month));
}

function formatDate(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function currency(value) {
  if (value === null || value === undefined) {
    return "—";
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(value);
}

function integer(value) {
  if (value === null || value === undefined) {
    return "—";
  }

  return Number(value).toLocaleString("en-GB", {
    maximumFractionDigits: 0
  });
}

function setStatus(message, kind = "") {
  statusElement.textContent = message;
  statusElement.className =
    `status-message${kind ? ` is-${kind}` : ""}`;
}

function setMembershipStatus(message, kind = "") {
  membershipImportStatus.textContent = message;
  membershipImportStatus.className =
    `status-message${kind ? ` is-${kind}` : ""}`;
}

function setText(id, value) {
  document.getElementById(id).textContent = value ?? "";
}

function actualInput(lineKey, year, month) {
  return document.querySelector(
    `[data-line="${lineKey}"]` +
    `[data-year="${year}"]` +
    `[data-month="${month}"]`
  );
}

function readActual(input) {
  return input.value.trim() === ""
    ? null
    : Number(input.value);
}

function supportingFinancialInput(
  key,
  valueType
) {
  return document.querySelector(
    `[data-supporting-financial-key="${key}"]` +
    `[data-supporting-financial-value="${valueType}"]`
  );
}

function outgoingsFinancialInput(key) {
  return document.querySelector(
    `[data-outgoings-financial-key="${key}"]`
  );
}

function createCurrencyInput(attributes) {
  const wrapper = document.createElement("label");

  wrapper.className =
    "currency-input currency-input--actual";

  const prefix = document.createElement("span");
  prefix.textContent = "£";

  const input = document.createElement("input");

  input.type = "number";
  input.step = "0.01";

  Object.entries(attributes).forEach(
    ([name, value]) => {
      input.dataset[name] = value;
    }
  );

  wrapper.append(prefix, input);

  return wrapper;
}

function createSupportingFinancialTable(
  definitions,
  includeBudget
) {
  const wrapper = document.createElement("div");

  wrapper.className =
    "budget-table-wrap";

  const table = document.createElement("table");

  table.className =
    "budget-table supporting-financial-table";

  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");

  [
    "Measure",
    "Actual YTD",
    ...(includeBudget
      ? ["Budget YTD"]
      : [])
  ].forEach(label => {
    const cell = document.createElement("th");

    cell.scope = "col";
    cell.textContent = label;

    headerRow.append(cell);
  });

  head.append(headerRow);

  const body = document.createElement("tbody");

  definitions.forEach(definition => {
    const row = document.createElement("tr");
    const label = document.createElement("th");

    label.scope = "row";
    label.textContent = definition.label;

    row.append(label);

    const actualCell =
      document.createElement("td");

    actualCell.append(
      includeBudget
        ? createCurrencyInput({
            supportingFinancialKey:
              definition.key,
            supportingFinancialValue:
              "actual"
          })
        : createCurrencyInput({
            outgoingsFinancialKey:
              definition.key
          })
    );

    row.append(actualCell);

    if (includeBudget) {
      const budgetCell =
        document.createElement("td");

      budgetCell.append(
        createCurrencyInput({
          supportingFinancialKey:
            definition.key,
          supportingFinancialValue:
            "budget"
        })
      );

      row.append(budgetCell);
    }

    body.append(row);
  });

  table.append(head, body);
  wrapper.append(table);

  return wrapper;
}

function renderSupportingFinancialInputs() {
  const container = document.getElementById(
    "supporting-financial-inputs"
  );

  const columns =
    document.createElement("div");

  columns.className =
    "supporting-financial-columns";

  const performancePanel =
    document.createElement("section");

  performancePanel.className =
    "supporting-financial-panel " +
    "supporting-financial-panel--performance";

  const performanceHeading =
    document.createElement("h3");

  performanceHeading.textContent =
    "Performance measures";

  const performanceTable =
    createSupportingFinancialTable(
      supportingFinancialDefinitions,
      true
    );

  performancePanel.append(
    performanceHeading,
    performanceTable
  );

  const outgoingsPanel =
    document.createElement("section");

  outgoingsPanel.className =
    "supporting-financial-panel " +
    "supporting-financial-panel--outgoings";

  const outgoingsHeading =
    document.createElement("h3");

  outgoingsHeading.textContent =
    "Outgoings breakdown";

  const outgoingsHelp =
    document.createElement("p");

  outgoingsHelp.textContent =
    "The membership subscription fees actual on the left is reused " +
    "for the outgoings comparison and must not be entered again.";

  const outgoingsTable =
    createSupportingFinancialTable(
      outgoingsFinancialDefinitions,
      false
    );

  outgoingsPanel.append(
    outgoingsHeading,
    outgoingsTable
  );

  columns.append(
    performancePanel,
    outgoingsPanel
  );

  container.replaceChildren(columns);
}

function percentage(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  return `${Number(value).toLocaleString(
    "en-GB",
    {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }
  )}%`;
}

function populateSupportingFinancials() {
  const supporting =
    report.supportingFinancials ?? {};

  supportingFinancialDefinitions.forEach(
    definition => {
      const value =
        supporting[definition.key] ?? {};

      supportingFinancialInput(
        definition.key,
        "actual"
      ).value =
        value.actual ?? "";

      supportingFinancialInput(
        definition.key,
        "budget"
      ).value =
        value.budget ?? "";
    }
  );

  const outgoings =
    supporting.outgoings ?? {};

  outgoingsFinancialDefinitions.forEach(
    definition => {
      outgoingsFinancialInput(
        definition.key
      ).value =
        outgoings[definition.key] ?? "";
    }
  );

  updateSupportingFinancialSummary();
}

function collectSupportingFinancials() {
  report.supportingFinancials ??= {};

  supportingFinancialDefinitions.forEach(
    definition => {
      report.supportingFinancials[
        definition.key
      ] ??= {};

      report.supportingFinancials[
        definition.key
      ].actual =
        readActual(
          supportingFinancialInput(
            definition.key,
            "actual"
          )
        );

      report.supportingFinancials[
        definition.key
      ].budget =
        readActual(
          supportingFinancialInput(
            definition.key,
            "budget"
          )
        );
    }
  );

  report.supportingFinancials.outgoings ??= {};

  outgoingsFinancialDefinitions.forEach(
    definition => {
      report.supportingFinancials
        .outgoings[
          definition.key
        ] =
          readActual(
            outgoingsFinancialInput(
              definition.key
            )
          );
    }
  );
}

function updateSupportingFinancialSummary() {
  const outgoings =
    outgoingsFinancialDefinitions.map(
      definition =>
        readActual(
          outgoingsFinancialInput(
            definition.key
          )
        )
    );

  const totalOutgoings =
    outgoings.every(
      value => value !== null
    )
      ? outgoings.reduce(
          (total, value) =>
            total + value,
          0
        )
      : null;

  const subscriptionIncome =
    readActual(
      supportingFinancialInput(
        "membershipSubscriptionFees",
        "actual"
      )
    );

  const coverage =
    totalOutgoings !== null &&
    totalOutgoings !== 0 &&
    subscriptionIncome !== null
      ? subscriptionIncome /
        totalOutgoings *
        100
      : null;

  const otherIncomeRequired =
    totalOutgoings !== null &&
    subscriptionIncome !== null
      ? Math.max(
          totalOutgoings -
          subscriptionIncome,
          0
        )
      : null;

  setText(
    "supporting-total-outgoings",
    currency(totalOutgoings)
  );

  setText(
    "supporting-subscription-coverage",
    percentage(coverage)
  );

  setText(
    "supporting-other-income-required",
    currency(otherIncomeRequired)
  );
}

function updateTotals() {
  report.financialLines.forEach(line => {
    const inputs = line.months.map(month =>
      actualInput(
        line.key,
        month.year,
        month.month
      )
    );

    const values = inputs.map(readActual);

    const actualTotal = values.every(value => value !== null)
      ? values.reduce((total, value) => total + value, 0)
      : null;

    const totalElement = document.querySelector(
      `[data-actual-total="${line.key}"]`
    );

    totalElement.textContent = actualTotal === null
      ? "Actual —"
      : `Actual ${currency(actualTotal)}`;
  });

  updateNetProfitRow();
}

function updateNetProfitRow() {
  const monthKeys = report.financialLines[0].months.map(
    month => `${month.year}-${month.month}`
  );

  monthKeys.forEach(key => {
    const [year, month] = key
      .split("-")
      .map(Number);

    let budget = 0;
    let actual = 0;
    let complete = true;

    report.financialLines.forEach(line => {
      const value = line.months.find(
        item =>
          item.year === year &&
          item.month === month
      );

      const sign = line.type === "Expense"
        ? -1
        : 1;

      budget += value.budget * sign;

      const inputValue = readActual(
        actualInput(
          line.key,
          year,
          month
        )
      );

      if (inputValue === null) {
        complete = false;
      } else {
        actual += inputValue * sign;
      }
    });

    document.querySelector(
      `[data-net-budget="${key}"]`
    ).textContent = `Budget ${currency(budget)}`;

    document.querySelector(
      `[data-net-actual="${key}"]`
    ).textContent = complete
      ? `Actual ${currency(actual)}`
      : "Actual —";
  });

  let annualBudget = 0;
  let annualActual = 0;
  let annualComplete = true;

  report.financialLines.forEach(line => {
    const sign = line.type === "Expense"
      ? -1
      : 1;

    annualBudget += line.months.reduce(
      (total, month) =>
        total + month.budget,
      0
    ) * sign;

    line.months.forEach(month => {
      const value = readActual(
        actualInput(
          line.key,
          month.year,
          month.month
        )
      );

      if (value === null) {
        annualComplete = false;
      } else {
        annualActual += value * sign;
      }
    });
  });

  document.getElementById(
    "net-annual-budget"
  ).textContent =
    `Budget ${currency(annualBudget)}`;

  document.getElementById(
    "net-annual-actual"
  ).textContent = annualComplete
    ? `Actual ${currency(annualActual)}`
    : "Actual —";
}

function renderTable() {
  const months = report.financialLines[0].months;

  const headerRow =
    document.createElement("tr");

  [
    "Financial line",
    ...months.map(monthLabel),
    "Annual"
  ].forEach(label => {
    const th = document.createElement("th");

    th.scope = "col";
    th.textContent = label;

    headerRow.append(th);
  });

  headElement.replaceChildren(headerRow);
  bodyElement.replaceChildren();

  report.financialLines
    .sort(
      (left, right) =>
        left.displayOrder - right.displayOrder
    )
    .forEach(line => {
      const row = document.createElement("tr");

      const labelCell =
        document.createElement("th");

      labelCell.scope = "row";

      labelCell.innerHTML =
        `<strong>${line.label}</strong>` +
        `<span>${line.type}</span>`;

      row.append(labelCell);

      line.months.forEach(month => {
        const cell =
          document.createElement("td");

        cell.className =
          "actual-budget-cell";

        const budget =
          document.createElement("span");

        budget.className = "budget-value";

        budget.textContent =
          `Budget ${currency(month.budget)}`;

        const wrapper =
          document.createElement("label");

        wrapper.className =
          "currency-input currency-input--actual";

        const prefix =
          document.createElement("span");

        prefix.textContent = "£";

        const input =
          document.createElement("input");

        input.type = "number";
        input.step = "0.01";
        input.value = month.actual ?? "";
        input.placeholder = "Actual";
        input.dataset.line = line.key;
        input.dataset.year = String(month.year);
        input.dataset.month = String(month.month);

        input.setAttribute(
          "aria-label",
          `${line.label}, ${monthLabel(month)} actual`
        );

        input.addEventListener(
          "input",
          updateTotals
        );

        wrapper.append(prefix, input);
        cell.append(budget, wrapper);
        row.append(cell);
      });

      const annualCell =
        document.createElement("td");

      annualCell.className =
        "actual-budget-cell annual-total";

      const annualBudget =
        line.months.reduce(
          (total, month) =>
            total + month.budget,
          0
        );

      annualCell.innerHTML =
        `<span>Budget ${currency(annualBudget)}</span>` +
        `<strong data-actual-total="${line.key}">` +
        `Actual —` +
        `</strong>`;

      row.append(annualCell);
      bodyElement.append(row);
    });

  const netRow =
    document.createElement("tr");

  netRow.className = "net-profit-row";

  const netLabel =
    document.createElement("th");

  netLabel.scope = "row";

  netLabel.innerHTML =
    "<strong>Net Profit Before Taxation</strong>" +
    "<span>Calculated</span>";

  netRow.append(netLabel);

  months.forEach(month => {
    const key =
      `${month.year}-${month.month}`;

    const cell =
      document.createElement("td");

    cell.className =
      "actual-budget-cell";

    cell.innerHTML =
      `<span data-net-budget="${key}"></span>` +
      `<strong data-net-actual="${key}"></strong>`;

    netRow.append(cell);
  });

  const annualNet =
    document.createElement("td");

  annualNet.className =
    "actual-budget-cell annual-total";

  annualNet.innerHTML =
    '<span id="net-annual-budget"></span>' +
    '<strong id="net-annual-actual"></strong>';

  netRow.append(annualNet);
  bodyElement.append(netRow);

  updateTotals();
}

function renderBreakdownTable(
  body,
  items
) {
  body.replaceChildren();

  items
    .filter(
      item =>
        Number(item.value) > 0
    )
    .sort((left, right) => {
      const valueDifference =
        Number(right.value) -
        Number(left.value);

      return valueDifference !== 0
        ? valueDifference
        : left.label.localeCompare(
            right.label,
            "en-GB"
          );
    })
    .forEach(item => {
      const row =
        document.createElement("tr");

      const labelCell =
        document.createElement("th");

      const valueCell =
        document.createElement("td");

      labelCell.scope = "row";
      labelCell.textContent = item.label;
      valueCell.textContent =
        integer(item.value);

      row.append(
        labelCell,
        valueCell
      );

      body.append(row);
    });
}

function buildMembershipGroupBreakdowns(
  snapshot
) {
  const categoryGroups =
    snapshot?.categoryGroupBreakdown ?? {};

  const playingGroupNames = new Set([
    "7 Day Membership",
    "6 Day Membership",
    "5 Day Membership",
    "Intermediate Membership"
  ]);

  const playing = [];
  const nonPlaying = [];

  Object.entries(categoryGroups).forEach(
    ([label, value]) => {
      const item = {
        label,
        value: Number(value)
      };

      if (playingGroupNames.has(label)) {
        playing.push(item);
      } else {
        nonPlaying.push(item);
      }
    }
  );

  return {
    playing,
    nonPlaying
  };
}

function updateImportButtonState() {
  const snapshot = report?.membershipSnapshot;

  importMembershipButton.textContent = snapshot
    ? "Refresh membership data"
    : "Import membership data";

  /*
   * Do not disable the button merely because the form is dirty.
   * The click handler needs to run so it can explain that the
   * report must be saved first.
   */
  importMembershipButton.disabled =
    report === null ||
    membershipImportInProgress;

  if (membershipImportInProgress) {
    importMembershipButton.textContent =
      "Importing membership data…";

    importMembershipButton.title = "";
    return;
  }

  importMembershipButton.title = hasUnsavedChanges
    ? "Save the report before importing membership data."
    : "";
}

function renderMembershipSnapshot() {
  const snapshot =
    report?.membershipSnapshot ?? null;

  const figuresCorrectAsAt =
    document
      .getElementById(
        "figures-correct-as-at"
      )
      .value ||
    report?.figuresCorrectAsAt;

  membershipSection.dataset.status =
    "missing";

  if (!snapshot) {
    setText(
      "membership-snapshot-status",
      "Not imported"
    );

    setText(
      "membership-data-as-at",
      "—"
    );

    setText(
      "membership-imported-at",
      "—"
    );

    setText(
      "membership-source-generated-at",
      "—"
    );

    setText(
      "membership-playing-members",
      "—"
    );

    setText(
      "membership-non-playing-members",
      "—"
    );

    setText(
      "membership-total-members",
      "—"
    );

    renderTeeTimeSnapshot();
    updateTeeTimeImportButtonState();

    membershipBreakdowns.hidden = true;

    setMembershipStatus(
      "No membership snapshot has been imported for this report."
    );

    updateImportButtonState();
    return;
  }

  const snapshotIsCurrent =
    snapshot.dataAsAt ===
    figuresCorrectAsAt;

  membershipSection.dataset.status =
    snapshotIsCurrent
      ? "current"
      : "stale";

  setText(
    "membership-snapshot-status",
    snapshotIsCurrent
      ? "Current"
      : "Needs refreshing"
  );

  setText(
    "membership-data-as-at",
    formatDate(snapshot.dataAsAt)
  );

  setText(
    "membership-imported-at",
    formatDateTime(
      snapshot.importedAtUtc
    )
  );

  setText(
    "membership-source-generated-at",
    formatDateTime(
      snapshot.sourceGeneratedAtUtc
    )
  );

  setText(
    "membership-playing-members",
    integer(snapshot.playingMembers)
  );

  setText(
    "membership-non-playing-members",
    integer(snapshot.nonPlayingMembers)
  );

  setText(
    "membership-total-members",
    integer(
      snapshot.totalMembers ??
      Number(
        snapshot.playingMembers ?? 0
      ) +
      Number(
        snapshot.nonPlayingMembers ?? 0
      )
    )
  );

  const breakdowns =
    buildMembershipGroupBreakdowns(
      snapshot
    );

  renderBreakdownTable(
    playingMembershipBreakdownBody,
    breakdowns.playing
  );

  renderBreakdownTable(
    nonPlayingMembershipBreakdownBody,
    breakdowns.nonPlaying
  );

  membershipBreakdowns.hidden =
    breakdowns.playing.length === 0 &&
    breakdowns.nonPlaying.length === 0;

  if (snapshotIsCurrent) {
    setMembershipStatus(
      `Membership data is current to ` +
      `${formatDate(snapshot.dataAsAt)}.`,
      "success"
    );
  } else {
    setMembershipStatus(
      `Membership data is dated ` +
      `${formatDate(snapshot.dataAsAt)}, ` +
      `but the financial figures are dated ` +
      `${formatDate(figuresCorrectAsAt)}. ` +
      `Save the report, then refresh the membership data.`,
      "error"
    );
  }

  updateImportButtonState();
}

function markFormDirty() {
  if (!report) {
    return;
  }

  hasUnsavedChanges = true;

  updateTeeTimeImportButtonState();

  if (report.teeTimeSnapshot) {
    setTeeTimeStatus(
      "Save the report before refreshing the tee-time data."
    );
  }

  updateImportButtonState();

  if (report.membershipSnapshot) {
    setMembershipStatus(
      "Save the report before refreshing the membership data."
    );
  }
}

function populateForm() {
  document.title =
    `Edit ${report.title}`;

  document.getElementById(
    "page-title"
  ).textContent = report.title;

  document.getElementById(
    "title"
  ).value = report.title;

  document.getElementById(
    "reporting-period-start"
  ).value = report.reportingPeriodStart;

  document.getElementById(
    "report-summary"
  ).value =
    report.presentation?.summary ?? "";
    
  document.getElementById(
    "reporting-period-end"
  ).value = report.reportingPeriodEnd;

  document.getElementById(
    "figures-correct-as-at"
  ).value = report.figuresCorrectAsAt;

  document.getElementById(
    "financial-year-label"
  ).textContent =
    `${formatDate(report.financialYearStart)} – ` +
    `${formatDate(report.financialYearEnd)}`;

  document.getElementById(
    "version-label"
  ).textContent =
    `Version ${report.version}`;

  document.getElementById(
    "view-report-link"
  ).href =
    `/?id=${encodeURIComponent(report.id)}`;

  document.getElementById(
    "financial-commentary"
  ).value =
    (
      report.presentation
        ?.financialCommentary ??
      []
    ).join("\n\n");

  const membershipNarrative =
    report.presentation
      ?.membershipNarrative;

  document.getElementById(
    "membership-narrative"
  ).value =
    typeof membershipNarrative === "string" &&
    membershipNarrative.trim().length > 0
      ? membershipNarrative
      : defaultMembershipNarrative;

  document.getElementById(
    "year-end-forecast-net-profit-before-taxation"
  ).value =
    report
      .yearEndForecastNetProfitBeforeTaxation ??
    "";

  renderSupportingFinancialInputs();
  populateSupportingFinancials();
  renderTable();

  hasUnsavedChanges = false;

  renderMembershipSnapshot();
  initialiseTeeTimeInputs();
  renderTeeTimeSnapshot();
  updateTeeTimeImportButtonState();
  updateImportButtonState();
}

async function loadReport() {
  if (!reportId) {
    loadStatus.textContent =
      "No report ID was supplied.";

    loadStatus.classList.add(
      "is-error"
    );

    return;
  }

  try {
    const response = await fetch(
      `/api/kpi-reports/` +
      `${encodeURIComponent(reportId)}`,
      {
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? "The KPI report was not found."
          : `The server returned ${response.status}.`
      );
    }

    report = await response.json();

    populateForm();

    loadPanel.hidden = true;
    form.hidden = false;
  } catch (error) {
    loadStatus.textContent =
      error.message;

    loadStatus.classList.add(
      "is-error"
    );
  }
}

function isImportParameterControl(
  element
) {
  return element.matches(
    "#tee-time-start-date, " +
    "#tee-time-end-date"
  );
}

form.addEventListener(
  "input",
  event => {
    if (
      !isImportParameterControl(
        event.target
      )
    ) {
      markFormDirty();
    }
  }
);

form.addEventListener(
  "change",
  event => {
    if (
      !isImportParameterControl(
        event.target
      )
    ) {
      markFormDirty();
    }
  }
);

form.addEventListener(
  "input",
  event => {
    if (
      event.target.matches(
        "[data-supporting-financial-key], " +
        "[data-outgoings-financial-key]"
      )
    ) {
      updateSupportingFinancialSummary();
    }
  }
);

form.addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    setStatus("Saving report…");

    saveButton.disabled = true;

    report.title =
      document
        .getElementById("title")
        .value
        .trim();

    report.reportingPeriodStart =
      document
        .getElementById(
          "reporting-period-start"
        )
        .value;

    report.reportingPeriodEnd =
      document
        .getElementById(
          "reporting-period-end"
        )
        .value;

    report.figuresCorrectAsAt =
      document
        .getElementById(
          "figures-correct-as-at"
        )
        .value;

    report.presentation ??= {};

    report.presentation.summary =
      document
        .getElementById(
          "report-summary"
        )
        .value
        .trim();
        
    report.presentation.membershipNarrative =
      document
        .getElementById(
          "membership-narrative"
        )
        .value
        .trim();

    report.presentation.financialCommentary =
      document
        .getElementById(
          "financial-commentary"
        )
        .value
        .trim()
        .split(/\r?\n\s*\r?\n+/)
        .map(
          paragraph =>
            paragraph.trim()
        )
        .filter(
          paragraph =>
            paragraph.length > 0
        );

    collectSupportingFinancials();

    report.financialLines.forEach(
      line => {
        line.months.forEach(
          month => {
            month.actual =
              readActual(
                actualInput(
                  line.key,
                  month.year,
                  month.month
                )
              );
          }
        );
      }
    );

    const yearEndForecastValue =
      document
        .getElementById(
          "year-end-forecast-net-profit-before-taxation"
        )
        .value
        .trim();

    report
      .yearEndForecastNetProfitBeforeTaxation =
      yearEndForecastValue === ""
        ? null
        : Number(
            yearEndForecastValue
          );

    try {
      const response = await fetch(
        `/api/kpi-reports/` +
        `${encodeURIComponent(report.id)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify(report)
        }
      );

      if (!response.ok) {
        const problem =
          await response
            .json()
            .catch(() => null);

        const messages =
          Object.entries(
            problem?.errors ?? {}
          )
            .flatMap(
              ([key, values]) =>
                values.map(
                  value =>
                    `${key}: ${value}`
                )
            );

        throw new Error(
          messages.join(" ") ||
          problem?.detail ||
          problem?.message ||
          `The server returned ${response.status}.`
        );
      }

      report = await response.json();

      hasUnsavedChanges = false;

      document.getElementById(
        "version-label"
      ).textContent =
        `Version ${report.version}`;

      renderMembershipSnapshot();
      updateImportButtonState();

      setStatus(
        "Saved. The graph and financial table now use these values.",
        "success"
      );
    } catch (error) {
      setStatus(
        error.message,
        "error"
      );
    } finally {
      saveButton.disabled = false;
    }
  }
);

importTeeTimeButton.addEventListener(
  "click",
  async () => {
    if (
      !report ||
      hasUnsavedChanges
    ) {
      setTeeTimeStatus(
        "Save the report before importing tee-time data.",
        "error"
      );

      return;
    }

    const startDate =
      teeTimeStartDateInput.value;

    const endDate =
      teeTimeEndDateInput.value;

    if (!startDate || !endDate) {
      setTeeTimeStatus(
        "Enter both a start date and an end date.",
        "error"
      );

      return;
    }

    if (endDate < startDate) {
      setTeeTimeStatus(
        "The end date must not be before the start date.",
        "error"
      );

      return;
    }

    teeTimeImportInProgress = true;

    updateTeeTimeImportButtonState();

    setTeeTimeStatus(
      "Importing tee-time data…"
    );

    try {
      const response = await fetch(
        `/api/kpi-reports/` +
        `${encodeURIComponent(
          report.id
        )}` +
        `/tee-time-snapshot`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            version: report.version,
            startDate,
            endDate
          })
        }
      );

      if (!response.ok) {
        const problem =
          await response
            .json()
            .catch(() => null);

        const validationMessages =
          Object.values(
            problem?.errors ?? {}
          ).flat();

        throw new Error(
          validationMessages.join(" ") ||
          problem?.detail ||
          problem?.message ||
          `The server returned ${response.status}.`
        );
      }

      report =
        await response.json();

      hasUnsavedChanges = false;

      document.getElementById(
        "version-label"
      ).textContent =
        `Version ${report.version}`;

      initialiseTeeTimeInputs();
      renderTeeTimeSnapshot();

      setTeeTimeStatus(
        "Tee-time utilisation data imported.",
        "success"
      );
    } catch (error) {
      setTeeTimeStatus(
        error.message,
        "error"
      );
    } finally {
      teeTimeImportInProgress = false;

      updateTeeTimeImportButtonState();
    }
  }
);

importMembershipButton.addEventListener(
  "click",
  async () => {
    if (
      !report ||
      hasUnsavedChanges
    ) {
      setMembershipStatus(
        "Save the report before importing membership data.",
        "error"
      );

      return;
    }

    membershipImportInProgress = true;

    updateImportButtonState();

    setMembershipStatus(
      "Importing membership data…"
    );

    try {
      const response = await fetch(
        `/api/kpi-reports/` +
        `${encodeURIComponent(report.id)}` +
        `/membership-snapshot`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            version: report.version
          })
        }
      );

      if (!response.ok) {
        const problem =
          await response
            .json()
            .catch(() => null);

        throw new Error(
          problem?.detail ||
          problem?.message ||
          `The server returned ${response.status}.`
        );
      }

      report = await response.json();

      hasUnsavedChanges = false;

      document.getElementById(
        "version-label"
      ).textContent =
        `Version ${report.version}`;

      renderMembershipSnapshot();

      setMembershipStatus(
        `Membership data imported for ` +
        `${formatDate(
          report.membershipSnapshot
            ?.dataAsAt
        )}.`,
        "success"
      );
    } catch (error) {
      setMembershipStatus(
        error.message,
        "error"
      );
    } finally {
      membershipImportInProgress = false;

      updateImportButtonState();
    }
  }
);

function setTeeTimeStatus(
  message,
  kind = ""
) {
  teeTimeImportStatus.textContent =
    message;

  teeTimeImportStatus.className =
    `status-message${
      kind
        ? ` is-${kind}`
        : ""
    }`;
}

function parseIsoDate(value) {
  const parts =
    String(value ?? "")
      .split("-")
      .map(Number);

  if (
    parts.length !== 3 ||
    parts.some(
      part => !Number.isInteger(part)
    )
  ) {
    return null;
  }

  return new Date(
    parts[0],
    parts[1] - 1,
    parts[2]
  );
}

function toIsoDate(date) {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addMonthsClamped(
  date,
  months
) {
  const target =
    new Date(
      date.getFullYear(),
      date.getMonth() + months,
      1
    );

  const finalDay =
    new Date(
      target.getFullYear(),
      target.getMonth() + 1,
      0
    ).getDate();

  target.setDate(
    Math.min(
      date.getDate(),
      finalDay
    )
  );

  return target;
}

function getDefaultTeeTimePeriod() {
  const figuresDate =
    parseIsoDate(
      document.getElementById(
        "figures-correct-as-at"
      ).value ||
      report?.figuresCorrectAsAt
    );

  if (!figuresDate) {
    return null;
  }

  const startDate =
    addMonthsClamped(
      figuresDate,
      -3
    );

  const endDate =
    new Date(figuresDate);

  endDate.setDate(
    endDate.getDate() - 1
  );

  return {
    startDate:
      toIsoDate(startDate),

    endDate:
      toIsoDate(endDate)
  };
}

function initialiseTeeTimeInputs() {
  const snapshot =
    report?.teeTimeSnapshot;

  if (snapshot) {
    teeTimeStartDateInput.value =
      snapshot.startDate;

    teeTimeEndDateInput.value =
      snapshot.endDate;

    return;
  }

  const defaults =
    getDefaultTeeTimePeriod();

  if (!defaults) {
    return;
  }

  teeTimeStartDateInput.value =
    defaults.startDate;

  teeTimeEndDateInput.value =
    defaults.endDate;
}

function updateTeeTimeImportButtonState() {
  const snapshot =
    report?.teeTimeSnapshot;

  importTeeTimeButton.textContent =
    snapshot
      ? "Refresh tee-time data"
      : "Import tee-time data";

  importTeeTimeButton.disabled =
    report === null ||
    teeTimeImportInProgress;

  if (teeTimeImportInProgress) {
    importTeeTimeButton.textContent =
      "Importing tee-time data…";

    importTeeTimeButton.title = "";

    return;
  }

  importTeeTimeButton.title =
    hasUnsavedChanges
      ? "Save the report before importing tee-time data."
      : "";
}

function renderTeeTimeSnapshot() {
  const snapshot =
    report?.teeTimeSnapshot ?? null;

  teeTimeSection.dataset.status =
    snapshot
      ? "current"
      : "missing";

  if (!snapshot) {
    setText(
      "tee-time-snapshot-status",
      "Not imported"
    );

    setText(
      "tee-time-imported-at",
      "—"
    );

    setText(
      "tee-time-imported-period",
      "—"
    );

    setText(
      "tee-time-overall-utilisation",
      "—"
    );

    setTeeTimeStatus(
      "No tee-time utilisation snapshot has been imported."
    );

    updateTeeTimeImportButtonState();

    return;
  }

  const totalRow =
    snapshot.rows?.find(
      row => row.isTotal
    );

  setText(
    "tee-time-snapshot-status",
    "Imported"
  );

  setText(
    "tee-time-imported-at",
    formatDateTime(
      snapshot.importedAtUtc
    )
  );

  setText(
    "tee-time-imported-period",
    `${formatDate(
      snapshot.startDate
    )} to ${formatDate(
      snapshot.endDate
    )}`
  );

  setText(
    "tee-time-overall-utilisation",
    totalRow
      ? `${integer(
          totalRow.percentage?.total
        )}%`
      : "—"
  );

  setTeeTimeStatus(
    `Tee-time data covers ` +
    `${formatDate(
      snapshot.startDate
    )} to ${formatDate(
      snapshot.endDate
    )}.`,
    "success"
  );

  updateTeeTimeImportButtonState();
}

loadReport();