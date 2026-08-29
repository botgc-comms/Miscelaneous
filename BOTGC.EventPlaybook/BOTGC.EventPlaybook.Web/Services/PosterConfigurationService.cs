using System.Text.Json;
using System.Text.RegularExpressions;
using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public sealed class PosterConfigurationService : IPosterConfigurationService
{
    private readonly PosterConfiguration _configuration;

    public PosterConfigurationService(IWebHostEnvironment environment)
    {
        var path = Path.Combine(environment.ContentRootPath, "Data", "poster-config.json");
        var json = File.ReadAllText(path);

        _configuration = JsonSerializer.Deserialize<PosterConfiguration>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? throw new InvalidOperationException("Unable to load poster configuration.");

        var visualStyleLibraryPath = Path.Combine(environment.ContentRootPath, "Data", "visual-style-library.json");
        _configuration.Styles = LoadVisualStyleLibrary(visualStyleLibraryPath);
    }

    public PosterConfiguration Get() => _configuration;

    public EventDefinition GetEvent(string eventId) =>
        _configuration.Events.SingleOrDefault(x => string.Equals(x.Id, eventId, StringComparison.OrdinalIgnoreCase))
        ?? throw new KeyNotFoundException($"Unknown event '{eventId}'.");

    public PosterStyleDefinition GetStyle(string styleId) =>
        _configuration.Styles.SingleOrDefault(x => string.Equals(x.Id, styleId, StringComparison.OrdinalIgnoreCase))
        ?? throw new KeyNotFoundException($"Unknown poster style '{styleId}'.");

    public PosterOutputDefinition GetOutput(string outputId) =>
        _configuration.Outputs.SingleOrDefault(x => string.Equals(x.Id, outputId, StringComparison.OrdinalIgnoreCase))
        ?? throw new KeyNotFoundException($"Unknown poster output '{outputId}'.");

    private static List<PosterStyleDefinition> LoadVisualStyleLibrary(string path)
    {
        if (!File.Exists(path))
        {
            throw new InvalidOperationException($"Visual style library was not found at '{path}'.");
        }

        var library = JsonSerializer.Deserialize<Dictionary<string, List<VisualStyleLibraryEntry>>>(
            File.ReadAllText(path),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        if (library is null || library.Count == 0)
        {
            throw new InvalidOperationException("Visual style library did not contain any parent styles.");
        }

        var styles = library.Select(parent => BuildParentStyle(parent.Key, parent.Value)).ToList();
        if (styles.SelectMany(style => style.Variations).Select(variation => variation.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count() !=
            styles.Sum(style => style.Variations.Count))
        {
            throw new InvalidOperationException("Visual style library contains duplicate generated style identifiers.");
        }

        return styles;
    }

    private static PosterStyleDefinition BuildParentStyle(
        string parentName,
        IReadOnlyCollection<VisualStyleLibraryEntry> entries)
    {
        if (string.IsNullOrWhiteSpace(parentName) || entries.Count == 0)
        {
            throw new InvalidOperationException("Every visual-style parent must have a name and at least one child style.");
        }

        var parentId = Slugify(parentName);
        var metadata = ParentMetadata(parentName);
        var variations = entries.Select(entry =>
        {
            if (string.IsNullOrWhiteSpace(entry.Name) || string.IsNullOrWhiteSpace(entry.Description))
            {
                throw new InvalidOperationException($"Visual-style parent '{parentName}' contains a child without a name or description.");
            }

            return new PosterStyleVariationDefinition
            {
                Id = $"{parentId}-{Slugify(entry.Name)}",
                Name = entry.Name.Trim(),
                References = entry.References.Where(reference => !string.IsNullOrWhiteSpace(reference))
                    .Select(reference => reference.Trim())
                    .ToList(),
                Camera = string.IsNullOrWhiteSpace(entry.Camera) ? null : entry.Camera.Trim(),
                StyleDirection = entry.Description.Trim()
            };
        }).ToList();

        return new PosterStyleDefinition
        {
            Id = parentId,
            Name = metadata.DisplayName,
            Summary = metadata.Summary,
            StyleDirection = metadata.Direction,
            ColourDirection = "Follow the selected child direction's authentic palette while retaining enough tonal separation, legibility and visual energy for an engaging event poster.",
            VisualLanguage =
            [
                "The randomly selected child direction is the authoritative visual treatment for this campaign.",
                "Apply the selected treatment to the event subject rather than allowing the treatment to invent a different subject."
            ],
            Mood = ["Match the event brief while preserving the character of the selected child direction."],
            Avoid =
            [
                "Do not render the parent name, child style name, reference names or camera specification as poster copy.",
                "Do not let visual-style metadata replace or dilute the organiser-supplied event content."
            ],
            Variations = variations
        };
    }

    private static ParentStyleMetadata ParentMetadata(string parentName) =>
        parentName.Trim().ToLowerInvariant() switch
        {
            "childrens book" => new(
                "Children's book",
                "Characterful picture-book and illustrated-fantasy treatments, selected at random for each concept.",
                "Create an original children's-book treatment using the selected configured child direction."),
            "fine art" => new(
                "Fine art",
                "Painting, printmaking and gallery-art traditions translated into compelling event artwork.",
                "Create an original fine-art treatment using the selected configured child direction."),
            "graffiti" => new(
                "Graffiti",
                "Street-art, mural, stencil and spray-paint treatments with energetic handmade character.",
                "Create an original street-art treatment using the selected configured child direction."),
            "photo realistic" => new(
                "Photo realistic",
                "Camera-led photographic treatments with specific lenses, viewpoints, lighting and optical behaviour.",
                "Create a believable photographic treatment using the selected configured child direction and camera guidance."),
            "vintage" => new(
                "Vintage",
                "Historic print and advertising treatments with period-specific composition and material texture.",
                "Create an original period-print treatment using the selected configured child direction."),
            "movie posters" => new(
                "Movie posters",
                "Cinematic key-art compositions ranging from graphic minimalism to painted theatrical montage.",
                "Create original cinematic key art using the selected configured child direction."),
            _ => new(
                parentName.Trim(),
                $"Configured visual directions from the {parentName.Trim()} library.",
                $"Create an original treatment using the selected configured {parentName.Trim()} direction.")
        };

    private static string Slugify(string value)
    {
        var slug = Regex.Replace(value.Trim().ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "style" : slug;
    }

    private sealed record ParentStyleMetadata(string DisplayName, string Summary, string Direction);
}
