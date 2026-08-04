namespace Botgc.KpiReport.Models;

public sealed class MembershipReportResponse
{
    public List<MembershipReportDataPoint> DataPoints { get; set; } = [];

    public DateTimeOffset GeneratedAt { get; set; }

    public MembershipFinancialYearToDateStatsResponse? FinancialYearToDateStats { get; set; }
}

public sealed class MembershipReportDataPoint
{
    public DateTimeOffset Date { get; set; }

    public int PlayingMembers { get; set; }

    public int NonPlayingMembers { get; set; }

    public double TargetPlayingMembers { get; set; }

    public Dictionary<string, int> PlayingCategoryBreakdown { get; set; } = [];

    public Dictionary<string, int> NonPlayingCategoryBreakdown { get; set; } = [];

    public Dictionary<string, int> CategoryGroupBreakdown { get; set; } = [];
}

public sealed class MembershipFinancialYearToDateStatsResponse
{
    public DateTimeOffset FromDate { get; set; }

    public DateTimeOffset ToDate { get; set; }

    public string PeriodDescription { get; set; } =
        string.Empty;

    public int PlayingNewJoiners { get; set; }

    public int PlayingMovedIn { get; set; }

    public int PlayingMovedOut { get; set; }

    public int PlayingLeavers { get; set; }

    public int PlayingDeaths { get; set; }

    public decimal PlayingGrowthPercentage { get; set; }

    public int OpeningPlayingMembers { get; set; }

    public int ClosingPlayingMembers { get; set; }

    public int NonPlayingNewJoiners { get; set; }

    public int NonPlayingMovedIn { get; set; }

    public int NonPlayingMovedOut { get; set; }

    public int NonPlayingLeavers { get; set; }

    public int NonPlayingDeaths { get; set; }

    public decimal NonPlayingGrowthPercentage { get; set; }

    public int OpeningNonPlayingMembers { get; set; }

    public int ClosingNonPlayingMembers { get; set; }
}