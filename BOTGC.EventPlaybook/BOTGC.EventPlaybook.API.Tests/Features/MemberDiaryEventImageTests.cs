using System.Text.Json;
using BOTGC.EventPlaybook.API.Features;
using BOTGC.EventPlaybook.API.Infrastructure;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BOTGC.EventPlaybook.API.Tests.Features;

public sealed class MemberDiaryEventImageTests
{
    private const int PlannerEventId = 4743;
    private const int DiaryEntryId = 4963;
    private static readonly byte[] PngBytes = [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4];

    [Fact]
    public async Task Publish_WhenDiarySucceeds_UploadsThenAttachesTheSelectedArtwork()
    {
        var transport = new RecordingTransport(call => call.Path switch
        {
            var path when call.Method == HttpMethod.Get && path.Contains("ajaxaction=addtodiary", StringComparison.Ordinal) =>
                Response(CreatedDiaryResponse),
            "/diaryadmin.php?&requestType=ajax&ajaxaction=editnow" => Response(string.Empty),
            var path when call.IsMultipart && path.Contains("ajaxaction=eventimageupload", StringComparison.Ordinal) =>
                Response(string.Empty),
            var path when call.Method == HttpMethod.Post && path.Contains("ajaxaction=eventdetailssave", StringComparison.Ordinal) =>
                Response(string.Empty),
            _ => throw Unexpected(call)
        });
        var handler = CreateHandler(transport, new JsonCache());

        var result = await handler.Handle(
            new PublishPlannerDiaryCommand(CreateRequest()),
            CancellationToken.None);

        Assert.True(result.Created);
        Assert.True(result.EventImageAttached);
        Assert.Equal(DiaryEntryId, result.IntelligentGolfDiaryEntryId);
        Assert.Collection(
            transport.Calls,
            call => Assert.Contains("ajaxaction=addtodiary", call.Path, StringComparison.Ordinal),
            call => Assert.Equal("/diaryadmin.php?&requestType=ajax&ajaxaction=editnow", call.Path),
            call =>
            {
                Assert.True(call.IsMultipart);
                Assert.Equal(
                    $"/event.php?eventid={PlannerEventId}&requestType=ajax&ajaxaction=eventimageupload",
                    call.Path);
                Assert.Equal(
                    [new("name", "the-2027-forum-social.png"), new("undefined", "undefined")],
                    call.Fields);
                Assert.NotNull(call.File);
                Assert.Equal("file", call.File.FieldName);
                Assert.Equal("the-2027-forum-social.png", call.File.FileName);
                Assert.Equal("image/png", call.File.ContentType);
                Assert.Equal(PngBytes, call.File.Content);
            },
            call =>
            {
                Assert.Equal(
                    $"/event.php?eventid={PlannerEventId}&requestType=ajax&ajaxaction=eventdetailssave",
                    call.Path);
                var field = Assert.Single(call.Fields!);
                Assert.Equal("description", field.Key);
                Assert.Equal(string.Empty, field.Value);
            });
    }

