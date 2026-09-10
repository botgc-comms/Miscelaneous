using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class IntelligentGolfIntegrationLinkStoreTests
{
    private static readonly DateTimeOffset InitialSynchronisedAt =
        new(2026, 9, 10, 8, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset DiaryPublishedAt =
        new(2026, 9, 10, 8, 15, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset RelinkedAt =
        new(2026, 9, 10, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task RelinkEventAsync_AtomicallyPersistsNewPlannerAndClearsPlannerSpecificState()
    {
        using var root = new TemporaryContentRoot();
        var store = CreateStore(root.Path);
        await SeedRichLinkAsync(store, "event-123", 4713);

        var result = await store.RelinkEventAsync(
            "event-123",
            expectedIntelligentGolfEventId: 4713,
            intelligentGolfEventId: 4733,
            fingerprint: "new-fingerprint",
            relinkedAtUtc: RelinkedAt,
            CancellationToken.None);

        Assert.Equal(4733, result.IntelligentGolfEventId);
        Assert.Null(result.IntelligentGolfDiaryEntryId);
        Assert.Null(result.DiaryPublishedAtUtc);
        Assert.Equal("new-fingerprint", result.LastEventFingerprint);
        Assert.Equal(RelinkedAt, result.EventSynchronisedAtUtc);
        Assert.Null(result.LastError);
        Assert.Null(result.LastErrorStage);
        Assert.Null(result.LastErrorStatusCode);
        Assert.Null(result.PendingMatchEventDate);
        Assert.Empty(result.PendingMatchCandidates);
        Assert.Null(result.MatchRequiredAtUtc);

        var reloaded = await CreateStore(root.Path).GetAsync("event-123", CancellationToken.None);
        Assert.NotNull(reloaded);
        Assert.Equal(4733, reloaded.IntelligentGolfEventId);
        Assert.Null(reloaded.IntelligentGolfDiaryEntryId);
        Assert.Null(reloaded.DiaryPublishedAtUtc);
        Assert.Equal("new-fingerprint", reloaded.LastEventFingerprint);
        Assert.Equal(RelinkedAt, reloaded.EventSynchronisedAtUtc);
    }

    [Fact]
    public async Task RelinkEventAsync_WhenPlannerIsUnchanged_PreservesAllExistingState()
    {
        using var root = new TemporaryContentRoot();
        var store = CreateStore(root.Path);
        await SeedRichLinkAsync(store, "event-123", 4713);
        var before = await store.GetAsync("event-123", CancellationToken.None);
        Assert.NotNull(before);

        var result = await store.RelinkEventAsync(
            "event-123",
            expectedIntelligentGolfEventId: 4713,
            intelligentGolfEventId: 4713,
            fingerprint: "must-not-replace-existing-fingerprint",
            relinkedAtUtc: RelinkedAt,
            CancellationToken.None);

        Assert.Equal(before.IntelligentGolfEventId, result.IntelligentGolfEventId);
        Assert.Equal(before.IntelligentGolfDiaryEntryId, result.IntelligentGolfDiaryEntryId);
        Assert.Equal(before.DiaryPublishedAtUtc, result.DiaryPublishedAtUtc);
        Assert.Equal(before.LastEventFingerprint, result.LastEventFingerprint);
        Assert.Equal(before.EventSynchronisedAtUtc, result.EventSynchronisedAtUtc);
        Assert.Equal(before.LastError, result.LastError);
        Assert.Equal(before.LastErrorStage, result.LastErrorStage);
        Assert.Equal(before.LastErrorStatusCode, result.LastErrorStatusCode);
        Assert.Equal(before.PendingMatchEventDate, result.PendingMatchEventDate);
        Assert.Equal(
            before.PendingMatchCandidates.Select(candidate => candidate.IntelligentGolfEventId),
            result.PendingMatchCandidates.Select(candidate => candidate.IntelligentGolfEventId));
        Assert.Equal(before.MatchRequiredAtUtc, result.MatchRequiredAtUtc);
        Assert.Equal(before.UpdatedAtUtc, result.UpdatedAtUtc);
    }

    [Fact]
    public async Task RelinkEventAsync_WhenTargetBelongsToAnotherEvent_RejectsWithoutChangingEitherLink()
    {
        using var root = new TemporaryContentRoot();
        var store = CreateStore(root.Path);
        await SeedRichLinkAsync(store, "event-123", 4713);
        await store.SaveEventAsync(
            "event-456",
            4733,
            "other-fingerprint",
            InitialSynchronisedAt,
            CancellationToken.None);

        var exception = await Assert.ThrowsAsync<IntelligentGolfPlannerEventAlreadyLinkedException>(() =>
            store.RelinkEventAsync(
                "event-123",
                expectedIntelligentGolfEventId: 4713,
                intelligentGolfEventId: 4733,
                fingerprint: "new-fingerprint",
                relinkedAtUtc: RelinkedAt,
                CancellationToken.None));

        Assert.Equal(4733, exception.IntelligentGolfEventId);
        var reloadedStore = CreateStore(root.Path);
        var first = await reloadedStore.GetAsync("event-123", CancellationToken.None);
        var second = await reloadedStore.GetAsync("event-456", CancellationToken.None);
        Assert.Equal(4713, first?.IntelligentGolfEventId);
        Assert.Equal(4963, first?.IntelligentGolfDiaryEntryId);
        Assert.Equal(4733, second?.IntelligentGolfEventId);
    }

    [Fact]
    public async Task RelinkEventAsync_WhenExpectedPlannerIsStale_RejectsWithoutChangingThePersistedLink()
    {
        using var root = new TemporaryContentRoot();
        var store = CreateStore(root.Path);
        await store.SaveEventAsync(
            "event-123",
            4800,
            "current-fingerprint",
            InitialSynchronisedAt,
            CancellationToken.None);

        var exception = await Assert.ThrowsAsync<IntelligentGolfPlannerLinkChangedException>(() =>
            store.RelinkEventAsync(
                "event-123",
                expectedIntelligentGolfEventId: 4713,
                intelligentGolfEventId: 4733,
                fingerprint: "new-fingerprint",
                relinkedAtUtc: RelinkedAt,
                CancellationToken.None));

        Assert.Equal(4713, exception.ExpectedIntelligentGolfEventId);
        Assert.Equal(4800, exception.ActualIntelligentGolfEventId);
        var reloaded = await CreateStore(root.Path).GetAsync("event-123", CancellationToken.None);
        Assert.Equal(4800, reloaded?.IntelligentGolfEventId);
        Assert.Equal("current-fingerprint", reloaded?.LastEventFingerprint);
    }

    private static IntelligentGolfIntegrationLinkStore CreateStore(string contentRootPath) =>
        new(new TestWebHostEnvironment(contentRootPath));

    private static async Task SeedRichLinkAsync(
        IIntelligentGolfIntegrationLinkStore store,
        string eventId,
        int intelligentGolfEventId)
    {
        await store.SaveEventAsync(
            eventId,
            intelligentGolfEventId,
            "initial-fingerprint",
            InitialSynchronisedAt,
            CancellationToken.None);
        await store.SaveDiaryAsync(
            eventId,
            intelligentGolfEventId,
            4963,
            DiaryPublishedAt,
            CancellationToken.None);
        await store.SaveMatchRequiredAsync(
            eventId,
            "2026-12-12",
            [new IntelligentGolfPlannerEventCandidate { IntelligentGolfEventId = 4733, Name = "Alternative event" }],
            CancellationToken.None);
        await store.RecordFailureAsync(
            eventId,
            "Previous failure",
            "previous-stage",
            502,
            CancellationToken.None);
    }

    private sealed class TemporaryContentRoot : IDisposable
    {
        public TemporaryContentRoot()
        {
            Path = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                "botgc-event-playbook-link-tests",
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
