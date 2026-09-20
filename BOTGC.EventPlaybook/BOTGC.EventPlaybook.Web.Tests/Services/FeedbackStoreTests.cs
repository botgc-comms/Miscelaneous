using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class FeedbackStoreTests
{
    [Fact]
    public async Task RecordAttendeeEmailAsync_PersistsAudienceAndSendIdentity()
    {
        using var root = new TemporaryContentRoot();
        var store = new FeedbackStore(new TestWebHostEnvironment(root.Path));
        await store.UpsertCampaignAsync(
            "event-123",
            new UpsertFeedbackCampaignRequest
            {
                EventName = "The 2027 Forum",
                EventDate = "2027-01-13",
                OpensOn = "2027-01-13",
                ClosesOn = "2027-01-20",
                IsOpen = true
            },
            CancellationToken.None);
        var sentAt = new DateTimeOffset(2027, 1, 14, 9, 30, 0, TimeSpan.Zero);

        await store.RecordAttendeeEmailAsync("event-123", 3, "9912", sentAt, CancellationToken.None);

        var reloaded = await new FeedbackStore(new TestWebHostEnvironment(root.Path))
            .GetForEventAsync("event-123", CancellationToken.None);
        Assert.NotNull(reloaded.Campaign);
        Assert.Equal(sentAt, reloaded.Campaign.AttendeeEmailSentAtUtc);
        Assert.Equal(3, reloaded.Campaign.AttendeeEmailRecipientCount);
        Assert.Equal("9912", reloaded.Campaign.AttendeeEmailDraftId);
    }

    private sealed class TemporaryContentRoot : IDisposable
    {
        public TemporaryContentRoot()
        {
            Path = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                "botgc-event-playbook-feedback-tests",
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
