using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;

namespace BOTGC.EventPlaybook.Services;

public sealed class PersistentStorageMaintenanceService(
    IWebHostEnvironment environment,
    ILogger<PersistentStorageMaintenanceService> logger) : IHostedService
{
    private readonly string _dataDirectory = Path.Combine(environment.ContentRootPath, "App_Data");

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (!Directory.Exists(_dataDirectory)) return Task.CompletedTask;

        var deletedFiles = 0;
        long reclaimedBytes = 0;
        DeleteAbandonedTemporaryFiles(ref deletedFiles, ref reclaimedBytes);
        DeleteOrphanedPosterArtwork(ref deletedFiles, ref reclaimedBytes);
        DeleteEmptyEmailArtwork(ref deletedFiles);

        logger.LogInformation(
            "Persistent storage maintenance removed {DeletedFiles} abandoned files and reclaimed {ReclaimedBytes} bytes.",
            deletedFiles,
            reclaimedBytes);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private void DeleteAbandonedTemporaryFiles(ref int deletedFiles, ref long reclaimedBytes)
    {
        foreach (var path in SafeEnumerateFiles(_dataDirectory, "*.tmp", SearchOption.AllDirectories))
        {
            TryDelete(path, ref deletedFiles, ref reclaimedBytes);
        }
    }

    private void DeleteOrphanedPosterArtwork(ref int deletedFiles, ref long reclaimedBytes)
    {
        var sessionDirectory = Path.Combine(_dataDirectory, "poster-sessions");
        var artworkDirectory = Path.Combine(_dataDirectory, "poster-artwork");
        if (!Directory.Exists(artworkDirectory)) return;

        var referencedArtwork = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var sessionPath in SafeEnumerateFiles(sessionDirectory, "*.json", SearchOption.TopDirectoryOnly))
        {
            try
            {
                using var document = JsonDocument.Parse(File.ReadAllBytes(sessionPath));
                CollectArtworkReferences(document.RootElement, artworkDirectory, referencedArtwork);
            }
            catch (Exception exception) when (exception is IOException or JsonException or UnauthorizedAccessException)
            {
                logger.LogWarning(exception, "Could not inspect poster session {PosterSessionPath} during storage maintenance.", sessionPath);
            }
        }

        // A completed artwork write is followed by a session update. Retaining
        // recent unreferenced files avoids racing an interrupted deployment;
        // older versions absent from every current session are disposable.
        var cutoff = DateTime.UtcNow.AddHours(-1);
        foreach (var artworkPath in SafeEnumerateFiles(artworkDirectory, "*.image", SearchOption.AllDirectories))
        {
            if (referencedArtwork.Contains(Path.GetFullPath(artworkPath))) continue;
            try
            {
                if (File.GetLastWriteTimeUtc(artworkPath) > cutoff) continue;
            }
            catch (IOException)
            {
                continue;
            }

            TryDelete(artworkPath, ref deletedFiles, ref reclaimedBytes);
            TryDelete($"{artworkPath}.content-type", ref deletedFiles, ref reclaimedBytes);
        }

        foreach (var metadataPath in SafeEnumerateFiles(artworkDirectory, "*.content-type", SearchOption.AllDirectories))
        {
            var artworkPath = metadataPath[..^".content-type".Length];
            if (!File.Exists(artworkPath)) TryDelete(metadataPath, ref deletedFiles, ref reclaimedBytes);
        }
    }

    private void DeleteEmptyEmailArtwork(ref int deletedFiles)
    {
        var ignoredBytes = 0L;
        var directory = Path.Combine(_dataDirectory, "MemberEmailArtwork");
        foreach (var path in SafeEnumerateFiles(directory, "*.png", SearchOption.TopDirectoryOnly))
        {
            try
            {
                if (new FileInfo(path).Length == 0) TryDelete(path, ref deletedFiles, ref ignoredBytes);
            }
            catch (IOException)
            {
                // A request could not be using the store while hosted-service
                // startup is running, but a transient filesystem read is still
                // harmless to skip.
            }
        }
    }

    private static void CollectArtworkReferences(
        JsonElement value,
        string artworkDirectory,
        HashSet<string> referencedArtwork)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in value.EnumerateObject())
                {
                    CollectArtworkReferences(property.Value, artworkDirectory, referencedArtwork);
                }
                break;
            case JsonValueKind.Array:
                foreach (var item in value.EnumerateArray())
                {
                    CollectArtworkReferences(item, artworkDirectory, referencedArtwork);
                }
                break;
            case JsonValueKind.String:
                AddArtworkReference(value.GetString(), artworkDirectory, referencedArtwork);
                break;
        }
    }

    private static void AddArtworkReference(
        string? source,
        string artworkDirectory,
        HashSet<string> referencedArtwork)
    {
        if (string.IsNullOrWhiteSpace(source) ||
            !source.StartsWith("/api/poster/artwork?", StringComparison.Ordinal) ||
            !Uri.TryCreate(new Uri("https://event-playbook.local"), source, out var parsed))
        {
            return;
        }

        var query = QueryHelpers.ParseQuery(parsed.Query);
        var key = query["key"].ToString();
        var outputId = query["outputId"].ToString();
        var version = query["version"].ToString();
        if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(outputId) || string.IsNullOrWhiteSpace(version)) return;

        var path = Path.Combine(
            artworkDirectory,
            HashValue(key),
            $"{HashValue(outputId)}-{HashValue(version)}.image");
        referencedArtwork.Add(Path.GetFullPath(path));
    }

    private static string HashValue(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private IEnumerable<string> SafeEnumerateFiles(string directory, string pattern, SearchOption searchOption)
    {
        if (!Directory.Exists(directory)) return [];
        try
        {
            return Directory.EnumerateFiles(directory, pattern, searchOption).ToArray();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning(exception, "Could not enumerate persistent storage directory {Directory}.", directory);
            return [];
        }
    }

    private void TryDelete(string path, ref int deletedFiles, ref long reclaimedBytes)
    {
        try
        {
            if (!File.Exists(path)) return;
            var length = new FileInfo(path).Length;
            File.Delete(path);
            deletedFiles += 1;
            reclaimedBytes += length;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning(exception, "Could not remove abandoned persistent-storage file {Path}.", path);
        }
    }
}
