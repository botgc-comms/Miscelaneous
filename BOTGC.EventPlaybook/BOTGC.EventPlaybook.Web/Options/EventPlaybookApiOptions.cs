namespace BOTGC.EventPlaybook.Options;

public sealed class EventPlaybookApiOptions
{
    public const string SectionName = "EventPlaybookApi";

    public string BaseUrl { get; init; } = string.Empty;
    public string ApiKey { get; init; } = string.Empty;
}
