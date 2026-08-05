using Botgc.KpiReport.Models;

namespace Botgc.KpiReport.Services;

public interface ITeeTimeUsageClient
{
    Task<List<TeeTimeUsageRowData>> GetAsync(
        DateOnly startDate,
        DateOnly endDate,
        CancellationToken cancellationToken = default);
}