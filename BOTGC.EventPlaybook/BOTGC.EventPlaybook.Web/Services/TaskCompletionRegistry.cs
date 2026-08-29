using System.Text.Json;
using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface ITaskCompletionRegistry
{
    Task<TaskCompletionRecord> RegisterAsync(RegisterCompletionLinkRequest request, CancellationToken cancellationToken);
    Task<TaskCompletionRecord?> GetAsync(string token, CancellationToken cancellationToken);
    Task<TaskCompletionRecord?> CompleteAsync(string token, string? notes, CancellationToken cancellationToken);
    Task<IReadOnlyList<TaskCompletionRecord>> GetCompletedForEventAsync(string eventId, CancellationToken cancellationToken);
}

public sealed class TaskCompletionRegistry : ITaskCompletionRegistry
{
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public TaskCompletionRegistry(IWebHostEnvironment environment)
    {
        var directory = Path.Combine(environment.ContentRootPath, "App_Data");
        Directory.CreateDirectory(directory);
        _path = Path.Combine(directory, "task-completions.json");
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
                existing.LearningInsights = request.LearningInsights ?? [];
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
                LearningInsights = request.LearningInsights ?? [],
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
            return records.SingleOrDefault(x => string.Equals(x.Token, token, StringComparison.Ordinal));
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

    private async Task<List<TaskCompletionRecord>> LoadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path))
        {
            return [];
        }

        await using var stream = File.OpenRead(_path);
        return await JsonSerializer.DeserializeAsync<List<TaskCompletionRecord>>(stream, _jsonOptions, cancellationToken) ?? [];
    }

    private async Task SaveAsync(List<TaskCompletionRecord> records, CancellationToken cancellationToken)
    {
        await using var stream = File.Create(_path);
        await JsonSerializer.SerializeAsync(stream, records, _jsonOptions, cancellationToken);
    }
}
