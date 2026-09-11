namespace BOTGC.EventPlaybook.Models;

public sealed class TaskAlertSchedule
{
    public DateTimeOffset? GeneratedAtUtc { get; init; }

    public required Uri PublicBaseUrl { get; init; }

    public IReadOnlyList<ScheduledTaskAlert> Tasks { get; init; } = [];
}

public sealed class ScheduledTaskAlert
{
    public required string EventId { get; init; }

    public required string EventName { get; init; }

    public string? EventDate { get; init; }

    public required string TaskId { get; init; }

    public required string TaskTitle { get; init; }

    public required DateOnly DueDate { get; init; }

    public string? AssigneeName { get; init; }

    public string? AssigneeEmail { get; init; }

    public string? OrganiserName { get; init; }

    public string? OrganiserEmail { get; init; }

    public required string CompletionPath { get; init; }

    public required string CompletionToken { get; init; }

    public bool CanCompleteFromLink { get; init; } = true;
}

public sealed class TaskAlertEmailMessage
{
    public required string RecipientEmail { get; init; }

    public required string Subject { get; init; }

    public required string BodyHtml { get; init; }

    public int TaskCount { get; init; }
}

public sealed class TaskEmailAlertDispatchResult
{
    public DateOnly LocalDate { get; init; }

    public int CandidateTaskCount { get; init; }

    public int RecipientCount { get; init; }

    public int SentRecipientCount { get; init; }

    public int AlreadySentRecipientCount { get; init; }

    public int FailedRecipientCount { get; init; }
}
