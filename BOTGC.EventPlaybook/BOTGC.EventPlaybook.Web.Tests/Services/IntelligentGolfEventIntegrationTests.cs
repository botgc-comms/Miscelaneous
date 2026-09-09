using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using BOTGC.EventPlaybook.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class IntelligentGolfEventIntegrationTests
{
    private static readonly byte[] PngBytes =
    [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
    ];

    private static readonly DateTimeOffset SynchronisedAt =
        new(2026, 9, 9, 8, 30, 0, TimeSpan.Zero);

    [Fact]
    public async Task PublishDiaryAsync_ForwardsSelectedPngWithEventDerivedSocialFileName()
    {
        var publishedAt = new DateTimeOffset(2026, 9, 9, 8, 35, 0, TimeSpan.Zero);
        var scenario = new PrivateApiScenario(publishedAt);
        var linkStore = new RecordingLinkStore();
        var activityStore = new RecordingActivityStore();
        var integration = CreateIntegration(scenario, linkStore, activityStore);

        var result = await integration.PublishDiaryAsync(
            CreateRequest(),
            PngBytes,
            CancellationToken.None);

        var request = Assert.Single(scenario.Requests, candidate =>
            candidate.Method == HttpMethod.Put &&
            candidate.Path == "/api/event-planner/member-diary");
        using var payload = JsonDocument.Parse(request.Body);
        Assert.Equal(
            "<p>Join fellow members for the 2027 forum.</p>",
            payload.RootElement.GetProperty("plannerDescriptionHtml").GetString());
        var artwork = payload.RootElement.GetProperty("artwork");
        Assert.Equal("the-2027-forum-social.png", artwork.GetProperty("fileName").GetString());
        Assert.Equal("image/png", artwork.GetProperty("contentType").GetString());
        Assert.Equal(PngBytes, Convert.FromBase64String(artwork.GetProperty("base64Data").GetString()!));

        Assert.Equal(4743, result.IntelligentGolfEventId);
        Assert.Equal(812, result.IntelligentGolfDiaryEntryId);
        Assert.True(result.EventImageAttached);
        Assert.Equal(publishedAt, result.PublishedAtUtc);

        var activity = Assert.Single(activityStore.Activities, candidate =>
            candidate.Operation == "Publish member diary");
        Assert.Equal("succeeded", activity.Outcome);
        Assert.Equal(4743, activity.ExternalEventId);
        Assert.Equal(812, activity.ExternalRecordId);
        Assert.Contains("attached its artwork", activity.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task PublishDiaryAsync_WhenImageStageFails_PreservesPublishedDiaryLinkAndActivityDetail()
    {
        var diaryPublishedAt = new DateTimeOffset(2026, 9, 9, 8, 40, 0, TimeSpan.Zero);
        var scenario = new PrivateApiScenario(diaryPublishedAt)
        {
            RejectDiaryRequestWithImageFailure = true
        };
        var linkStore = new RecordingLinkStore();
        var activityStore = new RecordingActivityStore();
        var integration = CreateIntegration(scenario, linkStore, activityStore);

        var exception = await Assert.ThrowsAsync<IntelligentGolfApiRequestException>(() =>
            integration.PublishDiaryAsync(CreateRequest(), PngBytes, CancellationToken.None));

        Assert.Equal(502, exception.StatusCode);
        Assert.Equal("planner-event-image-upload", exception.Stage);
        Assert.Equal(4743, exception.IntelligentGolfEventId);
        Assert.Equal(812, exception.IntelligentGolfRecordId);
        Assert.True(exception.MemberDiaryPublished);
        Assert.Equal(diaryPublishedAt, exception.MemberDiaryPublishedAtUtc);

        Assert.Equal(1, linkStore.SaveDiaryCalls);
        Assert.Equal(0, linkStore.SaveAllocatedDiaryCalls);
        var link = await linkStore.GetAsync("event-123", CancellationToken.None);
        Assert.NotNull(link);
        Assert.Equal(4743, link.IntelligentGolfEventId);
        Assert.Equal(812, link.IntelligentGolfDiaryEntryId);
        Assert.Equal(diaryPublishedAt, link.DiaryPublishedAtUtc);
        Assert.Equal("planner-event-image-upload", link.LastErrorStage);
        Assert.Equal(502, link.LastErrorStatusCode);

        var activity = Assert.Single(activityStore.Activities, candidate =>
            candidate.Operation == "Publish member diary");
        Assert.Equal("failed", activity.Outcome);
        Assert.Equal("planner-event-image-upload", activity.Stage);
        Assert.Equal(502, activity.StatusCode);
        Assert.Equal(4743, activity.ExternalEventId);
        Assert.Equal(812, activity.ExternalRecordId);
        Assert.Contains(
            "Member diary entry 812 was published, but its planner artwork was not attached.",
            activity.Message,
            StringComparison.Ordinal);
        Assert.Contains("temporary upload failure", activity.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task PublishDiaryAsync_WhenOldApiOmitsImageConfirmation_RecordsPublishedDiaryAsPartialFailure()
    {
        var diaryPublishedAt = new DateTimeOffset(2026, 9, 9, 8, 45, 0, TimeSpan.Zero);
        var scenario = new PrivateApiScenario(diaryPublishedAt)
        {
            OmitEventImageAttached = true
        };
        var linkStore = new RecordingLinkStore();
        var activityStore = new RecordingActivityStore();
        var integration = CreateIntegration(scenario, linkStore, activityStore);

        var exception = await Assert.ThrowsAsync<IntelligentGolfApiRequestException>(() =>
            integration.PublishDiaryAsync(CreateRequest(), PngBytes, CancellationToken.None));

        Assert.Equal(502, exception.StatusCode);
        Assert.Equal("planner-event-image-contract", exception.Stage);
        Assert.Equal(4743, exception.IntelligentGolfEventId);
        Assert.Equal(812, exception.IntelligentGolfRecordId);
        Assert.True(exception.MemberDiaryPublished);
        Assert.Equal(diaryPublishedAt, exception.MemberDiaryPublishedAtUtc);

        Assert.Equal(1, linkStore.SaveDiaryCalls);
        Assert.Equal(0, linkStore.SaveAllocatedDiaryCalls);
        var link = await linkStore.GetAsync("event-123", CancellationToken.None);
        Assert.NotNull(link);
        Assert.Equal(4743, link.IntelligentGolfEventId);
        Assert.Equal(812, link.IntelligentGolfDiaryEntryId);
        Assert.Equal(diaryPublishedAt, link.DiaryPublishedAtUtc);
        Assert.Equal("planner-event-image-contract", link.LastErrorStage);
        Assert.Equal(502, link.LastErrorStatusCode);

        var activity = Assert.Single(activityStore.Activities, candidate =>
            candidate.Operation == "Publish member diary");
        Assert.Equal("failed", activity.Outcome);
        Assert.Equal("planner-event-image-contract", activity.Stage);
        Assert.Equal(4743, activity.ExternalEventId);
        Assert.Equal(812, activity.ExternalRecordId);
        Assert.Contains(
            "Member diary entry 812 was published, but its planner artwork was not attached.",
            activity.Message,
            StringComparison.Ordinal);
        Assert.Contains("did not confirm", activity.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task PublishDiaryAsync_WhenArtworkExceedsTwentyMiB_DoesNotForwardItToThePrivateApi()
    {
        var scenario = new PrivateApiScenario(SynchronisedAt);
        var integration = CreateIntegration(
            scenario,
            new RecordingLinkStore(),
            new RecordingActivityStore());
        var oversizedArtwork = new byte[(20 * 1024 * 1024) + 1];
        PngBytes.AsSpan(0, 8).CopyTo(oversizedArtwork);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            integration.PublishDiaryAsync(CreateRequest(), oversizedArtwork, CancellationToken.None));

        Assert.Contains("larger than the 20 MB", exception.Message, StringComparison.Ordinal);
        Assert.Empty(scenario.Requests);
    }

    private static IntelligentGolfEventIntegration CreateIntegration(
        PrivateApiScenario scenario,
        RecordingLinkStore linkStore,
        RecordingActivityStore activityStore) =>
        new(
            new FakeHttpClientFactory(scenario.Handler),
            new NoOpSessionClient(),
            new ConfiguredPluginSettingsStore(),
            linkStore,
            activityStore,
            Microsoft.Extensions.Options.Options.Create(new EventPlaybookApiOptions
            {
                BaseUrl = "https://event-playbook-api.test/",
                ApiKey = "test-api-key"
            }),
            NullLogger<IntelligentGolfEventIntegration>.Instance);

    private static MemberDiaryPublishRequest CreateRequest() => new()
    {
        EventId = "event-123",
        EventName = "The 2027 Forum",
        Title = "The 2027 Forum",
        EventDate = "2027-02-20",
        Description = "<p>Join fellow members for the 2027 forum.</p>",
        EventDescription = "Join fellow members for the 2027 forum.",
        EventTypeId = 4,
        Attendees = 120,
        Venue = "Clubhouse",
        StartTime = "19:00",
        EndTime = "22:00",
        Artwork = new PublishAsset
        {
            OutputId = "social-square",
            Name = "Social square",
            DataUrl = "data:image/png;base64,unused-by-service-test"
        }
    };

    private sealed class PrivateApiScenario(DateTimeOffset diaryPublishedAt)
    {
        public List<CapturedRequest> Requests { get; } = [];

        public bool RejectDiaryRequestWithImageFailure { get; init; }
        public bool OmitEventImageAttached { get; init; }

        public HttpMessageHandler Handler => new RecordingHandler(Respond, Requests);

        private HttpResponseMessage Respond(CapturedRequest request)
        {
            if (request.Method == HttpMethod.Post &&
                request.Path == "/api/event-planner/events/synchronise")
            {
                return Json(HttpStatusCode.OK, new
                {
                    eventPlaybookEventId = "event-123",
                    intelligentGolfEventId = 4743,
                    allocated = false,
                    synchronisedAtUtc = SynchronisedAt
                });
            }

            if (request.Method == HttpMethod.Put &&
                request.Path == "/api/event-planner/member-diary")
            {
                if (RejectDiaryRequestWithImageFailure)
                {
                    return Json(HttpStatusCode.BadGateway, new
                    {
                        title = "Intelligent Golf publishing failed",
                        detail = "The member diary was published before a temporary upload failure.",
                        stage = "planner-event-image-upload",
                        intelligentGolfEventId = 4743,
                        intelligentGolfRecordId = 812,
                        retryable = true,
                        memberDiaryPublished = true,
                        memberDiaryPublishedAtUtc = diaryPublishedAt
                    });
                }

                if (OmitEventImageAttached)
                {
                    return Json(HttpStatusCode.OK, new
                    {
                        eventPlaybookEventId = "event-123",
                        intelligentGolfEventId = 4743,
                        intelligentGolfDiaryEntryId = 812,
                        created = true,
                        publishedAtUtc = diaryPublishedAt
                    });
                }

                return Json(HttpStatusCode.OK, new
                {
                    eventPlaybookEventId = "event-123",
                    intelligentGolfEventId = 4743,
                    intelligentGolfDiaryEntryId = 812,
                    created = true,
                    eventImageAttached = true,
                    publishedAtUtc = diaryPublishedAt
                });
            }

            throw new Xunit.Sdk.XunitException(
                $"Unexpected private API request: {request.Method} {request.Path}");
        }

        private static HttpResponseMessage Json(HttpStatusCode statusCode, object value) =>
            new(statusCode)
            {
                Content = JsonContent.Create(value)
            };
    }

    private sealed class RecordingHandler(
        Func<CapturedRequest, HttpResponseMessage> responder,
        List<CapturedRequest> requests) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var body = request.Content is null
                ? string.Empty
                : await request.Content.ReadAsStringAsync(cancellationToken);
            var captured = new CapturedRequest(request.Method, request.RequestUri!, body);
            requests.Add(captured);
            return responder(captured);
        }
    }

    private sealed record CapturedRequest(HttpMethod Method, Uri Uri, string Body)
    {
        public string Path => Uri.AbsolutePath;
    }

    private sealed class FakeHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class NoOpSessionClient : IIntelligentGolfApiSessionClient
    {
        public Task ConnectAsync(
            IntelligentGolfPluginCredentials credentials,
            CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public Task AuthorizeAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public void Clear()
        {
        }
    }

    private sealed class ConfiguredPluginSettingsStore : IPluginSettingsStore
    {
        public Task<PluginSettingsOverview> GetOverviewAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new PluginSettingsOverview
            {
                IntelligentGolf = new IntelligentGolfPluginSummary
                {
                    Enabled = true,
                    Configured = true
                },
                Monday = new MondayPluginSummary()
            });

        public Task<IntelligentGolfPluginSummary> SaveIntelligentGolfAsync(
            SaveIntelligentGolfPluginRequest request,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IntelligentGolfPluginCredentials> ResolveIntelligentGolfCredentialsAsync(
            SaveIntelligentGolfPluginRequest request,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IntelligentGolfPluginCredentials?> GetIntelligentGolfCredentialsAsync(
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<MondayPluginSummary> SaveMondayAsync(
            SaveMondayPluginRequest request,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<PluginSettingsOverview> SetEnabledAsync(
            string pluginId,
            bool enabled,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<PluginSettingsOverview> DisconnectAsync(
            string pluginId,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }

    private sealed class RecordingLinkStore : IIntelligentGolfIntegrationLinkStore
    {
        private IntelligentGolfIntegrationLink? _link;

        public int SaveDiaryCalls { get; private set; }
        public int SaveAllocatedDiaryCalls { get; private set; }

        public Task<IntelligentGolfIntegrationLink?> GetAsync(
            string eventId,
            CancellationToken cancellationToken) =>
            Task.FromResult(_link);

        public Task SaveAllocatedEventAsync(
            string eventId,
            int intelligentGolfEventId,
            CancellationToken cancellationToken)
        {
            var link = GetOrCreate(eventId);
            link.IntelligentGolfEventId = intelligentGolfEventId;
            return Task.CompletedTask;
        }

        public Task SaveEventAsync(
            string eventId,
            int intelligentGolfEventId,
            string fingerprint,
            DateTimeOffset synchronisedAtUtc,
            CancellationToken cancellationToken)
        {
            var link = GetOrCreate(eventId);
            link.IntelligentGolfEventId = intelligentGolfEventId;
            link.LastEventFingerprint = fingerprint;
            link.EventSynchronisedAtUtc = synchronisedAtUtc;
            link.LastError = null;
            link.LastErrorStage = null;
            link.LastErrorStatusCode = null;
            return Task.CompletedTask;
        }

        public Task SaveDiaryAsync(
            string eventId,
            int intelligentGolfEventId,
            int diaryEntryId,
            DateTimeOffset publishedAtUtc,
            CancellationToken cancellationToken)
        {
            SaveDiaryCalls++;
            var link = GetOrCreate(eventId);
            link.IntelligentGolfEventId = intelligentGolfEventId;
            link.IntelligentGolfDiaryEntryId = diaryEntryId;
            link.DiaryPublishedAtUtc = publishedAtUtc;
            link.LastError = null;
            link.LastErrorStage = null;
            link.LastErrorStatusCode = null;
            return Task.CompletedTask;
        }

        public Task SaveAllocatedDiaryAsync(
            string eventId,
            int intelligentGolfEventId,
            int diaryEntryId,
            CancellationToken cancellationToken)
        {
            SaveAllocatedDiaryCalls++;
            var link = GetOrCreate(eventId);
            link.IntelligentGolfEventId = intelligentGolfEventId;
            link.IntelligentGolfDiaryEntryId = diaryEntryId;
            return Task.CompletedTask;
        }

        public Task RecordFailureAsync(
            string eventId,
            string message,
            string? stage,
            int? statusCode,
            CancellationToken cancellationToken)
        {
            var link = GetOrCreate(eventId);
            link.LastError = message;
            link.LastErrorStage = stage;
            link.LastErrorStatusCode = statusCode;
            return Task.CompletedTask;
        }

        public Task SaveMatchRequiredAsync(
            string eventId,
            string eventDate,
            IReadOnlyCollection<IntelligentGolfPlannerEventCandidate> candidates,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task ClearMatchRequiredAsync(
            string eventId,
            CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public Task<string?> FindPlaybookEventIdByIntelligentGolfEventIdAsync(
            int intelligentGolfEventId,
            CancellationToken cancellationToken) =>
            Task.FromResult<string?>(null);

        private IntelligentGolfIntegrationLink GetOrCreate(string eventId) =>
            _link ??= new IntelligentGolfIntegrationLink
            {
                EventPlaybookEventId = eventId,
                UpdatedAtUtc = SynchronisedAt
            };
    }

    private sealed class RecordingActivityStore : IIntegrationActivityStore
    {
        public List<IntegrationActivityWrite> Activities { get; } = [];

        public Task RecordAsync(
            IntegrationActivityWrite activity,
            CancellationToken cancellationToken)
        {
            Activities.Add(activity);
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<IntegrationActivityEntry>> GetRecentAsync(
            int limit,
            CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<IntegrationActivityEntry>>([]);
    }
}
