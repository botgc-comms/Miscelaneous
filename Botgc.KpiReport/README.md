# BOTGC KPI Report

A .NET 8 ASP.NET Core application that recreates the KPI report as a responsive web page and stores report source data as local JSON files.

## What is included

- The existing KPI report design and SVG charts.
- A report administration page at `/admin.html`.
- An **Add KPI report** journey that captures report dates and the complete twelve-month budget.
- One JSON metadata file per report in `Data/KpiReports`.
- A monthly actual-entry screen showing budget and actual together.
- Server-side calculation of reporting-period totals, variances and net profit.
- The annual budget drives the solid target area in the net-profit graph.
- Monthly actuals drive the actual line when a complete quarter has been entered.
- Optimistic concurrency through the report `version` field.
- Atomic file writes to reduce the risk of partially written JSON.
- An `IKpiReportStore` abstraction so file persistence can later be replaced by an HTTP/API implementation.

## Run

```powershell
Set-Location .\Botgc.KpiReport
dotnet restore
dotnet run
```

Open the URL printed by ASP.NET Core. The supplied launch profile uses:

```text
http://localhost:5077
```

## Main pages

| Page | Purpose |
|---|---|
| `/` | Opens the latest KPI report |
| `/?id={reportId}` | Opens a specific report |
| `/admin.html` | Lists all KPI reports |
| `/admin/create.html` | Creates a report and captures its annual budget |
| `/admin/edit.html?id={reportId}` | Enters actuals and updates report dates |

## Storage model

Each report is stored in:

```text
Data/KpiReports/{report-id-without-hyphens}.json
```

The file contains:

- Report identity and version.
- Financial-year and reporting-period dates.
- Five financial lines.
- Twelve monthly budget values for each line.
- Optional monthly actual values.
- The presentation data used by the remaining KPI report sections.

Budget and actual values for expenses are stored as positive amounts. `KpiReportBuilder` applies the correct sign when producing the financial table and net-profit chart.

## API surface

```text
GET    /api/kpi-reports
GET    /api/kpi-reports/{reportId}
GET    /api/kpi-reports/{reportId}/rendered
POST   /api/kpi-reports
PUT    /api/kpi-reports/{reportId}
DELETE /api/kpi-reports/{reportId}?version={version}
GET    /api/report
GET    /api/report?id={reportId}
```

The administration pages depend on `IKpiReportStore`. The current dependency-injection registration is:

```csharp
builder.Services.AddSingleton<IKpiReportStore, FileSystemKpiReportStore>();
```

A later API-backed version can implement the same interface and replace only that registration.

## Calculation rules

For each reporting-period financial line:

```text
Signed income = positive
Signed expense = negative
Variance = actual - budget
Percentage variance = variance / budget × 100
```

Net profit is calculated as:

```text
Turnover
+ Other Income / Subs
- Cost of Sales
- Overheads
- Depreciation
```

The solid target area contains cumulative budgeted net profit at the end of Q1, Q2, Q3 and Q4. The actual line contains cumulative actual net profit only where all monthly actuals through that quarter are available.

## Current scope

New reports copy the existing non-financial report sections as presentation data so the page retains its current appearance. Membership, tee-time and other integrations can be introduced independently later.
