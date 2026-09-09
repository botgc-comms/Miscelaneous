using System.Text.Json;
using BOTGC.EventPlaybook.API.Features;
using BOTGC.EventPlaybook.API.Infrastructure;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using HtmlAgilityPack;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BOTGC.EventPlaybook.API.Tests.Features;

public sealed class EventPlannerEventMatchingTests
{
    private static readonly DateOnly EventDate = new(2026, 12, 12);

    [Fact]
    public async Task Synchronise_WhenDateAlreadyHasEvents_ReturnsCandidatesWithoutAllocatingOrUpdating()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/eventview.php?date=2026-12-12&view=day&subView=all" => Response(DayViewHtml),
            "/event.php?eventid=4713" => Response(SameDayEventPageHtml),
            "/event.php?eventid=4733" => Response(SameDayEventPageWithReorderedAttributesHtml),
            "/event.php?eventid=4900" => Response(AdjacentDayEventPageHtml),
            _ => throw Unexpected(request)
        });
        var cache = new JsonCache();
        var handler = CreateSynchroniseHandler(transport, cache);

        var exception = await Assert.ThrowsAsync<IntelligentGolfPlannerMatchRequiredException>(() =>
            handler.Handle(new SynchronisePlannerEventCommand(CreateSynchroniseRequest()), CancellationToken.None));

        Assert.Equal(EventDate, exception.EventDate);
        Assert.Collection(
            exception.Candidates,
            candidate =>
            {
                Assert.Equal(4713, candidate.IntelligentGolfEventId);
                Assert.Equal("Club Event: Marc Bolton", candidate.Name);
            },
            candidate =>
            {
                Assert.Equal(4733, candidate.IntelligentGolfEventId);
                Assert.Equal("BOTGC Event Planner: A Night with Marc Bolton", candidate.Name);
            });
        Assert.Equal(4, transport.Requests.Count);
        Assert.Contains(transport.Requests, request => request.Path == "/event.php?eventid=4900");
        Assert.DoesNotContain(transport.Requests, request =>
            request.Path.StartsWith("/eventadmin.php", StringComparison.Ordinal));
        Assert.DoesNotContain(transport.Requests, request => request.Method == HttpMethod.Post);
        Assert.Empty(cache.Values);
    }

    [Fact]
    public async Task MatchRequiredException_IsReturnedAsConflictWithStructuredCandidates()
    {
        var exception = new IntelligentGolfPlannerMatchRequiredException(
            EventDate,
            [new IntelligentGolfPlannerEventCandidate(4713, "Club Event: Marc Bolton")]);
        await using var services = new ServiceCollection()
            .AddLogging()
            .AddProblemDetails()
            .BuildServiceProvider();
        var context = new DefaultHttpContext
        {
            RequestServices = services
        };
        context.Response.Body = new MemoryStream();
        context.Features.Set<IExceptionHandlerFeature>(new ExceptionHandlerFeature { Error = exception });

        await ApiExceptionResponse.WriteAsync(context);

        Assert.Equal(StatusCodes.Status409Conflict, context.Response.StatusCode);
        context.Response.Body.Position = 0;
        using var problem = await JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal(
            "planner-event-match-required",
            problem.RootElement.GetProperty("stage").GetString());
        Assert.Equal("2026-12-12", problem.RootElement.GetProperty("eventDate").GetString());
        Assert.False(problem.RootElement.GetProperty("retryable").GetBoolean());
        var candidate = Assert.Single(problem.RootElement.GetProperty("candidates").EnumerateArray());
        Assert.Equal(4713, candidate.GetProperty("intelligentGolfEventId").GetInt32());
        Assert.Equal("Club Event: Marc Bolton", candidate.GetProperty("name").GetString());
    }

    [Fact]
    public async Task Adopt_VerifiesSameDayCandidateAndCachesLinkWithoutChangingIntelligentGolfEvent()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/eventview.php?date=2026-12-12&view=day&subView=all" => Response(DayViewHtml),
            "/event.php?eventid=4713" => Response(SameDayEventPageHtml),
            "/event.php?eventid=4733" => Response(SameDayEventPageWithReorderedAttributesHtml),
            "/event.php?eventid=4900" => Response(AdjacentDayEventPageHtml),
            _ => throw Unexpected(request)
        });
        var cache = new JsonCache();
        var handler = new AdoptPlannerEventHandler(
            transport,
            cache,
            new AlwaysAcquiredLockManager(),
            NullLogger<AdoptPlannerEventHandler>.Instance);

        var result = await handler.Handle(
            new AdoptPlannerEventCommand(new AdoptPlannerEventRequest("event-123", EventDate, 4713)),
            CancellationToken.None);

        Assert.True(result.Adopted);
        Assert.Equal("event-123", result.EventPlaybookEventId);
        Assert.Equal(4713, result.IntelligentGolfEventId);
        Assert.Equal(4, transport.Requests.Count);
        Assert.DoesNotContain(transport.Requests, request => request.Method == HttpMethod.Post);
        Assert.DoesNotContain(transport.Requests, request =>
            request.Path.StartsWith("/eventadmin.php", StringComparison.Ordinal));

        var cached = JsonDocument.Parse(cache.Values["intelligent-golf:event-link:event-123"]);
        Assert.Equal(4713, cached.RootElement.GetProperty("intelligentGolfEventId").GetInt32());
    }

    [Fact]
    public async Task Synchronise_WhenCreateNewIsExplicit_BypassesSameDayDiscoveryAndAllocatesSeparateEvent()
    {
        var transport = new RecordingTransport(request =>
        {
            if (request.Path == "/eventadmin.php?group=-1&booking=-1&date=12-12-2026&")
            {
                return Response(
                    string.Empty,
                    "https://www.botgc.co.uk/eventadmin.php?group=-1&booking=4800");
            }

            if (request.Path == "/event.php?eventid=4800") return Response("<html></html>");
            if (request.Method == HttpMethod.Post &&
                request.Path == "/event.php?eventid=4800&requestType=ajax&ajaxaction=confirmeditevent")
            {
                return Response(string.Empty);
            }

            if (request.Path.StartsWith(
                    "/event.php?eventid=4800&eventPlaybookVerify=",
                    StringComparison.Ordinal))
            {
                return Response("<h1>A Night with Marc Bolton</h1>");
            }

            throw Unexpected(request);
        });
        var cache = new JsonCache();
        var handler = CreateSynchroniseHandler(transport, cache);

        var result = await handler.Handle(
            new SynchronisePlannerEventCommand(CreateSynchroniseRequest(createNewWhenDateOccupied: true)),
            CancellationToken.None);

        Assert.True(result.Allocated);
        Assert.Equal(4800, result.IntelligentGolfEventId);
        Assert.DoesNotContain(transport.Requests, request =>
            request.Path.StartsWith("/eventview.php", StringComparison.Ordinal));
        Assert.Contains(transport.Requests, request =>
            request.Path == "/eventadmin.php?group=-1&booking=-1&date=12-12-2026&");
        Assert.Contains(transport.Requests, request =>
            request.Method == HttpMethod.Post &&
            request.Path == "/event.php?eventid=4800&requestType=ajax&ajaxaction=confirmeditevent");
    }

    [Fact]
    public async Task Synchronise_WhenDateIsFree_DiscoversBeforeAllocating()
    {
        var transport = new RecordingTransport(request =>
        {
            if (request.Path == "/eventview.php?date=2026-12-12&view=day&subView=all")
                return Response("<html><body>No events</body></html>");
            if (request.Path == "/eventadmin.php?group=-1&booking=-1&date=12-12-2026&")
                return Response(string.Empty, "https://www.botgc.co.uk/eventadmin.php?group=-1&booking=4801");
            if (request.Path == "/event.php?eventid=4801") return Response("<html></html>");
            if (request.Method == HttpMethod.Post &&
                request.Path == "/event.php?eventid=4801&requestType=ajax&ajaxaction=confirmeditevent")
                return Response(string.Empty);
            if (request.Path.StartsWith(
                    "/event.php?eventid=4801&eventPlaybookVerify=",
                    StringComparison.Ordinal))
                return Response("<h1>A Night with Marc Bolton</h1>");
            throw Unexpected(request);
        });
        var handler = CreateSynchroniseHandler(transport, new JsonCache());

        var result = await handler.Handle(
            new SynchronisePlannerEventCommand(CreateSynchroniseRequest()),
            CancellationToken.None);

        Assert.True(result.Allocated);
        Assert.Equal(4801, result.IntelligentGolfEventId);
        Assert.Equal(
            "/eventview.php?date=2026-12-12&view=day&subView=all",
            transport.Requests[0].Path);
        Assert.Equal(
            "/eventadmin.php?group=-1&booking=-1&date=12-12-2026&",
            transport.Requests[1].Path);
    }

    [Fact]
    public async Task Synchronise_WhenDayViewRequestFails_DoesNotAllocate()
    {
        var transport = new RecordingTransport(request =>
            request.Path == "/eventview.php?date=2026-12-12&view=day&subView=all"
                ? throw new HttpRequestException("The planner day could not be read.")
                : throw Unexpected(request));
        var cache = new JsonCache();
        var handler = CreateSynchroniseHandler(transport, cache);

        var exception = await Assert.ThrowsAsync<IntelligentGolfMutationException>(() =>
            handler.Handle(new SynchronisePlannerEventCommand(CreateSynchroniseRequest()), CancellationToken.None));

        Assert.Equal("planner-event-discovery", exception.Stage);
        Assert.DoesNotContain(transport.Requests, request =>
            request.Path.StartsWith("/eventadmin.php", StringComparison.Ordinal));
        Assert.DoesNotContain(transport.Requests, request => request.Method == HttpMethod.Post);
        Assert.Empty(cache.Values);
    }

    [Fact]
    public async Task Synchronise_WhenCandidateDateRequestFails_RetainsUnverifiedCandidate()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/eventview.php?date=2026-12-12&view=day&subView=all" =>
                Response("<a href=\"/event.php?eventid=4713\">Club Event: Marc Bolton</a>"),
            "/event.php?eventid=4713" => throw new HttpRequestException("The candidate page could not be read."),
            _ => throw Unexpected(request)
        });
        var handler = CreateSynchroniseHandler(transport, new JsonCache());

        var exception = await Assert.ThrowsAsync<IntelligentGolfPlannerMatchRequiredException>(() =>
            handler.Handle(new SynchronisePlannerEventCommand(CreateSynchroniseRequest()), CancellationToken.None));

        var candidate = Assert.Single(exception.Candidates);
        Assert.Equal(4713, candidate.IntelligentGolfEventId);
        Assert.DoesNotContain(transport.Requests, request =>
            request.Path.StartsWith("/eventadmin.php", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Synchronise_WhenCandidateDateCannotBeRead_RetainsUnverifiedCandidate()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/eventview.php?date=2026-12-12&view=day&subView=all" =>
                Response("<a href=\"/event.php?eventid=4713\">Club Event: Marc Bolton</a>"),
            "/event.php?eventid=4713" => Response("<input name=\"date\" value=\"not-a-date\">"),
            _ => throw Unexpected(request)
        });
        var cache = new JsonCache();
        var handler = CreateSynchroniseHandler(transport, cache);

        var exception = await Assert.ThrowsAsync<IntelligentGolfPlannerMatchRequiredException>(() =>
            handler.Handle(new SynchronisePlannerEventCommand(CreateSynchroniseRequest()), CancellationToken.None));

        var candidate = Assert.Single(exception.Candidates);
        Assert.Equal(4713, candidate.IntelligentGolfEventId);
        Assert.DoesNotContain(transport.Requests, request =>
            request.Path.StartsWith("/eventadmin.php", StringComparison.Ordinal));
        Assert.Empty(cache.Values);
    }

    [Fact]
    public async Task Adopt_WhenCandidateHasVanished_ReturnsRefreshableConflictWithEmptyCandidates()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/eventview.php?date=2026-12-12&view=day&subView=all" => Response("<html><body>No events</body></html>"),
            _ => throw Unexpected(request)
        });
        var handler = new AdoptPlannerEventHandler(
            transport,
            new JsonCache(),
            new AlwaysAcquiredLockManager(),
            NullLogger<AdoptPlannerEventHandler>.Instance);

        var exception = await Assert.ThrowsAsync<IntelligentGolfPlannerMatchRequiredException>(() =>
            handler.Handle(
                new AdoptPlannerEventCommand(new AdoptPlannerEventRequest("event-123", EventDate, 4713)),
                CancellationToken.None));

        Assert.Equal("planner-event-match-expired", exception.Stage);
        Assert.Equal(EventDate, exception.EventDate);
        Assert.Empty(exception.Candidates);

        await using var services = new ServiceCollection()
            .AddLogging()
            .AddProblemDetails()
            .BuildServiceProvider();
        var context = new DefaultHttpContext { RequestServices = services };
        context.Response.Body = new MemoryStream();
        context.Features.Set<IExceptionHandlerFeature>(new ExceptionHandlerFeature { Error = exception });
        await ApiExceptionResponse.WriteAsync(context);

        Assert.Equal(StatusCodes.Status409Conflict, context.Response.StatusCode);
        context.Response.Body.Position = 0;
        using var problem = await JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal("planner-event-match-expired", problem.RootElement.GetProperty("stage").GetString());
        Assert.Empty(problem.RootElement.GetProperty("candidates").EnumerateArray());
    }

    private static SynchronisePlannerEventHandler CreateSynchroniseHandler(
        IIntelligentGolfTransport transport,
        ICacheService cache) =>
        new(
            transport,
            cache,
            new AlwaysAcquiredLockManager(),
            NullLogger<SynchronisePlannerEventHandler>.Instance);

    private static SynchronisePlannerEventRequest CreateSynchroniseRequest(
        bool createNewWhenDateOccupied = false) =>
        new(
            EventPlaybookEventId: "event-123",
            IntelligentGolfEventId: null,
            Name: "A Night with Marc Bolton",
            EventDate,
            StartTime: "19:00",
            EndTime: "23:00",
            EventTypeId: 0,
            Attendees: 100,
            GroupId: "151",
            GroupName: "BOTGC Event Planner",
            DescriptionHtml: "<p>An evening with Marc Bolton.</p>",
            CreateNewWhenDateOccupied: createNewWhenDateOccupied);

    private static IntelligentGolfTransportResponse Response(string body, string? finalUri = null) =>
        new(body, finalUri is null ? null : new Uri(finalUri));

    private static Exception Unexpected(TransportRequest request) =>
        new Xunit.Sdk.XunitException($"Unexpected Intelligent Golf request: {request.Method} {request.Path}");

    private const string DayViewHtml = """
        <div class="calendar-day">
          <a href="/event.php?eventid=4713"><span>Club Event:</span> Marc Bolton</a>
          <a href="/event.php?eventid=4733&amp;tab=overview">BOTGC Event Planner: A Night with Marc Bolton</a>
          <a href="/event.php?eventid=4713">Marc Bolton</a>
          <a href="/event.php?eventid=4900">Adjacent-day navigation event</a>
          <a href="/competition.php?compid=22">Unrelated competition</a>
        </div>
        """;

    private const string SameDayEventPageHtml = """
        <form><input value="12/12/2026" class="date-field" name="date" type="text"></form>
        """;

    private const string SameDayEventPageWithReorderedAttributesHtml = """
        <form><input TYPE='text' NAME='DATE' id='event-date' value='12/12/2026'></form>
        """;

    private const string AdjacentDayEventPageHtml = """
        <form><input name="date" type="text" value="13/12/2026"></form>
        """;

    private sealed class RecordingTransport(
        Func<TransportRequest, IntelligentGolfTransportResponse> responder) : IIntelligentGolfTransport
    {
        public List<TransportRequest> Requests { get; } = [];

        public Task<T> ExecuteExclusiveAsync<T>(
            Func<CancellationToken, Task<T>> operation,
            CancellationToken cancellationToken = default) =>
            operation(cancellationToken);

        public Task<IntelligentGolfTransportResponse> GetResponseAsync(
            string path,
            CancellationToken cancellationToken = default) =>
            Record(HttpMethod.Get, path, null);

        public Task<IntelligentGolfTransportResponse> PostFormResponseAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            CancellationToken cancellationToken = default) =>
            Record(HttpMethod.Post, path, fields);

        public Task<IntelligentGolfTransportResponse> PostMultipartResponseAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            IntelligentGolfMultipartFile file,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<HtmlDocument> GetDocumentAsync(
            string path,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<HtmlDocument> PostFormDocumentAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<string> PostFormAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        private Task<IntelligentGolfTransportResponse> Record(
            HttpMethod method,
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>>? fields)
        {
            var request = new TransportRequest(method, path, fields);
            Requests.Add(request);
            return Task.FromResult(responder(request));
        }
    }

    private sealed class JsonCache : ICacheService
    {
        private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

        public Dictionary<string, string> Values { get; } = new(StringComparer.Ordinal);

        public Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken = default)
            where T : class =>
            Task.FromResult(
                Values.TryGetValue(key, out var json)
                    ? JsonSerializer.Deserialize<T>(json, Options)
                    : null);

        public Task SetAsync<T>(
            string key,
            T value,
            TimeSpan expiration,
            CancellationToken cancellationToken = default)
            where T : class
        {
            Values[key] = JsonSerializer.Serialize(value, Options);
            return Task.CompletedTask;
        }

        public Task RemoveAsync(string key, CancellationToken cancellationToken = default)
        {
            Values.Remove(key);
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

    private sealed record TransportRequest(
        HttpMethod Method,
        string Path,
        IReadOnlyCollection<KeyValuePair<string, string>>? Fields);
}
