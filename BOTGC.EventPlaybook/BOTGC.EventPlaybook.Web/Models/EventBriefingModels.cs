namespace BOTGC.EventPlaybook.Models;

public sealed class EventBriefingRequest
{
    public required string EventName { get; init; }
    public string EventDescription { get; init; } = string.Empty;
    public string EventDate { get; init; } = string.Empty;
    public string StartTime { get; init; } = string.Empty;
    public string EndTime { get; init; } = string.Empty;
    public string Organiser { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public string StatusReason { get; init; } = string.Empty;
    public int ExpectedAttendees { get; init; }
    public List<EventBriefingAnswer> Answers { get; init; } = [];
    public List<EventBriefingTask> Tasks { get; init; } = [];
}

public sealed class EventBriefingAnswer
{
    public required string Module { get; init; }
    public required string Section { get; init; }
    public required string Question { get; init; }
    public required string Answer { get; init; }
}

public sealed class EventBriefingTask
{
    public required string Phase { get; init; }
    public required string Area { get; init; }
    public required string Title { get; init; }
    public string Detail { get; init; } = string.Empty;
    public string DueDate { get; init; } = string.Empty;
    public string Owner { get; init; } = string.Empty;
    public string Notes { get; init; } = string.Empty;
    public bool Completed { get; init; }
}

public sealed class EventBriefingResult
{
    public required string Mode { get; init; }
    public required string Model { get; init; }
    public required string Headline { get; init; }
    public required string EventSummary { get; init; }
    public List<EventBriefingFact> KeyInformation { get; init; } = [];
    public List<EventBriefingSection> Sections { get; init; } = [];
    public required StaffBriefingResult StaffBriefing { get; init; }
}

public sealed class EventBriefingFact
{
    public required string Label { get; init; }
    public required string Value { get; init; }
}

public sealed class EventBriefingSection
{
    public required string Title { get; init; }
    public List<string> Points { get; init; } = [];
}

public sealed class StaffBriefingResult
{
    public required string Heading { get; init; }
    public required string Introduction { get; init; }
    public List<string> Preparation { get; init; } = [];
    public List<string> EventDay { get; init; } = [];
    public List<string> Afterwards { get; init; } = [];
    public List<string> KeyContacts { get; init; } = [];
    public List<string> ImportantNotes { get; init; } = [];
}
