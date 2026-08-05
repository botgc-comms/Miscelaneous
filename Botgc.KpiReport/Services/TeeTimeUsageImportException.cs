namespace Botgc.KpiReport.Services;

public sealed class TeeTimeUsageImportException : Exception
{
    public TeeTimeUsageImportException(string message)
        : base(message)
    {
    }

    public TeeTimeUsageImportException(
        string message,
        Exception innerException)
        : base(message, innerException)
    {
    }
}
