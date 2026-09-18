using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class PluginSettingsStoreTests : IDisposable
{
    private readonly string _contentRoot = Path.Combine(
        Path.GetTempPath(),
        $"botgc-plugin-settings-tests-{Guid.NewGuid():N}");

    [Fact]
    public async Task SaveYodeckAsync_EncryptsTokenAndReturnsOnlySecretPresence()
    {
        var store = CreateStore();

        var summary = await store.SaveYodeckAsync(new SaveYodeckPluginRequest
        {
            Enabled = true,
            ApiToken = "super-secret-yodeck-token",
            PlaylistId = 147,
            PlaylistName = "Main Clubhouse",
            MediaDurationSeconds = 25
        }, CancellationToken.None);

        Assert.True(summary.Enabled);
        Assert.True(summary.Configured);
        Assert.True(summary.HasApiToken);
        Assert.Equal(147, summary.PlaylistId);
        Assert.Equal("Main Clubhouse", summary.PlaylistName);
        Assert.Equal(25, summary.MediaDurationSeconds);
        Assert.DoesNotContain(
            "super-secret-yodeck-token",
            JsonSerializer.Serialize(summary),
            StringComparison.Ordinal);

        var persisted = await File.ReadAllTextAsync(SettingsPath());
        Assert.DoesNotContain("super-secret-yodeck-token", persisted, StringComparison.Ordinal);

        var credentials = await store.GetYodeckCredentialsAsync(CancellationToken.None);
        Assert.NotNull(credentials);
        Assert.Equal("super-secret-yodeck-token", credentials.ApiToken);
        Assert.Equal(147, credentials.PlaylistId);
        Assert.Equal("Main Clubhouse", credentials.PlaylistName);
        Assert.Equal(25, credentials.MediaDurationSeconds);
    }

    [Fact]
    public async Task SaveYodeckAsync_BlankTokenRetainsSavedValue()
    {
        var store = CreateStore();
        await store.SaveYodeckAsync(new SaveYodeckPluginRequest
        {
            Enabled = false,
            ApiToken = "retained-token",
            PlaylistId = 147,
            PlaylistName = "Original playlist",
            MediaDurationSeconds = 15
        }, CancellationToken.None);

        var summary = await store.SaveYodeckAsync(new SaveYodeckPluginRequest
        {
            Enabled = true,
            ApiToken = "   ",
            PlaylistId = 999,
            PlaylistName = "Updated playlist",
            MediaDurationSeconds = 30
        }, CancellationToken.None);

        Assert.True(summary.Enabled);
        Assert.True(summary.Configured);
        var credentials = await store.GetYodeckCredentialsAsync(CancellationToken.None);
        Assert.NotNull(credentials);
        Assert.Equal("retained-token", credentials.ApiToken);
        Assert.Equal(999, credentials.PlaylistId);
        Assert.Equal("Updated playlist", credentials.PlaylistName);
        Assert.Equal(30, credentials.MediaDurationSeconds);
    }

    [Fact]
    public async Task EnablingYodeckWithoutCompleteConfigurationIsRejected()
    {
        var store = CreateStore();

        var saveException = await Assert.ThrowsAsync<ArgumentException>(() =>
            store.SaveYodeckAsync(new SaveYodeckPluginRequest
            {
                Enabled = true,
                ApiToken = "token-without-playlist"
            }, CancellationToken.None));
        Assert.Contains("playlist ID", saveException.Message, StringComparison.OrdinalIgnoreCase);

        await store.SaveYodeckAsync(new SaveYodeckPluginRequest
        {
            Enabled = false,
            PlaylistId = 147
        }, CancellationToken.None);
        var toggleException = await Assert.ThrowsAsync<ArgumentException>(() =>
            store.SetEnabledAsync("yodeck", true, CancellationToken.None));
        Assert.Contains("Configure Yodeck", toggleException.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task DisconnectYodeck_ClearsConfigurationButPersistsExplicitDisabledRecord()
    {
        var store = CreateStore();
        await store.SaveYodeckAsync(new SaveYodeckPluginRequest
        {
            Enabled = true,
            ApiToken = "token-to-remove",
            PlaylistId = 147,
            PlaylistName = "Main Clubhouse",
            MediaDurationSeconds = 15
        }, CancellationToken.None);

        var overview = await store.DisconnectAsync("yodeck", CancellationToken.None);

        Assert.False(overview.Yodeck.Enabled);
        Assert.False(overview.Yodeck.Configured);
        Assert.False(overview.Yodeck.HasApiToken);
        Assert.Equal(0, overview.Yodeck.PlaylistId);
        Assert.Null(overview.Yodeck.PlaylistName);
        Assert.Equal(0, overview.Yodeck.MediaDurationSeconds);
        Assert.NotNull(overview.Yodeck.UpdatedAtUtc);
        Assert.Null(await store.GetYodeckCredentialsAsync(CancellationToken.None));

        var persisted = await File.ReadAllTextAsync(SettingsPath());
        Assert.DoesNotContain("token-to-remove", persisted, StringComparison.Ordinal);
        using var document = JsonDocument.Parse(persisted);
        var yodeck = document.RootElement.GetProperty("yodeck");
        Assert.False(yodeck.GetProperty("enabled").GetBoolean());
        Assert.Equal(JsonValueKind.Null, yodeck.GetProperty("encryptedApiToken").ValueKind);
        Assert.Equal(JsonValueKind.String, yodeck.GetProperty("updatedAtUtc").ValueKind);
    }

    [Fact]
    public async Task GetOverviewAsync_LoadsLegacyDocumentWithoutYodeck()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath())!);
        await File.WriteAllTextAsync(SettingsPath(), """
            {
              "version": 2,
              "monday": {
                "enabled": false,
                "workspaceId": "legacy-workspace"
              }
            }
            """);
        var store = CreateStore();

        var overview = await store.GetOverviewAsync(CancellationToken.None);

        Assert.Equal("legacy-workspace", overview.Monday.WorkspaceId);
        Assert.False(overview.Yodeck.Enabled);
        Assert.False(overview.Yodeck.Configured);
        Assert.False(overview.Yodeck.HasApiToken);
        Assert.Equal(0, overview.Yodeck.PlaylistId);
        Assert.Null(overview.Yodeck.UpdatedAtUtc);
        Assert.Null(await store.GetYodeckCredentialsAsync(CancellationToken.None));
    }

    [Fact]
    public async Task YodeckSettingsProvider_UsesLegacyEnvironmentUntilPluginIsExplicitlyConfigured()
    {
        var store = CreateStore();
        var provider = new YodeckSettingsProvider(store, Microsoft.Extensions.Options.Options.Create(new YodeckOptions
        {
            ApiToken = "legacy-token",
            ApiTokenLabel = "legacy-label",
            PlaylistId = 321,
            PlaylistName = "Legacy clubhouse",
            MediaDurationSeconds = 22
        }));

        var settings = await provider.GetAsync(CancellationToken.None);

        Assert.True(settings.Enabled);
        Assert.True(settings.IsAvailable);
        Assert.True(settings.UsesLegacyConfiguration);
        Assert.Equal("legacy-token", settings.ApiToken);
        Assert.Equal(321, settings.PlaylistId);
        Assert.Equal("Legacy clubhouse", settings.PlaylistName);
        Assert.Equal(22, settings.MediaDurationSeconds);
    }

    [Fact]
    public async Task YodeckSettingsProvider_ExplicitDisconnectPreventsLegacyFallback()
    {
        var store = CreateStore();
        await store.DisconnectAsync("yodeck", CancellationToken.None);
        var provider = new YodeckSettingsProvider(store, Microsoft.Extensions.Options.Options.Create(new YodeckOptions
        {
            ApiToken = "legacy-token",
            PlaylistId = 321,
            PlaylistName = "Legacy clubhouse",
            MediaDurationSeconds = 22
        }));

        var settings = await provider.GetAsync(CancellationToken.None);

        Assert.False(settings.Enabled);
        Assert.False(settings.IsAvailable);
        Assert.False(settings.UsesLegacyConfiguration);
        Assert.Equal(string.Empty, settings.ApiToken);
        Assert.Equal(0, settings.PlaylistId);
    }

    [Fact]
    public async Task YodeckSettingsProvider_ExplicitDisableRetainsPluginConfigurationWithoutUsingLegacyFallback()
    {
        var store = CreateStore();
        await store.SaveYodeckAsync(new SaveYodeckPluginRequest
        {
            Enabled = false,
            ApiToken = "saved-plugin-token",
            PlaylistId = 147,
            PlaylistName = "Saved clubhouse",
            MediaDurationSeconds = 30
        }, CancellationToken.None);
        var provider = new YodeckSettingsProvider(store, Microsoft.Extensions.Options.Options.Create(new YodeckOptions
        {
            ApiToken = "legacy-token",
            PlaylistId = 321,
            PlaylistName = "Legacy clubhouse",
            MediaDurationSeconds = 22
        }));

        var settings = await provider.GetAsync(CancellationToken.None);

        Assert.False(settings.Enabled);
        Assert.True(settings.IsConfigured);
        Assert.False(settings.IsAvailable);
        Assert.False(settings.UsesLegacyConfiguration);
        Assert.Equal("saved-plugin-token", settings.ApiToken);
        Assert.Equal(147, settings.PlaylistId);
        Assert.Equal("Saved clubhouse", settings.PlaylistName);
        Assert.Equal(30, settings.MediaDurationSeconds);
    }

    private PluginSettingsStore CreateStore()
    {
        Directory.CreateDirectory(_contentRoot);
        var keyDirectory = Path.Combine(_contentRoot, "DataProtection-Keys");
        return new PluginSettingsStore(
            new TestWebHostEnvironment(_contentRoot),
            DataProtectionProvider.Create(new DirectoryInfo(keyDirectory)));
    }

    private string SettingsPath() => Path.Combine(_contentRoot, "App_Data", "plugin-settings.json");

    public void Dispose()
    {
        if (Directory.Exists(_contentRoot)) Directory.Delete(_contentRoot, true);
    }

    private sealed class TestWebHostEnvironment(string contentRootPath) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "BOTGC.EventPlaybook.Web.Tests";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = contentRootPath;
        public string EnvironmentName { get; set; } = "Testing";
        public string ContentRootPath { get; set; } = contentRootPath;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
