namespace BOTGC.EventPlaybook.Models;

public sealed class ClubBrandingOverview
{
    public required string ClubName { get; init; }

    public required string CrestUrl { get; init; }

    public bool HasCustomCrest { get; init; }

    public DateTimeOffset? UpdatedAtUtc { get; init; }
}

public sealed class ClubCrestAsset
{
    public required byte[] Content { get; init; }

    public required string ContentType { get; init; }
}
