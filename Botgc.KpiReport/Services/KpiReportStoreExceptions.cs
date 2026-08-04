namespace Botgc.KpiReport.Services;

public sealed class KpiReportNotFoundException(Guid reportId)
    : Exception($"The KPI report '{reportId}' was not found.")
{
    public Guid ReportId { get; } = reportId;
}

public sealed class KpiReportConcurrencyException(
    Guid reportId,
    int expectedVersion,
    int actualVersion)
    : Exception(
        $"The KPI report '{reportId}' has changed. " +
        $"Expected version {expectedVersion}, but found version {actualVersion}.")
{
    public Guid ReportId { get; } = reportId;
    public int ExpectedVersion { get; } = expectedVersion;
    public int ActualVersion { get; } = actualVersion;
}

public sealed class KpiReportValidationException(string message)
    : Exception(message)
{
}
