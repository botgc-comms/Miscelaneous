using System.Text.Json;
using System.Globalization;
using BOTGC.EventPlaybook.Models;
using Microsoft.Extensions.Logging.Abstractions;

namespace BOTGC.EventPlaybook.Services;

public interface ITaskCompletionRegistry
{
    Task<TaskCompletionRecord> RegisterAsync(RegisterCompletionLinkRequest request, CancellationToken cancellationToken);
    Task<TaskCompletionRecord?> GetAsync(string token, CancellationToken cancellationToken);
    Task<TaskCompletionRecord?> CompleteAsync(string token, string? notes, CancellationToken cancellationToken);
    Task<IReadOnlyList<TaskCompletionRecord>> GetCompletedForEventAsync(string eventId, CancellationToken cancellationToken);
    Task<TaskEmailWorkspace> RegisterEmailAccessAsync(
        string accessToken,
        IReadOnlyCollection<string> taskTokens,
        CancellationToken cancellationToken);
    Task<TaskEmailWorkspace?> GetEmailAccessAsync(string accessToken, CancellationToken cancellationToken);
}

public sealed class TaskCompletionRegistry : ITaskCompletionRegistry
{
    private readonly string _path;
    private readonly string _emailAccessPath;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<TaskCompletionRegistry> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public TaskCompletionRegistry(IWebHostEnvironment environment)
        : this(environment, TimeProvider.System, NullLogger<TaskCompletionRegistry>.Instance)
    {
    }

    public TaskCompletionRegistry(IWebHostEnvironment environment, TimeProvider timeProvider)
        : this(environment, timeProvider, NullLogger<TaskCompletionRegistry>.Instance)
    {
    }

    public TaskCompletionRegistry(
        IWebHostEnvironment environment,
        TimeProvider timeProvider,
        ILogger<TaskCompletionRegistry> logger)
    {
        var directory = Path.Combine(environment.ContentRootPath, "App_Data");
        Directory.CreateDirectory(directory);
        _path = Path.Combine(directory, "task-completions.json");
        _emailAccessPath = Path.Combine(directory, "task-email-access.json");
        _timeProvider = timeProvider;
        _logger = logger;
    }

