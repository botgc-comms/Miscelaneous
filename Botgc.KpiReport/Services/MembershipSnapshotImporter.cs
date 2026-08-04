using Botgc.KpiReport.Models;

namespace Botgc.KpiReport.Services;

public sealed class MembershipSnapshotImporter(
    IMembershipReportClient membershipReportClient)
    : IMembershipSnapshotImporter
{
    private readonly IMembershipReportClient _membershipReportClient =
        membershipReportClient
        ?? throw new ArgumentNullException(
            nameof(membershipReportClient));

    public async Task<MembershipSnapshotData> ImportAsync(
        KpiReportData report,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(report);

        var source = await _membershipReportClient.GetAsync(
            report.FinancialYearStart,
            cancellationToken);

        var extendedPeriodStart =
            report.FinancialYearStart.AddMonths(-6);

        var extendedPeriodEnd =
            report.FinancialYearEnd.AddMonths(6);

        var pointsByDate = source.DataPoints
            .Select(point => new
            {
                Date = DateOnly.FromDateTime(
                    point.Date.UtcDateTime),
                Point = point
            })
            .Where(value =>
                value.Date >= extendedPeriodStart &&
                value.Date <= extendedPeriodEnd)
            .GroupBy(value => value.Date)
            .ToDictionary(
                group => group.Key,
                group => group
                    .OrderBy(value => value.Point.Date)
                    .Last()
                    .Point);

        if (!pointsByDate.TryGetValue(
                report.FiguresCorrectAsAt,
                out var currentPoint))
        {
            throw new MembershipReportImportException(
                $"The membership report did not contain data for " +
                $"{report.FiguresCorrectAsAt:dd MMMM yyyy}.");
        }

        var orderedTrend = pointsByDate
            .OrderBy(item => item.Key)
            .Select(item => new MembershipTrendPointData
            {
                Date = item.Key,
                PlayingMembers =
                    item.Value.PlayingMembers,
                NonPlayingMembers =
                    item.Value.NonPlayingMembers,
                TargetPlayingMembers =
                    item.Value.TargetPlayingMembers
            })
            .ToList();

        var movementSource =
            source.FinancialYearToDateStats
            ?? throw new MembershipReportImportException(
                "The membership report did not contain " +
                "financial-year-to-date membership statistics.");
                
        return new MembershipSnapshotData
        {
            PeriodStart =
                extendedPeriodStart,

            DataAsAt =
                report.FiguresCorrectAsAt,

            ImportedAtUtc =
                DateTimeOffset.UtcNow,

            SourceGeneratedAtUtc =
                source.GeneratedAt,

            PlayingMembers =
                currentPoint.PlayingMembers,

            NonPlayingMembers =
                currentPoint.NonPlayingMembers,

            TotalMembers =
                currentPoint.PlayingMembers +
                currentPoint.NonPlayingMembers,

            PlayingCategoryBreakdown =
                CloneDictionary(
                    currentPoint.PlayingCategoryBreakdown),

            NonPlayingCategoryBreakdown =
                CloneDictionary(
                    currentPoint.NonPlayingCategoryBreakdown),

            CategoryGroupBreakdown =
                CloneDictionary(
                    currentPoint.CategoryGroupBreakdown),

            Trend = orderedTrend, 

            Movement = new MembershipMovementSnapshotData
            {
                FromDate = DateOnly.FromDateTime(
                    movementSource.FromDate.UtcDateTime),

                ToDate = DateOnly.FromDateTime(
                    movementSource.ToDate.UtcDateTime),

                PlayingNewJoiners =
                    movementSource.PlayingNewJoiners,

                PlayingMovedIn =
                    movementSource.PlayingMovedIn,

                PlayingMovedOut =
                    movementSource.PlayingMovedOut,

                PlayingLeavers =
                    movementSource.PlayingLeavers,

                PlayingDeaths =
                    movementSource.PlayingDeaths,

                PlayingNetMovement =
                    movementSource.ClosingPlayingMembers -
                    movementSource.OpeningPlayingMembers,

                PlayingGrowthPercentage =
                    movementSource.PlayingGrowthPercentage,

                NonPlayingNewJoiners =
                    movementSource.NonPlayingNewJoiners,

                NonPlayingMovedIn =
                    movementSource.NonPlayingMovedIn,

                NonPlayingMovedOut =
                    movementSource.NonPlayingMovedOut,

                NonPlayingLeavers =
                    movementSource.NonPlayingLeavers,

                NonPlayingDeaths =
                    movementSource.NonPlayingDeaths,

                NonPlayingNetMovement =
                    movementSource.ClosingNonPlayingMembers -
                    movementSource.OpeningNonPlayingMembers,

                NonPlayingGrowthPercentage =
                    movementSource.NonPlayingGrowthPercentage
            }
        };
    }

    private static Dictionary<string, int> CloneDictionary(
        IReadOnlyDictionary<string, int>? source)
    {
        if (source is null)
        {
            return [];
        }

        return source.ToDictionary(
            item => item.Key,
            item => item.Value,
            StringComparer.OrdinalIgnoreCase);
    }
}