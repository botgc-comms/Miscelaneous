using System.Text.Json;

namespace BOTGC.EventPlaybook.Models;

public sealed class FeedbackQuestion
{
    public required string Id { get; init; }
    public required string Label { get; init; }
    public required string Type { get; init; }
    public bool Required { get; init; }
    public List<string> Options { get; init; } = [];
    public string? TargetModuleId { get; init; }
    public string? TargetSectionId { get; init; }
    public List<string> TargetItemIds { get; init; } = [];
}

public sealed class FeedbackCampaign
{
    public required string Id { get; init; }
    public required string EventId { get; init; }
    public required string EventName { get; set; }
    public required string PublicToken { get; init; }
    public string? EventDate { get; set; }
    public bool IsOpen { get; set; }
    public string? OpensOn { get; set; }
    public string? ClosesOn { get; set; }
    public List<FeedbackQuestion> Questions { get; set; } = [];
    public DateTimeOffset CreatedAtUtc { get; init; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

public sealed class FeedbackResponse
{
    public required string Id { get; init; }
    public required string CampaignId { get; init; }
    public DateTimeOffset SubmittedAtUtc { get; init; }
    public Dictionary<string, JsonElement> Answers { get; init; } = [];
}

public sealed class FeedbackDataDocument
{
    public List<FeedbackCampaign> Campaigns { get; init; } = [];
    public List<FeedbackResponse> Responses { get; init; } = [];
}

public sealed class UpsertFeedbackCampaignRequest
{
    public required string EventName { get; init; }
    public string? EventDate { get; init; }
    public bool IsOpen { get; init; } = true;
    public string? OpensOn { get; init; }
    public string? ClosesOn { get; init; }
    public string? CustomQuestion { get; init; }
}

public sealed class SubmitFeedbackRequest
{
    public Dictionary<string, JsonElement> Answers { get; init; } = [];
    public string? Website { get; init; }
}

public sealed class FeedbackEventData
{
    public FeedbackCampaign? Campaign { get; init; }
    public IReadOnlyList<FeedbackResponse> Responses { get; init; } = [];
    public FeedbackAvailability? Availability { get; init; }
}

public sealed class FeedbackAvailability
{
    public bool IsAcceptingResponses { get; init; }
    public required string Status { get; init; }
    public required string Message { get; init; }
    public required string ClubDate { get; init; }
    public string? OpensOn { get; init; }
    public string? ClosesOn { get; init; }
}
