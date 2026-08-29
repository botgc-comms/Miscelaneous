namespace BOTGC.EventPlaybook.API.Options;

public sealed class EventPlaybookApiOptions
{
    public const string SectionName = "EventPlaybookApi";

    public string ApiKey { get; init; } = string.Empty;
}
