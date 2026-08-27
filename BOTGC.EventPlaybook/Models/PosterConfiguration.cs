namespace BOTGC.EventPlaybook.Models;

public sealed class PosterConfiguration
{
    public required ClubBrand Brand { get; init; }

    public required PromptingConfiguration Prompting { get; init; }

    public required ReferenceSelectionConfiguration ReferenceSelection { get; init; }

    public required List<EventDefinition> Events { get; init; }

    public required List<PosterStyleDefinition> Styles { get; init; }

    public required List<PosterOutputDefinition> Outputs { get; init; }
}

public sealed class ReferenceSelectionConfiguration
{
    public int MaximumAutomaticReferences { get; init; } = 3;

    public int MinimumConfidence { get; init; } = 65;

    public required string ProfileInstruction { get; init; }

    public required string ScoringInstruction { get; init; }
}

public sealed class ClubBrand
{
    public required string Name { get; init; }

    public required string ShortName { get; init; }

    public required string Strapline { get; init; }
}

public sealed class PromptingConfiguration
{
    public required string CreativeDirectorInstruction { get; init; }

    public required string ColourQualityDirection { get; init; }

    public required List<string> GlobalImageRules { get; init; }

    public required List<string> GlobalExclusions { get; init; }
}

public sealed class EventDefinition
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    public required string Description { get; init; }

    public required string DefaultDate { get; init; }

    public string? DefaultPrice { get; init; }

    public required EventSceneRecipe SceneRecipe { get; init; }
}

public sealed class EventSceneRecipe
{
    public required string CentralIdea { get; init; }

    public required string PrimaryScene { get; init; }

    public required List<string> MustShow { get; init; }

    public required List<string> SupportingDetails { get; init; }

    public required List<string> MoodAndHumour { get; init; }

    public required List<string> Avoid { get; init; }
}

public sealed class PosterStyleDefinition
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    public required string Summary { get; init; }

    public required string StyleDirection { get; init; }

    public required string ColourDirection { get; init; }

    public required List<string> VisualLanguage { get; init; }

    public required List<string> Mood { get; init; }

    public required List<string> Avoid { get; init; }

    public List<PosterStyleVariationDefinition> Variations { get; init; } = [];
}

public sealed class PosterStyleVariationDefinition
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    public string? ArtistName { get; init; }

    public string? ReferenceWork { get; init; }

    public required string StyleDirection { get; init; }

    public string? ColourDirection { get; init; }
}

public sealed class PosterOutputDefinition
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    public required int Width { get; init; }

    public required int Height { get; init; }

    public required string OpenAiSize { get; init; }

    public required string Purpose { get; init; }

    public required string CompositionGuidance { get; init; }

    public required List<string> ReservedOverlayZones { get; init; }

    public bool IsPrimary { get; init; }
}
