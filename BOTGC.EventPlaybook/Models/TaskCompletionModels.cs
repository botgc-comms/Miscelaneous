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
}

public sealed class TaskCompletionRecord
{
    public required string Token { get; init; }
    public required string EventId { get; init; }
    public required string EventName { get; init; }
    public required string TaskId { get; init; }
    public required string TaskTitle { get; init; }
    public string? Assignee { get; init; }
    public string? AssigneeEmail { get; init; }
    public string? DueDate { get; init; }
    public DateTimeOffset RegisteredAtUtc { get; init; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public string? CompletionNotes { get; set; }
}

public sealed class CompleteTaskRequest
{
    public string? Notes { get; init; }
}
