using System.Text.Json;
using TrophyCabinetDemo.Models;

namespace TrophyCabinetDemo.Services;

public sealed class TrophyMetadataLoader(
    IWebHostEnvironment environment,
    ILogger<TrophyMetadataLoader> logger)
{
    private static readonly HashSet<string> AllowedImageExtensions =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ".png",
            ".jpg",
            ".jpeg",
            ".webp"
        };

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private const int DefaultRelativeHeight = 7;
    private const int DefaultCellSpan = 1;

    private readonly IWebHostEnvironment _environment =
        environment ?? throw new ArgumentNullException(nameof(environment));

    private readonly ILogger<TrophyMetadataLoader> _logger =
        logger ?? throw new ArgumentNullException(nameof(logger));

    public async Task<IReadOnlyList<TrophyMetadata>> LoadAsync(
        CancellationToken cancellationToken = default)
    {
        var trophyDirectory = Path.Combine(
            _environment.WebRootPath,
            "images",
            "trophies");

        if (!Directory.Exists(trophyDirectory))
        {
            return [];
        }

        var imageFiles = Directory
            .EnumerateFiles(trophyDirectory, "*", SearchOption.TopDirectoryOnly)
            .Where(filePath =>
                AllowedImageExtensions.Contains(Path.GetExtension(filePath)))
            .OrderBy(filePath => filePath, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var trophies = new List<TrophyMetadata>();

        foreach (var imagePath in imageFiles)
        {
            var imageFile = Path.GetFileName(imagePath);
            var metadataPath = Path.ChangeExtension(imagePath, ".json");

            TrophyMetadata metadata;

            if (File.Exists(metadataPath))
            {
                metadata = await LoadMetadataAsync(
                    metadataPath,
                    imageFile,
                    cancellationToken);

                _logger.LogInformation(
                    "Loaded trophy {TrophyName} with metadata from {MetadataFile}.",
                    metadata.Name,
                    Path.GetFileName(metadataPath));
            }
            else
            {
                metadata = CreateDefaultMetadata(imageFile);

                _logger.LogInformation(
                    "Loaded trophy {TrophyName} using default metadata.",
                    metadata.Name);
            }

            metadata.Validate(metadataPath);
            trophies.Add(metadata);
        }

        return trophies;
    }

    private static async Task<TrophyMetadata> LoadMetadataAsync(
        string metadataPath,
        string imageFile,
        CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(metadataPath);

        var metadata = await JsonSerializer.DeserializeAsync<TrophyMetadata>(
            stream,
            JsonOptions,
            cancellationToken);

        if (metadata is null)
        {
            throw new InvalidDataException(
                $"Metadata file '{metadataPath}' could not be deserialised.");
        }

        return metadata with
        {
            ImageFile = string.IsNullOrWhiteSpace(metadata.ImageFile)
                ? imageFile
                : metadata.ImageFile
        };
    }

    private static TrophyMetadata CreateDefaultMetadata(string imageFile)
    {
        var fileNameWithoutExtension =
            Path.GetFileNameWithoutExtension(imageFile);

        var displayName = fileNameWithoutExtension
            .Replace("-", " ", StringComparison.Ordinal)
            .Replace("_", " ", StringComparison.Ordinal);

        return new TrophyMetadata(
            displayName,
            imageFile,
            DefaultRelativeHeight,
            DefaultCellSpan);
    }
}