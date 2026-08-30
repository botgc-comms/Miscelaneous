using System.Text;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface IClubBrandingStore
{
    Task<ClubBrandingOverview> GetOverviewAsync(CancellationToken cancellationToken);

    Task<ClubCrestAsset?> GetCrestAsync(CancellationToken cancellationToken);

    Task<ClubBrandingOverview> SaveAsync(
        string? clubName,
        IFormFile? crest,
        bool removeCustomCrest,
        CancellationToken cancellationToken);
}

public sealed class ClubBrandingStore : IClubBrandingStore
{
    private const string DefaultClubName = "Burton-on-Trent Golf Club";
    private const string DefaultCrestUrl = "/assets/botgc-mark.svg";
    private const long MaximumCrestBytes = 5 * 1024 * 1024;
    private readonly string _directory;
    private readonly string _settingsPath;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public ClubBrandingStore(IWebHostEnvironment environment)
    {
        _directory = Path.Combine(environment.ContentRootPath, "App_Data", "branding");
        Directory.CreateDirectory(_directory);
        _settingsPath = Path.Combine(_directory, "club-branding.json");
    }

    public async Task<ClubBrandingOverview> GetOverviewAsync(CancellationToken cancellationToken)
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

    public async Task<ClubCrestAsset?> GetCrestAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(document.CrestFileName) || string.IsNullOrWhiteSpace(document.CrestContentType))
            {
                return null;
            }

            var path = CrestPath(document.CrestFileName);
            if (!File.Exists(path)) return null;
            return new ClubCrestAsset
            {
                Content = await File.ReadAllBytesAsync(path, cancellationToken),
                ContentType = document.CrestContentType
            };
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<ClubBrandingOverview> SaveAsync(
        string? clubName,
        IFormFile? crest,
        bool removeCustomCrest,
        CancellationToken cancellationToken)
    {
        var normalisedName = clubName?.Trim();
        if (string.IsNullOrWhiteSpace(normalisedName) || normalisedName.Length > 120)
        {
            throw new ArgumentException("Enter a club name of no more than 120 characters.");
        }

        CrestUpload? upload = null;
        if (crest is not null && crest.Length > 0)
        {
            if (crest.Length > MaximumCrestBytes)
            {
                throw new ArgumentException("The club crest must be 5 MB or smaller.");
            }

            await using var uploadStream = crest.OpenReadStream();
            using var memory = new MemoryStream();
            await uploadStream.CopyToAsync(memory, cancellationToken);
            upload = DetectCrest(memory.ToArray());
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            var current = await LoadAsync(cancellationToken);
            var next = new ClubBrandingDocument
            {
                ClubName = normalisedName,
                CrestFileName = current.CrestFileName,
                CrestContentType = current.CrestContentType,
                UpdatedAtUtc = DateTimeOffset.UtcNow
            };

            if (removeCustomCrest)
            {
                DeleteCrest(current.CrestFileName);
                next.CrestFileName = null;
                next.CrestContentType = null;
            }

            if (upload is not null)
            {
                var fileName = $"club-crest{upload.Extension}";
                var finalPath = CrestPath(fileName);
                var temporaryPath = $"{finalPath}.{Guid.NewGuid():N}.tmp";
                try
                {
                    await File.WriteAllBytesAsync(temporaryPath, upload.Content, cancellationToken);
                    File.Move(temporaryPath, finalPath, true);
                }
                finally
                {
                    if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
                }

                if (!string.Equals(current.CrestFileName, fileName, StringComparison.OrdinalIgnoreCase))
                {
                    DeleteCrest(current.CrestFileName);
                }

                next.CrestFileName = fileName;
                next.CrestContentType = upload.ContentType;
            }

            await SaveDocumentAsync(next, cancellationToken);
            return CreateOverview(next);
        }
        finally
        {
            _gate.Release();
        }
    }

    private static CrestUpload DetectCrest(byte[] content)
    {
        if (content.Length >= 8 && content.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }))
        {
            return new CrestUpload(content, ".png", "image/png");
        }

        if (content.Length >= 3 && content[0] == 0xff && content[1] == 0xd8 && content[2] == 0xff)
        {
            return new CrestUpload(content, ".jpg", "image/jpeg");
        }

        if (content.Length >= 12 &&
            Encoding.ASCII.GetString(content, 0, 4) == "RIFF" &&
            Encoding.ASCII.GetString(content, 8, 4) == "WEBP")
        {
            return new CrestUpload(content, ".webp", "image/webp");
        }

        throw new ArgumentException("Upload the club crest as a PNG, JPEG or WebP image.");
    }

    private async Task<ClubBrandingDocument> LoadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_settingsPath)) return new ClubBrandingDocument();
        await using var stream = File.OpenRead(_settingsPath);
        return await JsonSerializer.DeserializeAsync<ClubBrandingDocument>(stream, _jsonOptions, cancellationToken)
            ?? new ClubBrandingDocument();
    }

    private async Task SaveDocumentAsync(ClubBrandingDocument document, CancellationToken cancellationToken)
    {
        var temporaryPath = $"{_settingsPath}.{Guid.NewGuid():N}.tmp";
        try
        {
            var json = JsonSerializer.Serialize(document, _jsonOptions);
            await File.WriteAllTextAsync(temporaryPath, json, new UTF8Encoding(false), cancellationToken);
            File.Move(temporaryPath, _settingsPath, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private ClubBrandingOverview CreateOverview(ClubBrandingDocument document)
    {
        var hasCustomCrest = !string.IsNullOrWhiteSpace(document.CrestFileName) &&
                             File.Exists(CrestPath(document.CrestFileName));
        var version = document.UpdatedAtUtc?.ToUnixTimeSeconds() ?? 0;
        return new ClubBrandingOverview
        {
            ClubName = string.IsNullOrWhiteSpace(document.ClubName) ? DefaultClubName : document.ClubName,
            CrestUrl = hasCustomCrest ? $"/api/branding/crest?v={version}" : DefaultCrestUrl,
            HasCustomCrest = hasCustomCrest,
            UpdatedAtUtc = document.UpdatedAtUtc
        };
    }

    private string CrestPath(string fileName)
    {
        var safeName = Path.GetFileName(fileName);
        if (!string.Equals(safeName, fileName, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("The saved club crest path is invalid.");
        }

        return Path.Combine(_directory, safeName);
    }

    private void DeleteCrest(string? fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName)) return;
        var path = CrestPath(fileName);
        if (File.Exists(path)) File.Delete(path);
    }

    private sealed class ClubBrandingDocument
    {
        public int Version { get; init; } = 1;
        public string ClubName { get; init; } = DefaultClubName;
        public string? CrestFileName { get; set; }
        public string? CrestContentType { get; set; }
        public DateTimeOffset? UpdatedAtUtc { get; init; }
    }

    private sealed record CrestUpload(byte[] Content, string Extension, string ContentType);
}
