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

    [Fact]
    public async Task GetPlannerEventCandidatesAsync_UsesReadOnlyPrivateApiAndNormalisesCandidates()
    {
        var scenario = new PrivateApiScenario(SynchronisedAt)
        {
            PlannerCandidates =
            [
                new IntelligentGolfPlannerEventCandidate { IntelligentGolfEventId = 4733, Name = "  Existing forum  " },
                new IntelligentGolfPlannerEventCandidate { IntelligentGolfEventId = 4713, Name = "Current planner event" },
                new IntelligentGolfPlannerEventCandidate { IntelligentGolfEventId = 4733, Name = "Duplicate" }
            ]
        };
        var integration = CreateIntegration(
            scenario,
            new RecordingLinkStore(),
            new RecordingActivityStore());

        var result = await integration.GetPlannerEventCandidatesAsync(
            CreateSnapshot(),
            CancellationToken.None);

        Assert.Equal("2027-02-20", result.EventDate);
        Assert.Collection(
            result.Candidates,
            candidate => Assert.Equal(4713, candidate.IntelligentGolfEventId),
            candidate =>
            {
                Assert.Equal(4733, candidate.IntelligentGolfEventId);
                Assert.Equal("Existing forum", candidate.Name);
            });
        var request = Assert.Single(scenario.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal("/api/event-planner/events/candidates", request.Path);
        Assert.Equal("?eventDate=2027-02-20", request.Uri.Query);
    }

    [Fact]
    public async Task LookupPlannerEventAsync_UsesReadOnlyPrivateApiAndNormalisesTheCandidate()
    {
        var scenario = new PrivateApiScenario(SynchronisedAt)
        {
            PlannerLookupCandidate = new IntelligentGolfPlannerEventCandidate
            {
                IntelligentGolfEventId = 4423,
                Name = "  Marc Bolton  "
            }
        };
        var integration = CreateIntegration(
            scenario,
            new RecordingLinkStore(),
            new RecordingActivityStore());

        var result = await integration.LookupPlannerEventAsync(
            CreateSnapshot(),
            4423,
            CancellationToken.None);

        Assert.Equal("2027-02-20", result.EventDate);
        Assert.NotNull(result.Candidate);
        Assert.Equal(4423, result.Candidate.IntelligentGolfEventId);
        Assert.Equal("Marc Bolton", result.Candidate.Name);
        var request = Assert.Single(scenario.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal("/api/event-planner/events/lookup", request.Path);
        Assert.Equal(
            "?eventDate=2027-02-20&intelligentGolfEventId=4423",
            request.Uri.Query);
    }

    [Fact]
    public async Task LookupPlannerEventAsync_WhenPrivateApiReturnsAnotherId_RejectsTheResponse()
    {
        var scenario = new PrivateApiScenario(SynchronisedAt)
        {
            PlannerLookupCandidate = new IntelligentGolfPlannerEventCandidate
            {
                IntelligentGolfEventId = 9999,
                Name = "Wrong event"
            }
        };
        var integration = CreateIntegration(
            scenario,
            new RecordingLinkStore(),
            new RecordingActivityStore());

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            integration.LookupPlannerEventAsync(
                CreateSnapshot(),
                4423,
                CancellationToken.None));

        Assert.Contains("not the requested entry 4423", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task LookupPlannerEventAsync_WhenIdIsNotPositive_DoesNotCallPrivateApi()
    {
        var scenario = new PrivateApiScenario(SynchronisedAt);
        var integration = CreateIntegration(
            scenario,
            new RecordingLinkStore(),
            new RecordingActivityStore());

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            integration.LookupPlannerEventAsync(
                CreateSnapshot(),
                0,
                CancellationToken.None));

        Assert.Contains("greater than zero", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(scenario.Requests);
    }

    [Fact]
    public async Task RelinkExistingEventAsync_WhenTargetBelongsToAnotherEvent_DoesNotCallPrivateApiOrChangeLink()
    {
        var scenario = new PrivateApiScenario(SynchronisedAt);
        var linkStore = new RecordingLinkStore();
        linkStore.Seed(CreateExistingLink());
        linkStore.LinkedOwners[4733] = "event-456";
        var integration = CreateIntegration(scenario, linkStore, new RecordingActivityStore());

        var exception = await Assert.ThrowsAsync<IntelligentGolfPlannerEventAlreadyLinkedException>(() =>
            integration.RelinkExistingEventAsync(
                CreateSnapshot(),
                expectedIntelligentGolfEventId: 4713,
                intelligentGolfEventId: 4733,
                CancellationToken.None));

        Assert.Equal(4733, exception.IntelligentGolfEventId);
        Assert.Empty(scenario.Requests);
        var link = await linkStore.GetAsync("event-123", CancellationToken.None);
        Assert.Equal(4713, link?.IntelligentGolfEventId);
        Assert.Equal(4963, link?.IntelligentGolfDiaryEntryId);
    }

    [Fact]
    public async Task RelinkExistingEventAsync_WhenTargetIsNoLongerAvailable_PreservesConflictAndCandidates()
    {
        var scenario = new PrivateApiScenario(SynchronisedAt)
        {
            RelinkFailureStage = "planner-event-relink-target-unavailable",
            PlannerCandidates =
            [
                new IntelligentGolfPlannerEventCandidate
                {
                    IntelligentGolfEventId = 4744,
                    Name = "Replacement event"
                }
            ]
        };
        var linkStore = new RecordingLinkStore();
        linkStore.Seed(CreateExistingLink());
        var activityStore = new RecordingActivityStore();
        var integration = CreateIntegration(scenario, linkStore, activityStore);

        var exception = await Assert.ThrowsAsync<IntelligentGolfApiRequestException>(() =>
            integration.RelinkExistingEventAsync(
                CreateSnapshot(),
                expectedIntelligentGolfEventId: 4713,
                intelligentGolfEventId: 4733,
                CancellationToken.None));

        Assert.Equal(409, exception.StatusCode);
        Assert.Equal("planner-event-relink-target-unavailable", exception.Stage);
        Assert.True(exception.RequiresPlannerMatch);
        Assert.False(exception.RequiresPlannerLinkRefresh);
        var candidate = Assert.Single(exception.Candidates);
        Assert.Equal(4744, candidate.IntelligentGolfEventId);
        var link = await linkStore.GetAsync("event-123", CancellationToken.None);
        Assert.Equal(4713, link?.IntelligentGolfEventId);
        Assert.Equal("action-required", Assert.Single(activityStore.Activities).Outcome);
    }

    [Fact]
    public async Task RelinkExistingEventAsync_WhenPrivateLinkHasChanged_PreservesConflictIdsForStatusRefresh()
    {
        var scenario = new PrivateApiScenario(SynchronisedAt)
        {
            RelinkFailureStage = "planner-event-relink-conflict"
        };
        var linkStore = new RecordingLinkStore();
        linkStore.Seed(CreateExistingLink());
        var activityStore = new RecordingActivityStore();
        var integration = CreateIntegration(scenario, linkStore, activityStore);

        var exception = await Assert.ThrowsAsync<IntelligentGolfApiRequestException>(() =>
            integration.RelinkExistingEventAsync(
                CreateSnapshot(),
                expectedIntelligentGolfEventId: 4713,
                intelligentGolfEventId: 4733,
                CancellationToken.None));

        Assert.Equal(409, exception.StatusCode);
        Assert.Equal("planner-event-relink-conflict", exception.Stage);
        Assert.False(exception.RequiresPlannerMatch);
        Assert.True(exception.RequiresPlannerLinkRefresh);
        Assert.Equal(4713, exception.ExpectedIntelligentGolfEventId);
        Assert.Equal(4720, exception.CurrentIntelligentGolfEventId);
        var link = await linkStore.GetAsync("event-123", CancellationToken.None);
        Assert.Equal(4713, link?.IntelligentGolfEventId);
        Assert.Equal("action-required", Assert.Single(activityStore.Activities).Outcome);
    }

    [Theory]
    [InlineData("planner-event-lookup-response")]
    [InlineData("planner-event-lookup-date-mismatch")]
    public async Task RelinkExistingEventAsync_WhenVerifiedTargetIsRejected_PreservesNonRetryableConflict(
        string stage)
    {
        var scenario = new PrivateApiScenario(SynchronisedAt)
        {
            RelinkFailureStage = stage
        };
        var linkStore = new RecordingLinkStore();
        linkStore.Seed(CreateExistingLink());
        var integration = CreateIntegration(scenario, linkStore, new RecordingActivityStore());

        var exception = await Assert.ThrowsAsync<IntelligentGolfApiRequestException>(() =>
            integration.RelinkExistingEventAsync(
                CreateSnapshot(),
                expectedIntelligentGolfEventId: 4713,
                intelligentGolfEventId: 4733,
                CancellationToken.None));

        Assert.Equal(409, exception.StatusCode);
        Assert.Equal(stage, exception.Stage);
        Assert.True(exception.RejectsPlannerTarget);
        Assert.False(exception.Retryable);
        var link = await linkStore.GetAsync("event-123", CancellationToken.None);
        Assert.Equal(4713, link?.IntelligentGolfEventId);
        Assert.Equal(4963, link?.IntelligentGolfDiaryEntryId);
    }

    [Fact]
    public async Task PublishDiaryAsync_WhenRelinkStartsDuringPublish_DoesNotRestorePreviousPlannerLink()
    {
        var scenario = new PrivateApiScenario(SynchronisedAt)
        {
            PlannerEventId = 4713,
            PauseDiaryResponse = true
        };
        var linkStore = new RecordingLinkStore();
        linkStore.Seed(CreateExistingLink());
        var integration = CreateIntegration(scenario, linkStore, new RecordingActivityStore());

        var publishTask = integration.PublishDiaryAsync(CreateRequest(), PngBytes, CancellationToken.None);
        await scenario.DiaryRequestStarted.WaitAsync(TimeSpan.FromSeconds(5));
        var relinkTask = integration.RelinkExistingEventAsync(
            CreateSnapshot(),
            expectedIntelligentGolfEventId: 4713,
            intelligentGolfEventId: 4733,
            CancellationToken.None);

        try
        {
            var firstCompletion = await Task.WhenAny(relinkTask, Task.Delay(TimeSpan.FromMilliseconds(100)));
            Assert.NotSame(relinkTask, firstCompletion);
        }
        finally
        {
            scenario.ReleaseDiaryResponse();
        }

        var published = await publishTask;
        var relinked = await relinkTask;

        Assert.Equal(4713, published.IntelligentGolfEventId);
        Assert.Equal(4733, relinked.IntelligentGolfEventId);
        var stored = await linkStore.GetAsync("event-123", CancellationToken.None);
        Assert.Equal(4733, stored?.IntelligentGolfEventId);
        Assert.Null(stored?.IntelligentGolfDiaryEntryId);
        var diaryRequestIndex = scenario.Requests.FindIndex(request =>
            request.Method == HttpMethod.Put && request.Path == "/api/event-planner/member-diary");
        var relinkRequestIndex = scenario.Requests.FindIndex(request =>
            request.Method == HttpMethod.Post && request.Path == "/api/event-planner/events/relink");
        Assert.True(diaryRequestIndex >= 0);
        Assert.True(relinkRequestIndex > diaryRequestIndex);
    }

    [Fact]
    public async Task RelinkThenPublishDiary_TargetsNewPlannerWithoutSynchronisingOrSendingStaleDiaryId()
    {
        var scenario = new PrivateApiScenario(SynchronisedAt)
        {
            PlannerEventId = 4713
        };
        var linkStore = new RecordingLinkStore();
        linkStore.Seed(CreateExistingLink());
        var activityStore = new RecordingActivityStore();
        var integration = CreateIntegration(scenario, linkStore, activityStore);

        var relinked = await integration.RelinkExistingEventAsync(
            CreateSnapshot(),
            expectedIntelligentGolfEventId: 4713,
            intelligentGolfEventId: 4733,
            CancellationToken.None);
        var published = await integration.PublishDiaryAsync(
            CreateRequest(),
            PngBytes,
            CancellationToken.None);

        Assert.True(relinked.Relinked);
        Assert.Equal(4713, relinked.PreviousIntelligentGolfEventId);
        Assert.Equal(4733, relinked.IntelligentGolfEventId);
        Assert.Equal(4733, published.IntelligentGolfEventId);
        Assert.DoesNotContain(scenario.Requests, request =>
            request.Path == "/api/event-planner/events/synchronise");
        var relinkRequest = Assert.Single(scenario.Requests, request =>
            request.Method == HttpMethod.Post && request.Path == "/api/event-planner/events/relink");
        using (var relinkPayload = JsonDocument.Parse(relinkRequest.Body))
        {
            Assert.Equal(4713, relinkPayload.RootElement.GetProperty("expectedIntelligentGolfEventId").GetInt32());
            Assert.Equal(4733, relinkPayload.RootElement.GetProperty("intelligentGolfEventId").GetInt32());
        }

        var diaryRequest = Assert.Single(scenario.Requests, request =>
            request.Method == HttpMethod.Put && request.Path == "/api/event-planner/member-diary");
        using (var diaryPayload = JsonDocument.Parse(diaryRequest.Body))
        {
            Assert.Equal(4733, diaryPayload.RootElement.GetProperty("intelligentGolfEventId").GetInt32());
            Assert.Equal(JsonValueKind.Null, diaryPayload.RootElement.GetProperty("intelligentGolfDiaryEntryId").ValueKind);
        }

        var stored = await linkStore.GetAsync("event-123", CancellationToken.None);
        Assert.Equal(4733, stored?.IntelligentGolfEventId);
        Assert.Equal(812, stored?.IntelligentGolfDiaryEntryId);
        var activity = Assert.Single(activityStore.Activities, candidate =>
            candidate.Operation == "Relink planner event");
        Assert.Equal("succeeded", activity.Outcome);
        Assert.Contains("4713 to 4733", activity.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task RelinkThenSynchroniseChangedSnapshot_UpdatesNewPlannerId()
    {
        var scenario = new PrivateApiScenario(SynchronisedAt)
        {
            PlannerEventId = 4713
        };
        var linkStore = new RecordingLinkStore();
        linkStore.Seed(CreateExistingLink());
        var integration = CreateIntegration(scenario, linkStore, new RecordingActivityStore());
        var snapshot = CreateSnapshot();

        await integration.RelinkExistingEventAsync(snapshot, 4713, 4733, CancellationToken.None);
        await integration.SynchroniseEventAsync(
            new PlaybookEventIntegrationSnapshot
            {
                EventId = snapshot.EventId,
                Name = "The renamed 2027 Forum",
                EventDate = snapshot.EventDate,
                Description = snapshot.Description,
                StartTime = snapshot.StartTime,
                EndTime = snapshot.EndTime,
                EventTypeId = snapshot.EventTypeId,
                Attendees = snapshot.Attendees,
                GroupId = snapshot.GroupId,
                GroupName = snapshot.GroupName
            },
            force: false,
            CancellationToken.None);

        var syncRequest = Assert.Single(scenario.Requests, request =>
            request.Method == HttpMethod.Post && request.Path == "/api/event-planner/events/synchronise");
        using var payload = JsonDocument.Parse(syncRequest.Body);
        Assert.Equal(4733, payload.RootElement.GetProperty("intelligentGolfEventId").GetInt32());
        Assert.False(payload.RootElement.GetProperty("createNewWhenDateOccupied").GetBoolean());
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

    private static PlaybookEventIntegrationSnapshot CreateSnapshot() => new()
    {
        EventId = "event-123",
        Name = "The 2027 Forum",
        EventDate = "2027-02-20",
        Description = "Join fellow members for the 2027 forum.",
        EventTypeId = 4,
        Attendees = 120,
        StartTime = "19:00",
        EndTime = "22:00"
    };

    private static IntelligentGolfIntegrationLink CreateExistingLink() => new()
    {
        EventPlaybookEventId = "event-123",
        IntelligentGolfEventId = 4713,
        IntelligentGolfDiaryEntryId = 4963,
        LastEventFingerprint = "old-fingerprint",
        EventSynchronisedAtUtc = SynchronisedAt,
        DiaryPublishedAtUtc = SynchronisedAt,
        UpdatedAtUtc = SynchronisedAt
    };

    private sealed class PrivateApiScenario(DateTimeOffset diaryPublishedAt)
    {
        public List<CapturedRequest> Requests { get; } = [];

        public bool RejectDiaryRequestWithImageFailure { get; init; }
        public bool OmitEventImageAttached { get; init; }
        public string? RelinkFailureStage { get; init; }
        public bool PauseDiaryResponse { get; init; }
        public int PlannerEventId { get; set; } = 4743;
        public IReadOnlyList<IntelligentGolfPlannerEventCandidate> PlannerCandidates { get; init; } = [];
        public IntelligentGolfPlannerEventCandidate? PlannerLookupCandidate { get; init; }
        private readonly TaskCompletionSource<bool> _diaryRequestStarted =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _releaseDiaryResponse =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public HttpMessageHandler Handler => new RecordingHandler(RespondAsync, Requests);
        public Task DiaryRequestStarted => _diaryRequestStarted.Task;

        public void ReleaseDiaryResponse() => _releaseDiaryResponse.TrySetResult(true);

        private async Task<HttpResponseMessage> RespondAsync(
            CapturedRequest request,
            CancellationToken cancellationToken)
        {
            if (PauseDiaryResponse &&
                request.Method == HttpMethod.Put &&
                request.Path == "/api/event-planner/member-diary")
            {
                _diaryRequestStarted.TrySetResult(true);
                await _releaseDiaryResponse.Task.WaitAsync(cancellationToken);
            }

            return Respond(request);
        }

        private HttpResponseMessage Respond(CapturedRequest request)
        {
            if (request.Method == HttpMethod.Get &&
                request.Path == "/api/event-planner/events/candidates")
            {
                return Json(HttpStatusCode.OK, new
                {
                    eventDate = "2027-02-20",
                    candidates = PlannerCandidates
                });
            }

            if (request.Method == HttpMethod.Get &&
                request.Path == "/api/event-planner/events/lookup")
            {
                return Json(HttpStatusCode.OK, new
                {
                    eventDate = "2027-02-20",
                    candidate = PlannerLookupCandidate
                });
            }

            if (request.Method == HttpMethod.Post &&
                request.Path == "/api/event-planner/events/relink")
            {
                if (string.Equals(
                        RelinkFailureStage,
                        "planner-event-relink-target-unavailable",
                        StringComparison.Ordinal))
                {
                    return Json(HttpStatusCode.Conflict, new
                    {
                        title = "The selected planner event is no longer available.",
                        stage = RelinkFailureStage,
                        eventDate = "2027-02-20",
                        candidates = PlannerCandidates,
                        retryable = false
                    });
                }

                if (string.Equals(
                        RelinkFailureStage,
                        "planner-event-relink-conflict",
                        StringComparison.Ordinal))
                {
                    return Json(HttpStatusCode.Conflict, new
                    {
                        title = "The planner link has changed.",
                        stage = RelinkFailureStage,
                        expectedIntelligentGolfEventId = 4713,
                        currentIntelligentGolfEventId = 4720,
                        retryable = false
                    });
                }

                if (string.Equals(RelinkFailureStage, "planner-event-lookup-response", StringComparison.Ordinal) ||
                    string.Equals(RelinkFailureStage, "planner-event-lookup-date-mismatch", StringComparison.Ordinal))
                {
                    return Json(HttpStatusCode.Conflict, new
                    {
                        title = "That Intelligent Golf planner event cannot be linked.",
                        detail = "The selected planner entry could not be verified for this event date.",
                        stage = RelinkFailureStage,
                        eventDate = "2027-02-20",
                        intelligentGolfEventId = 4733,
                        retryable = false
                    });
                }

                using var payload = JsonDocument.Parse(request.Body);
                var previousId = payload.RootElement.GetProperty("expectedIntelligentGolfEventId").GetInt32();
                var selectedId = payload.RootElement.GetProperty("intelligentGolfEventId").GetInt32();
                PlannerEventId = selectedId;
                return Json(HttpStatusCode.OK, new
                {
                    eventPlaybookEventId = "event-123",
                    previousIntelligentGolfEventId = previousId,
                    intelligentGolfEventId = selectedId,
                    relinked = previousId != selectedId,
                    relinkedAtUtc = SynchronisedAt
                });
            }

            if (request.Method == HttpMethod.Post &&
                request.Path == "/api/event-planner/events/synchronise")
            {
                return Json(HttpStatusCode.OK, new
                {
                    eventPlaybookEventId = "event-123",
                    intelligentGolfEventId = PlannerEventId,
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
                        intelligentGolfEventId = PlannerEventId,
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
                        intelligentGolfEventId = PlannerEventId,
                        intelligentGolfDiaryEntryId = 812,
                        created = true,
                        publishedAtUtc = diaryPublishedAt
                    });
                }

                return Json(HttpStatusCode.OK, new
                {
                    eventPlaybookEventId = "event-123",
                    intelligentGolfEventId = PlannerEventId,
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
        Func<CapturedRequest, CancellationToken, Task<HttpResponseMessage>> responder,
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
            return await responder(captured, cancellationToken);
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
        public Dictionary<int, string> LinkedOwners { get; } = [];

        public void Seed(IntelligentGolfIntegrationLink link) => _link = link;

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
            Task.FromResult(
                LinkedOwners.TryGetValue(intelligentGolfEventId, out var owner)
                    ? owner
                    : _link?.IntelligentGolfEventId == intelligentGolfEventId
                        ? _link.EventPlaybookEventId
                        : null);

        public Task<IntelligentGolfIntegrationLink> RelinkEventAsync(
            string eventId,
            int expectedIntelligentGolfEventId,
            int intelligentGolfEventId,
            string fingerprint,
            DateTimeOffset relinkedAtUtc,
            CancellationToken cancellationToken)
        {
            var link = GetOrCreate(eventId);
            if (link.IntelligentGolfEventId != expectedIntelligentGolfEventId)
                throw new IntelligentGolfPlannerLinkChangedException(expectedIntelligentGolfEventId, link.IntelligentGolfEventId);
            if (intelligentGolfEventId != expectedIntelligentGolfEventId)
            {
                link.IntelligentGolfEventId = intelligentGolfEventId;
                link.IntelligentGolfDiaryEntryId = null;
                link.DiaryPublishedAtUtc = null;
                link.LastEventFingerprint = fingerprint;
                link.EventSynchronisedAtUtc = relinkedAtUtc;
            }
            return Task.FromResult(link);
        }

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
