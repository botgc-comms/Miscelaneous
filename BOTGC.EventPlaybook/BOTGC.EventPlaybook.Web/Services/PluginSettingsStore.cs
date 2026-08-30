using System.Text;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using Microsoft.AspNetCore.DataProtection;

namespace BOTGC.EventPlaybook.Services;

public interface IPluginSettingsStore
{
    Task<PluginSettingsOverview> GetOverviewAsync(CancellationToken cancellationToken);
    Task<IntelligentGolfPluginSummary> SaveIntelligentGolfAsync(
        SaveIntelligentGolfPluginRequest request,
        CancellationToken cancellationToken);
    Task<IntelligentGolfPluginCredentials> ResolveIntelligentGolfCredentialsAsync(
        SaveIntelligentGolfPluginRequest request,
        CancellationToken cancellationToken);
    Task<IntelligentGolfPluginCredentials?> GetIntelligentGolfCredentialsAsync(
        CancellationToken cancellationToken);
    Task<MondayPluginSummary> SaveMondayAsync(
        SaveMondayPluginRequest request,
        CancellationToken cancellationToken);
    Task<PluginSettingsOverview> SetEnabledAsync(
        string pluginId,
        bool enabled,
        CancellationToken cancellationToken);
    Task<PluginSettingsOverview> DisconnectAsync(string pluginId, CancellationToken cancellationToken);
}

public sealed class PluginSettingsStore : IPluginSettingsStore
{
    private const int MaximumSecretLength = 4_096;
    private const int MaximumSettingLength = 500;
    private readonly string _path;
    private readonly IDataProtector _protector;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public PluginSettingsStore(IWebHostEnvironment environment, IDataProtectionProvider dataProtectionProvider)
    {
        var directory = Path.Combine(environment.ContentRootPath, "App_Data");
        Directory.CreateDirectory(directory);
        _path = Path.Combine(directory, "plugin-settings.json");
        _protector = dataProtectionProvider.CreateProtector("BOTGC.EventPlaybook.PluginSettings.v1");
    }

