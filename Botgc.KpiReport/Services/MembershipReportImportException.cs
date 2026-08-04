namespace Botgc.KpiReport.Services;

public sealed class MembershipReportImportException : Exception
{
    public MembershipReportImportException(string message)
        : base(message)
    {
    }

    public MembershipReportImportException(
        string message,
        Exception innerException)
        : base(message, innerException)
    {
    }
}