using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace BOTGC.EventPlaybook.Services;

public interface IEventFileStore
{
    Task<IReadOnlyList<EventFileMetadata>> ListAsync(string eventId, CancellationToken cancellationToken);

    Task<EventFileMetadata> SaveAsync(
        string eventId,
        string fileName,
        string? contentType,
        Stream content,
        long maximumBytes,
        string? uploadedBy,
        CancellationToken cancellationToken);

    Task<EventFileAsset?> GetAsync(string eventId, string fileId, CancellationToken cancellationToken);

    Task<bool> DeleteAsync(string eventId, string fileId, CancellationToken cancellationToken);
}

public sealed class EventFileStore : IEventFileStore
{
    public const long MaximumFileBytes = 50L * 1024L * 1024L;

    private static readonly HashSet<string> SafeImagePreviewContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/gif",
        "image/jpeg",
        "image/png",
        "image/webp"
    };

    private readonly string _directory;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public EventFileStore(IWebHostEnvironment environment)
    {
        _directory = Path.Combine(environment.ContentRootPath, "App_Data", "event-files");
        Directory.CreateDirectory(_directory);
    }

    public static bool IsSafeImagePreviewContentType(string? contentType)
    {
        var value = contentType?.Split(';', 2)[0].Trim();
        return !string.IsNullOrWhiteSpace(value) && SafeImagePreviewContentTypes.Contains(value);
    }

    public async Task<IReadOnlyList<EventFileMetadata>> ListAsync(
        string eventId,
        CancellationToken cancellationToken)
    {
        var key = NormaliseEventId(eventId);
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var index = await LoadIndexAsync(key, cancellationToken);
            return index.Files
                .Where(file => File.Exists(ContentPath(key, file.Id)))
                .OrderByDescending(file => file.UploadedAtUtc)
                .ToArray();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<EventFileMetadata> SaveAsync(
        string eventId,
        string fileName,
        string? contentType,
        Stream content,
        long maximumBytes,
        string? uploadedBy,
        CancellationToken cancellationToken)
    {
        var key = NormaliseEventId(eventId);
        var safeFileName = NormaliseFileName(fileName);
        if (maximumBytes <= 0 || maximumBytes > MaximumFileBytes)
            throw new ArgumentOutOfRangeException(nameof(maximumBytes));

        var file = new EventFileMetadata
        {
            Id = Guid.NewGuid().ToString("N"),
            FileName = safeFileName,
            ContentType = NormaliseContentType(contentType),
            SizeBytes = 0,
            UploadedAtUtc = DateTimeOffset.UtcNow,
            UploadedBy = string.IsNullOrWhiteSpace(uploadedBy) ? null : uploadedBy.Trim()[..Math.Min(uploadedBy.Trim().Length, 120)]
        };

        await _gate.WaitAsync(cancellationToken);
        try
        {
            var eventDirectory = EventDirectory(key);
            Directory.CreateDirectory(eventDirectory);
            var finalPath = ContentPath(key, file.Id);
            var temporaryPath = $"{finalPath}.{Guid.NewGuid():N}.tmp";
            try
            {
                await using (var destination = new FileStream(
                    temporaryPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None,
                    81920,
                    FileOptions.Asynchronous | FileOptions.SequentialScan))
                {
                    var buffer = new byte[81920];
                    long total = 0;
                    while (true)
                    {
                        var read = await content.ReadAsync(buffer, cancellationToken);
                        if (read == 0) break;
                        total += read;
                        if (total > maximumBytes)
                            throw new InvalidDataException($"Files must be {maximumBytes / 1024 / 1024} MB or smaller.");
                        await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                    }

                    if (total == 0) throw new InvalidDataException("Choose a file that is not empty.");
                    file.SizeBytes = total;
                }

                File.Move(temporaryPath, finalPath);
                var index = await LoadIndexAsync(key, cancellationToken);
                index.Files.Add(file);
                try
                {
                    await SaveIndexAsync(key, index, cancellationToken);
                }
                catch
                {
                    File.Delete(finalPath);
                    throw;
                }
            }
            finally
            {
                if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
            }

            return file;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<EventFileAsset?> GetAsync(
        string eventId,
        string fileId,
        CancellationToken cancellationToken)
    {
        var key = NormaliseEventId(eventId);
        var id = NormaliseFileId(fileId);
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var index = await LoadIndexAsync(key, cancellationToken);
            var metadata = index.Files.FirstOrDefault(file => string.Equals(file.Id, id, StringComparison.Ordinal));
            if (metadata is null) return null;
            var path = ContentPath(key, id);
            return File.Exists(path) ? new EventFileAsset { Path = path, Metadata = metadata } : null;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> DeleteAsync(
        string eventId,
        string fileId,
        CancellationToken cancellationToken)
    {
        var key = NormaliseEventId(eventId);
        var id = NormaliseFileId(fileId);
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var index = await LoadIndexAsync(key, cancellationToken);
            var removed = index.Files.RemoveAll(file => string.Equals(file.Id, id, StringComparison.Ordinal)) > 0;
            if (!removed) return false;
            await SaveIndexAsync(key, index, cancellationToken);
            var path = ContentPath(key, id);
            if (File.Exists(path)) File.Delete(path);
            return true;
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<EventFileIndex> LoadIndexAsync(string eventId, CancellationToken cancellationToken)
    {
        var path = IndexPath(eventId);
        if (!File.Exists(path)) return new EventFileIndex();
        await using var stream = File.OpenRead(path);
        return await JsonSerializer.DeserializeAsync<EventFileIndex>(stream, _jsonOptions, cancellationToken)
            ?? new EventFileIndex();
    }

    private async Task SaveIndexAsync(
        string eventId,
        EventFileIndex index,
        CancellationToken cancellationToken)
    {
        var eventDirectory = EventDirectory(eventId);
        Directory.CreateDirectory(eventDirectory);
        var path = IndexPath(eventId);
        var temporaryPath = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                81920,
                FileOptions.Asynchronous))
            {
                await JsonSerializer.SerializeAsync(stream, index, _jsonOptions, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }
            File.Move(temporaryPath, path, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private string EventDirectory(string eventId)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(eventId))).ToLowerInvariant()[..32];
        return Path.Combine(_directory, hash);
    }

    private string IndexPath(string eventId) => Path.Combine(EventDirectory(eventId), "index.json");

    private string ContentPath(string eventId, string fileId) => Path.Combine(EventDirectory(eventId), $"{fileId}.bin");

    private static string NormaliseEventId(string eventId)
    {
        var value = eventId?.Trim();
        if (string.IsNullOrWhiteSpace(value) || value.Length > 200)
            throw new ArgumentException("A valid event ID is required.");
        return value;
    }

    private static string NormaliseFileId(string fileId)
    {
        var value = fileId?.Trim().ToLowerInvariant();
        if (value is null || value.Length != 32 || value.Any(character => !char.IsAsciiHexDigit(character)))
            throw new ArgumentException("A valid file ID is required.");
        return value;
    }

    private static string NormaliseFileName(string fileName)
    {
        var value = (fileName ?? string.Empty)
            .Replace('\\', '/')
            .Split('/', StringSplitOptions.RemoveEmptyEntries)
            .LastOrDefault() ?? string.Empty;
        value = new string(value.Where(character => !char.IsControl(character)).ToArray()).Trim().Trim('.');
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException("A file name is required.");
        return value.Length <= 180 ? value : value[..180];
    }

    private static string NormaliseContentType(string? contentType)
    {
        var value = contentType?.Split(';', 2)[0].Trim();
        if (string.IsNullOrWhiteSpace(value) || value.Length > 150 || value.Any(char.IsControl))
            return "application/octet-stream";
        return value;
    }

    private sealed class EventFileIndex
    {
        public List<EventFileMetadata> Files { get; set; } = [];
    }
}

public sealed class EventFileMetadata
{
    public required string Id { get; set; }
    public required string FileName { get; set; }
    public required string ContentType { get; set; }
    public long SizeBytes { get; set; }
    public DateTimeOffset UploadedAtUtc { get; set; }
    public string? UploadedBy { get; set; }
}

public sealed class EventFileAsset
{
    public required string Path { get; init; }
    public required EventFileMetadata Metadata { get; init; }
}
