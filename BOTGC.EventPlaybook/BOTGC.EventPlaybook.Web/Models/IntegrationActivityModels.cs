namespace BOTGC.EventPlaybook.Models;

public sealed class IntegrationActivityEntry
{
    public required string Id { get; init; }
    public required DateTimeOffset OccurredAtUtc { get; init; }
    public required string Integration { get; init; }
    public required string Operation { get; init; }
    public required string Outcome { get; init; }
    public string? EventPlaybookEventId { get; init; }
    public string? EventName { get; init; }
    public int? ExternalEventId { get; init; }
    public int? ExternalRecordId { get; init; }
    public string? Stage { get; init; }
    public int? StatusCode { get; init; }
    public required string Message { get; init; }
}

public sealed class IntegrationActivityWrite
{
    public string Integration { get; init; } = "Intelligent Golf";
    public required string Operation { get; init; }
    public required string Outcome { get; init; }
    public string? EventPlaybookEventId { get; init; }
    public string? EventName { get; init; }
    public int? ExternalEventId { get; init; }
    public int? ExternalRecordId { get; init; }
    public string? Stage { get; init; }
    public int? StatusCode { get; init; }
    public required string Message { get; init; }
}
