using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface ISharedPlaybookStateStore
{
    Task<SharedPlaybookStateDocument> GetAsync(CancellationToken cancellationToken);
    Task<(bool Conflict, SharedPlaybookStateDocument Document)> SaveAsync(
        SaveSharedPlaybookStateRequest request,
        CancellationToken cancellationToken);
}

public interface IPosterSessionStore
{
    Task<PosterSessionDocument?> GetAsync(string key, CancellationToken cancellationToken);
    Task<PosterSessionDocument> SaveAsync(string key, JsonElement session, CancellationToken cancellationToken);
    Task<PosterArtworkFile?> GetArtworkAsync(
        string key,
        string outputId,
        string version,
        CancellationToken cancellationToken);
    Task<PosterArtworkFile> SaveArtworkAsync(
        string key,
        string outputId,
        Stream content,
        string contentType,
        CancellationToken cancellationToken);
}

public sealed class PrototypePersistenceStore : ISharedPlaybookStateStore, IPosterSessionStore
{
    private readonly string _sharedStatePath;
    private readonly string _posterSessionsDirectory;
    private readonly string _posterArtworkDirectory;
    private readonly SemaphoreSlim _sharedStateGate = new(1, 1);
    private readonly SemaphoreSlim _posterSessionGate = new(1, 1);
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public PrototypePersistenceStore(IWebHostEnvironment environment)
    {
        var dataDirectory = Path.Combine(environment.ContentRootPath, "App_Data");
        _posterSessionsDirectory = Path.Combine(dataDirectory, "poster-sessions");
        _posterArtworkDirectory = Path.Combine(dataDirectory, "poster-artwork");
        Directory.CreateDirectory(dataDirectory);
        Directory.CreateDirectory(_posterSessionsDirectory);
        Directory.CreateDirectory(_posterArtworkDirectory);
        _sharedStatePath = Path.Combine(dataDirectory, "shared-playbook-state.json");
    }

    async Task<SharedPlaybookStateDocument> ISharedPlaybookStateStore.GetAsync(CancellationToken cancellationToken)
    {
        await _sharedStateGate.WaitAsync(cancellationToken);
        try
        {
            return await LoadSharedStateAsync(cancellationToken);
        }
        finally
        {
            _sharedStateGate.Release();
        }
    }

    async Task<(bool Conflict, SharedPlaybookStateDocument Document)> ISharedPlaybookStateStore.SaveAsync(
        SaveSharedPlaybookStateRequest request,
        CancellationToken cancellationToken)
    {
        await _sharedStateGate.WaitAsync(cancellationToken);
        try
        {
            var current = await LoadSharedStateAsync(cancellationToken);
            if (request.Revision != current.Revision)
            {
                return (true, current);
            }

            var next = new SharedPlaybookStateDocument
            {
                Revision = current.Revision + 1,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
                State = request.State.Clone()
            };
            await WriteJsonAtomicallyAsync(_sharedStatePath, next, cancellationToken);
            return (false, next);
        }
        finally
        {
            _sharedStateGate.Release();
        }
    }

