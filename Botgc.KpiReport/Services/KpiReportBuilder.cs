using System.Globalization;
using Botgc.KpiReport.Models;

namespace Botgc.KpiReport.Services;

public sealed class KpiReportBuilder : IKpiReportBuilder
{
    private static readonly CultureInfo BritishCulture =
        CultureInfo.GetCultureInfo("en-GB");

    public KpiReportDocument Build(KpiReportData source)
    {
        ArgumentNullException.ThrowIfNull(source);

        var financialYearMonths = GetFinancialYearMonths(
            source.FinancialYearStart);

        var completedMonths = GetContiguousCompletedMonths(
            source,
            financialYearMonths);

        return new KpiReportDocument
        {
            Header = new ReportHeader
            {
                Title = source.Title,
                Period = FormatPeriod(
                    source.ReportingPeriodStart,
                    source.ReportingPeriodEnd),
                Summary = source.Presentation.Summary
            },
            NetProfit = BuildProfitChart(
                source,
                financialYearMonths,
                completedMonths),
            FinancialPositionAsAt = FormatFinancialPositionAsAt(
                completedMonths),
            FinancialSummary = BuildFinancialSummary(
                source,
                completedMonths),
            FinancialCommentary =
                source.Presentation.FinancialCommentary,
            MembershipNarrative =
                source.Presentation.MembershipNarrative,
            Outgoings = BuildOutgoings(
                source.SupportingFinancials,
                source.Presentation.Outgoings),
            Membership = BuildMembership(source.MembershipSnapshot),
            MembershipTrend = BuildMembershipTrend(
                source.MembershipSnapshot,
                source.FinancialYearStart,
                source.FinancialYearEnd,
                source.FiguresCorrectAsAt),
            TeeTimeUtilisation =
                source.Presentation.TeeTimeUtilisation,
            MemberRetention =
                source.Presentation.MemberRetention,
            Gauges = BuildFinancialGauges(
                source.SupportingFinancials,
                source.Presentation.Gauges),
            Movement = source.Presentation.Movement,
            Feedback = source.Presentation.Feedback,
            FiguresCorrectAsAt = source.FiguresCorrectAsAt.ToString(
                "d MMMM yyyy",
                BritishCulture), 
            MembershipMovement = BuildMembershipMovement(
                source.MembershipSnapshot?.Movement),
        };
    }

