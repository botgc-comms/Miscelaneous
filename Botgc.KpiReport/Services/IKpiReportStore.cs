using Botgc.KpiReport.Models;

namespace Botgc.KpiReport.Services;

public interface IKpiReportStore
{
    Task<IReadOnlyList<KpiReportSummary>> ListAsync(
        CancellationToken cancellationToken = default);

    Task<KpiReportData?> GetAsync(
        Guid reportId,
        CancellationToken cancellationToken = default);

    Task<KpiReportData?> GetLatestAsync(
        CancellationToken cancellationToken = default);

    Task<KpiReportData> CreateAsync(
        CreateKpiReportRequest request,
        CancellationToken cancellationToken = default);

    Task<KpiReportData> SaveAsync(
        KpiReportData report,
        CancellationToken cancellationToken = default);

    Task DeleteAsync(
        Guid reportId,
        int expectedVersion,
        CancellationToken cancellationToken = default);
}
