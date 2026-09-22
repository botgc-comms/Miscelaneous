using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class PersistentStorageMaintenanceServiceTests : IDisposable
{
    private readonly string _contentRoot = Path.Combine(
        Path.GetTempPath(),
        $"event-playbook-storage-maintenance-tests-{Guid.NewGuid():N}");

    [Fact]
    public async Task StartupCleanupRetainsReferencedArtworkAndRemovesOnlyOldOrphanedVersions()
    {
        var dataDirectory = Path.Combine(_contentRoot, "App_Data");
        var sessionsDirectory = Path.Combine(dataDirectory, "poster-sessions");
        var artworkDirectory = Path.Combine(dataDirectory, "poster-artwork");
        Directory.CreateDirectory(sessionsDirectory);

        const string key = "event-1";
        const string outputId = "square";
        const string referencedVersion = "referenced-version";
        const string orphanedVersion = "orphaned-version";
        var outputDirectory = Path.Combine(artworkDirectory, Hash(key));
        Directory.CreateDirectory(outputDirectory);
        var referencedPath = Path.Combine(outputDirectory, $"{Hash(outputId)}-{Hash(referencedVersion)}.image");
        var orphanedPath = Path.Combine(outputDirectory, $"{Hash(outputId)}-{Hash(orphanedVersion)}.image");
        await File.WriteAllBytesAsync(referencedPath, [1, 2, 3]);
        await File.WriteAllBytesAsync(orphanedPath, [4, 5, 6]);
        await File.WriteAllTextAsync($"{orphanedPath}.content-type", "image/png");
        File.SetLastWriteTimeUtc(orphanedPath, DateTime.UtcNow.AddHours(-2));
        File.SetLastWriteTimeUtc($"{orphanedPath}.content-type", DateTime.UtcNow.AddHours(-2));
        var temporaryPath = Path.Combine(dataDirectory, "abandoned.tmp");
        await File.WriteAllTextAsync(temporaryPath, "partial");
        await File.WriteAllTextAsync(
            Path.Combine(sessionsDirectory, "session.json"),
            JsonSerializer.Serialize(new
            {
                artwork = $"/api/poster/artwork?key={key}&outputId={outputId}&version={referencedVersion}"
            }));

        var service = new PersistentStorageMaintenanceService(
            new TestWebHostEnvironment(_contentRoot),
            NullLogger<PersistentStorageMaintenanceService>.Instance);
        await service.StartAsync(CancellationToken.None);

        Assert.True(File.Exists(referencedPath));
        Assert.False(File.Exists(orphanedPath));
        Assert.False(File.Exists($"{orphanedPath}.content-type"));
        Assert.False(File.Exists(temporaryPath));
    }

    public void Dispose()
    {
        if (!Directory.Exists(_contentRoot)) return;
        var resolved = Path.GetFullPath(_contentRoot);
        if (!resolved.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(resolved).StartsWith("event-playbook-storage-maintenance-tests-", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Unexpected test cleanup path: {resolved}");
        }
        Directory.Delete(resolved, recursive: true);
    }

    private static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private sealed class TestWebHostEnvironment(string contentRootPath) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "BOTGC.EventPlaybook.Web.Tests";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = Path.Combine(contentRootPath, "wwwroot");
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = contentRootPath;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