    [Fact]
    public async Task Publish_WhenDiaryUpdateFails_DoesNotStartImageWork()
    {
        var transport = new RecordingTransport(call => call.Path switch
        {
            var path when call.Method == HttpMethod.Get && path.Contains("ajaxaction=addtodiary", StringComparison.Ordinal) =>
                Response(CreatedDiaryResponse),
            "/diaryadmin.php?&requestType=ajax&ajaxaction=editnow" =>
                Response("{\"success\":false,\"message\":\"Diary rejected\"}"),
            _ => throw Unexpected(call)
        });
        var handler = CreateHandler(transport, new JsonCache());

        var exception = await Assert.ThrowsAsync<IntelligentGolfMutationException>(() =>
            handler.Handle(new PublishPlannerDiaryCommand(CreateRequest()), CancellationToken.None));

        Assert.Equal("member-diary-update", exception.Stage);
        Assert.Equal(PlannerEventId, exception.IntelligentGolfEventId);
        Assert.Equal(DiaryEntryId, exception.IntelligentGolfRecordId);
        Assert.False(exception.MemberDiaryPublished);
        Assert.DoesNotContain(transport.Calls, call => call.IsMultipart);
        Assert.DoesNotContain(transport.Calls, call => call.Path.Contains("eventdetailssave", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Publish_WhenPlannerDescriptionExists_PreservesItWhileAttachingTheImage()
    {
        var transport = new RecordingTransport(call => call.Path switch
        {
            var path when call.Method == HttpMethod.Get && path.Contains("ajaxaction=addtodiary", StringComparison.Ordinal) =>
                Response(CreatedDiaryResponse),
            "/diaryadmin.php?&requestType=ajax&ajaxaction=editnow" => Response(string.Empty),
            var path when call.IsMultipart && path.Contains("ajaxaction=eventimageupload", StringComparison.Ordinal) =>
                Response(string.Empty),
            var path when call.Method == HttpMethod.Post && path.Contains("ajaxaction=eventdetailssave", StringComparison.Ordinal) =>
                Response(string.Empty),
            _ => throw Unexpected(call)
        });
        var handler = CreateHandler(transport, new JsonCache());

        await handler.Handle(
            new PublishPlannerDiaryCommand(CreateRequest() with
            {
                PlannerDescriptionHtml = "<p>Planner details.</p><script>remove me</script>"
            }),
            CancellationToken.None);

        var save = Assert.Single(
            transport.Calls,
            call => call.Path.Contains("ajaxaction=eventdetailssave", StringComparison.Ordinal));
        var description = Assert.Single(save.Fields!);
        Assert.Equal("description", description.Key);
        Assert.Equal("<p>Planner details.</p>", description.Value);
    }

    [Fact]
    public async Task Publish_WhenArtworkUploadFails_ReportsPublishedDiaryAndDoesNotAttach()
    {
        var transport = new RecordingTransport(call => call.Path switch
        {
            var path when call.Method == HttpMethod.Get && path.Contains("ajaxaction=addtodiary", StringComparison.Ordinal) =>
                Response(CreatedDiaryResponse),
            "/diaryadmin.php?&requestType=ajax&ajaxaction=editnow" => Response(string.Empty),
            var path when call.IsMultipart && path.Contains("ajaxaction=eventimageupload", StringComparison.Ordinal) =>
                throw new HttpRequestException("Upload unavailable."),
            _ => throw Unexpected(call)
        });
        var handler = CreateHandler(transport, new JsonCache());

        var exception = await Assert.ThrowsAsync<IntelligentGolfMutationException>(() =>
            handler.Handle(new PublishPlannerDiaryCommand(CreateRequest()), CancellationToken.None));

        Assert.Equal("planner-event-image-upload", exception.Stage);
        Assert.Equal(PlannerEventId, exception.IntelligentGolfEventId);
        Assert.Equal(DiaryEntryId, exception.IntelligentGolfRecordId);
        Assert.True(exception.MemberDiaryPublished);
        Assert.NotNull(exception.MemberDiaryPublishedAtUtc);
        Assert.Contains("member diary entry was published", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(transport.Calls, call => call.Path.Contains("eventdetailssave", StringComparison.Ordinal));

        await using var services = new ServiceCollection()
            .AddLogging()
            .AddProblemDetails()
            .BuildServiceProvider();
        var context = new DefaultHttpContext { RequestServices = services };
        context.Response.Body = new MemoryStream();
        context.Features.Set<IExceptionHandlerFeature>(new ExceptionHandlerFeature { Error = exception });
        await ApiExceptionResponse.WriteAsync(context);
        context.Response.Body.Position = 0;
        using var problem = await JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal("planner-event-image-upload", problem.RootElement.GetProperty("stage").GetString());
        Assert.True(problem.RootElement.GetProperty("memberDiaryPublished").GetBoolean());
        Assert.Equal(DiaryEntryId, problem.RootElement.GetProperty("intelligentGolfRecordId").GetInt32());
    }

    [Fact]
    public async Task Publish_RetryAfterArtworkFailure_ResumesWithoutRepublishingUnchangedDiary()
    {
        var firstUpload = true;
        var transport = new RecordingTransport(call => call.Path switch
        {
            var path when call.Method == HttpMethod.Get && path.Contains("ajaxaction=addtodiary", StringComparison.Ordinal) =>
                Response(CreatedDiaryResponse),
            "/diaryadmin.php?&requestType=ajax&ajaxaction=editnow" => Response(string.Empty),
            var path when call.IsMultipart && path.Contains("ajaxaction=eventimageupload", StringComparison.Ordinal) =>
                firstUpload
                    ? ThrowFirstUpload()
                    : Response(string.Empty),
            var path when call.Method == HttpMethod.Post && path.Contains("ajaxaction=eventdetailssave", StringComparison.Ordinal) =>
                Response(string.Empty),
            _ => throw Unexpected(call)
        });
        var handler = CreateHandler(transport, new JsonCache());
        var command = new PublishPlannerDiaryCommand(CreateRequest());

        await Assert.ThrowsAsync<IntelligentGolfMutationException>(() =>
            handler.Handle(command, CancellationToken.None));
        var retry = await handler.Handle(command, CancellationToken.None);

        Assert.False(retry.Created);
        Assert.True(retry.EventImageAttached);
        Assert.Single(transport.Calls, call => call.Path.Contains("ajaxaction=addtodiary", StringComparison.Ordinal));
        Assert.Single(transport.Calls, call => call.Path.Contains("ajaxaction=editnow", StringComparison.Ordinal));
        Assert.Equal(2, transport.Calls.Count(call => call.IsMultipart));
        Assert.Single(transport.Calls, call => call.Path.Contains("ajaxaction=eventdetailssave", StringComparison.Ordinal));
        return;

        IntelligentGolfTransportResponse ThrowFirstUpload()
        {
            firstUpload = false;
            throw new HttpRequestException("Upload unavailable.");
        }
    }

    [Fact]
    public async Task Publish_WhenArtworkSaveFails_ReportsTheDistinctAssociationStage()
    {
        var transport = new RecordingTransport(call => call.Path switch
        {
            var path when call.Method == HttpMethod.Get && path.Contains("ajaxaction=addtodiary", StringComparison.Ordinal) =>
                Response(CreatedDiaryResponse),
            "/diaryadmin.php?&requestType=ajax&ajaxaction=editnow" => Response(string.Empty),
            var path when call.IsMultipart && path.Contains("ajaxaction=eventimageupload", StringComparison.Ordinal) =>
                Response(string.Empty),
            var path when call.Method == HttpMethod.Post && path.Contains("ajaxaction=eventdetailssave", StringComparison.Ordinal) =>
                Response("{\"success\":false,\"message\":\"Save rejected\"}"),
            _ => throw Unexpected(call)
        });
        var handler = CreateHandler(transport, new JsonCache());

        var exception = await Assert.ThrowsAsync<IntelligentGolfMutationException>(() =>
            handler.Handle(new PublishPlannerDiaryCommand(CreateRequest()), CancellationToken.None));

        Assert.Equal("planner-event-image-save", exception.Stage);
        Assert.True(exception.MemberDiaryPublished);
        Assert.Equal(DiaryEntryId, exception.IntelligentGolfRecordId);
    }

    [Fact]
    public async Task Publish_WhenSaveRefreshesTheSession_RepeatsTheCompleteImagePair()
    {
        var saveCount = 0;
        var transport = new RecordingTransport(call => call.Path switch
        {
            var path when call.Method == HttpMethod.Get && path.Contains("ajaxaction=addtodiary", StringComparison.Ordinal) =>
                Response(CreatedDiaryResponse),
            "/diaryadmin.php?&requestType=ajax&ajaxaction=editnow" => Response(string.Empty),
            var path when call.IsMultipart && path.Contains("ajaxaction=eventimageupload", StringComparison.Ordinal) =>
                Response(string.Empty),
            var path when call.Method == HttpMethod.Post && path.Contains("ajaxaction=eventdetailssave", StringComparison.Ordinal) =>
                ++saveCount == 1
                    ? Response("{\"success\":false,\"message\":\"No staged upload in refreshed session\"}", sessionRefreshed: true)
                    : Response(string.Empty),
            _ => throw Unexpected(call)
        });
        var handler = CreateHandler(transport, new JsonCache());

        var result = await handler.Handle(
            new PublishPlannerDiaryCommand(CreateRequest()),
            CancellationToken.None);

        Assert.True(result.EventImageAttached);
        Assert.Equal(2, transport.Calls.Count(call => call.IsMultipart));
        Assert.Equal(2, transport.Calls.Count(call => call.Path.Contains("eventdetailssave", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task Publish_WhenArtworkExceedsTwentyMiB_RejectsBeforeCallingIntelligentGolf()
    {
        var oversizedArtwork = new byte[(20 * 1024 * 1024) + 1];
        PngBytes.AsSpan(0, 8).CopyTo(oversizedArtwork);
        var request = CreateRequest() with
        {
            Artwork = new PlannerEventArtwork(
                "the-2027-forum-social.png",
                "image/png",
                Convert.ToBase64String(oversizedArtwork))
        };
        var transport = new RecordingTransport(call => throw Unexpected(call));
        var handler = CreateHandler(transport, new JsonCache());

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            handler.Handle(new PublishPlannerDiaryCommand(request), CancellationToken.None));

        Assert.Contains("larger than 20 MB", exception.Message, StringComparison.Ordinal);
        Assert.Empty(transport.Calls);
    }

    private static PublishPlannerDiaryHandler CreateHandler(
        IIntelligentGolfTransport transport,
        ICacheService cache) =>
        new(
            transport,
            cache,
            new AlwaysAcquiredLockManager(),
            NullLogger<PublishPlannerDiaryHandler>.Instance);

    private static PublishPlannerDiaryRequest CreateRequest() =>
        new(
            EventPlaybookEventId: "event-123",
            IntelligentGolfEventId: PlannerEventId,
            IntelligentGolfDiaryEntryId: null,
            Headline: "The 2027 Forum",
            DiaryDate: new DateOnly(2027, 1, 12),
            StartTime: "19:00",
            EndTime: "22:00",
            Venue: "Clubhouse",
            BodyHtml: "<p>Member-facing details.</p>",
            TagIds: [1, 2, 3, 4],
            PlannerDescriptionHtml: string.Empty,
            Artwork: new PlannerEventArtwork(
                "the-2027-forum-social.png",
                "image/png",
                Convert.ToBase64String(PngBytes)));

    private static IntelligentGolfTransportResponse Response(
        string body,
        bool sessionRefreshed = false) =>
        new(body, null, sessionRefreshed);

    private static Exception Unexpected(TransportCall call) =>
        new Xunit.Sdk.XunitException($"Unexpected Intelligent Golf request: {call.Method} {call.Path}");

    private const string CreatedDiaryResponse =
        "{\"actions\":[{\"type\":\"replace\",\"html\":\"<a data-ajax-action=\\\"editdiary\\\" data-ajax-data-inline-id=\\\"4963\\\">Edit</a>\"}]}";

    private sealed class RecordingTransport(
        Func<TransportCall, IntelligentGolfTransportResponse> responder) : IIntelligentGolfTransport
    {
        public List<TransportCall> Calls { get; } = [];

        public Task<T> ExecuteExclusiveAsync<T>(
            Func<CancellationToken, Task<T>> operation,
            CancellationToken cancellationToken = default) =>
            operation(cancellationToken);

        public Task<IntelligentGolfTransportResponse> GetResponseAsync(
            string path,
            CancellationToken cancellationToken = default) =>
            Record(new TransportCall(HttpMethod.Get, path, null, null));

        public Task<IntelligentGolfTransportResponse> PostFormResponseAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            CancellationToken cancellationToken = default) =>
            Record(new TransportCall(HttpMethod.Post, path, fields.ToArray(), null));

        public Task<IntelligentGolfTransportResponse> PostMultipartResponseAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            IntelligentGolfMultipartFile file,
            CancellationToken cancellationToken = default) =>
            Record(new TransportCall(HttpMethod.Post, path, fields.ToArray(), file));

        public Task<HtmlAgilityPack.HtmlDocument> GetDocumentAsync(
            string path,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<HtmlAgilityPack.HtmlDocument> PostFormDocumentAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<string> PostFormAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        private Task<IntelligentGolfTransportResponse> Record(TransportCall call)
        {
            Calls.Add(call);
            return Task.FromResult(responder(call));
        }
    }

    private sealed class JsonCache : ICacheService
    {
        private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
        private readonly Dictionary<string, string> _values = new(StringComparer.Ordinal);

        public Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken = default)
            where T : class =>
            Task.FromResult(
                _values.TryGetValue(key, out var json)
                    ? JsonSerializer.Deserialize<T>(json, Options)
                    : null);

        public Task SetAsync<T>(
            string key,
            T value,
            TimeSpan expiration,
            CancellationToken cancellationToken = default)
            where T : class
        {
            _values[key] = JsonSerializer.Serialize(value, Options);
            return Task.CompletedTask;
        }

        public Task RemoveAsync(string key, CancellationToken cancellationToken = default)
        {
            _values.Remove(key);
            return Task.CompletedTask;
        }
    }

    private sealed class AlwaysAcquiredLockManager : IDistributedLockManager
    {
        public Task<IDistributedLock> AcquireAsync(
            string resource,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IDistributedLock>(new AcquiredLock());

        private sealed class AcquiredLock : IDistributedLock
        {
            public bool IsAcquired => true;
            public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }

    private sealed record TransportCall(
        HttpMethod Method,
        string Path,
        IReadOnlyCollection<KeyValuePair<string, string>>? Fields,
        IntelligentGolfMultipartFile? File)
    {
        public bool IsMultipart => File is not null;
    }
}