    async Task<PosterSessionDocument?> IPosterSessionStore.GetAsync(string key, CancellationToken cancellationToken)
    {
        var path = PosterSessionPath(key);
        await _posterSessionGate.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(path)) return null;
            await using var stream = File.OpenRead(path);
            return await JsonSerializer.DeserializeAsync<PosterSessionDocument>(stream, _jsonOptions, cancellationToken);
        }
        finally
        {
            _posterSessionGate.Release();
        }
    }

    async Task<PosterSessionDocument> IPosterSessionStore.SaveAsync(
        string key,
        JsonElement session,
        CancellationToken cancellationToken)
    {
        var path = PosterSessionPath(key);
        await _posterSessionGate.WaitAsync(cancellationToken);
        try
        {
            var currentRevision = 0L;
            if (File.Exists(path))
            {
                await using var readStream = File.OpenRead(path);
                var current = await JsonSerializer.DeserializeAsync<PosterSessionDocument>(readStream, _jsonOptions, cancellationToken);
                currentRevision = current?.Revision ?? 0;
            }

            var next = new PosterSessionDocument
            {
                Key = key,
                Revision = currentRevision + 1,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
                Session = session.Clone()
            };
            await WriteJsonAtomicallyAsync(path, next, cancellationToken);
            return next;
        }
        finally
        {
            _posterSessionGate.Release();
        }
    }

    async Task<PosterArtworkFile?> IPosterSessionStore.GetArtworkAsync(
        string key,
        string outputId,
        string version,
        CancellationToken cancellationToken)
    {
        var path = PosterArtworkPath(key, outputId, version);
        await _posterSessionGate.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(path)) return null;
            return await DescribePosterArtworkAsync(path, version, cancellationToken);
        }
        finally
        {
            _posterSessionGate.Release();
        }
    }

    async Task<PosterArtworkFile> IPosterSessionStore.SaveArtworkAsync(
        string key,
        string outputId,
        Stream content,
        string contentType,
        CancellationToken cancellationToken)
    {
        const long maximumArtworkBytes = 80L * 1024L * 1024L;
        var version = Guid.NewGuid().ToString("N");
        var path = PosterArtworkPath(key, outputId, version);
        var directory = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(directory);

        await _posterSessionGate.WaitAsync(cancellationToken);
        try
        {
            var temporaryPath = $"{path}.{Guid.NewGuid():N}.tmp";
            try
            {
                await using (var stream = new FileStream(
                    temporaryPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None,
                    65536,
                    FileOptions.Asynchronous | FileOptions.WriteThrough))
                {
                    var buffer = new byte[65536];
                    long totalBytes = 0;
                    while (true)
                    {
                        var bytesRead = await content.ReadAsync(buffer, cancellationToken);
                        if (bytesRead == 0) break;
                        totalBytes += bytesRead;
                        if (totalBytes > maximumArtworkBytes)
                        {
                            throw new InvalidDataException("Poster artwork exceeds the 80 MB storage limit.");
                        }
                        await stream.WriteAsync(buffer.AsMemory(0, bytesRead), cancellationToken);
                    }

                    if (totalBytes == 0)
                    {
                        throw new InvalidDataException("Poster artwork was empty.");
                    }
                    await stream.FlushAsync(cancellationToken);
                }

                File.Move(temporaryPath, path);
                await File.WriteAllTextAsync(
                    PosterArtworkContentTypePath(path),
                    NormaliseImageContentType(contentType),
                    cancellationToken);
            }
            finally
            {
                if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
            }

            return await DescribePosterArtworkAsync(path, version, cancellationToken);
        }
        finally
        {
            _posterSessionGate.Release();
        }
    }

    private async Task<SharedPlaybookStateDocument> LoadSharedStateAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_sharedStatePath)) return new SharedPlaybookStateDocument();
        await using var stream = File.OpenRead(_sharedStatePath);
        return await JsonSerializer.DeserializeAsync<SharedPlaybookStateDocument>(stream, _jsonOptions, cancellationToken)
            ?? new SharedPlaybookStateDocument();
    }

    private string PosterSessionPath(string key)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant();
        return Path.Combine(_posterSessionsDirectory, $"{hash}.json");
    }

    private string PosterArtworkPath(string key, string outputId, string version)
    {
        var sessionHash = HashValue(key);
        var outputHash = HashValue(outputId);
        var versionHash = HashValue(version);
        return Path.Combine(_posterArtworkDirectory, sessionHash, $"{outputHash}-{versionHash}.image");
    }

    private static string PosterArtworkContentTypePath(string artworkPath) => $"{artworkPath}.content-type";

    private static string HashValue(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private static string NormaliseImageContentType(string contentType) => contentType.ToLowerInvariant() switch
    {
        "image/jpeg" or "image/jpg" => "image/jpeg",
        "image/webp" => "image/webp",
        "image/svg+xml" => "image/svg+xml",
        _ => "image/png"
    };

    private static async Task<PosterArtworkFile> DescribePosterArtworkAsync(
        string path,
        string version,
        CancellationToken cancellationToken)
    {
        var contentTypePath = PosterArtworkContentTypePath(path);
        var contentType = File.Exists(contentTypePath)
            ? NormaliseImageContentType(await File.ReadAllTextAsync(contentTypePath, cancellationToken))
            : "image/png";
        return new PosterArtworkFile
        {
            Path = path,
            ContentType = contentType,
            Version = version
        };
    }

    private async Task WriteJsonAtomicallyAsync<T>(string path, T value, CancellationToken cancellationToken)
    {
        var temporaryPath = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                65536,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, value, _jsonOptions, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }
            File.Move(temporaryPath, path, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }
}
