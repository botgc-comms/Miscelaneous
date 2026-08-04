namespace Botgc.KpiReport.Models;

public sealed class KpiReportData
{
    public Guid Id { get; set; }
    public int Version { get; set; }
    public string Title { get; set; } = string.Empty;
    public DateOnly FinancialYearStart { get; set; }
    public DateOnly FinancialYearEnd { get; set; }
    public DateOnly ReportingPeriodStart { get; set; }
    public DateOnly ReportingPeriodEnd { get; set; }
    public DateOnly FiguresCorrectAsAt { get; set; }
    public decimal? YearEndForecastNetProfitBeforeTaxation { get; set; }
    public MembershipSnapshotData? MembershipSnapshot { get; set; }
    public List<KpiFinancialLineData> FinancialLines { get; set; } = [];
    public SupportingFinancialData SupportingFinancials { get; set; } = new();
    public KpiReportPresentationData Presentation { get; set; } = new();
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

public sealed class SupportingFinancialData
{
    public ActualBudgetFinancialValue VisitorGreenFees { get; set; } = new();

    public ActualBudgetFinancialValue FoodAndBeverageContribution { get; set; } = new();

    public ActualBudgetFinancialValue VisitorBarAndCatering { get; set; } = new();

    public ActualBudgetFinancialValue MemberBarAndCatering { get; set; } = new();

    public ActualBudgetFinancialValue MembershipSubscriptionFees { get; set; } = new();

    public OutgoingsFinancialData Outgoings { get; set; } = new();
}

public sealed class ActualBudgetFinancialValue
{
    public decimal? Actual { get; set; }

    public decimal? Budget { get; set; }
}

public sealed class OutgoingsFinancialData
{
    public decimal? AdministrativeExpenditure { get; set; }

    public decimal? CourseExpenditure { get; set; }

    public decimal? CompetitionExpenditure { get; set; }

    public decimal? BuggyExpenditure { get; set; }
}

public sealed class KpiFinancialLineData
{
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public KpiFinancialLineType Type { get; set; }
    public int DisplayOrder { get; set; }
    public List<KpiMonthlyFinancialData> Months { get; set; } = [];
}

public enum KpiFinancialLineType
{
    Income,
    Expense
}

public sealed class KpiMonthlyFinancialData
{
    public int Year { get; set; }
    public int Month { get; set; }
    public decimal Budget { get; set; }
    public decimal? Actual { get; set; }
}

public sealed class KpiReportPresentationData
{
    public string Summary { get; set; } = string.Empty;

    public List<string> FinancialCommentary { get; set; } = [];

    public string MembershipNarrative { get; set; } =
        """
        At the start of each subscription year, we assume that playing membership will reduce by approximately 8%. This is a pattern we have seen consistently over a number of years and is built into all of our budgets. Our aim is to recruit enough new playing members during the year to recover that reduction and return playing membership to the level recorded at the start of the subscription year.
        """;

    public DonutMetric Outgoings { get; set; } = new();
    public MembershipMetrics Membership { get; set; } = new();
    public TeeTimeMetrics TeeTimeUtilisation { get; set; } = new();
    public RetentionMetrics MemberRetention { get; set; } = new();
    public List<GaugeMetric> Gauges { get; set; } = [];
    public MembershipMovement Movement { get; set; } = new();
    public FeedbackPanel Feedback { get; set; } = new();
}

public sealed class CreateKpiReportRequest
{
    public string Title { get; set; } = string.Empty;
    public DateOnly FinancialYearStart { get; set; }
    public DateOnly ReportingPeriodStart { get; set; }
    public DateOnly ReportingPeriodEnd { get; set; }
    public DateOnly FiguresCorrectAsAt { get; set; }
    public List<CreateKpiFinancialLineRequest> FinancialLines { get; set; } = [];
}

public sealed class CreateKpiFinancialLineRequest
{
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public KpiFinancialLineType Type { get; set; }
    public int DisplayOrder { get; set; }
    public List<CreateKpiMonthlyBudgetRequest> Months { get; set; } = [];
}

public sealed class CreateKpiMonthlyBudgetRequest
{
    public int Year { get; set; }
    public int Month { get; set; }
    public decimal Budget { get; set; }
}

public sealed record KpiReportSummary(
    Guid Id,
    string Title,
    DateOnly FinancialYearStart,
    DateOnly ReportingPeriodStart,
    DateOnly ReportingPeriodEnd,
    DateTimeOffset UpdatedAtUtc,
    int Version);

public sealed class MembershipSnapshotData
{
    public DateOnly PeriodStart { get; set; }

    public DateOnly DataAsAt { get; set; }

    public DateTimeOffset ImportedAtUtc { get; set; }

    public DateTimeOffset SourceGeneratedAtUtc { get; set; }

    public int PlayingMembers { get; set; }

    public int NonPlayingMembers { get; set; }

    public int TotalMembers { get; set; }

    public Dictionary<string, int> PlayingCategoryBreakdown { get; set; } = [];

    public Dictionary<string, int> NonPlayingCategoryBreakdown { get; set; } = [];

    public Dictionary<string, int> CategoryGroupBreakdown { get; set; } = [];

    public List<MembershipTrendPointData> Trend { get; set; } = [];

    public MembershipMovementSnapshotData? Movement { get; set; }
}

public sealed class MembershipMovementSnapshotData
{
    public DateOnly FromDate { get; set; }

    public DateOnly ToDate { get; set; }

    public int PlayingNewJoiners { get; set; }

    public int PlayingMovedIn { get; set; }

    public int PlayingMovedOut { get; set; }

    public int PlayingLeavers { get; set; }

    public int PlayingDeaths { get; set; }

    public int PlayingNetMovement { get; set; }

    public decimal PlayingGrowthPercentage { get; set; }

    public int NonPlayingNewJoiners { get; set; }

    public int NonPlayingMovedIn { get; set; }

    public int NonPlayingMovedOut { get; set; }

    public int NonPlayingLeavers { get; set; }

    public int NonPlayingDeaths { get; set; }

    public int NonPlayingNetMovement { get; set; }

    public decimal NonPlayingGrowthPercentage { get; set; }
}

public sealed class MembershipTrendPointData
{
    public DateOnly Date { get; set; }

    public int PlayingMembers { get; set; }

    public int NonPlayingMembers { get; set; }

    public double? TargetPlayingMembers { get; set; }
}

public sealed class ImportMembershipSnapshotRequest
{
    public int Version { get; set; }
}