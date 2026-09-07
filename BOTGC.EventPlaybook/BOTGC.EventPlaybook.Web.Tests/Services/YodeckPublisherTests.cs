using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using BOTGC.EventPlaybook.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class YodeckPublisherTests
{
    private static readonly byte[] PngBytes =
    [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
    ];

    [Fact]
    public async Task PublishAsync_UploadsBinaryPngBeforeUpdatingPlaylistAndPushingScreens()
    {
        var scenario = new YodeckScenario
        {
            MediaStatuses = new Queue<string>(["initialized", "uploading", "encoding", "finished"])
        };
        var publisher = CreatePublisher(scenario);

        var result = await publisher.PublishAsync(CreateCommand(), CancellationToken.None);

        var create = Assert.Single(scenario.Requests, request =>
            request.Method == HttpMethod.Post && request.Path == "/api/v2/media");
        var createBody = JsonNode.Parse(create.TextBody!)!.AsObject();
        Assert.Equal("local", createBody["media_origin"]?["source"]?.GetValue<string>());
        Assert.Equal("image", createBody["media_origin"]?["type"]?.GetValue<string>());
        var availability = createBody["availability_schedule"]!.AsObject();
        Assert.True(availability["enable"]!.GetValue<bool>());
        Assert.Equal("2026-09-07T00:00:00", availability["available_after"]!.GetValue<string>());
        Assert.Equal("2026-10-25T23:59:59", availability["available_before"]!.GetValue<string>());
        Assert.DoesNotContain('Z', availability["available_after"]!.GetValue<string>());
        Assert.DoesNotContain('Z', availability["available_before"]!.GetValue<string>());
        var slot = Assert.IsType<JsonObject>(Assert.Single(availability["availability_slots"]!.AsArray()));
        Assert.Equal("00:00:00", slot["start"]!.GetValue<string>());
        Assert.Equal("23:59:59", slot["end"]!.GetValue<string>());
        Assert.Equal("1111111", slot["days_of_week"]!.GetValue<string>());

        var upload = Assert.Single(scenario.Requests, request =>
            request.Method == HttpMethod.Put && request.Uri.Host == "uploads.example.test");
        Assert.Equal("image/png", upload.ContentType);
        Assert.Equal(PngBytes, upload.Body);

        var uploadIndex = scenario.Requests.IndexOf(upload);
        var completeIndex = scenario.IndexOf(HttpMethod.Put, "/api/v2/media/91/upload/complete");
        var mediaFinishedIndex = scenario.LastIndexOf(HttpMethod.Get, "/api/v2/media/91/status");
        var playlistIndex = scenario.IndexOf(HttpMethod.Patch, "/api/v2/playlists/77");
        var pushIndex = scenario.IndexOf(HttpMethod.Post, "/api/v2/screens/push");
        Assert.True(uploadIndex < completeIndex, "The binary upload must precede upload completion.");
        Assert.True(completeIndex < mediaFinishedIndex, "Yodeck processing must be checked after upload completion.");
        Assert.True(mediaFinishedIndex < playlistIndex, "Only finished media can be added to the playlist.");
        Assert.True(playlistIndex < pushIndex, "Screens must be pushed only after the playlist is updated.");

        Assert.True(result.MediaWasCreated);
        Assert.True(result.MediaUploadConfirmed);
        Assert.Equal("local", result.MediaSource);
        Assert.Equal("png", result.FileExtension);
        Assert.Equal(2160, result.ImageWidth);
        Assert.Equal(3840, result.ImageHeight);
        Assert.True(result.PlaylistWasChanged);
        Assert.True(result.ScreenPushRequested);
        Assert.True(result.ScreenPushConfirmed);
        Assert.Equal("completed", result.ScreenPushStatus);
        Assert.Equal(2, result.ScreenCount);
    }

    [Fact]
    public async Task PublishAsync_ReplacesLegacyUrlBackedMediaWithNewLocalUpload()
    {
        var scenario = new YodeckScenario
        {
            ExistingMedia =
            [
                Media(80, "url", "2026-09-06T12:00:00Z")
            ],
            PlaylistItems =
            [
                PlaylistItem(42, 1),
                PlaylistItem(80, 2)
            ]
        };
        var publisher = CreatePublisher(scenario);

        var result = await publisher.PublishAsync(CreateCommand(), CancellationToken.None);

        Assert.True(result.MediaWasCreated);
        Assert.Equal(91, result.MediaId);
        Assert.Contains(scenario.Requests, request =>
            request.Method == HttpMethod.Post && request.Path == "/api/v2/media");
        Assert.DoesNotContain(scenario.Requests, request =>
            request.Method == HttpMethod.Patch && request.Path == "/api/v2/media/80");

        var playlistPatch = Assert.Single(scenario.Requests, request =>
            request.Method == HttpMethod.Patch && request.Path == "/api/v2/playlists/77");
        var ids = ReadPlaylistMediaIds(playlistPatch);
        Assert.Contains(42, ids);
        Assert.Contains(91, ids);
        Assert.DoesNotContain(80, ids);
        Assert.Equal(1, ids.Count(id => id == 91));
    }

    [Fact]
    public async Task PublishAsync_DoesNotAcceptPreviousFinishedUploadBeforeMediaVersionAdvances()
    {
        const string previousUpload = "2026-09-07T12:00:00Z";
        const string currentUpload = "2026-09-07T13:00:00Z";
        var scenario = new YodeckScenario
        {
            ExistingMedia =
            [
                Media(80, "local", previousUpload, previousUpload)
            ],
            MediaStatuses = new Queue<string>(["finished"]),
            MediaLastUploadedTimestamps = new Queue<string>([previousUpload, currentUpload])
        };
        var publisher = CreatePublisher(scenario);

        var result = await publisher.PublishAsync(CreateCommand(), CancellationToken.None);

        Assert.False(result.MediaWasCreated);
        Assert.Equal(80, result.MediaId);
        Assert.Equal(2, scenario.Requests.Count(request =>
            request.Method == HttpMethod.Get && request.Path == "/api/v2/media/80/status"));
        Assert.Equal(2, scenario.Requests.Count(request =>
            request.Method == HttpMethod.Get && request.Path == "/api/v2/media/80"));

        var secondMediaCheck = scenario.Requests.FindLastIndex(request =>
            request.Method == HttpMethod.Get && request.Path == "/api/v2/media/80");
        var playlistUpdate = scenario.IndexOf(HttpMethod.Patch, "/api/v2/playlists/77");
        Assert.True(secondMediaCheck < playlistUpdate,
            "The playlist must not be updated until Yodeck reports the newly uploaded media version.");
    }

    [Fact]
    public async Task PublishAsync_RemovesDuplicateEventMediaAndKeepsUnrelatedPlaylistItems()
    {
        var scenario = new YodeckScenario
        {
            ExistingMedia =
            [
                Media(80, "local", "2026-09-07T12:00:00Z"),
                Media(81, "local", "2026-09-06T12:00:00Z")
            ],
            PlaylistItems =
            [
                PlaylistItem(42, 1),
                PlaylistItem(80, 2),
                PlaylistItem(80, 3),
                PlaylistItem(81, 4)
            ]
        };
        var publisher = CreatePublisher(scenario);

        var result = await publisher.PublishAsync(CreateCommand(), CancellationToken.None);

        Assert.False(result.MediaWasCreated);
        Assert.Equal(80, result.MediaId);
        Assert.Equal(2, result.DuplicatePlaylistEntriesRemoved);

        var playlistPatch = Assert.Single(scenario.Requests, request =>
            request.Method == HttpMethod.Patch && request.Path == "/api/v2/playlists/77");
        var ids = ReadPlaylistMediaIds(playlistPatch);
        Assert.Equal([42L, 80L], ids);
    }

    [Fact]
    public async Task PublishAsync_PushesExactRegisteredScreensAndWaitsForCompletion()
    {
        var scenario = new YodeckScenario
        {
            PushStatuses = new Queue<string>(["in_progress", "completed"])
        };
        var publisher = CreatePublisher(scenario);

        var result = await publisher.PublishAsync(CreateCommand(), CancellationToken.None);

        var push = Assert.Single(scenario.Requests, request =>
            request.Method == HttpMethod.Post && request.Path == "/api/v2/screens/push");
        var pushBody = JsonNode.Parse(push.TextBody!)!.AsObject();
        Assert.False(pushBody["use_download_timeslots"]!.GetValue<bool>());
        Assert.False(pushBody.ContainsKey("filter_workspaces"));
        Assert.Equal([501L, 502L], pushBody["filter_devices"]!.AsArray()
            .Select(value => value!.GetValue<long>())
            .ToList());
        var screenLookup = Assert.Single(scenario.Requests, request =>
            request.Method == HttpMethod.Get && request.Path == "/api/v2/screens");
        Assert.Contains("registered=true", screenLookup.Uri.Query, StringComparison.Ordinal);
        Assert.Contains("limit=100", screenLookup.Uri.Query, StringComparison.Ordinal);
        Assert.Contains("workspace=9", screenLookup.Uri.Query, StringComparison.Ordinal);
        Assert.Equal(2, scenario.Requests.Count(request =>
            request.Method == HttpMethod.Get && request.Path == "/api/v2/screens/push/status/job-1"));
        Assert.True(result.ScreenPushConfirmed);
        Assert.Equal("completed", result.ScreenPushStatus);
        Assert.Equal(2, result.ScreenCount);
    }

    [Fact]
    public async Task PublishAsync_FailsUnlessEveryTargetScreenIsConfirmedByYodeck()
    {
        var scenario = new YodeckScenario
        {
            ConfirmedScreenIds = [501L],
            PushStatuses = new Queue<string>(["completed"])
        };
        var publisher = CreatePublisher(scenario);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            publisher.PublishAsync(CreateCommand(), CancellationToken.None));

        Assert.Contains("Expected: 501, 502; confirmed: 501", exception.Message, StringComparison.Ordinal);
    }

    private static YodeckPublisher CreatePublisher(YodeckScenario scenario) =>
        new(
            new FakeHttpClientFactory(scenario.Handler),
            Microsoft.Extensions.Options.Options.Create(new YodeckOptions
            {
                ApiBaseUrl = "https://app.yodeck.test/api/v2/",
                ApiToken = "secret-token",
                ApiTokenLabel = "event-playbook",
                PlaylistId = 77,
                PlaylistName = "Clubhouse",
                MediaDurationSeconds = 15
            }),
            NullLogger<YodeckPublisher>.Instance);

    private static YodeckPublishCommand CreateCommand() => new()
    {
        EventId = "event-123",
        EventName = "Sunday Lunch",
        StartDate = new DateOnly(2026, 9, 7),
        EndDate = new DateOnly(2026, 10, 25),
        MediaName = "Sunday Lunch — Clubhouse screens — 2026-10-25",
        Tags = ["clubhouse-screens", "sunday-lunch"],
        ImageBytes = PngBytes,
        ImageWidth = 2160,
        ImageHeight = 3840
    };

    private static JsonObject Media(
        long id,
        string source,
        string lastModified,
        string? lastUploaded = null)
    {
        var media = new JsonObject
        {
            ["id"] = id,
            ["description"] = "Event Playbook event id: event-123. Artwork for Sunday Lunch.",
            ["last_modified"] = lastModified,
            ["tags"] = new JsonArray("event-playbook", "event-playbook-event-123"),
            ["media_origin"] = new JsonObject
            {
                ["type"] = "image",
                ["source"] = source
            }
        };
        if (!string.IsNullOrWhiteSpace(lastUploaded))
        {
            media["last_uploaded"] = lastUploaded;
        }
        return media;
    }

    private static JsonObject PlaylistItem(long id, long priority) => new()
    {
        ["id"] = id,
        ["priority"] = priority,
        ["duration"] = 15,
        ["type"] = "media"
    };

    private static List<long> ReadPlaylistMediaIds(CapturedRequest request)
    {
        var body = JsonNode.Parse(request.TextBody!)!.AsObject();
        return body["items"]!.AsArray()
            .OfType<JsonObject>()
            .Where(item => item["type"]?.GetValue<string>() == "media")
            .Select(item => item["id"]!.GetValue<long>())
            .ToList();
    }

    private sealed class YodeckScenario
    {
        public List<JsonObject> ExistingMedia { get; init; } = [];

        public List<JsonObject> PlaylistItems { get; init; } = [];

        public Queue<string> PushStatuses { get; init; } = new(["completed"]);

        public Queue<string> MediaStatuses { get; init; } = new(["finished"]);

        public Queue<string> MediaLastUploadedTimestamps { get; init; } =
            new(["2026-09-07T13:00:00Z"]);

        public IReadOnlyList<long> RegisteredScreenIds { get; init; } = [501L, 502L];

        public IReadOnlyList<long> ConfirmedScreenIds { get; init; } = [501L, 502L];

        public List<CapturedRequest> Requests { get; } = [];

        public HttpMessageHandler Handler => new RecordingHandler(HandleAsync, Requests);

        public int IndexOf(HttpMethod method, string path) =>
            Requests.FindIndex(request => request.Method == method && request.Path == path);

        public int LastIndexOf(HttpMethod method, string path) =>
            Requests.FindLastIndex(request => request.Method == method && request.Path == path);

        private Task<HttpResponseMessage> HandleAsync(CapturedRequest request)
        {
            var response = (request.Method.Method, request.Path) switch
            {
                ("GET", "/api/v2/playlists/77") => Json(new JsonObject
                {
                    ["id"] = 77,
                    ["name"] = "Clubhouse",
                    ["workspace"] = new JsonObject { ["id"] = 9L },
                    ["items"] = new JsonArray(PlaylistItems.Select(item => item.DeepClone()).ToArray())
                }),
                ("GET", "/api/v2/media/tags") => Json(new JsonObject
                {
                    ["results"] = new JsonArray(
                        Tag("event-playbook"),
                        Tag("event-playbook-event-123"),
                        Tag("clubhouse-screens"),
                        Tag("sunday-lunch")),
                    ["next"] = null
                }),
                ("GET", "/api/v2/media") => Json(new JsonObject
                {
                    ["results"] = new JsonArray(ExistingMedia.Select(item => item.DeepClone()).ToArray()),
                    ["next"] = null
                }),
                ("POST", "/api/v2/media") => Json(Media(91, "local", "2026-09-07T13:00:00Z"), HttpStatusCode.Created),
                ("PATCH", var path) when path.StartsWith("/api/v2/media/", StringComparison.Ordinal) =>
                    Json(Media(ParseMediaId(path), "local", "2026-09-07T13:00:00Z")),
                ("GET", var path) when path.EndsWith("/upload", StringComparison.Ordinal) =>
                    Json(new JsonObject { ["upload_url"] = $"https://uploads.example.test{path}.png" }),
                ("PUT", var path) when request.Uri.Host == "uploads.example.test" => Empty(),
                ("PUT", var path) when path.EndsWith("/upload/complete", StringComparison.Ordinal) => Empty(),
                ("GET", var path) when path.EndsWith("/status", StringComparison.Ordinal) && path.Contains("/media/", StringComparison.Ordinal) =>
                    Json(new JsonObject
                    {
                        ["status"] = MediaStatuses.Count > 1 ? MediaStatuses.Dequeue() : MediaStatuses.Peek()
                    }),
                ("GET", var path) when path.StartsWith("/api/v2/media/", StringComparison.Ordinal) =>
                    Json(UploadedMedia(ParseMediaId(path))),
                ("PATCH", "/api/v2/playlists/77") => UpdatePlaylist(request),
                ("GET", "/api/v2/screens") => Json(new JsonObject
                {
                    ["results"] = new JsonArray(RegisteredScreenIds
                        .Select(id => (JsonNode?)new JsonObject
                        {
                            ["id"] = id,
                            ["name"] = $"Clubhouse portrait {id}"
                        })
                        .ToArray()),
                    ["next"] = null
                }),
                ("POST", "/api/v2/screens/push") => Json(new JsonObject
                {
                    ["status"] = "queued",
                    ["push_status_url"] = "https://app.yodeck.test/api/v2/screens/push/status/job-1",
                    ["screens"] = new JsonArray()
                }, HttpStatusCode.Accepted),
                ("GET", "/api/v2/screens/push/status/job-1") => Json(new JsonObject
                {
                    ["status"] = PushStatuses.Count > 1 ? PushStatuses.Dequeue() : PushStatuses.Peek(),
                    ["screens"] = new JsonArray(ConfirmedScreenIds
                        .Select(id => (JsonNode?)new JsonObject
                        {
                            ["id"] = id,
                            ["status"] = "completed"
                        })
                        .ToArray())
                }),
                _ => throw new Xunit.Sdk.XunitException(
                    $"Unexpected Yodeck request: {request.Method} {request.Uri}")
            };

            return Task.FromResult(response);
        }

        private static JsonObject Tag(string name) => new() { ["name"] = name };

        private JsonObject UploadedMedia(long id)
        {
            var media = Media(id, "local", "2026-09-07T13:00:00Z");
            media["last_uploaded"] = MediaLastUploadedTimestamps.Count > 1
                ? MediaLastUploadedTimestamps.Dequeue()
                : MediaLastUploadedTimestamps.Peek();
            media["status"] = "finished";
            media["file_extension"] = "png";
            return media;
        }

        private HttpResponseMessage UpdatePlaylist(CapturedRequest request)
        {
            var items = JsonNode.Parse(request.TextBody!)!["items"]!.AsArray();
            PlaylistItems.Clear();
            PlaylistItems.AddRange(items.OfType<JsonObject>().Select(item => item.DeepClone().AsObject()));
            return Empty();
        }

        private static long ParseMediaId(string path) =>
            long.Parse(path.Split('/', StringSplitOptions.RemoveEmptyEntries)[3]);

        private static HttpResponseMessage Json(JsonNode value, HttpStatusCode statusCode = HttpStatusCode.OK) =>
            new(statusCode)
            {
                Content = new StringContent(value.ToJsonString(), Encoding.UTF8, "application/json")
            };

        private static HttpResponseMessage Empty() => new(HttpStatusCode.NoContent);
    }

    private sealed class FakeHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false)
        {
            BaseAddress = new Uri("https://app.yodeck.test/api/v2/")
        };
    }

    private sealed class RecordingHandler(
        Func<CapturedRequest, Task<HttpResponseMessage>> responder,
        List<CapturedRequest> requests) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var body = request.Content is null
                ? []
                : await request.Content.ReadAsByteArrayAsync(cancellationToken);
            var captured = new CapturedRequest(
                request.Method,
                request.RequestUri!,
                request.Content?.Headers.ContentType?.MediaType,
                body);
            requests.Add(captured);
            return await responder(captured);
        }
    }

    private sealed record CapturedRequest(
        HttpMethod Method,
        Uri Uri,
        string? ContentType,
        byte[] Body)
    {
        public string Path => Uri.AbsolutePath;

        public string? TextBody => Body.Length == 0 ? null : Encoding.UTF8.GetString(Body);
    }
}
