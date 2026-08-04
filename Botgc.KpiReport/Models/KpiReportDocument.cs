namespace Botgc.KpiReport.Models;

public sealed class KpiReportDocument
{
    public ReportHeader Header { get; init; } = new();
    public ProfitChart NetProfit { get; init; } = new();
    public string FinancialPositionAsAt { get; init; } = string.Empty;
    public List<FinancialRow> FinancialSummary { get; init; } = [];
    public List<string> FinancialCommentary { get; init; } = [];
    public string MembershipNarrative { get; init; } = string.Empty;
    public OutgoingsMetric Outgoings { get; init; } = new();
    public MembershipMetrics Membership { get; init; } = new();
    public MembershipTrendMetrics MembershipTrend { get; init; } = new();
    public TeeTimeMetrics TeeTimeUtilisation { get; init; } = new();
    public RetentionMetrics MemberRetention { get; init; } = new();
    public List<GaugeMetric> Gauges { get; init; } = [];
    public MembershipMovement Movement { get; init; } = new();
    public FeedbackPanel Feedback { get; init; } = new();
    public string FiguresCorrectAsAt { get; init; } = string.Empty;
    public MembershipMovementMetrics MembershipMovement { get; init; } = new();
}

public sealed class OutgoingsMetric
{
    public string Title { get; init; } = string.Empty;

    public string Description { get; init; } = string.Empty;

    public List<NamedValue> Items { get; init; } = [];

    public decimal? SubscriptionIncome { get; init; }

    public decimal? TotalOutgoings { get; init; }

    public decimal? OtherIncomeRequired { get; init; }

    public double? CoveragePercentage { get; init; }

    public bool IsCalculated { get; init; }
}

public sealed class MembershipMovementMetrics
{
    public string Period { get; init; } =
        string.Empty;

    public MembershipMovementColumnMetrics Playing
    {
        get;
        init;
    } = new();

    public MembershipMovementColumnMetrics NonPlaying
    {
        get;
        init;
    } = new();
}

public sealed class MembershipMovementColumnMetrics
{
    public int NewJoiners { get; init; }

    public int MovedIn { get; init; }

    public int MovedOut { get; init; }

    public int Leavers { get; init; }

    public int Deaths { get; init; }

    public int NetMovement { get; init; }

    public decimal GrowthPercentage { get; init; }
}

public sealed class ReportHeader
{
    public string Title { get; init; } = string.Empty;
    public string Period { get; init; } = string.Empty;
    public string Summary { get; init; } = string.Empty;
}

public sealed class ProfitChart
{
    public List<string> Labels { get; init; } = [];
    public List<double> Target { get; init; } = [];
    public List<double?> Actual { get; init; } = [];
    public List<double?> Forecast { get; init; } = [];
}

public sealed class FinancialRow
{
    public string Label { get; init; } = string.Empty;
    public decimal? Actual { get; init; }
    public decimal? Budget { get; init; }
    public decimal? Variance { get; init; }
    public decimal? PercentageVariance { get; init; }
    public bool IsTotal { get; init; }
}

public sealed class DonutMetric
{
    public string Title { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public List<NamedValue> Items { get; init; } = [];
}

public sealed class NamedValue
{
    public string Label { get; init; } = string.Empty;
    public double Value { get; init; }
}

public sealed class MembershipMetrics
{
    public string Description { get; init; } = string.Empty;
    public List<NamedValue> PlayingMemberTypes { get; init; } = [];
    public List<NamedValue> AllMemberTypes { get; init; } = [];
}

public sealed class TeeTimeMetrics
{
    public string Period { get; init; } = string.Empty;
    public List<string> Days { get; init; } = [];
    public List<TeeTimeRow> Rows { get; init; } = [];
    public List<double> Totals { get; init; } = [];
    public double CapacityDivisor { get; init; } = 11;
}

public sealed class MembershipTrendMetrics
{
    public string Period { get; init; } = string.Empty;

    public string FinancialYearLabel { get; init; } = string.Empty;

    public string FinancialYearStart { get; init; } = string.Empty;

    public string FinancialYearEnd { get; init; } = string.Empty;

    public string FiguresCorrectAsAt { get; init; } = string.Empty;

    public List<string> Dates { get; init; } = [];

    public List<int> PlayingMembers { get; init; } = [];

    public List<int> NonPlayingMembers { get; init; } = [];

    public List<double?> PlayingTarget { get; init; } = [];
}

public sealed class TeeTimeRow
{
    public string Time { get; init; } = string.Empty;
    public List<double> Values { get; init; } = [];
}

public sealed class RetentionMetrics
{
    public List<string> Years { get; init; } = [];
    public List<double> Total { get; init; } = [];
    public List<double> Male { get; init; } = [];
    public List<double> Female { get; init; } = [];
}

public sealed class GaugeMetric
{
    public string Title { get; init; } = string.Empty;
    public double Value { get; init; }
    public double Minimum { get; init; }
    public double Maximum { get; init; } = 100;
    public string Prefix { get; init; } = string.Empty;
    public string Suffix { get; init; } = string.Empty;
    public int DecimalPlaces { get; init; }
    public List<double> Bands { get; init; } = [30, 25, 45];
    public decimal? Actual { get; init; }
    public decimal? Budget { get; init; }
    public decimal? Variance { get; init; }
    public string PerformanceText { get; init; } = string.Empty;
    public string Tone { get; init; } = "neutral";
}

public sealed class MembershipMovement
{
    public string Since { get; init; } = string.Empty;
    public List<MovementItem> Departures { get; init; } = [];
    public List<MovementItem> Changes { get; init; } = [];
    public string PromotionSummary { get; init; } = string.Empty;
    public string PromotionOutcome { get; init; } = string.Empty;
}

public sealed class MovementItem
{
    public double Value { get; init; }
    public string Label { get; init; } = string.Empty;
    public string Tone { get; init; } = "neutral";
}

public sealed class FeedbackPanel
{
    public string Heading { get; init; } = string.Empty;
    public string Text { get; init; } = string.Empty;
    public string EmailAddress { get; init; } = string.Empty;
    public string QrCodeImage { get; init; } = string.Empty;
}