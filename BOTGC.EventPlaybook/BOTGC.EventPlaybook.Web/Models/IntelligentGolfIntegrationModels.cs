namespace BOTGC.EventPlaybook.Models;

public sealed class PlaybookEventIntegrationSnapshot
{
    public required string EventId { get; init; }
    public required string Name { get; init; }
    public required string EventDate { get; init; }
    public required string Description { get; init; }
    public string? StartTime { get; init; }
    public string? EndTime { get; init; }
    public int? EventTypeId { get; init; }
    public int Attendees { get; init; }
    public string? GroupId { get; init; } = "151";
    public string GroupName { get; init; } = "BOTGC Event Planner";
}

public sealed class IntelligentGolfIntegrationLink
{
    public required string EventPlaybookEventId { get; init; }
    public int? IntelligentGolfEventId { get; set; }
    public int? IntelligentGolfDiaryEntryId { get; set; }
    public string? LastEventFingerprint { get; set; }
    public DateTimeOffset? EventSynchronisedAtUtc { get; set; }
    public DateTimeOffset? DiaryPublishedAtUtc { get; set; }
    public string? LastError { get; set; }
    public string? LastErrorStage { get; set; }
    public int? LastErrorStatusCode { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

public sealed class IntelligentGolfEventSynchroniseResult
{
    public required string EventPlaybookEventId { get; init; }
    public int IntelligentGolfEventId { get; init; }
    public bool Allocated { get; init; }
    public DateTimeOffset SynchronisedAtUtc { get; init; }
}

public sealed class IntelligentGolfDiaryPublishResult
{
    public required string EventPlaybookEventId { get; init; }
    public int IntelligentGolfEventId { get; init; }
    public int IntelligentGolfDiaryEntryId { get; init; }
    public bool Created { get; init; }
    public DateTimeOffset PublishedAtUtc { get; init; }
}
