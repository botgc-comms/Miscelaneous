using Botgc.KpiReport.Models;

namespace Botgc.KpiReport.Services;

public interface IMembershipSnapshotImporter
{
    Task<MembershipSnapshotData> ImportAsync(
        KpiReportData report,
        CancellationToken cancellationToken = default);
}