namespace BOTGC.EventPlaybook.Models;

public sealed record EventStatusNotificationRequest
{
    public required string NotificationId { get; init; }

    public required string EventId { get; init; }

    public required string EventName { get; init; }

    public string? EventDate { get; init; }

    public required string Status { get; init; }

    public required DateTimeOffset StatusChangedAtUtc { get; init; }

    public string? DecisionOwner { get; init; }

    public string? Reason { get; init; }

    public IReadOnlyList<EventStatusNotificationRecipient> Recipients { get; init; } = [];
}

public sealed class EventStatusNotificationRecipient
{
    public string? Name { get; init; }

    public required string Email { get; init; }

    public IReadOnlyList<string> Areas { get; init; } = [];
}

public sealed class EventStatusNotificationResult
{
    public required string NotificationId { get; init; }

    public int RequestedRecipientCount { get; init; }

    public int SentRecipientCount { get; init; }

    public int AlreadySentRecipientCount { get; init; }

    public int PendingRecipientCount { get; init; }

    public IReadOnlyList<EventStatusNotificationDelivery> Deliveries { get; init; } = [];
}

public sealed class EventStatusNotificationDelivery
{
    public required string RecipientEmail { get; init; }

    public required string Status { get; init; }

    public string? Error { get; init; }
}
