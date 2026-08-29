namespace BOTGC.EventPlaybook.Options;

public sealed class IntelligentGolfOptions
{
    public string DiaryEndpoint { get; set; } = string.Empty;

    public string ApiToken { get; set; } = string.Empty;

    public string ClubId { get; set; } = string.Empty;

    public string HttpMethod { get; set; } = "PUT";

    public bool IsConfigured =>
        Uri.TryCreate(DiaryEndpoint, UriKind.Absolute, out _) &&
        !string.IsNullOrWhiteSpace(ApiToken) &&
        !string.IsNullOrWhiteSpace(ClubId);
}
