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
}

public sealed class PrototypePersistenceStore : ISharedPlaybookStateStore, IPosterSessionStore
{
    private readonly string _sharedStatePath;
    private readonly string _posterSessionsDirectory;
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
        Directory.CreateDirectory(dataDirectory);
        Directory.CreateDirectory(_posterSessionsDirectory);
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
