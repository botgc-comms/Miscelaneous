using System.Text.Json;
using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface IIntelligentGolfIntegrationLinkStore
{
    Task<IntelligentGolfIntegrationLink?> GetAsync(string eventId, CancellationToken cancellationToken);
    Task SaveAllocatedEventAsync(
        string eventId,
        int intelligentGolfEventId,
        CancellationToken cancellationToken);
    Task SaveEventAsync(
        string eventId,
        int intelligentGolfEventId,
        string fingerprint,
        DateTimeOffset synchronisedAtUtc,
        CancellationToken cancellationToken);
    Task SaveDiaryAsync(
        string eventId,
        int intelligentGolfEventId,
        int diaryEntryId,
        DateTimeOffset publishedAtUtc,
        CancellationToken cancellationToken);
    Task SaveAllocatedDiaryAsync(
        string eventId,
        int intelligentGolfEventId,
        int diaryEntryId,
        CancellationToken cancellationToken);
    Task RecordFailureAsync(
        string eventId,
        string message,
        string? stage,
        int? statusCode,
        CancellationToken cancellationToken);
}

public sealed class IntelligentGolfIntegrationLinkStore : IIntelligentGolfIntegrationLinkStore
{
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public IntelligentGolfIntegrationLinkStore(IWebHostEnvironment environment)
    {
        var directory = Path.Combine(environment.ContentRootPath, "App_Data");
        Directory.CreateDirectory(directory);
        _path = Path.Combine(directory, "intelligent-golf-event-links.json");
    }

    public async Task<IntelligentGolfIntegrationLink?> GetAsync(
        string eventId,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            return document.Events.TryGetValue(eventId.Trim(), out var link)
                ? Clone(link)
                : null;
        }
        finally
        {
            _gate.Release();
        }
    }

    public Task SaveAllocatedEventAsync(
        string eventId,
        int intelligentGolfEventId,
        CancellationToken cancellationToken) =>
        UpdateAsync(eventId, link =>
        {
            link.IntelligentGolfEventId = intelligentGolfEventId;
        }, cancellationToken);

    public Task SaveEventAsync(
        string eventId,
        int intelligentGolfEventId,
        string fingerprint,
        DateTimeOffset synchronisedAtUtc,
        CancellationToken cancellationToken) =>
        UpdateAsync(eventId, link =>
        {
            link.IntelligentGolfEventId = intelligentGolfEventId;
            link.LastEventFingerprint = fingerprint;
            link.EventSynchronisedAtUtc = synchronisedAtUtc;
            link.LastError = null;
            link.LastErrorStage = null;
            link.LastErrorStatusCode = null;
        }, cancellationToken);

    public Task SaveDiaryAsync(
        string eventId,
        int intelligentGolfEventId,
        int diaryEntryId,
        DateTimeOffset publishedAtUtc,
        CancellationToken cancellationToken) =>
        UpdateAsync(eventId, link =>
        {
            link.IntelligentGolfEventId = intelligentGolfEventId;
            link.IntelligentGolfDiaryEntryId = diaryEntryId;
            link.DiaryPublishedAtUtc = publishedAtUtc;
            link.LastError = null;
            link.LastErrorStage = null;
            link.LastErrorStatusCode = null;
        }, cancellationToken);

    public Task SaveAllocatedDiaryAsync(
        string eventId,
        int intelligentGolfEventId,
        int diaryEntryId,
        CancellationToken cancellationToken) =>
        UpdateAsync(eventId, link =>
        {
            link.IntelligentGolfEventId = intelligentGolfEventId;
            link.IntelligentGolfDiaryEntryId = diaryEntryId;
        }, cancellationToken);

    public Task RecordFailureAsync(
        string eventId,
        string message,
        string? stage,
        int? statusCode,
        CancellationToken cancellationToken) =>
        UpdateAsync(eventId, link =>
        {
            link.LastError = message.Trim();
            link.LastErrorStage = string.IsNullOrWhiteSpace(stage) ? null : stage.Trim();
            link.LastErrorStatusCode = statusCode;
        }, cancellationToken);

    private async Task UpdateAsync(
        string eventId,
        Action<IntelligentGolfIntegrationLink> update,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            var key = eventId.Trim();
            if (!document.Events.TryGetValue(key, out var link))
            {
                link = new IntelligentGolfIntegrationLink
                {
                    EventPlaybookEventId = key,
                    UpdatedAtUtc = DateTimeOffset.UtcNow
                };
                document.Events[key] = link;
            }
            update(link);
            link.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await SaveAsync(document, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<LinkDocument> LoadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path)) return new LinkDocument();
        await using var stream = File.OpenRead(_path);
        return await JsonSerializer.DeserializeAsync<LinkDocument>(stream, _jsonOptions, cancellationToken)
            ?? new LinkDocument();
    }

    private async Task SaveAsync(LinkDocument document, CancellationToken cancellationToken)
    {
        var temporaryPath = $"{_path}.{Guid.NewGuid():N}.tmp";
        await using (var stream = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            await JsonSerializer.SerializeAsync(stream, document, _jsonOptions, cancellationToken);
            await stream.FlushAsync(cancellationToken);
        }
        File.Move(temporaryPath, _path, true);
    }

    private static IntelligentGolfIntegrationLink Clone(IntelligentGolfIntegrationLink link) => new()
    {
        EventPlaybookEventId = link.EventPlaybookEventId,
        IntelligentGolfEventId = link.IntelligentGolfEventId,
        IntelligentGolfDiaryEntryId = link.IntelligentGolfDiaryEntryId,
        LastEventFingerprint = link.LastEventFingerprint,
        EventSynchronisedAtUtc = link.EventSynchronisedAtUtc,
        DiaryPublishedAtUtc = link.DiaryPublishedAtUtc,
        LastError = link.LastError,
        LastErrorStage = link.LastErrorStage,
        LastErrorStatusCode = link.LastErrorStatusCode,
        UpdatedAtUtc = link.UpdatedAtUtc
    };

    private sealed class LinkDocument
    {
        public int Version { get; init; } = 1;
        public Dictionary<string, IntelligentGolfIntegrationLink> Events { get; init; } =
            new(StringComparer.OrdinalIgnoreCase);
    }
}
