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

    public string? SelectedConceptDataUrl { get; init; }

    public bool IsConceptPreview { get; init; }

    public int SafetyRecoveryAttempt { get; init; }

    public bool SafetyFallbackStyle { get; init; }

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
    public string? LibraryId { get; init; }

    public required string FileName { get; init; }

    public required string DataUrl { get; init; }

    public string? Title { get; init; }

    public string? Description { get; init; }

    public string? Category { get; init; }

    public List<string> Tags { get; init; } = [];

    public string? Source { get; init; }

    public int? RelevanceConfidence { get; init; }

    public string? RelevanceReason { get; init; }

    public string? MatchingInstruction { get; init; }
}

public sealed class CompileReferenceProfileRequest
{
    public required string Title { get; init; }

    public required string Category { get; init; }

    public required string Description { get; init; }

    public List<string> Tags { get; init; } = [];
}

public sealed class ReferenceRelevanceProfile
{
    public int SchemaVersion { get; init; } = 1;

    public required string MatchingInstruction { get; init; }

    public List<string> PositiveSignals { get; init; } = [];

    public List<string> NamedEntities { get; init; } = [];

    public List<string> NegativeSignals { get; init; } = [];

    public required string Mode { get; init; }

    public required string Model { get; init; }

    public required string GeneratedAt { get; init; }
}

public sealed class SelectReferenceImagesRequest
{
    public required string EventName { get; init; }

    public required string EventDate { get; init; }

    public required string Description { get; init; }

    public string? AdditionalInstructions { get; init; }

    public bool IncludeDate { get; init; }

    public bool IncludePrice { get; init; }

    public bool IncludeClubBranding { get; init; }

    public string? Price { get; init; }

    public List<ReferenceSelectionCandidate> References { get; init; } = [];
}

public sealed class ReferenceSelectionCandidate
{
    public required string Id { get; init; }

    public required string Title { get; init; }

    public required string Category { get; init; }

    public required string Description { get; init; }

    public List<string> Tags { get; init; } = [];

    public int Priority { get; init; }

    public ReferenceRelevanceProfile? RelevanceProfile { get; init; }
}

public sealed class ReferenceSelectionResult
{
    public required string EventIntent { get; init; }

    public required string Mode { get; init; }

    public required string Model { get; init; }

    public required List<ReferenceMatchResult> Matches { get; init; }

    public required List<ReferenceMatchResult> Selected { get; init; }
}

public sealed class ReferenceMatchResult
{
    public required string Id { get; init; }

    public int Confidence { get; init; }

    public required string Reason { get; init; }
}
