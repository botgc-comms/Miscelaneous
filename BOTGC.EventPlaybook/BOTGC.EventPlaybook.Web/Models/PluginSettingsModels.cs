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
    public bool HasMemberId { get; init; }
    public bool HasMemberPassword { get; init; }
    public bool HasAdminPassword { get; init; }
    public bool EmailConfigured { get; init; }
    public int? EmailSenderMemberNumber { get; init; }
    public string? EmailFromName { get; init; }
    public string? EmailFromAddress { get; init; }
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
    public string? MemberId { get; init; }
    public string? MemberPassword { get; init; }
    // Kept as input aliases so existing saved administration pages remain compatible.
    public string? Pin { get; init; }
    public string? Password { get; init; }
    public string? AdminPassword { get; init; }
    public string? EmailSenderMemberNumber { get; init; }
    public string? EmailFromName { get; init; }
    public string? EmailFromAddress { get; init; }

    public string? EffectiveMemberId => MemberId ?? Pin;
    public string? EffectiveMemberPassword => MemberPassword ?? Password;
}

public sealed record IntelligentGolfPluginCredentials(
    string SiteUrl,
    string MemberId,
    string MemberPassword,
    string AdminPassword,
    int? EmailSenderMemberNumber,
    string? EmailFromName,
    string? EmailFromAddress);

public sealed class SaveMondayPluginRequest
{
    public bool Enabled { get; init; }
    public string? ApiToken { get; init; }
    public string? WorkspaceId { get; init; }
    public string? BoardId { get; init; }
}

public sealed class SetPluginEnabledRequest
{
    public bool Enabled { get; init; }
}
