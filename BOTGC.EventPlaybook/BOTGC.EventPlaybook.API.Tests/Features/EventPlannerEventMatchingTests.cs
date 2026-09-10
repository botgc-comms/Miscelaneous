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
    private static readonly IIntelligentGolfSession Session =
        new AuthenticatedSession("https://www.botgc.co.uk/");

    [Fact]
    public async Task Synchronise_WhenDateAlreadyHasEvents_ReturnsCandidatesWithoutAllocatingOrUpdating()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/eventview.php?date=12-12-2026&view=month&subView=all" => Response(MonthViewHtml),
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
                Assert.Equal("A Night with Marc Bolton", candidate.Name);
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
            "/eventview.php?date=12-12-2026&view=month&subView=all" => Response(MonthViewHtml),
            "/event.php?eventid=4713" => Response(SameDayEventPageHtml),
            "/event.php?eventid=4733" => Response(SameDayEventPageWithReorderedAttributesHtml),
            "/event.php?eventid=4900" => Response(AdjacentDayEventPageHtml),
            _ => throw Unexpected(request)
        });
        var cache = new JsonCache();
        var handler = new AdoptPlannerEventHandler(
            transport,
            Session,
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
            if (request.Path == "/eventview.php?date=12-12-2026&view=month&subView=all")
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
            "/eventview.php?date=12-12-2026&view=month&subView=all",
            transport.Requests[0].Path);
        Assert.Equal(
            "/eventadmin.php?group=-1&booking=-1&date=12-12-2026&",
            transport.Requests[1].Path);
    }

    [Fact]
    public async Task Synchronise_WhenMonthViewRequestFails_DoesNotAllocate()
    {
        var transport = new RecordingTransport(request =>
            request.Path == "/eventview.php?date=12-12-2026&view=month&subView=all"
                ? throw new HttpRequestException("The planner month could not be read.")
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
    public async Task Synchronise_WhenCandidateDetailRequestFails_AbortsWithoutAllocatingDuplicate()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/eventview.php?date=12-12-2026&view=month&subView=all" =>
                Response("<a href=\"/event.php?eventid=4713\">Club Event: Marc Bolton</a>"),
            "/event.php?eventid=4713" => throw new HttpRequestException("The candidate page could not be read."),
            _ => throw Unexpected(request)
        });
        var handler = CreateSynchroniseHandler(transport, new JsonCache());

        var exception = await Assert.ThrowsAsync<IntelligentGolfMutationException>(() =>
            handler.Handle(new SynchronisePlannerEventCommand(CreateSynchroniseRequest()), CancellationToken.None));

        Assert.Equal("planner-event-lookup-request", exception.Stage);
        Assert.DoesNotContain(transport.Requests, request =>
            request.Path.StartsWith("/eventadmin.php", StringComparison.Ordinal));
        Assert.DoesNotContain(transport.Requests, request => request.Method == HttpMethod.Post);
    }

    [Fact]
    public async Task Synchronise_WhenCandidateDetailCannotBeVerified_AbortsWithoutAllocatingDuplicate()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/eventview.php?date=12-12-2026&view=month&subView=all" =>
                Response("<a href=\"/event.php?eventid=4713\">Club Event: Marc Bolton</a>"),
            "/event.php?eventid=4713" => Response("<input name=\"date\" value=\"not-a-date\">"),
            _ => throw Unexpected(request)
        });
        var cache = new JsonCache();
        var handler = CreateSynchroniseHandler(transport, cache);

        var exception = await Assert.ThrowsAsync<IntelligentGolfMutationException>(() =>
            handler.Handle(new SynchronisePlannerEventCommand(CreateSynchroniseRequest()), CancellationToken.None));

        Assert.Equal("planner-event-lookup-response", exception.Stage);
        Assert.DoesNotContain(transport.Requests, request =>
            request.Path.StartsWith("/eventadmin.php", StringComparison.Ordinal));
        Assert.DoesNotContain(transport.Requests, request => request.Method == HttpMethod.Post);
        Assert.Empty(cache.Values);
    }

    [Fact]
    public async Task Adopt_WhenCandidateHasVanished_ReturnsRefreshableConflictWithEmptyCandidates()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/eventview.php?date=12-12-2026&view=month&subView=all" => Response("<html><body>No events</body></html>"),
            _ => throw Unexpected(request)
        });
        var handler = new AdoptPlannerEventHandler(
            transport,
            Session,
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

    [Fact]
    public async Task ListCandidates_ReturnsSameDayPlannerEventsWithoutMutatingIntelligentGolf()
    {
        var transport = CreateDiscoveryTransport();
        var handler = new ListPlannerEventCandidatesHandler(transport, Session);

        var result = await handler.Handle(
            new ListPlannerEventCandidatesQuery(EventDate),
            CancellationToken.None);

        Assert.Equal(EventDate, result.EventDate);
        Assert.Equal([4713, 4733], result.Candidates.Select(candidate => candidate.IntelligentGolfEventId));
        Assert.All(transport.Requests, request => Assert.Equal(HttpMethod.Get, request.Method));
    }

    [Fact]
    public async Task ListCandidates_VerifiesSameDayEntryFromBookingDetailsTable()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/eventview.php?date=12-12-2026&view=month&subView=all" =>
                Response("<a href='/event.php?eventid=4423'>Calendar label</a>"),
            "/event.php?eventid=4423" => Response(
                KnownPlannerBookingDetailsHtml,
                "https://www.botgc.co.uk/event.php?eventid=4423"),
            _ => throw Unexpected(request)
        });
        var handler = new ListPlannerEventCandidatesHandler(transport, Session);

        var result = await handler.Handle(
            new ListPlannerEventCandidatesQuery(EventDate),
            CancellationToken.None);

        var candidate = Assert.Single(result.Candidates);
        Assert.Equal(4423, candidate.IntelligentGolfEventId);
        Assert.Equal("Marc Bolton", candidate.Name);
        Assert.All(transport.Requests, request => Assert.Equal(HttpMethod.Get, request.Method));
    }

    [Fact]
    public async Task LookupPlannerEvent_ByKnownId_VerifiesAuthoritativeFormWithOneReadOnlyRequest()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/event.php?eventid=4423" => Response(KnownPlannerEventPageHtml),
            _ => throw Unexpected(request)
        });
        var handler = new LookupPlannerEventHandler(transport, Session);

        var result = await handler.Handle(
            new LookupPlannerEventQuery(EventDate, 4423),
            CancellationToken.None);

        Assert.Equal(EventDate, result.EventDate);
        Assert.Equal(4423, result.Candidate.IntelligentGolfEventId);
        Assert.Equal("Marc Bolton", result.Candidate.Name);
        var request = Assert.Single(transport.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal("/event.php?eventid=4423", request.Path);
    }

    [Fact]
    public async Task LookupPlannerEvent_WhenEditFormIsAbsent_VerifiesBookingDetailsAndFinalUri()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/event.php?eventid=4423" => Response(
                KnownPlannerBookingDetailsHtml,
                "https://www.botgc.co.uk/event.php?eventid=4423"),
            _ => throw Unexpected(request)
        });
        var handler = new LookupPlannerEventHandler(transport, Session);

        var result = await handler.Handle(
            new LookupPlannerEventQuery(EventDate, 4423),
            CancellationToken.None);

        Assert.Equal(EventDate, result.EventDate);
        Assert.Equal(4423, result.Candidate.IntelligentGolfEventId);
        Assert.Equal("Marc Bolton", result.Candidate.Name);
        var request = Assert.Single(transport.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
    }

    [Fact]
    public async Task LookupPlannerEvent_WhenOnlyEventIdInputIsRendered_UsesBookingDetailsForNameAndDate()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/event.php?eventid=4423" => Response(
                "<input name='eventid' value='4423'>" + KnownPlannerBookingDetailsHtml,
                "https://www.botgc.co.uk/event.php?eventid=4423"),
            _ => throw Unexpected(request)
        });
        var handler = new LookupPlannerEventHandler(transport, Session);

        var result = await handler.Handle(
            new LookupPlannerEventQuery(EventDate, 4423),
            CancellationToken.None);

        Assert.Equal(4423, result.Candidate.IntelligentGolfEventId);
        Assert.Equal("Marc Bolton", result.Candidate.Name);
        Assert.Equal(EventDate, result.EventDate);
    }

    [Theory]
    [InlineData("https://www.botgc.co.uk/event.php?eventid=4745")]
    [InlineData("https://www.botgc.co.uk/event.php")]
    [InlineData("https://www.botgc.co.uk/eventadmin.php?eventid=4423")]
    [InlineData("https://not-botgc.example/event.php?eventid=4423")]
    [InlineData("/eventadmin.php?eventid=4423")]
    public async Task LookupPlannerEvent_WhenBookingDetailsFinalUriDoesNotIdentifyRequestedEvent_Rejects(
        string finalUri)
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/event.php?eventid=4423" => Response(KnownPlannerBookingDetailsHtml, finalUri),
            _ => throw Unexpected(request)
        });
        var handler = new LookupPlannerEventHandler(transport, Session);

        var exception = await Assert.ThrowsAsync<IntelligentGolfMutationException>(() =>
            handler.Handle(new LookupPlannerEventQuery(EventDate, 4423), CancellationToken.None));

        Assert.Equal("planner-event-lookup-response", exception.Stage);
        Assert.Equal(4423, exception.IntelligentGolfEventId);
        Assert.Single(transport.Requests);
    }

    [Theory]
    [InlineData("https://www.botgc.co.uk/eventadmin.php?eventid=4423")]
    [InlineData("https://elsewhere.example/event.php?eventid=4423")]
    [InlineData("/event.php?eventid=4745")]
    public async Task LookupPlannerEvent_WhenFormMatchesButFinalUriIsNotRequestedEvent_Rejects(
        string finalUri)
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/event.php?eventid=4423" => Response(KnownPlannerEventPageHtml, finalUri),
            _ => throw Unexpected(request)
        });
        var handler = new LookupPlannerEventHandler(transport, Session);

        var exception = await Assert.ThrowsAsync<IntelligentGolfMutationException>(() =>
            handler.Handle(new LookupPlannerEventQuery(EventDate, 4423), CancellationToken.None));

        Assert.Equal("planner-event-lookup-response", exception.Stage);
        Assert.Equal(4423, exception.IntelligentGolfEventId);
        Assert.Single(transport.Requests);
    }

    [Theory]
    [InlineData("<input name='eventid' value='9999'><input name='name' value='Marc Bolton'><input name='date' value='12/12/2026'>", "planner-event-lookup-response")]
    [InlineData("<input name='eventid' value='4423'><input name='name' value='Marc Bolton'>", "planner-event-lookup-response")]
    [InlineData("<input name='eventid' value='4423'><input name='name' value='Marc Bolton'><input name='date' value='13/12/2026'>", "planner-event-lookup-date-mismatch")]
    public async Task LookupPlannerEvent_WhenIdentityOrDateCannotBeVerified_RejectsWithoutMutation(
        string responseHtml,
        string expectedStage)
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/event.php?eventid=4423" => Response(responseHtml),
            _ => throw Unexpected(request)
        });
        var handler = new LookupPlannerEventHandler(transport, Session);

        var exception = await Assert.ThrowsAsync<IntelligentGolfMutationException>(() =>
            handler.Handle(new LookupPlannerEventQuery(EventDate, 4423), CancellationToken.None));

        Assert.Equal(expectedStage, exception.Stage);
        Assert.Equal(4423, exception.IntelligentGolfEventId);
        var request = Assert.Single(transport.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
    }

    [Theory]
    [InlineData("planner-event-lookup-response")]
    [InlineData("planner-event-lookup-date-mismatch")]
    public async Task DeterministicPlannerLookupFailure_IsConflictAndNotRetryable(string stage)
    {
        var exception = new IntelligentGolfMutationException(
            stage,
            "The selected planner event could not be verified.",
            4423);
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
        Assert.Equal(stage, problem.RootElement.GetProperty("stage").GetString());
        Assert.False(problem.RootElement.GetProperty("retryable").GetBoolean());
    }

    [Fact]
    public async Task PlannerLookupRequestFailure_RemainsRetryableBadGateway()
    {
        var exception = new IntelligentGolfMutationException(
            "planner-event-lookup-request",
            "The selected planner event could not be read.",
            4423);
        await using var services = new ServiceCollection()
            .AddLogging()
            .AddProblemDetails()
            .BuildServiceProvider();
        var context = new DefaultHttpContext { RequestServices = services };
        context.Response.Body = new MemoryStream();
        context.Features.Set<IExceptionHandlerFeature>(new ExceptionHandlerFeature { Error = exception });

        await ApiExceptionResponse.WriteAsync(context);

        Assert.Equal(StatusCodes.Status502BadGateway, context.Response.StatusCode);
        context.Response.Body.Position = 0;
        using var problem = await JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal("planner-event-lookup-request", problem.RootElement.GetProperty("stage").GetString());
        Assert.True(problem.RootElement.GetProperty("retryable").GetBoolean());
    }

    [Fact]
    public async Task Relink_WhenCalendarDiscoveryIsEmpty_DirectlyVerifiesKnownIdAndClearsOnlyEventScopedDiaryCache()
    {
        var transport = CreateDiscoveryTransport();
        var cache = new JsonCache();
        await SeedCacheAsync(cache, "intelligent-golf:event-link:event-123", new { IntelligentGolfEventId = 4733 });
        await SeedCacheAsync(cache, "intelligent-golf:diary-link:event-123", new { IntelligentGolfDiaryEntryId = 4963 });
        await SeedCacheAsync(cache, "intelligent-golf:diary-link:planner:4733", new { IntelligentGolfDiaryEntryId = 4963 });
        await SeedCacheAsync(cache, "intelligent-golf:diary-link:planner:4713", new { IntelligentGolfDiaryEntryId = 4999 });
        var handler = CreateRelinkHandler(transport, cache);

        var result = await handler.Handle(
            new RelinkPlannerEventCommand(
                new RelinkPlannerEventRequest("event-123", EventDate, 4733, 4713)),
            CancellationToken.None);

        Assert.True(result.Relinked);
        Assert.Equal(4733, result.PreviousIntelligentGolfEventId);
        Assert.Equal(4713, result.IntelligentGolfEventId);
        var cached = JsonDocument.Parse(cache.Values["intelligent-golf:event-link:event-123"]);
        Assert.Equal(4713, cached.RootElement.GetProperty("intelligentGolfEventId").GetInt32());
        Assert.DoesNotContain("intelligent-golf:diary-link:event-123", cache.Values.Keys);
        Assert.Contains("intelligent-golf:diary-link:planner:4733", cache.Values.Keys);
        Assert.Contains("intelligent-golf:diary-link:planner:4713", cache.Values.Keys);
        var verification = Assert.Single(transport.Requests);
        Assert.Equal(HttpMethod.Get, verification.Method);
        Assert.Equal("/event.php?eventid=4713", verification.Path);
        Assert.DoesNotContain(transport.Requests, request =>
            request.Path.StartsWith("/eventview.php", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Relink_WhenApiAlreadyPointsAtTarget_IsIdempotentAndKeepsCurrentDiaryCache()
    {
        var transport = CreateDiscoveryTransport();
        var cache = new JsonCache();
        await SeedCacheAsync(cache, "intelligent-golf:event-link:event-123", new { IntelligentGolfEventId = 4713 });
        await SeedCacheAsync(cache, "intelligent-golf:diary-link:event-123", new { IntelligentGolfDiaryEntryId = 4999 });
        var handler = CreateRelinkHandler(transport, cache);

        var result = await handler.Handle(
            new RelinkPlannerEventCommand(
                new RelinkPlannerEventRequest("event-123", EventDate, 4733, 4713)),
            CancellationToken.None);

        Assert.False(result.Relinked);
        Assert.Equal(4713, result.IntelligentGolfEventId);
        Assert.Contains("intelligent-golf:diary-link:event-123", cache.Values.Keys);
        var verification = Assert.Single(transport.Requests);
        Assert.Equal(HttpMethod.Get, verification.Method);
        Assert.Equal("/event.php?eventid=4713", verification.Path);
    }

    [Fact]
    public async Task Relink_WhenPlannerCacheWriteFails_RestoresPreviousPlannerAndDiaryAssociations()
    {
        const string eventLinkKey = "intelligent-golf:event-link:event-123";
        const string diaryLinkKey = "intelligent-golf:diary-link:event-123";
        var transport = CreateDiscoveryTransport();
        var cache = new FaultInjectingCache();
        await SeedCacheAsync(cache, eventLinkKey, new { IntelligentGolfEventId = 4733 });
        await SeedCacheAsync(cache, diaryLinkKey, new
        {
            IntelligentGolfDiaryEntryId = 4963,
            DiaryFingerprint = "diary-old",
            ArtworkFingerprint = "artwork-old"
        });
        cache.FailAfterSetKey = eventLinkKey;
        var handler = CreateRelinkHandler(transport, cache);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            handler.Handle(
                new RelinkPlannerEventCommand(
                    new RelinkPlannerEventRequest("event-123", EventDate, 4733, 4713)),
                CancellationToken.None));

        using var eventLink = JsonDocument.Parse(cache.Values[eventLinkKey]);
        Assert.Equal(4733, eventLink.RootElement.GetProperty("intelligentGolfEventId").GetInt32());
        using var diaryLink = JsonDocument.Parse(cache.Values[diaryLinkKey]);
        Assert.Equal(4963, diaryLink.RootElement.GetProperty("intelligentGolfDiaryEntryId").GetInt32());
        Assert.Equal("diary-old", diaryLink.RootElement.GetProperty("diaryFingerprint").GetString());
        Assert.Equal("artwork-old", diaryLink.RootElement.GetProperty("artworkFingerprint").GetString());
    }

    [Fact]
    public async Task Relink_WhenCancelledAfterDiaryRemoval_RestoresPreviousPlannerAndDiaryAssociations()
    {
        const string eventLinkKey = "intelligent-golf:event-link:event-123";
        const string diaryLinkKey = "intelligent-golf:diary-link:event-123";
        using var cancellation = new CancellationTokenSource();
        var transport = CreateDiscoveryTransport();
        var cache = new FaultInjectingCache
        {
            CancelAfterRemoveKey = diaryLinkKey,
            CancellationSource = cancellation
        };
        await SeedCacheAsync(cache, eventLinkKey, new { IntelligentGolfEventId = 4733 });
        await SeedCacheAsync(cache, diaryLinkKey, new { IntelligentGolfDiaryEntryId = 4963 });
        var handler = CreateRelinkHandler(transport, cache);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            handler.Handle(
                new RelinkPlannerEventCommand(
                    new RelinkPlannerEventRequest("event-123", EventDate, 4733, 4713)),
                cancellation.Token));

        using var eventLink = JsonDocument.Parse(cache.Values[eventLinkKey]);
        Assert.Equal(4733, eventLink.RootElement.GetProperty("intelligentGolfEventId").GetInt32());
        using var diaryLink = JsonDocument.Parse(cache.Values[diaryLinkKey]);
        Assert.Equal(4963, diaryLink.RootElement.GetProperty("intelligentGolfDiaryEntryId").GetInt32());
    }

    [Fact]
    public async Task Relink_WhenApiAlreadyPointsAtTargetButItIsNoLongerOnTheDate_RejectsPartialRetry()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/event.php?eventid=4713" => Response("""
                <input name="eventid" value="4713">
                <input name="name" value="Marc Bolton">
                <input name="date" value="13/12/2026">
                """),
            _ => throw Unexpected(request)
        });
        var cache = new JsonCache();
        await SeedCacheAsync(cache, "intelligent-golf:event-link:event-123", new { IntelligentGolfEventId = 4713 });
        await SeedCacheAsync(cache, "intelligent-golf:diary-link:event-123", new { IntelligentGolfDiaryEntryId = 4999 });
        var handler = CreateRelinkHandler(transport, cache);

        var exception = await Assert.ThrowsAsync<IntelligentGolfMutationException>(() =>
            handler.Handle(
                new RelinkPlannerEventCommand(
                    new RelinkPlannerEventRequest("event-123", EventDate, 4733, 4713)),
                CancellationToken.None));

        Assert.Equal("planner-event-lookup-date-mismatch", exception.Stage);
        var cached = JsonDocument.Parse(cache.Values["intelligent-golf:event-link:event-123"]);
        Assert.Equal(4713, cached.RootElement.GetProperty("intelligentGolfEventId").GetInt32());
        Assert.Contains("intelligent-golf:diary-link:event-123", cache.Values.Keys);
        Assert.Single(transport.Requests);
    }

    [Fact]
    public async Task Relink_WhenExpectedLinkIsStale_ReturnsConflictWithoutChangingAnyCache()
    {
        var transport = new RecordingTransport(request => throw Unexpected(request));
        var cache = new JsonCache();
        await SeedCacheAsync(cache, "intelligent-golf:event-link:event-123", new { IntelligentGolfEventId = 4800 });
        await SeedCacheAsync(cache, "intelligent-golf:diary-link:event-123", new { IntelligentGolfDiaryEntryId = 4963 });
        var handler = CreateRelinkHandler(transport, cache);

        var exception = await Assert.ThrowsAsync<IntelligentGolfPlannerRelinkConflictException>(() =>
            handler.Handle(
                new RelinkPlannerEventCommand(
                    new RelinkPlannerEventRequest("event-123", EventDate, 4733, 4713)),
                CancellationToken.None));

        Assert.Equal(4733, exception.ExpectedIntelligentGolfEventId);
        Assert.Equal(4800, exception.CurrentIntelligentGolfEventId);
        Assert.Contains("intelligent-golf:diary-link:event-123", cache.Values.Keys);
        Assert.Empty(transport.Requests);

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
        Assert.Equal("planner-event-relink-conflict", problem.RootElement.GetProperty("stage").GetString());
        Assert.Equal(4733, problem.RootElement.GetProperty("expectedIntelligentGolfEventId").GetInt32());
        Assert.Equal(4800, problem.RootElement.GetProperty("currentIntelligentGolfEventId").GetInt32());
    }

    [Fact]
    public async Task Relink_WhenTargetIsNotOnEventDate_PreservesCurrentLinkAndDiaryCache()
    {
        var transport = new RecordingTransport(request => request.Path switch
        {
            "/event.php?eventid=4713" => Response("<input name='eventid' value='4713'><input name='name' value='Marc Bolton'>"),
            _ => throw Unexpected(request)
        });
        var cache = new JsonCache();
        await SeedCacheAsync(cache, "intelligent-golf:event-link:event-123", new { IntelligentGolfEventId = 4733 });
        await SeedCacheAsync(cache, "intelligent-golf:diary-link:event-123", new { IntelligentGolfDiaryEntryId = 4963 });
        var handler = CreateRelinkHandler(transport, cache);

        var exception = await Assert.ThrowsAsync<IntelligentGolfMutationException>(() =>
            handler.Handle(
                new RelinkPlannerEventCommand(
                    new RelinkPlannerEventRequest("event-123", EventDate, 4733, 4713)),
                CancellationToken.None));

        Assert.Equal("planner-event-lookup-response", exception.Stage);
        var cached = JsonDocument.Parse(cache.Values["intelligent-golf:event-link:event-123"]);
        Assert.Equal(4733, cached.RootElement.GetProperty("intelligentGolfEventId").GetInt32());
        Assert.Contains("intelligent-golf:diary-link:event-123", cache.Values.Keys);
    }

    [Fact]
    public async Task Relink_WhenApiEventCacheIsEmpty_UsesExplicitExpectedLinkAndCompletes()
    {
        var transport = CreateDiscoveryTransport();
        var cache = new JsonCache();
        await SeedCacheAsync(cache, "intelligent-golf:diary-link:event-123", new { IntelligentGolfDiaryEntryId = 4963 });
        var handler = CreateRelinkHandler(transport, cache);

        var result = await handler.Handle(
            new RelinkPlannerEventCommand(
                new RelinkPlannerEventRequest("event-123", EventDate, 4733, 4713)),
            CancellationToken.None);

        Assert.True(result.Relinked);
        var cached = JsonDocument.Parse(cache.Values["intelligent-golf:event-link:event-123"]);
        Assert.Equal(4713, cached.RootElement.GetProperty("intelligentGolfEventId").GetInt32());
        Assert.DoesNotContain("intelligent-golf:diary-link:event-123", cache.Values.Keys);
    }

    private static SynchronisePlannerEventHandler CreateSynchroniseHandler(
        IIntelligentGolfTransport transport,
        ICacheService cache) =>
        new(
            transport,
            Session,
            cache,
            new AlwaysAcquiredLockManager(),
            NullLogger<SynchronisePlannerEventHandler>.Instance);

    private static RelinkPlannerEventHandler CreateRelinkHandler(
        IIntelligentGolfTransport transport,
        ICacheService cache) =>
        new(
            transport,
            Session,
            cache,
            new AlwaysAcquiredLockManager(),
            NullLogger<RelinkPlannerEventHandler>.Instance);

    private static RecordingTransport CreateDiscoveryTransport() =>
        new(request => request.Path switch
        {
            "/eventview.php?date=12-12-2026&view=month&subView=all" => Response(MonthViewHtml),
            "/event.php?eventid=4713" => Response(SameDayEventPageHtml),
            "/event.php?eventid=4733" => Response(SameDayEventPageWithReorderedAttributesHtml),
            "/event.php?eventid=4900" => Response(AdjacentDayEventPageHtml),
            _ => throw Unexpected(request)
        });

    private static Task SeedCacheAsync(ICacheService cache, string key, object value) =>
        cache.SetAsync(key, value, TimeSpan.FromDays(1), CancellationToken.None);

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
        new(body, finalUri is null ? null : new Uri(finalUri, UriKind.RelativeOrAbsolute));

    private static Exception Unexpected(TransportRequest request) =>
        new Xunit.Sdk.XunitException($"Unexpected Intelligent Golf request: {request.Method} {request.Path}");

    private const string MonthViewHtml = """
        <div class="calendar-day">
          <a href="/eventadmin.php?group=-1&amp;booking=4713"><span>Club Event:</span> Marc Bolton</a>
          <a href="/eventadmin.php?booking=4733&amp;group=-1">BOTGC Event Planner: A Night with Marc Bolton</a>
          <a href="/event.php?tab=overview&amp;eventid=4713">Marc Bolton</a>
          <a href="/eventadmin.php?group=-1&amp;booking=4900">Adjacent-day navigation event</a>
          <a href="/eventadmin.php?group=-1&amp;booking=-1&amp;date=12-12-2026">Add Event</a>
          <a href="/competition.php?compid=22">Unrelated competition</a>
        </div>
        """;

    private const string SameDayEventPageHtml = """
        <form>
          <input name="eventid" value="4713" type="hidden">
          <input name="name" value="Club Event: Marc Bolton" type="text">
          <input value="12/12/2026" class="date-field" name="date" type="text">
        </form>
        """;

    private const string SameDayEventPageWithReorderedAttributesHtml = """
        <form>
          <input VALUE='4733' NAME='EVENTID' TYPE='hidden'>
          <input value='A Night with Marc Bolton' type='text' name='NAME'>
          <input TYPE='text' NAME='DATE' id='event-date' value='12/12/2026'>
        </form>
        """;

    private const string KnownPlannerEventPageHtml = """
        <div id="event_overview_details_edit">
          <form>
            <input type="hidden" id="eventid" value="4423" name="eventid">
            <input class="form-control" value="Marc Bolton" id="name" name="name" type="text">
            <input value="12/12/2026" type="text" id="date" name="date" class="form-control datepicker">
          </form>
        </div>
        """;

    private const string KnownPlannerBookingDetailsHtml = """
        <div class="slate">
          <h3>Booking Details</h3>
          <table class="table">
            <tr><td><strong>Group</strong></td><td>Club Event</td></tr>
            <tr>
              <td style="font-weight:bold">Event Name</td>
              <td><span>Marc Bolton</span></td>
            </tr>
            <tr>
              <th>Date:</th>
              <td>Saturday&nbsp;12/12/2026</td>
            </tr>
          </table>
        </div>
        """;

    private const string AdjacentDayEventPageHtml = """
        <form>
          <input name="eventid" type="hidden" value="4900">
          <input name="name" type="text" value="Adjacent-day navigation event">
          <input name="date" type="text" value="13/12/2026">
        </form>
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
            var response = responder(request);
            if (response.FinalUri is null &&
                method == HttpMethod.Get &&
                path.StartsWith("/event.php?", StringComparison.OrdinalIgnoreCase))
            {
                response = response with { FinalUri = new Uri(path, UriKind.Relative) };
            }

            return Task.FromResult(response);
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

    private sealed class FaultInjectingCache : ICacheService
    {
        private readonly JsonCache inner = new();

        public Dictionary<string, string> Values => inner.Values;
        public string? FailAfterSetKey { get; set; }
        public string? CancelAfterRemoveKey { get; init; }
        public CancellationTokenSource? CancellationSource { get; init; }

        public Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken = default)
            where T : class =>
            inner.GetAsync<T>(key, cancellationToken);

        public async Task SetAsync<T>(
            string key,
            T value,
            TimeSpan expiration,
            CancellationToken cancellationToken = default)
            where T : class
        {
            await inner.SetAsync(key, value, expiration, cancellationToken);
            if (!string.Equals(FailAfterSetKey, key, StringComparison.Ordinal)) return;

            FailAfterSetKey = null;
            throw new InvalidOperationException("Injected cache write failure.");
        }

        public async Task RemoveAsync(string key, CancellationToken cancellationToken = default)
        {
            await inner.RemoveAsync(key, cancellationToken);
            if (!string.Equals(CancelAfterRemoveKey, key, StringComparison.Ordinal) ||
                CancellationSource is null ||
                CancellationSource.IsCancellationRequested)
            {
                return;
            }

            CancellationSource.Cancel();
            throw new OperationCanceledException(CancellationSource.Token);
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

    private sealed class AuthenticatedSession(string baseUrl) : IIntelligentGolfSession
    {
        public IntelligentGolfSessionStatus Status { get; } =
            new(true, null, DateTimeOffset.UtcNow, null);
        public string BaseUrl { get; } = baseUrl;
        public string? MemberId => "3104";
        public IntelligentGolfEmailSenderIdentity EmailSender { get; } = new(null, null, null);

        public Task<IntelligentGolfSessionGrant> AuthenticateAsync(
            IntelligentGolfCredentials credentials,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task EnsureAuthenticatedAsync(
            bool forceRefresh = false,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public bool IsSessionTokenValid(string? token) => true;
    }

    private sealed record TransportRequest(
        HttpMethod Method,
        string Path,
        IReadOnlyCollection<KeyValuePair<string, string>>? Fields);
}