    public async Task<PluginSettingsOverview> GetOverviewAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return CreateOverview(await LoadAsync(cancellationToken));
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IntelligentGolfPluginSummary> SaveIntelligentGolfAsync(
        SaveIntelligentGolfPluginRequest request,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            var current = document.IntelligentGolf ?? new IntelligentGolfPluginRecord();
            var siteUrl = NormaliseHttpsUrl(request.SiteUrl, "The Intelligent Golf site URL");
            var encryptedPin = UpdateSecret(current.EncryptedPin, request.EffectiveMemberId, "member ID");
            var encryptedPassword = UpdateSecret(current.EncryptedPassword, request.EffectiveMemberPassword, "member PIN/password");
            var encryptedAdminPassword = UpdateSecret(current.EncryptedAdminPassword, request.AdminPassword, "administrator password");

            var configured = !string.IsNullOrWhiteSpace(siteUrl) &&
                             HasSecret(encryptedPin) &&
                             HasSecret(encryptedPassword) &&
                             HasSecret(encryptedAdminPassword);
            if (request.Enabled && !configured)
            {
                throw new ArgumentException("Add the site URL, member ID, member PIN/password and administrator password before enabling Intelligent Golf.");
            }

            document.IntelligentGolf = new IntelligentGolfPluginRecord
            {
                Enabled = request.Enabled,
                SiteUrl = siteUrl,
                EncryptedPin = encryptedPin,
                EncryptedPassword = encryptedPassword,
                EncryptedAdminPassword = encryptedAdminPassword,
                UpdatedAtUtc = DateTimeOffset.UtcNow
            };
            await SaveAsync(document, cancellationToken);
            return CreateIntelligentGolfSummary(document.IntelligentGolf);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IntelligentGolfPluginCredentials> ResolveIntelligentGolfCredentialsAsync(
        SaveIntelligentGolfPluginRequest request,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var current = (await LoadAsync(cancellationToken)).IntelligentGolf ?? new IntelligentGolfPluginRecord();
            var siteUrl = NormaliseHttpsUrl(request.SiteUrl, "The Intelligent Golf site URL");
            var memberId = ResolveSecret(current.EncryptedPin, request.EffectiveMemberId);
            var memberPassword = ResolveSecret(current.EncryptedPassword, request.EffectiveMemberPassword);
            var adminPassword = ResolveSecret(current.EncryptedAdminPassword, request.AdminPassword);
            return CreateCredentials(siteUrl, memberId, memberPassword, adminPassword);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IntelligentGolfPluginCredentials?> GetIntelligentGolfCredentialsAsync(
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var record = (await LoadAsync(cancellationToken)).IntelligentGolf;
            if (record is null) return null;
            var memberId = ResolveSecret(record.EncryptedPin, null);
            var memberPassword = ResolveSecret(record.EncryptedPassword, null);
            var adminPassword = ResolveSecret(record.EncryptedAdminPassword, null);
            return CreateCredentials(record.SiteUrl, memberId, memberPassword, adminPassword);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<MondayPluginSummary> SaveMondayAsync(
        SaveMondayPluginRequest request,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            var current = document.Monday ?? new MondayPluginRecord();
            var encryptedApiToken = UpdateSecret(current.EncryptedApiToken, request.ApiToken, "API token");
            var workspaceId = NormaliseSetting(request.WorkspaceId, "workspace ID");
            var boardId = NormaliseSetting(request.BoardId, "board ID");
            var configured = HasSecret(encryptedApiToken);
            if (request.Enabled && !configured)
            {
                throw new ArgumentException("Add a Monday.com API token before enabling the plugin.");
            }

            document.Monday = new MondayPluginRecord
            {
                Enabled = request.Enabled,
                EncryptedApiToken = encryptedApiToken,
                WorkspaceId = workspaceId,
                BoardId = boardId,
                UpdatedAtUtc = DateTimeOffset.UtcNow
            };
            await SaveAsync(document, cancellationToken);
            return CreateMondaySummary(document.Monday);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PluginSettingsOverview> DisconnectAsync(string pluginId, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            switch (pluginId.Trim().ToLowerInvariant())
            {
                case "intelligent-golf":
                    document.IntelligentGolf = null;
                    break;
                case "monday":
                    document.Monday = null;
                    break;
                default:
                    throw new KeyNotFoundException("That plugin does not exist.");
            }

            await SaveAsync(document, cancellationToken);
            return CreateOverview(document);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PluginSettingsOverview> SetEnabledAsync(
        string pluginId,
        bool enabled,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            switch (pluginId.Trim().ToLowerInvariant())
            {
                case "intelligent-golf":
                {
                    var record = document.IntelligentGolf ?? new IntelligentGolfPluginRecord();
                    var configured = !string.IsNullOrWhiteSpace(record.SiteUrl) &&
                                     HasSecret(record.EncryptedPin) &&
                                     HasSecret(record.EncryptedPassword) &&
                                     HasSecret(record.EncryptedAdminPassword);
                    if (enabled && !configured)
                    {
                        throw new ArgumentException("Configure Intelligent Golf before turning the module on.");
                    }

                    record.Enabled = enabled;
                    record.UpdatedAtUtc = DateTimeOffset.UtcNow;
                    document.IntelligentGolf = record;
                    break;
                }
                case "monday":
                {
                    var record = document.Monday ?? new MondayPluginRecord();
                    if (enabled && !HasSecret(record.EncryptedApiToken))
                    {
                        throw new ArgumentException("Configure Monday.com before turning the module on.");
                    }

                    record.Enabled = enabled;
                    record.UpdatedAtUtc = DateTimeOffset.UtcNow;
                    document.Monday = record;
                    break;
                }
                default:
                    throw new KeyNotFoundException("That plugin does not exist.");
            }

            await SaveAsync(document, cancellationToken);
            return CreateOverview(document);
        }
        finally
        {
            _gate.Release();
        }
    }

    private string? UpdateSecret(string? currentEncryptedValue, string? replacement, string label)
    {
        if (string.IsNullOrEmpty(replacement)) return currentEncryptedValue;
        if (replacement.Length > MaximumSecretLength)
        {
            throw new ArgumentException($"The {label} is too long.");
        }

        return _protector.Protect(replacement);
    }

    private string? ResolveSecret(string? currentEncryptedValue, string? replacement)
    {
        if (!string.IsNullOrEmpty(replacement)) return replacement;
        return string.IsNullOrWhiteSpace(currentEncryptedValue)
            ? null
            : _protector.Unprotect(currentEncryptedValue);
    }

    private static IntelligentGolfPluginCredentials CreateCredentials(
        string? siteUrl,
        string? memberId,
        string? memberPassword,
        string? adminPassword)
    {
        if (string.IsNullOrWhiteSpace(siteUrl) ||
            string.IsNullOrWhiteSpace(memberId) ||
            string.IsNullOrWhiteSpace(memberPassword) ||
            string.IsNullOrWhiteSpace(adminPassword))
        {
            throw new ArgumentException(
                "Add the site URL, member ID, member PIN/password and administrator password before enabling Intelligent Golf.");
        }

        return new IntelligentGolfPluginCredentials(siteUrl, memberId, memberPassword, adminPassword);
    }

    private static bool HasSecret(string? encryptedValue) => !string.IsNullOrWhiteSpace(encryptedValue);

    private static string? NormaliseHttpsUrl(string? value, string label)
    {
        var normalised = NormaliseSetting(value, label);
        if (normalised is null) return null;
        if (!Uri.TryCreate(normalised, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
        {
            throw new ArgumentException($"{label} must be a complete https URL.");
        }

        return normalised.TrimEnd('/');
    }

    private static string? NormaliseSetting(string? value, string label)
    {
        var normalised = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalised)) return null;
        if (normalised.Length > MaximumSettingLength)
        {
            throw new ArgumentException($"The {label} is too long.");
        }

        return normalised;
    }

    private async Task<PluginSettingsDocument> LoadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path)) return new PluginSettingsDocument();
        await using var stream = File.OpenRead(_path);
        return await JsonSerializer.DeserializeAsync<PluginSettingsDocument>(stream, _jsonOptions, cancellationToken)
            ?? new PluginSettingsDocument();
    }

    private async Task SaveAsync(PluginSettingsDocument document, CancellationToken cancellationToken)
    {
        var temporaryPath = $"{_path}.{Guid.NewGuid():N}.tmp";
        try
        {
            var json = JsonSerializer.Serialize(document, _jsonOptions);
            await File.WriteAllTextAsync(temporaryPath, json, new UTF8Encoding(false), cancellationToken);
            File.Move(temporaryPath, _path, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private static PluginSettingsOverview CreateOverview(PluginSettingsDocument document) => new()
    {
        IntelligentGolf = CreateIntelligentGolfSummary(document.IntelligentGolf),
        Monday = CreateMondaySummary(document.Monday)
    };

    private static IntelligentGolfPluginSummary CreateIntelligentGolfSummary(IntelligentGolfPluginRecord? record) => new()
    {
        Enabled = record?.Enabled == true,
        Configured = !string.IsNullOrWhiteSpace(record?.SiteUrl) &&
                     HasSecret(record?.EncryptedPin) &&
                     HasSecret(record?.EncryptedPassword) &&
                     HasSecret(record?.EncryptedAdminPassword),
        SiteUrl = record?.SiteUrl,
        HasMemberId = HasSecret(record?.EncryptedPin),
        HasMemberPassword = HasSecret(record?.EncryptedPassword),
        HasAdminPassword = HasSecret(record?.EncryptedAdminPassword),
        UpdatedAtUtc = record?.UpdatedAtUtc
    };

    private static MondayPluginSummary CreateMondaySummary(MondayPluginRecord? record) => new()
    {
        Enabled = record?.Enabled == true,
        Configured = HasSecret(record?.EncryptedApiToken),
        WorkspaceId = record?.WorkspaceId,
        BoardId = record?.BoardId,
        HasApiToken = HasSecret(record?.EncryptedApiToken),
        UpdatedAtUtc = record?.UpdatedAtUtc
    };

    private sealed class PluginSettingsDocument
    {
        public int Version { get; init; } = 1;
        public IntelligentGolfPluginRecord? IntelligentGolf { get; set; }
        public MondayPluginRecord? Monday { get; set; }
    }

    private sealed class IntelligentGolfPluginRecord
    {
        public bool Enabled { get; set; }
        public string? SiteUrl { get; init; }
        public string? EncryptedPin { get; init; }
        public string? EncryptedPassword { get; init; }
        public string? EncryptedAdminPassword { get; init; }
        public DateTimeOffset? UpdatedAtUtc { get; set; }
    }

    private sealed class MondayPluginRecord
    {
        public bool Enabled { get; set; }
        public string? EncryptedApiToken { get; init; }
        public string? WorkspaceId { get; init; }
        public string? BoardId { get; init; }
        public DateTimeOffset? UpdatedAtUtc { get; set; }
    }
}
