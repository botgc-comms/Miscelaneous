namespace BOTGC.EventPlaybook.API.Options;

public sealed class CacheOptions
{
    public const string SectionName = "Cache";

    public string Provider { get; init; } = "Memory";
    public int DefaultTtlMinutes { get; init; } = 30;
    public int MemberTtlMinutes { get; init; } = 30;
    public int CompetitionTtlMinutes { get; init; } = 30;
    public int WorkspaceTtlMinutes { get; init; } = 5;
    public RedisOptions Redis { get; init; } = new();
}

public sealed class RedisOptions
{
    public string ConnectionString { get; init; } = string.Empty;
    public string InstanceName { get; init; } = "BOTGC.EventPlaybook";
}
