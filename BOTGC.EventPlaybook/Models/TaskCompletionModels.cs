namespace BOTGC.EventPlaybook.Models;

public sealed class RegisterCompletionLinkRequest
{
    public required string Token { get; init; }
    public required string EventId { get; init; }
    public required string EventName { get; init; }
    public required string TaskId { get; init; }
    public required string TaskTitle { get; init; }
    public string? Assignee { get; init; }
    public string? AssigneeEmail { get; init; }
    public string? DueDate { get; init; }
    public List<TaskLearningInsightSnapshot> LearningInsights { get; init; } = [];
}

public sealed class TaskCompletionRecord
{
    public required string Token { get; init; }
    public required string EventId { get; init; }
    public required string EventName { get; set; }
    public required string TaskId { get; init; }
    public required string TaskTitle { get; set; }
    public string? Assignee { get; set; }
    public string? AssigneeEmail { get; set; }
    public string? DueDate { get; set; }
    public List<TaskLearningInsightSnapshot> LearningInsights { get; set; } = [];
    public DateTimeOffset RegisteredAtUtc { get; init; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public string? CompletionNotes { get; set; }
}

public sealed class TaskLearningInsightSnapshot
{
    public required string Summary { get; init; }
    public string? SourceEventName { get; init; }
    public string? SourceEventDate { get; init; }
    public int EvidenceCount { get; init; }
}

public sealed class CompleteTaskRequest
{
    public string? Notes { get; init; }
}
