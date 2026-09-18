using BOTGC.EventPlaybook.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.Services;

public sealed record YodeckRuntimeSettings(
    bool Enabled,
    string ApiToken,
    string ApiTokenLabel,
    long PlaylistId,
    string PlaylistName,
    int MediaDurationSeconds,
    bool UsesLegacyConfiguration)
{
    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiToken) && PlaylistId > 0;

    public bool IsAvailable => Enabled && IsConfigured;
}

public interface IYodeckSettingsProvider
{
    Task<YodeckRuntimeSettings> GetAsync(CancellationToken cancellationToken);
}

public sealed class YodeckSettingsProvider(
    IPluginSettingsStore pluginSettingsStore,
    IOptions<YodeckOptions> legacyOptions) : IYodeckSettingsProvider
{
    private readonly YodeckOptions _legacyOptions = legacyOptions.Value;

    public async Task<YodeckRuntimeSettings> GetAsync(CancellationToken cancellationToken)
    {
        var overview = await pluginSettingsStore.GetOverviewAsync(cancellationToken);
        var summary = overview.Yodeck;

        // Deployments that pre-date the Yodeck plugin continue to work until an
        // administrator explicitly saves or disconnects the plugin. An explicit
        // disabled/empty record must win over the environment fallback.
        if (summary.UpdatedAtUtc is null)
        {
            return new YodeckRuntimeSettings(
                Enabled: _legacyOptions.IsConfigured,
                ApiToken: _legacyOptions.ApiToken,
                ApiTokenLabel: NormaliseTokenLabel(_legacyOptions.ApiTokenLabel),
                PlaylistId: _legacyOptions.PlaylistId,
                PlaylistName: NormalisePlaylistName(_legacyOptions.PlaylistName),
                MediaDurationSeconds: NormaliseDuration(_legacyOptions.MediaDurationSeconds),
                UsesLegacyConfiguration: true);
        }

        var credentials = await pluginSettingsStore.GetYodeckCredentialsAsync(cancellationToken);
        return new YodeckRuntimeSettings(
            Enabled: summary.Enabled,
            ApiToken: credentials?.ApiToken ?? string.Empty,
            ApiTokenLabel: NormaliseTokenLabel(_legacyOptions.ApiTokenLabel),
            PlaylistId: credentials?.PlaylistId ?? summary.PlaylistId,
            PlaylistName: NormalisePlaylistName(credentials?.PlaylistName ?? summary.PlaylistName),
            MediaDurationSeconds: NormaliseDuration(credentials?.MediaDurationSeconds ?? summary.MediaDurationSeconds),
            UsesLegacyConfiguration: false);
    }

    private static string NormaliseTokenLabel(string? value) =>
        string.IsNullOrWhiteSpace(value) ? "event-playbook" : value.Trim();

    private static string NormalisePlaylistName(string? value) =>
        string.IsNullOrWhiteSpace(value) ? "Clubhouse" : value.Trim();

    private static int NormaliseDuration(int value) => Math.Clamp(value <= 0 ? 15 : value, 5, 300);
}
