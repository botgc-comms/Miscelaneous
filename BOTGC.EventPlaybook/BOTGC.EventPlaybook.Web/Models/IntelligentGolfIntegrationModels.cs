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
    public string? LifecycleStatus { get; init; }
    public string? GroupId { get; init; } = "151";
    public string GroupName { get; init; } = "BOTGC Event Planner";
    public string? PlanningNote { get; init; }
    public bool IntelligentGolfTicketsRequested { get; init; }
    public IntelligentGolfTicketConfiguration? IntelligentGolfTickets { get; init; }
    public string? IntelligentGolfTicketValidationError { get; init; }
}

public sealed class IntelligentGolfTicketConfiguration
{
    public int MaximumTickets { get; init; }
    public bool AllowMembersOnline { get; init; }
    public int? MaximumTicketsPerMember { get; init; }
    public bool RequireMemberGuestDetails { get; init; }
    public bool MembersPaymentDueOnEntry { get; init; }
    public bool AllowVisitorsOnline { get; init; }
    public int? MaximumTicketsPerVisitor { get; init; }
    public bool AddOptions { get; init; }
    public IReadOnlyList<IntelligentGolfTicketType> TicketTypes { get; init; } = [];
}

public sealed class IntelligentGolfTicketType
{
    public required string Name { get; init; }
    public decimal Price { get; init; }
}

public sealed class IntelligentGolfTicketSynchroniseResult
{
    public required string EventPlaybookEventId { get; init; }
    public int IntelligentGolfEventId { get; init; }
    public int TicketTypeCount { get; init; }
    public DateTimeOffset SynchronisedAtUtc { get; init; }
}

public sealed class IntelligentGolfPlannerNoteSynchroniseResult
{
    public required string EventPlaybookEventId { get; init; }
    public int IntelligentGolfEventId { get; init; }
    public int? IntelligentGolfNoteId { get; init; }
    public bool Created { get; init; }
    public DateTimeOffset SynchronisedAtUtc { get; init; }
}

public sealed class IntelligentGolfTicketBookingList
{
    public int IntelligentGolfEventId { get; init; }
    public int BookingCount { get; init; }
    public int TicketCount { get; init; }
    public int MemberBookingCount { get; init; }
    public int MemberBookingsWithEmailCount { get; init; }
    public IReadOnlyList<IntelligentGolfTicketBooking> Bookings { get; init; } = [];
}

public sealed class IntelligentGolfTicketBooking
{
    public int BookingId { get; init; }
    public int? BookerIntelligentGolfUserId { get; init; }
    public int? BookerMemberNumber { get; init; }
    public required string BookerName { get; init; }
    public string? BookerEmail { get; init; }
    public string? BookerPhone { get; init; }
    public bool IsMember { get; init; }
    public bool MemberMatched { get; init; }
    public bool IsActiveMember { get; init; }
    public string? MembershipCategory { get; init; }
    public required string BookingReference { get; init; }
    public required string BookingType { get; init; }
    public int TicketCount { get; init; }
    public IReadOnlyList<string> TicketHolderNames { get; init; } = [];
    public required string Price { get; init; }
    public required string PaymentStatus { get; init; }
    public required string BookedAt { get; init; }
    public string? Notes { get; init; }
}

public sealed class IntelligentGolfIntegrationLink
{
    public required string EventPlaybookEventId { get; init; }
    public int? IntelligentGolfEventId { get; set; }
    public int? IntelligentGolfDiaryEntryId { get; set; }
    public string? LastEventFingerprint { get; set; }
    public string? LastPlannerNoteFingerprint { get; set; }
    public int? IntelligentGolfNoteId { get; set; }
    public DateTimeOffset? EventSynchronisedAtUtc { get; set; }
    public DateTimeOffset? DiaryPublishedAtUtc { get; set; }
    public string? LastError { get; set; }
    public string? LastErrorStage { get; set; }
    public int? LastErrorStatusCode { get; set; }
    public string? PendingMatchEventDate { get; set; }
    public List<IntelligentGolfPlannerEventCandidate> PendingMatchCandidates { get; set; } = [];
    public DateTimeOffset? MatchRequiredAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

public sealed class IntelligentGolfPlannerEventCandidate
{
    public int IntelligentGolfEventId { get; init; }
    public required string Name { get; init; }
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
    public bool? EventImageAttached { get; init; }
    public DateTimeOffset PublishedAtUtc { get; init; }
}

public sealed class CancelIntelligentGolfEventRequest
{
    public bool RemoveDiary { get; init; }

    public bool RemovePlanner { get; init; }
}

public sealed class IntelligentGolfRemovalOutcome
{
    public required bool Requested { get; init; }

    public required string Outcome { get; init; }

    public int? ExternalId { get; init; }

    public DateTimeOffset? RemovedAtUtc { get; init; }
}

public sealed class IntelligentGolfEventCancellationResult
{
    public required string EventPlaybookEventId { get; init; }

    public required bool Success { get; init; }

    public int? PlannerEntryId { get; init; }

    public int? DiaryEntryId { get; init; }

    public required IntelligentGolfRemovalOutcome Diary { get; init; }

    public required IntelligentGolfRemovalOutcome Planner { get; init; }
}

public sealed class IntelligentGolfDiaryRemovalResult
{
    public required string EventPlaybookEventId { get; init; }

    public int IntelligentGolfEventId { get; init; }

    public int IntelligentGolfDiaryEntryId { get; init; }

    public bool Removed { get; init; }

    public bool ConfirmedAbsent { get; init; }

    public DateTimeOffset RemovedAtUtc { get; init; }
}

public sealed class IntelligentGolfPlannerRemovalResult
{
    public required string EventPlaybookEventId { get; init; }

    public int IntelligentGolfEventId { get; init; }

    public bool Removed { get; init; }

    public bool ConfirmedAbsent { get; init; }

    public DateTimeOffset RemovedAtUtc { get; init; }
}

public sealed class IntelligentGolfEventAdoptResult
{
    public required string EventPlaybookEventId { get; init; }
    public int IntelligentGolfEventId { get; init; }
    public DateTimeOffset AdoptedAtUtc { get; init; }
}

public sealed class IntelligentGolfPlannerEventCandidatesResult
{
    public required string EventDate { get; init; }
    public IReadOnlyList<IntelligentGolfPlannerEventCandidate> Candidates { get; init; } = [];
}

public sealed class IntelligentGolfPlannerEventLookupResult
{
    public required string EventDate { get; init; }
    public IntelligentGolfPlannerEventCandidate? Candidate { get; init; }
}

public sealed class IntelligentGolfEventRelinkResult
{
    public required string EventPlaybookEventId { get; init; }
    public int PreviousIntelligentGolfEventId { get; init; }
    public int IntelligentGolfEventId { get; init; }
    public bool Relinked { get; init; }
    public DateTimeOffset RelinkedAtUtc { get; init; }
}

public sealed class ResolveIntelligentGolfPlannerMatchRequest
{
    public required string Action { get; init; }
    public int? IntelligentGolfEventId { get; init; }
}

public sealed class RelinkIntelligentGolfPlannerEventRequest
{
    public int ExpectedIntelligentGolfEventId { get; init; }
    public int IntelligentGolfEventId { get; init; }
}
