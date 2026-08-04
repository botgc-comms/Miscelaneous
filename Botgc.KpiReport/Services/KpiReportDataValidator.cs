using Botgc.KpiReport.Models;

namespace Botgc.KpiReport.Services;

public static class KpiReportDataValidator
{
    public static Dictionary<string, string[]> ValidateCreate(CreateKpiReportRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        ValidateMetadata(
            errors,
            request.Title,
            request.FinancialYearStart,
            request.ReportingPeriodStart,
            request.ReportingPeriodEnd,
            request.FiguresCorrectAsAt);

        ValidateFinancialLines(
            errors,
            request.FinancialYearStart,
            request.FinancialLines.Select(line => new FinancialLineValidationModel(
                line.Key,
                line.Label,
                line.Months.Select(month => new FinancialMonthValidationModel(
                    month.Year,
                    month.Month,
                    month.Budget,
                    null)).ToList())).ToList());

        return errors;
    }

    public static Dictionary<string, string[]> Validate(KpiReportData report)
    {
        var errors = new Dictionary<string, string[]>();

        if (report.Id == Guid.Empty)
        {
            errors["id"] = ["The report ID is required."];
        }

        if (report.Version <= 0)
        {
            errors["version"] = ["The report version must be greater than zero."];
        }

        ValidateMetadata(
            errors,
            report.Title,
            report.FinancialYearStart,
            report.ReportingPeriodStart,
            report.ReportingPeriodEnd,
            report.FiguresCorrectAsAt);

        ValidateFinancialLines(
            errors,
            report.FinancialYearStart,
            report.FinancialLines.Select(line => new FinancialLineValidationModel(
                line.Key,
                line.Label,
                line.Months.Select(month => new FinancialMonthValidationModel(
                    month.Year,
                    month.Month,
                    month.Budget,
                    month.Actual)).ToList())).ToList());

        ValidateSupportingFinancials(
            errors,
            report.SupportingFinancials);
            
        return errors;
    }

private static void ValidateSupportingFinancials(
    Dictionary<string, string[]> errors,
    SupportingFinancialData? data)
{
    if (data is null)
    {
        return;
    }

    ValidateActualBudgetPair(
        errors,
        "supportingFinancials.visitorGreenFees",
        data.VisitorGreenFees,
        allowNegative: false);

    ValidateActualBudgetPair(
        errors,
        "supportingFinancials.foodAndBeverageContribution",
        data.FoodAndBeverageContribution,
        allowNegative: true);

    ValidateActualBudgetPair(
        errors,
        "supportingFinancials.visitorBarAndCatering",
        data.VisitorBarAndCatering,
        allowNegative: false);

    ValidateActualBudgetPair(
        errors,
        "supportingFinancials.memberBarAndCatering",
        data.MemberBarAndCatering,
        allowNegative: false);

    ValidateActualBudgetPair(
        errors,
        "supportingFinancials.membershipSubscriptionFees",
        data.MembershipSubscriptionFees,
        allowNegative: false);

    ValidateNonNegativeValue(
        errors,
        "supportingFinancials.outgoings.administrativeExpenditure",
        data.Outgoings?.AdministrativeExpenditure);

    ValidateNonNegativeValue(
        errors,
        "supportingFinancials.outgoings.courseExpenditure",
        data.Outgoings?.CourseExpenditure);

    ValidateNonNegativeValue(
        errors,
        "supportingFinancials.outgoings.competitionExpenditure",
        data.Outgoings?.CompetitionExpenditure);

    ValidateNonNegativeValue(
        errors,
        "supportingFinancials.outgoings.buggyExpenditure",
        data.Outgoings?.BuggyExpenditure);
}

private static void ValidateActualBudgetPair(
    Dictionary<string, string[]> errors,
    string key,
    ActualBudgetFinancialValue? value,
    bool allowNegative)
{
    if (value is null)
    {
        return;
    }

    if (value.Actual.HasValue != value.Budget.HasValue)
    {
        errors[key] =
        [
            "Enter both the year-to-date actual and budget, or leave both blank."
        ];

        return;
    }

    if (!allowNegative &&
        (value.Actual < 0 || value.Budget < 0))
    {
        errors[key] =
        [
            "Actual and budget values must not be negative."
        ];
    }
}

private static void ValidateNonNegativeValue(
    Dictionary<string, string[]> errors,
    string key,
    decimal? value)
{
    if (value < 0)
    {
        errors[key] =
        [
            "Expenditure values must be entered as positive amounts."
        ];
    }
}

private static void ValidateMetadata(
    Dictionary<string, string[]> errors,
    string title,
    DateOnly financialYearStart,
    DateOnly reportingPeriodStart,
    DateOnly reportingPeriodEnd,
    DateOnly figuresCorrectAsAt)
{
    if (string.IsNullOrWhiteSpace(title))
    {
        errors["title"] = ["The report title is required."];
    }

    if (financialYearStart == default)
    {
        errors["financialYearStart"] = ["The financial year start date is required."];
        return;
    }

    var financialYearEnd = financialYearStart.AddYears(1).AddDays(-1);

    if (reportingPeriodStart < financialYearStart || reportingPeriodStart > financialYearEnd)
    {
        errors["reportingPeriodStart"] = ["The reporting period must start within the financial year."];
    }

    if (reportingPeriodEnd < reportingPeriodStart || reportingPeriodEnd > financialYearEnd)
    {
        errors["reportingPeriodEnd"] = ["The reporting period end must be after its start and within the financial year."];
    }

    if (figuresCorrectAsAt == default)
    {
        errors["figuresCorrectAsAt"] = ["The figures-correct-as-at date is required."];
    }
}

private static void ValidateFinancialLines(
    Dictionary<string, string[]> errors,
    DateOnly financialYearStart,
    IReadOnlyList<FinancialLineValidationModel> lines)
{
    if (lines.Count == 0)
    {
        errors["financialLines"] = ["At least one financial line is required."];
        return;
    }

    var duplicateKeys = lines
        .GroupBy(line => line.Key, StringComparer.OrdinalIgnoreCase)
        .Where(group => group.Count() > 1)
        .Select(group => group.Key)
        .ToList();

    if (duplicateKeys.Count > 0)
    {
        errors["financialLines"] = [$"Financial line keys must be unique: {string.Join(", ", duplicateKeys)}."];
    }

    var expectedMonths = Enumerable
        .Range(0, 12)
        .Select(offset => financialYearStart.AddMonths(offset))
        .Select(date => (date.Year, date.Month))
        .ToHashSet();

    for (var index = 0; index < lines.Count; index++)
    {
        var line = lines[index];
        var prefix = $"financialLines[{index}]";

        if (string.IsNullOrWhiteSpace(line.Key))
        {
            errors[$"{prefix}.key"] = ["A financial line key is required."];
        }

        if (string.IsNullOrWhiteSpace(line.Label))
        {
            errors[$"{prefix}.label"] = ["A financial line label is required."];
        }

        var suppliedMonths = line.Months
            .Select(month => (month.Year, month.Month))
            .ToHashSet();

        if (line.Months.Count != 12 || !suppliedMonths.SetEquals(expectedMonths))
        {
            errors[$"{prefix}.months"] = ["Exactly the twelve months in the financial year are required."];
        }

        if (line.Months.Any(month => month.Budget < 0))
        {
            errors[$"{prefix}.months.budget"] = ["Budget values must be entered as positive amounts."];
        }
    }
}

private sealed record FinancialLineValidationModel(
    string Key,
    string Label,
    IReadOnlyList<FinancialMonthValidationModel> Months);

private sealed record FinancialMonthValidationModel(
    int Year,
    int Month,
    decimal Budget,
    decimal? Actual);
}
