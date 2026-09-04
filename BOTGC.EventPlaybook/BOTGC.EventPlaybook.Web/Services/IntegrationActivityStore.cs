using System.Text.Json;
using System.Text.RegularExpressions;
using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface IIntegrationActivityStore
{
    Task RecordAsync(IntegrationActivityWrite activity, CancellationToken cancellationToken);
    Task<IReadOnlyList<IntegrationActivityEntry>> GetRecentAsync(int limit, CancellationToken cancellationToken);
}

public sealed partial class IntegrationActivityStore : IIntegrationActivityStore
{
    private const int MaximumEntries = 500;
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public IntegrationActivityStore(IWebHostEnvironment environment)
    {
        var directory = Path.Combine(environment.ContentRootPath, "App_Data");
        Directory.CreateDirectory(directory);
        _path = Path.Combine(directory, "integration-activity.json");
    }

    public async Task RecordAsync(IntegrationActivityWrite activity, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            document.Entries.Insert(0, new IntegrationActivityEntry
            {
                Id = Guid.NewGuid().ToString("N"),
                OccurredAtUtc = DateTimeOffset.UtcNow,
                Integration = Clean(activity.Integration, 120) ?? "Integration",
                Operation = Clean(activity.Operation, 160) ?? "Integration operation",
                Outcome = string.Equals(activity.Outcome, "succeeded", StringComparison.OrdinalIgnoreCase)
                    ? "succeeded"
                    : "failed",
                EventPlaybookEventId = Clean(activity.EventPlaybookEventId, 160),
                EventName = Clean(activity.EventName, 240),
                ExternalEventId = activity.ExternalEventId,
                ExternalRecordId = activity.ExternalRecordId,
                Stage = Clean(activity.Stage, 160),
                StatusCode = activity.StatusCode,
                Message = Clean(activity.Message, 1_500) ?? "No diagnostic message was supplied."
            });
            if (document.Entries.Count > MaximumEntries)
                document.Entries.RemoveRange(MaximumEntries, document.Entries.Count - MaximumEntries);
            await SaveAsync(document, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IReadOnlyList<IntegrationActivityEntry>> GetRecentAsync(
        int limit,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            return document.Entries.Take(Math.Clamp(limit, 1, 200)).ToArray();
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<ActivityDocument> LoadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path)) return new ActivityDocument();
        await using var stream = File.OpenRead(_path);
        return await JsonSerializer.DeserializeAsync<ActivityDocument>(stream, _jsonOptions, cancellationToken)
            ?? new ActivityDocument();
    }

    private async Task SaveAsync(ActivityDocument document, CancellationToken cancellationToken)
    {
        var temporaryPath = $"{_path}.{Guid.NewGuid():N}.tmp";
        await using (var stream = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            await JsonSerializer.SerializeAsync(stream, document, _jsonOptions, cancellationToken);
            await stream.FlushAsync(cancellationToken);
        }
        File.Move(temporaryPath, _path, true);
    }

    private static string? Clean(string? value, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var cleaned = WhitespaceRegex().Replace(value, " ").Trim();
        cleaned = SecretRegex().Replace(cleaned, "$1$2[redacted]");
        return cleaned.Length <= maximumLength ? cleaned : $"{cleaned[..maximumLength]}…";
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    [GeneratedRegex(@"(?i)\b(password|pin|token|api[-_ ]?key|cookie|phpsessid|ig_persist)(\s*[:=]\s*)([^\s&,;]+)")]
    private static partial Regex SecretRegex();

    private sealed class ActivityDocument
    {
        public int Version { get; init; } = 1;
        public List<IntegrationActivityEntry> Entries { get; init; } = [];
    }
}
