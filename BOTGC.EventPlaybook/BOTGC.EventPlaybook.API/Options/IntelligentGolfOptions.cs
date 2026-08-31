namespace BOTGC.EventPlaybook.API.Options;

public sealed class IntelligentGolfOptions
{
    public const string SectionName = "IntelligentGolf";

    public string BaseUrl { get; init; } = string.Empty;
    public string MemberId { get; init; } = string.Empty;
    public string MemberPassword { get; init; } = string.Empty;
    public string AdminPassword { get; init; } = string.Empty;
    public int LoginRefreshMinutes { get; init; } = 30;
    public int EmailSenderMemberNumber { get; init; }
    public string EmailFromName { get; init; } = string.Empty;
    public string EmailFromAddress { get; init; } = string.Empty;
    public IntelligentGolfEndpointOptions Endpoints { get; init; } = new();
}

public sealed class IntelligentGolfEndpointOptions
{
    public string MembersReportPath { get; init; } = string.Empty;
    public string MemberContactReportPath { get; init; } = string.Empty;
    public string PlayerIdLookupReportPath { get; init; } = string.Empty;
    public string ActiveCompetitionsPath { get; init; } = string.Empty;
    public string UpcomingCompetitionsPath { get; init; } = string.Empty;
    public string SendEmailPathTemplate { get; init; } = string.Empty;
    public string BulkEmailComposerPath { get; init; } = string.Empty;
    public string BulkEmailSendPath { get; init; } = string.Empty;
    public string DiaryReadPathTemplate { get; init; } = string.Empty;
    public string DiaryUpdatePathTemplate { get; init; } = string.Empty;
    public string PlannerReadPathTemplate { get; init; } = string.Empty;
    public string PlannerUpdatePathTemplate { get; init; } = string.Empty;
}