    public async Task<TaskCompletionRecord> RegisterAsync(RegisterCompletionLinkRequest request, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var records = await LoadAsync(cancellationToken);
            var existing = records.SingleOrDefault(x => string.Equals(x.Token, request.Token, StringComparison.Ordinal));

            if (existing is not null)
            {
                existing.EventName = request.EventName;
                existing.TaskTitle = request.TaskTitle;
                existing.Assignee = request.Assignee;
                existing.AssigneeEmail = request.AssigneeEmail;
                existing.DueDate = request.DueDate;
                existing.ExpiresOn = request.ExpiresOn;
                existing.Notes = request.Notes;
                existing.CanCompleteFromLink = request.CanCompleteFromLink;
                if (!request.PreserveLearningInsights)
                {
                    existing.LearningInsights = request.LearningInsights ?? [];
                }
                await SaveAsync(records, cancellationToken);
                return existing;
            }

            var record = new TaskCompletionRecord
            {
                Token = request.Token,
                EventId = request.EventId,
                EventName = request.EventName,
                TaskId = request.TaskId,
                TaskTitle = request.TaskTitle,
                Assignee = request.Assignee,
                AssigneeEmail = request.AssigneeEmail,
                DueDate = request.DueDate,
                ExpiresOn = request.ExpiresOn,
                Notes = request.Notes,
                LearningInsights = request.LearningInsights ?? [],
                CanCompleteFromLink = request.CanCompleteFromLink,
                RegisteredAtUtc = DateTimeOffset.UtcNow
            };

            records.Add(record);
            await SaveAsync(records, cancellationToken);
            return record;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<TaskCompletionRecord?> GetAsync(string token, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var records = await LoadAsync(cancellationToken);
            var record = records.SingleOrDefault(x => string.Equals(x.Token, token, StringComparison.Ordinal));
            ApplyExpiry(record);
            return record;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<TaskCompletionRecord?> CompleteAsync(string token, string? notes, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var records = await LoadAsync(cancellationToken);
            var record = records.SingleOrDefault(x => string.Equals(x.Token, token, StringComparison.Ordinal));
            if (record is null)
            {
                return null;
            }

            ApplyExpiry(record);
            if (!record.CanCompleteFromLink)
            {
                return record;
            }

            record.CompletedAtUtc = DateTimeOffset.UtcNow;
            record.CompletionNotes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
            await SaveAsync(records, cancellationToken);
            return record;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IReadOnlyList<TaskCompletionRecord>> GetCompletedForEventAsync(string eventId, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var records = await LoadAsync(cancellationToken);
            return records
                .Where(x => string.Equals(x.EventId, eventId, StringComparison.OrdinalIgnoreCase) && x.CompletedAtUtc is not null)
                .ToList();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<TaskEmailWorkspace> RegisterEmailAccessAsync(
        string accessToken,
        IReadOnlyCollection<string> taskTokens,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(accessToken, out _))
        {
            throw new ArgumentException("The email access token must be a GUID.", nameof(accessToken));
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            var records = await LoadAsync(cancellationToken);
            var available = records.ToDictionary(record => record.Token, StringComparer.Ordinal);
            var allowedTokens = taskTokens
                .Where(token => available.ContainsKey(token))
                .Distinct(StringComparer.Ordinal)
                .ToList();
            if (allowedTokens.Count == 0)
            {
                throw new InvalidOperationException("An email task workspace must contain at least one registered task.");
            }

            var grants = await LoadEmailAccessAsync(cancellationToken);
            grants.RemoveAll(grant => string.Equals(grant.Token, accessToken, StringComparison.Ordinal));
            grants.Add(new TaskEmailAccessGrant
            {
                Token = accessToken,
                TaskTokens = allowedTokens,
                RegisteredAtUtc = _timeProvider.GetUtcNow()
            });
            await SaveEmailAccessAsync(grants, cancellationToken);
            return BuildWorkspace(accessToken, allowedTokens, available);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<TaskEmailWorkspace?> GetEmailAccessAsync(
        string accessToken,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var grant = (await LoadEmailAccessAsync(cancellationToken))
                .SingleOrDefault(item => string.Equals(item.Token, accessToken, StringComparison.Ordinal));
            if (grant is null) return null;

            var records = (await LoadAsync(cancellationToken))
                .ToDictionary(record => record.Token, StringComparer.Ordinal);
            foreach (var token in grant.TaskTokens)
            {
                if (records.TryGetValue(token, out var record)) ApplyExpiry(record);
            }
            return BuildWorkspace(accessToken, grant.TaskTokens, records);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<List<TaskCompletionRecord>> LoadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path))
        {
            return [];
        }

        try
        {
            await using var stream = File.OpenRead(_path);
            return await JsonSerializer.DeserializeAsync<List<TaskCompletionRecord>>(stream, _jsonOptions, cancellationToken) ?? [];
        }
        catch (JsonException exception)
        {
            var recovered = await RecoverCompleteRecordsAsync(cancellationToken);
            _logger.LogError(
                exception,
                "The task completion registry was truncated. Recovered {RecoveredCount} complete records from its valid prefix.",
                recovered.Count);
            await SaveAsync(recovered, cancellationToken);
            return recovered;
        }
    }

    private async Task SaveAsync(List<TaskCompletionRecord> records, CancellationToken cancellationToken)
    {
        var temporaryPath = $"{_path}.{Guid.NewGuid():N}.tmp";
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
                await JsonSerializer.SerializeAsync(stream, records, _jsonOptions, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }
            File.Move(temporaryPath, _path, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private async Task<List<TaskEmailAccessGrant>> LoadEmailAccessAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_emailAccessPath)) return [];
        await using var stream = File.OpenRead(_emailAccessPath);
        return await JsonSerializer.DeserializeAsync<List<TaskEmailAccessGrant>>(
                   stream,
                   _jsonOptions,
                   cancellationToken) ?? [];
    }

    private async Task SaveEmailAccessAsync(
        List<TaskEmailAccessGrant> grants,
        CancellationToken cancellationToken)
    {
        var temporaryPath = $"{_emailAccessPath}.{Guid.NewGuid():N}.tmp";
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
                await JsonSerializer.SerializeAsync(stream, grants, _jsonOptions, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }
            File.Move(temporaryPath, _emailAccessPath, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private static TaskEmailWorkspace BuildWorkspace(
        string accessToken,
        IEnumerable<string> taskTokens,
        IReadOnlyDictionary<string, TaskCompletionRecord> records) =>
        new()
        {
            AccessToken = accessToken,
            Tasks = taskTokens
                .Select(token => records.GetValueOrDefault(token))
                .Where(record => record is not null)
                .Cast<TaskCompletionRecord>()
                .ToArray()
        };

    private async Task<List<TaskCompletionRecord>> RecoverCompleteRecordsAsync(CancellationToken cancellationToken)
    {
        var text = await File.ReadAllTextAsync(_path, cancellationToken);
        var boundary = text.LastIndexOf("\n  }", StringComparison.Ordinal);
        while (boundary >= 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var candidate = $"{text[..(boundary + 4)].TrimEnd().TrimEnd(',')}\n]";
            try
            {
                return JsonSerializer.Deserialize<List<TaskCompletionRecord>>(candidate, _jsonOptions) ?? [];
            }
            catch (JsonException)
            {
                boundary = text.LastIndexOf("\n  }", boundary - 1, StringComparison.Ordinal);
            }
        }
        return [];
    }

    private void ApplyExpiry(TaskCompletionRecord? record)
    {
        if (record is null || record.CompletedAtUtc is not null ||
            !DateOnly.TryParseExact(
                record.ExpiresOn,
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var expiresOn))
        {
            return;
        }

        if (TaskEmailAlertDispatcher.GetLondonDate(_timeProvider) > expiresOn)
        {
            record.CanCompleteFromLink = false;
        }
    }
}
