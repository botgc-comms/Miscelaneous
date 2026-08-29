namespace BOTGC.EventPlaybook.Models;

public sealed class RetrospectiveAnalysisRequest
{
    public required string EventName { get; init; }
    public string? EventDescription { get; init; }
    public required string RetrospectiveText { get; init; }
    public string? CustomerFeedbackText { get; init; }
    public int CustomerFeedbackResponseCount { get; init; }
    public int? SentimentRating { get; init; }
    public List<RetrospectiveTaskContext> Tasks { get; init; } = [];
}

public sealed class RetrospectiveTaskContext
{
    public required string Id { get; init; }
    public string ItemType { get; init; } = "task";
    public required string Title { get; init; }
    public string? Detail { get; init; }
    public required string ModuleId { get; init; }
    public required string ModuleTitle { get; init; }
    public required string SectionId { get; init; }
    public required string SectionTitle { get; init; }
    public bool Completed { get; init; }
}

public sealed class RetrospectiveAnalysisResult
{
    public required string Mode { get; init; }
    public required string Model { get; init; }
    public required string Summary { get; init; }
    public required string CustomerFeedbackSummary { get; init; }
    public List<RetrospectiveLearningProposal> Proposals { get; init; } = [];
}

public sealed class RetrospectiveLearningProposal
{
    public required string Id { get; init; }
    public required string Title { get; init; }
    public required string Summary { get; init; }
    public required string Importance { get; init; }
    public required string TargetItemId { get; init; }
    public required string TargetModuleId { get; init; }
    public required string TargetSectionId { get; init; }
    public int Confidence { get; init; }
    public required string Reason { get; init; }
    public required string SourceExcerpt { get; init; }
}
