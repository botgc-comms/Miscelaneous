using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class MemberEmailCampaignQueueTests
{
    [Fact]
    public async Task EnqueueAsync_ReusesTheSameDurableCampaignForAnIdenticalRequest()
    {
        await using var fixture = new QueueFixture();
        var first = await fixture.Queue.EnqueueAsync(Request(3104, 83642), CancellationToken.None);
        var second = await fixture.Queue.EnqueueAsync(Request(83642, 3104), CancellationToken.None);

        Assert.Equal(first.CampaignId, second.CampaignId);
        Assert.False(first.Reused);
        Assert.True(second.Reused);
        Assert.Equal(2, second.Requested);
        Assert.Empty(fixture.Communications.SentMemberNumbers);
    }

    [Fact]
    public async Task ProcessNextRecipientAsync_CheckpointsEachRecipientAndNeverResendsOnRequeue()
    {
        await using var fixture = new QueueFixture();
        var campaign = await fixture.Queue.EnqueueAsync(Request(3104, 83642), CancellationToken.None);

        Assert.True(await fixture.Queue.ProcessNextRecipientAsync(CancellationToken.None));
        Assert.True(await fixture.Queue.ProcessNextRecipientAsync(CancellationToken.None));
        Assert.False(await fixture.Queue.ProcessNextRecipientAsync(CancellationToken.None));

        var complete = await fixture.Queue.GetAsync(campaign.CampaignId, CancellationToken.None);
        Assert.NotNull(complete);
        Assert.Equal("completed", complete.Status);
        Assert.Equal(2, complete.Sent);
        Assert.Equal([3104, 83642], fixture.Communications.SentMemberNumbers);

        var duplicateClick = await fixture.Queue.EnqueueAsync(Request(83642, 3104), CancellationToken.None);
        Assert.True(duplicateClick.Reused);
        Assert.Equal("completed", duplicateClick.Status);
        Assert.False(await fixture.Queue.ProcessNextRecipientAsync(CancellationToken.None));
        Assert.Equal(2, fixture.Communications.SentMemberNumbers.Count);
    }

    [Fact]
    public async Task ProcessNextRecipientAsync_DoesNotRetryAnAmbiguousFailure()
    {
        await using var fixture = new QueueFixture { Communications = { Failure = new InvalidOperationException("Timed out") } };
        var campaign = await fixture.Queue.EnqueueAsync(Request(3104), CancellationToken.None);

        Assert.True(await fixture.Queue.ProcessNextRecipientAsync(CancellationToken.None));
        Assert.False(await fixture.Queue.ProcessNextRecipientAsync(CancellationToken.None));
        var progress = await fixture.Queue.GetAsync(campaign.CampaignId, CancellationToken.None);

        Assert.NotNull(progress);
        Assert.Equal("action-required", progress.Status);
        Assert.Equal(1, progress.Uncertain);
        Assert.Equal(0, progress.Sent);
        Assert.Equal([3104], fixture.Communications.SentMemberNumbers);

        var duplicateClick = await fixture.Queue.EnqueueAsync(Request(3104), CancellationToken.None);
        Assert.True(duplicateClick.Reused);
        Assert.False(await fixture.Queue.ProcessNextRecipientAsync(CancellationToken.None));
        Assert.Single(fixture.Communications.SentMemberNumbers);
    }

    private static MemberCampaignEmailRequest Request(params int[] memberNumbers) => new()
    {
        MemberNumbers = memberNumbers.ToList(),
        Subject = "Autumn event",
        BodyHtml = "<p>Please join us.</p>",
        EventId = "event-1",
        EventName = "Autumn event"
    };

    private sealed class QueueFixture : IAsyncDisposable
    {
        private readonly string _directory = Path.Combine(Path.GetTempPath(), $"member-email-queue-{Guid.NewGuid():N}");
        public RecordingCommunications Communications { get; } = new();
        public MemberEmailCampaignQueue Queue { get; }

        public QueueFixture()
        {
            Directory.CreateDirectory(_directory);
            Queue = new MemberEmailCampaignQueue(
                new TestEnvironment(_directory),
                Communications,
                new RecordingActivityStore(),
                TimeProvider.System,
                NullLogger<MemberEmailCampaignQueue>.Instance);
        }

        public ValueTask DisposeAsync()
        {
            Queue.Dispose();
            if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
            return ValueTask.CompletedTask;
        }
    }

    private sealed class RecordingCommunications : IIntelligentGolfMemberCommunicationsClient
    {
        public List<int> SentMemberNumbers { get; } = [];
        public Exception? Failure { get; set; }

        public Task<MemberCampaignEmailResult> SendCampaignAsync(MemberCampaignEmailRequest request, CancellationToken cancellationToken)
        {
            SentMemberNumbers.Add(Assert.Single(request.MemberNumbers));
            if (Failure is not null) throw Failure;
            return Task.FromResult(new MemberCampaignEmailResult { Requested = 1, Sent = 1 });
        }

        public Task<IReadOnlyList<MemberDirectoryEntry>> GetMembersAsync(bool refresh, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
        public Task SendTestAsync(MemberEmailTestRequest request, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
        public Task<AddressEmailDeliveryResult> SendToAddressesAsync(IReadOnlyCollection<string> recipientEmails, string subject, string bodyHtml, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }

    private sealed class RecordingActivityStore : IIntegrationActivityStore
    {
        public List<IntegrationActivityWrite> Entries { get; } = [];
        public Task RecordAsync(IntegrationActivityWrite activity, CancellationToken cancellationToken)
        {
            Entries.Add(activity);
            return Task.CompletedTask;
        }
        public Task<IReadOnlyList<IntegrationActivityEntry>> GetRecentAsync(int limit, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<IntegrationActivityEntry>>([]);
    }

    private sealed class TestEnvironment(string contentRootPath) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "Tests";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = contentRootPath;
        public string EnvironmentName { get; set; } = "Test";
        public string ContentRootPath { get; set; } = contentRootPath;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
