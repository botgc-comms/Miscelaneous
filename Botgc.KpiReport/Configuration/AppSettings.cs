namespace Botgc.KpiReport.Configuration;

public sealed class AppSettings
{
    public ApiSettings API { get; set; } = new();
}

public sealed class ApiSettings
{
    public string Url { get; set; } = string.Empty;

    public string XApiKey { get; set; } = string.Empty;
}