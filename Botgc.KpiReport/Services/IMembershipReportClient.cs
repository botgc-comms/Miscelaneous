using Botgc.KpiReport.Models;

namespace Botgc.KpiReport.Services;

public interface IMembershipReportClient
{
    Task<MembershipReportResponse> GetAsync(
        DateOnly windowStart,
        CancellationToken cancellationToken = default);
}