using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class PrototypePersistenceStoreTests : IDisposable
{
    private readonly string _contentRoot = Path.Combine(
        Path.GetTempPath(),
        $"event-playbook-poster-session-tests-{Guid.NewGuid():N}");

    [Fact]
    public async Task SaveAsync_AcceptsRevisionZeroWhenCreatingSession()
    {
        var store = CreateStore();

        var result = await store.SaveAsync(
            "event-1",
            0,
            Session("first"),
            CancellationToken.None);

        Assert.False(result.Conflict);
        Assert.Equal(1, result.Document.Revision);
        Assert.Equal("first", Marker(result.Document));
    }

    [Fact]
    public async Task SaveAsync_AcceptsCurrentRevisionAndAdvancesIt()
    {
        var store = CreateStore();
        var created = await store.SaveAsync(
            "event-1",
            0,
            Session("first"),
            CancellationToken.None);

        var updated = await store.SaveAsync(
            "event-1",
            created.Document.Revision,
            Session("second"),
            CancellationToken.None);

        Assert.False(updated.Conflict);
        Assert.Equal(2, updated.Document.Revision);
        Assert.Equal("second", Marker(updated.Document));
    }

    [Fact]
    public async Task SaveAsync_RejectsStaleRevisionAndReturnsCurrentSession()
    {
        var store = CreateStore();
        var created = await store.SaveAsync(
            "event-1",
            0,
            Session("first"),
            CancellationToken.None);
        var updated = await store.SaveAsync(
            "event-1",
            created.Document.Revision,
            Session("second"),
            CancellationToken.None);

        var stale = await store.SaveAsync(
            "event-1",
            created.Document.Revision,
            Session("stale overwrite"),
            CancellationToken.None);

        Assert.True(stale.Conflict);
        Assert.Equal(updated.Document.Revision, stale.Document.Revision);
        Assert.Equal("second", Marker(stale.Document));

        var retained = await store.GetAsync("event-1", CancellationToken.None);
        Assert.NotNull(retained);
        Assert.Equal(updated.Document.Revision, retained.Revision);
        Assert.Equal("second", Marker(retained));
    }

    [Fact]
    public async Task SaveAsync_ProtectsExistingSessionWhenRevisionIsOmitted()
    {
        var store = CreateStore();
        var created = await store.SaveAsync(
            "event-1",
            0,
            Session("current"),
            CancellationToken.None);

        // Missing ExpectedRevision binds to zero. That remains compatible for
        // the first save, but cannot overwrite an existing campaign session.
        var missingRevision = await store.SaveAsync(
            "event-1",
            0,
            Session("unversioned overwrite"),
            CancellationToken.None);

        Assert.True(missingRevision.Conflict);
        Assert.Equal(created.Document.Revision, missingRevision.Document.Revision);
        Assert.Equal("current", Marker(missingRevision.Document));
    }

    public void Dispose()
    {
        if (!Directory.Exists(_contentRoot)) return;

        var resolvedRoot = Path.GetFullPath(_contentRoot);
        var expectedParent = Path.GetFullPath(Path.GetTempPath());
        if (!resolvedRoot.StartsWith(expectedParent, StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(resolvedRoot).StartsWith("event-playbook-poster-session-tests-", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Unexpected test cleanup path: {resolvedRoot}");
        }

        Directory.Delete(resolvedRoot, recursive: true);
    }

    private IPosterSessionStore CreateStore()
    {
        Directory.CreateDirectory(_contentRoot);
        return new PrototypePersistenceStore(new TestWebHostEnvironment(_contentRoot));
    }

    private static JsonElement Session(string marker) => JsonSerializer.SerializeToElement(new { marker });

    private static string Marker(PosterSessionDocument document) =>
        document.Session.GetProperty("marker").GetString()!;

    private sealed class TestWebHostEnvironment(string contentRootPath) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "BOTGC.EventPlaybook.Web.Tests";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = Path.Combine(contentRootPath, "wwwroot");
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ContentRootPath { get; set; } = contentRootPath;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
