namespace BOTGC.EventPlaybook.Models;

public sealed class PluginSettingsOverview
{
    public required IntelligentGolfPluginSummary IntelligentGolf { get; init; }
    public required MondayPluginSummary Monday { get; init; }
}

public sealed class IntelligentGolfPluginSummary
{
    public string Id { get; init; } = "intelligent-golf";
    public string Name { get; init; } = "Intelligent Golf";
    public bool Enabled { get; init; }
    public bool Configured { get; init; }
    public string? SiteUrl { get; init; }
    public bool HasPin { get; init; }
    public bool HasPassword { get; init; }
    public bool HasAdminPassword { get; init; }
    public DateTimeOffset? UpdatedAtUtc { get; init; }
}

public sealed class MondayPluginSummary
{
    public string Id { get; init; } = "monday";
    public string Name { get; init; } = "Monday.com";
    public bool Enabled { get; init; }
    public bool Configured { get; init; }
    public string? WorkspaceId { get; init; }
    public string? BoardId { get; init; }
    public bool HasApiToken { get; init; }
    public DateTimeOffset? UpdatedAtUtc { get; init; }
}

public sealed class SaveIntelligentGolfPluginRequest
{
    public bool Enabled { get; init; }
    public string? SiteUrl { get; init; }
    public string? Pin { get; init; }
    public string? Password { get; init; }
    public string? AdminPassword { get; init; }
}

public sealed class SaveMondayPluginRequest
{
    public bool Enabled { get; init; }
    public string? ApiToken { get; init; }
    public string? WorkspaceId { get; init; }
    public string? BoardId { get; init; }
}
