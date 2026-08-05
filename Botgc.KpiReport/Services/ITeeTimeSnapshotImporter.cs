using Botgc.KpiReport.Models;

namespace Botgc.KpiReport.Services;

public interface ITeeTimeSnapshotImporter
{
    Task<TeeTimeSnapshotData> ImportAsync(
        DateOnly startDate,
        DateOnly endDate,
        CancellationToken cancellationToken = default);
}