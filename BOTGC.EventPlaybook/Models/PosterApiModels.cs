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
    public required string EventName { get; init; }

    public required List<PublishAsset> Assets { get; init; }

    public bool PublishToYodeck { get; init; }

    public bool PublishByEmail { get; init; }
}

public sealed class PublishAsset
{
    public required string OutputId { get; init; }

    public required string Name { get; init; }
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
