using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using BOTGC.EventPlaybook.API.Features.MemberEmail;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using HtmlAgilityPack;
using MediatR;

namespace BOTGC.EventPlaybook.API.Features;

public sealed record SynchronisePlannerEventRequest(
    string EventPlaybookEventId,
    int? IntelligentGolfEventId,
    string Name,
    DateOnly EventDate,
    string? StartTime,
    string? EndTime,
    int? EventTypeId,
    int? Attendees,
    string? GroupId,
    string? GroupName,
    string DescriptionHtml);

public sealed record SynchronisePlannerEventResult(
    string EventPlaybookEventId,
    int IntelligentGolfEventId,
    bool Allocated,
    DateTimeOffset SynchronisedAtUtc);

public sealed record PublishPlannerDiaryRequest(
    string EventPlaybookEventId,
    int IntelligentGolfEventId,
    int? IntelligentGolfDiaryEntryId,
    string Headline,
    DateOnly DiaryDate,
    string? StartTime,
    string? EndTime,
    string? Venue,
    string BodyHtml,
    IReadOnlyCollection<int>? TagIds);

public sealed record PublishPlannerDiaryResult(
    string EventPlaybookEventId,
    int IntelligentGolfEventId,
    int IntelligentGolfDiaryEntryId,
    bool Created,
    DateTimeOffset PublishedAtUtc);

public sealed record SynchronisePlannerEventCommand(
    SynchronisePlannerEventRequest Request) : IRequest<SynchronisePlannerEventResult>;

public sealed record PublishPlannerDiaryCommand(
    PublishPlannerDiaryRequest Request) : IRequest<PublishPlannerDiaryResult>;

public sealed class SynchronisePlannerEventHandler(
    IIntelligentGolfTransport transport,
    ICacheService cache,
    IDistributedLockManager lockManager,
    ILogger<SynchronisePlannerEventHandler> logger)
    : IRequestHandler<SynchronisePlannerEventCommand, SynchronisePlannerEventResult>
{
    private static readonly TimeSpan LinkLifetime = TimeSpan.FromDays(3650);

    public async Task<SynchronisePlannerEventResult> Handle(
        SynchronisePlannerEventCommand command,
        CancellationToken cancellationToken)
    {
        var request = command.Request;
        ValidateEvent(request);

        var cacheKey = EventCacheKey(request.EventPlaybookEventId);
        var externalId = request.IntelligentGolfEventId;
        var allocated = false;
        if (externalId is null or <= 0)
        {
            externalId = (await cache.GetAsync<ExternalEventLink>(cacheKey, cancellationToken))?.IntelligentGolfEventId;
        }

        if (externalId is null or <= 0)
        {
            await using var allocationLock = await lockManager.AcquireAsync(
                $"intelligent-golf:event-allocation:{request.EventPlaybookEventId}",
                cancellationToken);
            if (!allocationLock.IsAcquired)
            {
                throw new TimeoutException("Another request is currently creating this Intelligent Golf event. Try again shortly.");
            }

            externalId = (await cache.GetAsync<ExternalEventLink>(cacheKey, cancellationToken))?.IntelligentGolfEventId;
            if (externalId is null or <= 0)
            {
                var allocationDate = request.EventDate.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture);
                var allocation = await transport.GetResponseAsync(
                    $"/eventadmin.php?group=-1&booking=-1&date={allocationDate}&",
                    cancellationToken);
                externalId = ExtractAllocatedEventId(allocation)
                    ?? throw new InvalidOperationException(
                        "Intelligent Golf created the event page but did not return its event ID. The event details were not submitted.");
                allocated = true;
                await cache.SetAsync(
                    cacheKey,
                    new ExternalEventLink(externalId.Value),
                    LinkLifetime,
                    cancellationToken);
            }
        }

        var fields = new List<KeyValuePair<string, string>>
        {
            new("eventid", externalId.Value.ToString(CultureInfo.InvariantCulture)),
            new("groupid", request.GroupId?.Trim() ?? string.Empty),
            new("newgroupname", string.IsNullOrWhiteSpace(request.GroupId)
                ? (string.IsNullOrWhiteSpace(request.GroupName) ? "BOTGC Event Planner" : request.GroupName.Trim())
                : string.Empty),
            new("name", request.Name.Trim()),
            new("eventtype_id", Math.Max(0, request.EventTypeId ?? 0).ToString(CultureInfo.InvariantCulture)),
            new("attendees", Math.Max(0, request.Attendees ?? 0).ToString(CultureInfo.InvariantCulture)),
            new("invoice_no", string.Empty),
            new("date", request.EventDate.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)),
            new("start", request.StartTime?.Trim() ?? string.Empty),
            new("end", request.EndTime?.Trim() ?? string.Empty),
            new("description", MemberEmailHtmlSanitizer.Sanitise(request.DescriptionHtml))
        };

        await transport.PostFormAsync(
            $"/event.php?eventid={externalId.Value}&requestType=ajax&ajaxaction=confirmeditevent",
            fields,
            cancellationToken);
        await cache.SetAsync(cacheKey, new ExternalEventLink(externalId.Value), LinkLifetime, cancellationToken);

        var synchronisedAt = DateTimeOffset.UtcNow;
        logger.LogInformation(
            "{Operation} Intelligent Golf event {IntelligentGolfEventId} for Event Playbook event {EventPlaybookEventId}.",
            allocated ? "Allocated and synchronised" : "Synchronised",
            externalId,
            request.EventPlaybookEventId);
        return new SynchronisePlannerEventResult(
            request.EventPlaybookEventId,
            externalId.Value,
            allocated,
            synchronisedAt);
    }

    internal static void ValidateTimeRange(string? startTime, string? endTime)
    {
        var start = ParseTime(startTime, "start");
        var end = ParseTime(endTime, "end");
        if (start.HasValue && end.HasValue && end.Value <= start.Value)
        {
            throw new ArgumentException("The event end time must be after its start time.");
        }
    }

    private static string EventCacheKey(string eventPlaybookEventId) =>
        $"intelligent-golf:event-link:{eventPlaybookEventId.Trim().ToLowerInvariant()}";

    private static void ValidateEvent(SynchronisePlannerEventRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.EventPlaybookEventId))
            throw new ArgumentException("The Event Playbook event ID is required.");
        if (string.IsNullOrWhiteSpace(request.Name))
            throw new ArgumentException("The event name is required.");
        if (request.Name.Trim().Length > 180)
            throw new ArgumentException("The event name cannot exceed 180 characters.");
        if (string.IsNullOrWhiteSpace(request.DescriptionHtml))
            throw new ArgumentException("The event description is required.");
        ValidateTimeRange(request.StartTime, request.EndTime);
    }

    private static TimeOnly? ParseTime(string? value, string label)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (TimeOnly.TryParseExact(value.Trim(), "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var result))
            return result;
        throw new ArgumentException($"The event {label} time must use the 24-hour HH:mm format.");
    }

    private static int? ExtractAllocatedEventId(IntelligentGolfTransportResponse response)
    {
        var queryMatch = Regex.Match(
            response.FinalUri?.Query ?? string.Empty,
            @"(?:^|[?&])booking=(\d+)(?:&|$)",
            RegexOptions.IgnoreCase);
        if (queryMatch.Success && int.TryParse(queryMatch.Groups[1].Value, out var queryId)) return queryId;

        var htmlMatch = Regex.Match(
            response.Body,
            @"(?:booking=|name=[""']bookingid[""'][^>]*value=[""'])(\d+)",
            RegexOptions.IgnoreCase);
        return htmlMatch.Success && int.TryParse(htmlMatch.Groups[1].Value, out var bodyId) ? bodyId : null;
    }

    private sealed record ExternalEventLink(int IntelligentGolfEventId);
}

