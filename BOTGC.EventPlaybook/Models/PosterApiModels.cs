namespace BOTGC.EventPlaybook.Models;

public sealed class GeneratePosterRequest
{
    public required string EventId { get; init; }

    public string? EventName { get; init; }

    public required string StyleId { get; init; }

    public string? StyleVariationId { get; init; }

    public required string EventDate { get; init; }

    public required string Description { get; init; }

    public bool IncludeDate { get; init; }

    public bool IncludePrice { get; init; }

    public bool IncludeClubBranding { get; init; }

    public string? Price { get; init; }

    public string? AdditionalInstructions { get; init; }

    public string? RefinementNotes { get; init; }

    public string? PreviousArtworkDataUrl { get; init; }

    public List<SupportingImageReference> SupportingImages { get; init; } = [];
}

public sealed class GenerateVariantRequest
{
    public required string EventId { get; init; }

    public string? EventName { get; init; }

    public required string StyleId { get; init; }

    public string? StyleVariationId { get; init; }

    public required string OutputId { get; init; }

    public required string EventDate { get; init; }

    public required string Description { get; init; }

    public required string PrimaryArtworkDataUrl { get; init; }

    public bool IncludeDate { get; init; }

    public bool IncludePrice { get; init; }

    public bool IncludeClubBranding { get; init; }

    public string? Price { get; init; }

    public string? AdditionalInstructions { get; init; }

    public string? RefinementNotes { get; init; }

    public List<SupportingImageReference> SupportingImages { get; init; } = [];
}

public sealed class GeneratedArtworkResponse
{
    public required string DataUrl { get; init; }

    public required string Mode { get; init; }

    public required string Model { get; init; }

    public required string PromptModel { get; init; }

    public required string PromptUsed { get; init; }
}

public sealed class ImagePromptResult
{
    public required string Prompt { get; init; }

    public required string Model { get; init; }
}

public sealed class PublishRequest
{
    public required string EventId { get; init; }

    public required string EventName { get; init; }

    public required string EventDate { get; init; }

    public required string StartDate { get; init; }

    public required string MediaName { get; init; }

    public List<string> Tags { get; init; } = [];

    public required PublishAsset DigitalScreenAsset { get; init; }

    public bool SendToClubhouseScreens { get; init; } = true;
}

public sealed class PublishAsset
{
    public required string OutputId { get; init; }

    public required string Name { get; init; }

    public required string DataUrl { get; init; }
}

public sealed class YodeckPublishCommand
{
    public required string EventId { get; init; }

    public required string EventName { get; init; }

    public required DateOnly StartDate { get; init; }

    public required DateOnly EndDate { get; init; }

    public required string MediaName { get; init; }

    public required IReadOnlyList<string> Tags { get; init; }

    public required byte[] ImageBytes { get; init; }
}

public sealed class YodeckPublishResult
{
    public required long MediaId { get; init; }

    public required string MediaName { get; init; }

    public required long PlaylistId { get; init; }

    public required string PlaylistName { get; init; }

    public required DateOnly StartDate { get; init; }

    public required DateOnly EndDate { get; init; }

    public required IReadOnlyList<string> Tags { get; init; }

    public required bool MediaWasCreated { get; init; }

    public required bool PlaylistWasChanged { get; init; }

    public required int DuplicatePlaylistEntriesRemoved { get; init; }
}


public sealed class SupportingImageReference
{
    public required string FileName { get; init; }

    public required string DataUrl { get; init; }

    public string? Title { get; init; }

    public string? Description { get; init; }

    public string? Category { get; init; }

    public List<string> Tags { get; init; } = [];

    public string? Source { get; init; }
}
