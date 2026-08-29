namespace BOTGC.EventPlaybook.Options;

public sealed class YodeckOptions
{
    public string ApiBaseUrl { get; set; } = "https://app.yodeck.com/api/v2/";

    public string ApiToken { get; set; } = string.Empty;

    public string ApiTokenLabel { get; set; } = "event-playbook";

    public long PlaylistId { get; set; }

    public string PlaylistName { get; set; } = "Clubhouse";

    public int MediaDurationSeconds { get; set; } = 15;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiToken) && PlaylistId > 0;
}