public sealed class PublishPlannerDiaryHandler(
    IIntelligentGolfTransport transport,
    ICacheService cache,
    IDistributedLockManager lockManager,
    ILogger<PublishPlannerDiaryHandler> logger)
    : IRequestHandler<PublishPlannerDiaryCommand, PublishPlannerDiaryResult>
{
    private static readonly TimeSpan LinkLifetime = TimeSpan.FromDays(3650);

    public async Task<PublishPlannerDiaryResult> Handle(
        PublishPlannerDiaryCommand command,
        CancellationToken cancellationToken)
    {
        var request = command.Request;
        Validate(request);
        var cacheKey = $"intelligent-golf:diary-link:{request.EventPlaybookEventId.Trim().ToLowerInvariant()}";
        var diaryId = request.IntelligentGolfDiaryEntryId;
        if (diaryId is null or <= 0)
        {
            diaryId = (await cache.GetAsync<ExternalDiaryLink>(cacheKey, cancellationToken))?.IntelligentGolfDiaryEntryId;
        }

        var created = false;
        if (diaryId is null or <= 0)
        {
            await using var diaryLock = await lockManager.AcquireAsync(
                $"intelligent-golf:diary-allocation:{request.EventPlaybookEventId}",
                cancellationToken);
            if (!diaryLock.IsAcquired)
            {
                throw new TimeoutException("Another request is currently creating this member diary entry. Try again shortly.");
            }

            diaryId = (await cache.GetAsync<ExternalDiaryLink>(cacheKey, cancellationToken))?.IntelligentGolfDiaryEntryId;
            if (diaryId is null or <= 0)
            {
                var eventPage = await transport.GetResponseAsync(
                    $"/event.php?eventid={request.IntelligentGolfEventId}",
                    cancellationToken);
                diaryId = ExtractDiaryId(eventPage, request.IntelligentGolfEventId);
                if (diaryId is null or <= 0)
                {
                    var allocationPath = ExtractDiaryAllocationPath(eventPage.Body);
                    if (!string.IsNullOrWhiteSpace(allocationPath))
                    {
                        var allocationResponse = await transport.GetResponseAsync(allocationPath, cancellationToken);
                        diaryId = ExtractDiaryId(allocationResponse, request.IntelligentGolfEventId);
                        created = diaryId is > 0;
                    }
                }

                if (diaryId is null or <= 0)
                {
                    created = true;
                    var creationResponse = await transport.PostFormResponseAsync(
                        $"/event.php?eventid={request.IntelligentGolfEventId}&requestType=ajax&ajaxaction=confirmeditdiary",
                        new List<KeyValuePair<string, string>>
                        {
                            new("id", string.Empty),
                            new("headline", request.Headline.Trim()),
                            new("body", HtmlToPlainText(request.BodyHtml)),
                            new("venue", request.Venue?.Trim() ?? string.Empty),
                            new("visibleToMembers", "1")
                        },
                        cancellationToken);

                    diaryId = ExtractDiaryId(creationResponse, request.IntelligentGolfEventId);
                }

                if (diaryId is null or <= 0)
                {
                    var refreshedEventPage = await transport.GetResponseAsync(
                        $"/event.php?eventid={request.IntelligentGolfEventId}",
                        cancellationToken);
                    diaryId = ExtractDiaryId(refreshedEventPage, request.IntelligentGolfEventId);
                }

                if (diaryId is null or <= 0)
                {
                    throw new InvalidOperationException(
                        "Intelligent Golf accepted the initial diary request but did not expose the new diary-entry ID. No HTML update was attempted; inspect the event in Intelligent Golf before retrying.");
                }

                await cache.SetAsync(cacheKey, new ExternalDiaryLink(diaryId.Value), LinkLifetime, cancellationToken);
            }
        }

        var fields = new List<KeyValuePair<string, string>>
        {
            new("id", diaryId.Value.ToString(CultureInfo.InvariantCulture)),
            new("booking", request.IntelligentGolfEventId.ToString(CultureInfo.InvariantCulture)),
            new("warning", "0"),
            new("headline", request.Headline.Trim())
        };
        var tagIds = request.TagIds?.Where(id => id > 0).Distinct().ToArray() ?? [1, 2, 3, 4];
        fields.AddRange(tagIds.Select(id => new KeyValuePair<string, string>("tags[]", id.ToString(CultureInfo.InvariantCulture))));
        fields.AddRange(
        [
            new("diarydate", request.DiaryDate.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)),
            new("starttime", request.StartTime?.Trim() ?? string.Empty),
            new("endtime", request.EndTime?.Trim() ?? string.Empty),
            new("venue", request.Venue?.Trim() ?? "Clubhouse"),
            new("body", MemberEmailHtmlSanitizer.Sanitise(request.BodyHtml))
        ]);

        await transport.PostFormAsync(
            "/diaryadmin.php?&requestType=ajax&ajaxaction=editnow",
            fields,
            cancellationToken);
        await cache.SetAsync(cacheKey, new ExternalDiaryLink(diaryId.Value), LinkLifetime, cancellationToken);

        var publishedAt = DateTimeOffset.UtcNow;
        logger.LogInformation(
            "{Operation} Intelligent Golf diary entry {DiaryEntryId}, linked to event {IntelligentGolfEventId}.",
            created ? "Created and updated" : "Updated",
            diaryId,
            request.IntelligentGolfEventId);
        return new PublishPlannerDiaryResult(
            request.EventPlaybookEventId,
            request.IntelligentGolfEventId,
            diaryId.Value,
            created,
            publishedAt);
    }

    private static void Validate(PublishPlannerDiaryRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.EventPlaybookEventId))
            throw new ArgumentException("The Event Playbook event ID is required.");
        if (request.IntelligentGolfEventId <= 0)
            throw new ArgumentException("A valid Intelligent Golf event ID is required before publishing its diary entry.");
        if (string.IsNullOrWhiteSpace(request.Headline))
            throw new ArgumentException("The member diary headline is required.");
        if (string.IsNullOrWhiteSpace(request.BodyHtml))
            throw new ArgumentException("The member diary HTML body is required.");
        if (request.Headline.Trim().Length > 250)
            throw new ArgumentException("The member diary headline cannot exceed 250 characters.");
        if (request.BodyHtml.Length > 200_000)
            throw new ArgumentException("The member diary HTML body is too large.");
        SynchronisePlannerEventHandler.ValidateTimeRange(request.StartTime, request.EndTime);
    }

    private static string HtmlToPlainText(string html)
    {
        var document = new HtmlDocument();
        document.LoadHtml(MemberEmailHtmlSanitizer.Sanitise(html));
        return WebUtility.HtmlDecode(document.DocumentNode.InnerText)
            .Replace("\u00a0", " ", StringComparison.Ordinal)
            .Trim();
    }

    private static int? ExtractDiaryId(string raw, int eventId)
    {
        var jsonId = TryExtractDiaryIdFromJson(raw, eventId);
        if (jsonId.HasValue) return jsonId;

        var candidates = new List<int>();
        var patterns = new[]
        {
            @"(?:diary(?:entry)?[_-]?id|diaryid)\s*[""':=\s]+(\d+)",
            @"(?:editDiary|openEditDiaryEntryDialog)\s*\([^\d]*(\d+)",
            @"diaryadmin\.php[^""'\s>]*[?&](?:id|diaryid)=(\d+)"
        };
        foreach (var pattern in patterns)
        {
            foreach (Match match in Regex.Matches(raw, pattern, RegexOptions.IgnoreCase))
            {
                if (int.TryParse(match.Groups[1].Value, out var id) && id > 0 && id != eventId)
                    candidates.Add(id);
            }
        }
        return candidates.Count == 0 ? null : candidates.Max();
    }

    private static int? ExtractDiaryId(IntelligentGolfTransportResponse response, int eventId)
    {
        var queryMatch = Regex.Match(
            response.FinalUri?.Query ?? string.Empty,
            @"(?:^|[?&])(?:id|diaryid|diaryentryid)=(\d+)(?:&|$)",
            RegexOptions.IgnoreCase);
        if (queryMatch.Success && int.TryParse(queryMatch.Groups[1].Value, out var id) && id != eventId)
            return id;
        return ExtractDiaryId(response.Body, eventId);
    }

    private static string? ExtractDiaryAllocationPath(string html)
    {
        var document = new HtmlDocument();
        document.LoadHtml(html);
        var link = document.DocumentNode.SelectSingleNode("//a[@id='eventbutton']")
                   ?? document.DocumentNode.SelectSingleNode("//a[contains(@href, 'eventbookingid=')]");
        var href = WebUtility.HtmlDecode(link?.GetAttributeValue("href", string.Empty) ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(href) || Uri.TryCreate(href, UriKind.Absolute, out _)) return null;
        return href.StartsWith('/') ? href : $"/{href}";
    }

    private static int? TryExtractDiaryIdFromJson(string raw, int eventId)
    {
        try
        {
            using var document = JsonDocument.Parse(raw);
            return FindDiaryId(document.RootElement, eventId);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static int? FindDiaryId(JsonElement element, int eventId)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if ((property.Name.Equals("diaryId", StringComparison.OrdinalIgnoreCase) ||
                     property.Name.Equals("diaryEntryId", StringComparison.OrdinalIgnoreCase) ||
                     property.Name.Equals("id", StringComparison.OrdinalIgnoreCase)) &&
                    TryReadPositiveInt(property.Value, out var id) && id != eventId)
                    return id;
                var nested = FindDiaryId(property.Value, eventId);
                if (nested.HasValue) return nested;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                var nested = FindDiaryId(item, eventId);
                if (nested.HasValue) return nested;
            }
        }
        return null;
    }

    private static bool TryReadPositiveInt(JsonElement value, out int result)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out result)) return result > 0;
        if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out result)) return result > 0;
        result = 0;
        return false;
    }

    private sealed record ExternalDiaryLink(int IntelligentGolfDiaryEntryId);
}

public static class EventPlannerFeatureExtensions
{
    public static IServiceCollection AddEventPlannerFeatures(this IServiceCollection services) => services;

    public static IEndpointRouteBuilder MapEventPlannerEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost(
                "/api/event-planner/events/synchronise",
                async (SynchronisePlannerEventRequest request, IMediator mediator, CancellationToken cancellationToken) =>
                    Results.Ok(await mediator.Send(new SynchronisePlannerEventCommand(request), cancellationToken)))
            .WithName("SynchronisePlannerEvent")
            .WithTags("Event planner")
            .WithSummary("Allocate when necessary and synchronise an Event Playbook event with Intelligent Golf")
            .Produces<SynchronisePlannerEventResult>();

        endpoints.MapPut(
                "/api/event-planner/member-diary",
                async (PublishPlannerDiaryRequest request, IMediator mediator, CancellationToken cancellationToken) =>
                    Results.Ok(await mediator.Send(new PublishPlannerDiaryCommand(request), cancellationToken)))
            .WithName("PublishPlannerMemberDiary")
            .WithTags("Event planner")
            .WithSummary("Create when necessary and update the Intelligent Golf member diary entry with HTML")
            .Produces<PublishPlannerDiaryResult>();

        return endpoints;
    }
}
