using System.Text;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class EventFileStoreTests
{
    [Theory]
    [InlineData("image/png")]
    [InlineData("image/jpeg")]
    [InlineData("image/webp")]
    [InlineData("image/gif")]
    [InlineData("IMAGE/PNG; charset=binary")]
    public void IsSafeImagePreviewContentType_AllowsSupportedRasterImages(string contentType)
    {
        Assert.True(EventFileStore.IsSafeImagePreviewContentType(contentType));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("image/svg+xml")]
    [InlineData("text/html")]
    [InlineData("application/pdf")]
    [InlineData("application/octet-stream")]
    public void IsSafeImagePreviewContentType_RejectsDocumentsAndActiveContent(string? contentType)
    {
        Assert.False(EventFileStore.IsSafeImagePreviewContentType(contentType));
    }

    [Fact]
    public async Task SaveListGetAndDelete_PersistsAnEventAttachmentOutsideSharedState()
    {
        using var root = new TemporaryContentRoot();
        var store = CreateStore(root.Path);
        await using var content = new MemoryStream(Encoding.UTF8.GetBytes("table plan contents"));

        var saved = await store.SaveAsync(
            "event-123",
            "table-plan.txt",
            "text/plain; charset=utf-8",
            content,
            EventFileStore.MaximumFileBytes,
            "Event organiser",
            CancellationToken.None);

        var reloadedStore = CreateStore(root.Path);
        var listed = Assert.Single(await reloadedStore.ListAsync("event-123", CancellationToken.None));
        Assert.Equal(saved.Id, listed.Id);
        Assert.Equal("table-plan.txt", listed.FileName);
        Assert.Equal("text/plain", listed.ContentType);
        Assert.Equal("Event organiser", listed.UploadedBy);
        var asset = await reloadedStore.GetAsync("event-123", saved.Id, CancellationToken.None);
        Assert.NotNull(asset);
        Assert.Equal("table plan contents", await File.ReadAllTextAsync(asset.Path));

        Assert.True(await reloadedStore.DeleteAsync("event-123", saved.Id, CancellationToken.None));
        Assert.Empty(await reloadedStore.ListAsync("event-123", CancellationToken.None));
        Assert.Null(await reloadedStore.GetAsync("event-123", saved.Id, CancellationToken.None));
    }

    [Fact]
    public async Task SaveAsync_StripsClientPathsFromFileNames()
    {
        using var root = new TemporaryContentRoot();
        var store = CreateStore(root.Path);
        await using var content = new MemoryStream([1, 2, 3]);

        var saved = await store.SaveAsync(
            "event-123",
            "C:\\Users\\Someone\\menu.pdf",
            "application/pdf",
            content,
            EventFileStore.MaximumFileBytes,
            null,
            CancellationToken.None);

        Assert.Equal("menu.pdf", saved.FileName);
        Assert.Equal(3, saved.SizeBytes);
    }

    [Fact]
    public async Task SaveAsync_RejectsEmptyAndOversizedContentWithoutPublishingMetadata()
    {
        using var root = new TemporaryContentRoot();
        var store = CreateStore(root.Path);

        await Assert.ThrowsAsync<InvalidDataException>(() => store.SaveAsync(
            "event-123",
            "empty.txt",
            "text/plain",
            new MemoryStream(),
            EventFileStore.MaximumFileBytes,
            null,
            CancellationToken.None));

        await Assert.ThrowsAsync<InvalidDataException>(() => store.SaveAsync(
            "event-123",
            "too-large.bin",
            "application/octet-stream",
            new MemoryStream([1, 2, 3, 4]),
            3,
            null,
            CancellationToken.None));

        Assert.Empty(await store.ListAsync("event-123", CancellationToken.None));
    }

    private static EventFileStore CreateStore(string contentRoot) =>
        new(new TestWebHostEnvironment(contentRoot));

    private sealed class TemporaryContentRoot : IDisposable
    {
        public TemporaryContentRoot()
        {
            Path = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                "botgc-event-playbook-file-tests",
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }

        public void Dispose()
        {
            if (Directory.Exists(Path)) Directory.Delete(Path, recursive: true);
        }
    }

    private sealed class TestWebHostEnvironment(string contentRootPath) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "BOTGC.EventPlaybook.Web.Tests";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = contentRootPath;
        public string EnvironmentName { get; set; } = "Testing";
        public string ContentRootPath { get; set; } = contentRootPath;
        public IFileProvider ContentRootFileProvider { get; set; } = new PhysicalFileProvider(contentRootPath);
    }
}