    private static MembershipMovementMetrics
        BuildMembershipMovement(
            MembershipMovementSnapshotData? movement)
    {
        if (movement is null)
        {
            return new MembershipMovementMetrics();
        }

        return new MembershipMovementMetrics
        {
            Period =
                $"{movement.FromDate.ToString(
                    "d MMMM yyyy",
                    BritishCulture)} to " +
                $"{movement.ToDate.ToString(
                    "d MMMM yyyy",
                    BritishCulture)}",

            Playing = new MembershipMovementColumnMetrics
            {
                NewJoiners =
                    movement.PlayingNewJoiners,

                MovedIn =
                    movement.PlayingMovedIn,

                MovedOut =
                    movement.PlayingMovedOut,

                Leavers =
                    movement.PlayingLeavers,

                Deaths =
                    movement.PlayingDeaths,

                NetMovement =
                    movement.PlayingNetMovement,

                GrowthPercentage =
                    movement.PlayingGrowthPercentage
            },

            NonPlaying = new MembershipMovementColumnMetrics
            {
                NewJoiners =
                    movement.NonPlayingNewJoiners,

                MovedIn =
                    movement.NonPlayingMovedIn,

                MovedOut =
                    movement.NonPlayingMovedOut,

                Leavers =
                    movement.NonPlayingLeavers,

                Deaths =
                    movement.NonPlayingDeaths,

                NetMovement =
                    movement.NonPlayingNetMovement,

                GrowthPercentage =
                    movement.NonPlayingGrowthPercentage
            }
        };
    }

    private static ProfitChart BuildProfitChart(
        KpiReportData source,
        IReadOnlyList<DateOnly> financialYearMonths,
        IReadOnlyList<DateOnly> completedMonths)
    {
        var labels = new List<string>
        {
            "SOY"
        };

        labels.AddRange(
            financialYearMonths.Select(month =>
                month.ToString("MMM", BritishCulture)));

        var target = new List<double>
        {
            0
        };

        var actual = new List<double?>
        {
            0
        };

        for (var index = 0;
             index < financialYearMonths.Count;
             index++)
        {
            var includedMonths = financialYearMonths
                .Take(index + 1)
                .ToList();

            var targetValue = CalculateNetProfit(
                source.FinancialLines,
                includedMonths,
                useActual: false);

            if (!targetValue.HasValue)
            {
                throw new InvalidDataException(
                    $"Budget data is missing for " +
                    $"{financialYearMonths[index]:MMMM yyyy}.");
            }

            target.Add((double)targetValue.Value);

            if (index < completedMonths.Count)
            {
                var actualValue = CalculateNetProfit(
                    source.FinancialLines,
                    includedMonths,
                    useActual: true);

                if (!actualValue.HasValue)
                {
                    throw new InvalidDataException(
                        $"Actual data is incomplete for " +
                        $"{financialYearMonths[index]:MMMM yyyy}.");
                }

                actual.Add((double)actualValue.Value);
            }
            else
            {
                actual.Add(null);
            }
        }

        var forecast = BuildForecastProjection(
            source.YearEndForecastNetProfitBeforeTaxation,
            target,
            actual,
            completedMonths.Count);

        return new ProfitChart
        {
            Labels = labels,
            Target = target,
            Actual = actual,
            Forecast = forecast
        };
    }

    private static List<double?> BuildForecastProjection(
        decimal? yearEndForecast,
        IReadOnlyList<double> target,
        IReadOnlyList<double?> actual,
        int completedMonthCount)
    {
        var forecast = Enumerable
            .Repeat<double?>(null, target.Count)
            .ToList();

        if (!yearEndForecast.HasValue ||
            completedMonthCount == 0 ||
            completedMonthCount >= target.Count - 1)
        {
            return forecast;
        }

        var latestActualIndex = completedMonthCount;
        var latestActual = actual[latestActualIndex];

        if (!latestActual.HasValue)
        {
            return forecast;
        }

        var budgetAtLatestActual = target[latestActualIndex];
        var budgetAtYearEnd = target[^1];

        var remainingBudgetMovement =
            budgetAtYearEnd - budgetAtLatestActual;

        var requiredForecastMovement =
            (double)yearEndForecast.Value - latestActual.Value;

        var remainingPointCount =
            target.Count - 1 - latestActualIndex;

        forecast[latestActualIndex] = latestActual.Value;

        for (var index = latestActualIndex + 1;
            index < target.Count;
            index++)
        {
            var progress = Math.Abs(remainingBudgetMovement) > 0.000001
                ? (target[index] - budgetAtLatestActual) /
                remainingBudgetMovement
                : (double)(index - latestActualIndex) /
                remainingPointCount;

            forecast[index] = latestActual.Value +
                            requiredForecastMovement * progress;
        }

        forecast[^1] = (double)yearEndForecast.Value;

        return forecast;
    }

    private static List<FinancialRow> BuildFinancialSummary(
        KpiReportData source,
        IReadOnlyList<DateOnly> completedMonths)
    {
        var rows = source.FinancialLines
            .OrderBy(line => line.DisplayOrder)
            .Select(line => BuildFinancialRow(
                line,
                completedMonths))
            .ToList();

        decimal? totalBudget = null;
        decimal? totalActual = null;
        decimal? totalVariance = null;
        decimal? totalPercentageVariance = null;

        if (completedMonths.Count > 0)
        {
            totalBudget = rows.Sum(row =>
                row.Budget ?? 0);

            totalActual = rows.Sum(row =>
                row.Actual ?? 0);

            totalVariance =
                totalActual.Value - totalBudget.Value;

            if (totalBudget.Value != 0)
            {
                totalPercentageVariance =
                    totalVariance.Value /
                    totalBudget.Value *
                    100;
            }
        }

        rows.Add(new FinancialRow
        {
            Label = "Net Profit Before Taxation",
            Actual = totalActual,
            Budget = totalBudget,
            Variance = totalVariance,
            PercentageVariance =
                totalPercentageVariance,
            IsTotal = true
        });

        return rows;
    }

    private static MembershipTrendMetrics BuildMembershipTrend(
        MembershipSnapshotData? snapshot,
        DateOnly financialYearStart,
        DateOnly financialYearEnd,
        DateOnly figuresCorrectAsAt)
    {
        if (snapshot is null || snapshot.Trend.Count == 0)
        {
            return new MembershipTrendMetrics();
        }

        var orderedPoints = snapshot.Trend
            .OrderBy(point => point.Date)
            .ToList();

        return new MembershipTrendMetrics
        {
            Period =
                $"{financialYearStart.ToString("d MMMM yyyy", BritishCulture)} to " +
                $"{figuresCorrectAsAt.ToString("d MMMM yyyy", BritishCulture)}",

            FinancialYearLabel =
                $"{financialYearStart:yyyy}/{financialYearEnd:yy}",

            FinancialYearStart =
                financialYearStart.ToString("yyyy-MM-dd", BritishCulture),

            FinancialYearEnd =
                financialYearEnd.ToString("yyyy-MM-dd", BritishCulture),

            FiguresCorrectAsAt =
                figuresCorrectAsAt.ToString("yyyy-MM-dd", BritishCulture),

            Dates = orderedPoints
                .Select(point => point.Date.ToString("yyyy-MM-dd", BritishCulture))
                .ToList(),

            PlayingMembers = orderedPoints
                .Select(point => point.PlayingMembers)
                .ToList(),

            NonPlayingMembers = orderedPoints
                .Select(point => point.NonPlayingMembers)
                .ToList(),

            PlayingTarget = orderedPoints
                .Select(point => point.TargetPlayingMembers)
                .ToList()
        };
    }

    private static FinancialRow BuildFinancialRow(
        KpiFinancialLineData line,
        IReadOnlyList<DateOnly> completedMonths)
    {
        if (completedMonths.Count == 0)
        {
            return new FinancialRow
            {
                Label = line.Label,
                Actual = null,
                Budget = null,
                Variance = null,
                PercentageVariance = null,
                IsTotal = false
            };
        }

        var values = completedMonths
            .Select(month =>
                line.Months.SingleOrDefault(value =>
                    value.Year == month.Year &&
                    value.Month == month.Month)
                ?? throw new InvalidDataException(
                    $"Financial line '{line.Label}' does not contain " +
                    $"{month:MMMM yyyy}."))
            .ToList();

        var sign = line.Type ==
                   KpiFinancialLineType.Expense
            ? -1m
            : 1m;

        var budget = values.Sum(value =>
            value.Budget) * sign;

        var actual = values.Sum(value =>
            value.Actual!.Value) * sign;

        var variance = actual - budget;

        decimal? percentageVariance = budget != 0
            ? variance / budget * 100
            : null;

        return new FinancialRow
        {
            Label = line.Label,
            Actual = actual,
            Budget = budget,
            Variance = variance,
            PercentageVariance =
                percentageVariance,
            IsTotal = false
        };
    }

    private static decimal? CalculateNetProfit(
        IReadOnlyList<KpiFinancialLineData> lines,
        IReadOnlyCollection<DateOnly> months,
        bool useActual)
    {
        decimal total = 0;

        foreach (var line in lines)
        {
            var sign = line.Type ==
                       KpiFinancialLineType.Expense
                ? -1m
                : 1m;

            foreach (var monthDate in months)
            {
                var value = line.Months.SingleOrDefault(
                    month =>
                        month.Year == monthDate.Year &&
                        month.Month == monthDate.Month);

                if (value is null)
                {
                    return null;
                }

                if (useActual)
                {
                    if (!value.Actual.HasValue)
                    {
                        return null;
                    }

                    total += value.Actual.Value * sign;
                }
                else
                {
                    total += value.Budget * sign;
                }
            }
        }

        return total;
    }

    private static List<DateOnly> GetFinancialYearMonths(
        DateOnly financialYearStart)
    {
        return Enumerable
            .Range(0, 12)
            .Select(offset =>
                financialYearStart.AddMonths(offset))
            .ToList();
    }

    private static List<DateOnly> GetContiguousCompletedMonths(
        KpiReportData source,
        IReadOnlyList<DateOnly> financialYearMonths)
    {
        var completedMonths = new List<DateOnly>();

        foreach (var month in financialYearMonths)
        {
            var monthIsComplete =
                source.FinancialLines.Count > 0 &&
                source.FinancialLines.All(line =>
                    line.Months.SingleOrDefault(value =>
                        value.Year == month.Year &&
                        value.Month == month.Month)
                    ?.Actual.HasValue == true);

            if (!monthIsComplete)
            {
                break;
            }

            completedMonths.Add(month);
        }

        return completedMonths;
    }

    private static MembershipMetrics BuildMembership(
        MembershipSnapshotData? snapshot)
    {
        if (snapshot is null)
        {
            return new MembershipMetrics
            {
                Description =
                    "Membership data has not yet been imported."
            };
        }

        var playingMemberTypes = new List<NamedValue>
        {
            new()
            {
                Label = "7 Day",
                Value = GetMembershipGroupValue(
                    snapshot,
                    "7 Day Membership")
            },
            new()
            {
                Label = "5 Day",
                Value = GetMembershipGroupValue(
                    snapshot,
                    "5 Day Membership")
            },
            new()
            {
                Label = "Intermediate",
                Value = GetMembershipGroupValue(
                    snapshot,
                    "Intermediate Membership")
            },
            new()
            {
                Label = "6 Day",
                Value = GetMembershipGroupValue(
                    snapshot,
                    "6 Day Membership")
            }
        }
        .Where(item => item.Value > 0)
        .ToList();

        var allMemberTypes = new List<NamedValue>
        {
            new()
            {
                Label = "Playing",
                Value = snapshot.PlayingMembers
            },
            new()
            {
                Label = "Social",
                Value = GetMembershipGroupValue(
                    snapshot,
                    "Social Membership")
            },
            new()
            {
                Label = "Clubhouse",
                Value = GetMembershipGroupValue(
                    snapshot,
                    "Clubhouse Only")
            },
            new()
            {
                Label = "Junior",
                Value = GetMembershipGroupValue(
                    snapshot,
                    "Junior Membership")
            },
            new()
            {
                Label = "Flexi",
                Value = GetMembershipGroupValue(
                    snapshot,
                    "Off Peak Membership (Flexi)")
            },
            new()
            {
                Label = "Other",
                Value = GetMembershipGroupValue(
                    snapshot,
                    "Other")
            }
        }
        .Where(item => item.Value > 0)
        .ToList();

        return new MembershipMetrics
        {
            Description =
                "Current playing and non-playing membership " +
                "by membership group.",

            PlayingMemberTypes = playingMemberTypes,
            AllMemberTypes = allMemberTypes
        };
    }

    private static double GetMembershipGroupValue(
        MembershipSnapshotData snapshot,
        string groupName)
    {
        return snapshot.CategoryGroupBreakdown.TryGetValue(
            groupName,
            out var value)
            ? value
            : 0;
    }

    private static string FormatFinancialPositionAsAt(
        IReadOnlyList<DateOnly> completedMonths)
    {
        if (completedMonths.Count == 0)
        {
            return "No completed actual period";
        }

        var latestCompletedMonth =
            completedMonths[^1];

        var monthEnd =
            latestCompletedMonth
                .AddMonths(1)
                .AddDays(-1);

        return
            $"Year-to-date position as at " +
            $"{monthEnd.ToString("d MMMM yyyy", BritishCulture)}";
    }

    private static string FormatPeriod(
        DateOnly start,
        DateOnly end)
    {
        return
            $"{start.ToString("d MMMM yyyy", BritishCulture)} to " +
            end.ToString("d MMMM yyyy", BritishCulture);
    }

    private static OutgoingsMetric BuildOutgoings(
        SupportingFinancialData? supporting,
        DonutMetric legacy)
    {
        var subscriptionIncome =
            supporting?
                .MembershipSubscriptionFees?
                .Actual;

        var outgoings = supporting?.Outgoings;

        if (!subscriptionIncome.HasValue ||
            outgoings is null ||
            !outgoings.AdministrativeExpenditure.HasValue ||
            !outgoings.CourseExpenditure.HasValue ||
            !outgoings.CompetitionExpenditure.HasValue ||
            !outgoings.BuggyExpenditure.HasValue)
        {
            return new OutgoingsMetric
            {
                Title = legacy.Title,
                Description = legacy.Description,
                Items = legacy.Items,
                IsCalculated = false
            };
        }

        var totalOutgoings =
            outgoings.AdministrativeExpenditure.Value +
            outgoings.CourseExpenditure.Value +
            outgoings.CompetitionExpenditure.Value +
            outgoings.BuggyExpenditure.Value;

        if (totalOutgoings <= 0)
        {
            return new OutgoingsMetric
            {
                Title = legacy.Title,
                Description = legacy.Description,
                Items = legacy.Items,
                IsCalculated = false
            };
        }

        var coveragePercentage =
            subscriptionIncome.Value /
            totalOutgoings *
            100m;

        var otherIncomeRequired =
            Math.Max(
                totalOutgoings -
                subscriptionIncome.Value,
                0m);

        var fundingGapPercentage =
            totalOutgoings <= 0
                ? 0m
                : otherIncomeRequired /
                totalOutgoings *
                100m;

        var description =
            otherIncomeRequired > 0
                ? $"Membership subscriptions cover " +
                $"{coveragePercentage:0.0}% of relevant " +
                $"outgoings, leaving a funding gap of " +
                $"{otherIncomeRequired.ToString(
                    "C0",
                    BritishCulture)} " +
                $"({fundingGapPercentage:0.0}%)."
                : "Membership subscriptions currently cover " +
                "all relevant outgoings.";

        return new OutgoingsMetric
        {
            Title =
                "Outgoings vs subscription income",

            Description = description,

            SubscriptionIncome =
                subscriptionIncome.Value,

            TotalOutgoings =
                totalOutgoings,

            OtherIncomeRequired =
                otherIncomeRequired,

            CoveragePercentage =
                (double)coveragePercentage,

            IsCalculated = true,

            Items =
            [
                new NamedValue
                {
                    Label = "Administrative costs",
                    Value = (double)
                        outgoings
                            .AdministrativeExpenditure
                            .Value
                },
                new NamedValue
                {
                    Label = "Course expenditure",
                    Value = (double)
                        outgoings
                            .CourseExpenditure
                            .Value
                },
                new NamedValue
                {
                    Label = "Competition expenditure",
                    Value = (double)
                        outgoings
                            .CompetitionExpenditure
                            .Value
                },
                new NamedValue
                {
                    Label = "Buggy expenditure",
                    Value = (double)
                        outgoings
                            .BuggyExpenditure
                            .Value
                }
            ]
        };
    }

    private static List<GaugeMetric> BuildFinancialGauges(
        SupportingFinancialData? supporting,
        IReadOnlyCollection<GaugeMetric> legacy)
    {
        if (supporting is null)
        {
            return legacy.ToList();
        }

        var gauges = new List<GaugeMetric>();

        AddFinancialGauge(
            gauges,
            "Visitor Green Fees",
            supporting.VisitorGreenFees);

        AddFinancialGauge(
            gauges,
            "Food & Beverage Contribution",
            supporting.FoodAndBeverageContribution);

        AddFinancialGauge(
            gauges,
            "Visitor Bar & Catering",
            supporting.VisitorBarAndCatering);

        AddFinancialGauge(
            gauges,
            "Member Bar & Catering",
            supporting.MemberBarAndCatering);

        AddFinancialGauge(
            gauges,
            "Membership Subscription Fees",
            supporting.MembershipSubscriptionFees);

        return gauges.Count > 0
            ? gauges
            : legacy.ToList();
    }

    private static void AddFinancialGauge(
        ICollection<GaugeMetric> gauges,
        string title,
        ActualBudgetFinancialValue? value)
    {
        if (value is null ||
            !value.Actual.HasValue ||
            !value.Budget.HasValue)
        {
            return;
        }

        var actual = value.Actual.Value;
        var budget = value.Budget.Value;
        var variance = actual - budget;

        double performanceScore;

        if (budget > 0)
        {
            // Ordinary income measure:
            // achieving the budget equals 100%.
            performanceScore =
                (double)(
                    actual /
                    budget *
                    100m);
        }
        else if (budget < 0)
        {
            if (actual >= 0)
            {
                // A budgeted loss has become break-even
                // or a profit.
                performanceScore = 150;
            }
            else
            {
                // For a budgeted loss, a smaller actual
                // loss produces a higher score.
                performanceScore =
                    (double)(
                        Math.Abs(budget) /
                        Math.Abs(actual) *
                        100m);
            }
        }
        else
        {
            performanceScore =
                actual >= 0
                    ? 150
                    : 0;
        }

        performanceScore =
            Math.Clamp(
                performanceScore,
                0,
                150);

        performanceScore = Math.Clamp(
            performanceScore,
            0,
            150);

        var performanceText =
            $"{performanceScore:0.0}%";

        var tone =
            performanceScore > 100
                ? "positive"
                : performanceScore < 100
                    ? "negative"
                    : "neutral";

        gauges.Add(
            new GaugeMetric
            {
                Title = title,

                Value = performanceScore,

                Minimum = 0,

                Maximum = 150,

                Prefix = string.Empty,

                Suffix = "%",

                DecimalPlaces = 1,

                Bands = [75, 25, 50],

                Actual = actual,

                Budget = budget,

                Variance = variance,

                PerformanceText =
                    performanceText,

                Tone = tone
            });
    }
}