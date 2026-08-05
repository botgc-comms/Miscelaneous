using Botgc.KpiReport.Models;

namespace Botgc.KpiReport.Services;

public sealed class TeeTimeSnapshotImporter(
    ITeeTimeUsageClient teeTimeUsageClient)
    : ITeeTimeSnapshotImporter
{
    private readonly ITeeTimeUsageClient _teeTimeUsageClient =
        teeTimeUsageClient ??
        throw new ArgumentNullException(
            nameof(teeTimeUsageClient));

    public async Task<TeeTimeSnapshotData> ImportAsync(
        DateOnly startDate,
        DateOnly endDate,
        CancellationToken cancellationToken = default)
    {
        if (startDate == default)
        {
            throw new TeeTimeUsageImportException(
                "A tee-time start date is required.");
        }

        if (endDate < startDate)
        {
            throw new TeeTimeUsageImportException(
                "The tee-time end date must not be " +
                "before the start date.");
        }

        var rows =
            await _teeTimeUsageClient.GetAsync(
                startDate,
                endDate,
                cancellationToken);

        if (!rows.Any(row => !row.IsTotal))
        {
            throw new TeeTimeUsageImportException(
                "The tee-time utilisation response " +
                "contained no hourly rows.");
        }

        if (rows.Count(row => row.IsTotal) != 1)
        {
            throw new TeeTimeUsageImportException(
                "The tee-time utilisation response must " +
                "contain exactly one total row.");
        }

        return new TeeTimeSnapshotData
        {
            StartDate = startDate,
            EndDate = endDate,
            ImportedAtUtc = DateTimeOffset.UtcNow,
            Rows = rows
        };
    }
}