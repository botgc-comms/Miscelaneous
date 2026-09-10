using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
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
    string DescriptionHtml,
    bool CreateNewWhenDateOccupied = false);

public sealed record SynchronisePlannerEventResult(
    string EventPlaybookEventId,
    int IntelligentGolfEventId,
    bool Allocated,
    DateTimeOffset SynchronisedAtUtc);

public sealed record IntelligentGolfPlannerEventCandidate(
    int IntelligentGolfEventId,
    string Name);

public sealed class IntelligentGolfPlannerMatchRequiredException(
    DateOnly eventDate,
    IReadOnlyList<IntelligentGolfPlannerEventCandidate> candidates,
    string stage = "planner-event-match-required",
    string? message = null)
    : Exception(message ?? BuildMessage(eventDate, candidates))
{
    public DateOnly EventDate { get; } = eventDate;
    public IReadOnlyList<IntelligentGolfPlannerEventCandidate> Candidates { get; } = candidates;
    public string Stage { get; } = stage;

    private static string BuildMessage(
        DateOnly eventDate,
        IReadOnlyCollection<IntelligentGolfPlannerEventCandidate> candidates) =>
        $"Intelligent Golf already contains {candidates.Count} planner " +
        $"{(candidates.Count == 1 ? "event" : "events")} on {eventDate:yyyy-MM-dd}. " +
        "Choose one to adopt or explicitly create a separate event.";
}

public sealed record AdoptPlannerEventRequest(
    string EventPlaybookEventId,
    DateOnly EventDate,
    int IntelligentGolfEventId);

public sealed record AdoptPlannerEventResult(
    string EventPlaybookEventId,
    int IntelligentGolfEventId,
    bool Adopted,
    DateTimeOffset AdoptedAtUtc);

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
    IReadOnlyCollection<int>? TagIds,
    string? PlannerDescriptionHtml,
    PlannerEventArtwork Artwork);

public sealed record PlannerEventArtwork(
    string FileName,
    string ContentType,
    string Base64Data);

public sealed record PublishPlannerDiaryResult(
    string EventPlaybookEventId,
    int IntelligentGolfEventId,
    int IntelligentGolfDiaryEntryId,
    bool Created,
    bool EventImageAttached,
    DateTimeOffset PublishedAtUtc);

public sealed record SynchronisePlannerEventCommand(
    SynchronisePlannerEventRequest Request) : IRequest<SynchronisePlannerEventResult>;

public sealed record AdoptPlannerEventCommand(
    AdoptPlannerEventRequest Request) : IRequest<AdoptPlannerEventResult>;

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
                $"intelligent-golf:event-allocation:{request.EventPlaybookEventId.Trim().ToLowerInvariant()}",
                cancellationToken);
            if (!allocationLock.IsAcquired)
            {
                throw new TimeoutException("Another request is currently creating this Intelligent Golf event. Try again shortly.");
            }

            externalId = (await cache.GetAsync<ExternalEventLink>(cacheKey, cancellationToken))?.IntelligentGolfEventId;
            if (externalId is null or <= 0)
            {
                if (!request.CreateNewWhenDateOccupied)
                {
                    var candidates = await IntelligentGolfPlannerEventDiscovery.FindByDateAsync(
                        transport,
                        request.EventDate,
                        cancellationToken);
                    if (candidates.Count > 0)
                    {
                        throw new IntelligentGolfPlannerMatchRequiredException(request.EventDate, candidates);
                    }
                }

                var allocationDate = request.EventDate.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture);
                IntelligentGolfTransportResponse allocation;
                try
                {
                    allocation = await transport.GetResponseAsync(
                        $"/eventadmin.php?group=-1&booking=-1&date={allocationDate}&",
                        cancellationToken);
                }
                catch (IntelligentGolfAuthenticationException)
                {
                    throw;
                }
                catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                {
                    throw new IntelligentGolfMutationException(
                        "planner-allocation",
                        "Intelligent Golf did not finish allocating the planner entry in time.");
                }
                catch (Exception exception) when (exception is not OperationCanceledException)
                {
                    throw new IntelligentGolfMutationException(
                        "planner-allocation",
                        "Intelligent Golf could not allocate the planner entry.",
                        responseDetail: exception.Message,
                        innerException: exception);
                }
                externalId = ExtractAllocatedEventId(allocation)
                    ?? throw new IntelligentGolfMutationException(
                        "planner-allocation-response",
                        "Intelligent Golf created the planner page, but Event Playbook could not read its event ID.",
                        responseDetail: "The event details were not submitted. A blank planner entry may exist in Intelligent Golf; check the event date before retrying.");
                allocated = true;
                await cache.SetAsync(
                    cacheKey,
                    new ExternalEventLink(externalId.Value),
                    LinkLifetime,
                    cancellationToken);
                logger.LogInformation(
                    "Allocated Intelligent Golf planner entry {IntelligentGolfEventId} for Event Playbook event {EventPlaybookEventId}.",
                    externalId.Value,
                    request.EventPlaybookEventId);
            }
        }

        // Match Intelligent Golf's own browser workflow. Opening the allocated event
        // page establishes the server-side page context used by the subsequent AJAX
        // update; posting immediately after allocation can leave a blank event behind.
        try
        {
            await transport.GetResponseAsync(
                $"/event.php?eventid={externalId.Value}",
                cancellationToken);
        }
        catch (IntelligentGolfAuthenticationException)
        {
            throw;
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            throw new IntelligentGolfMutationException(
                "planner-page-preparation",
                $"Intelligent Golf planner entry {externalId.Value} exists, but its edit page could not be prepared for updating.",
                externalId,
                responseDetail: exception.Message,
                innerException: exception);
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

        IntelligentGolfTransportResponse updateResponse;
        try
        {
            updateResponse = await transport.PostFormResponseAsync(
                $"/event.php?eventid={externalId.Value}&requestType=ajax&ajaxaction=confirmeditevent",
                fields,
                cancellationToken);
        }
        catch (IntelligentGolfAuthenticationException)
        {
            throw;
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            throw new IntelligentGolfMutationException(
                "planner-details-update",
                $"Intelligent Golf planner entry {externalId.Value} exists, but its event details could not be submitted.",
                externalId,
                responseDetail: exception.Message,
                innerException: exception);
        }

        var rejection = IntelligentGolfMutationResponseInspector.FindRejection(updateResponse.Body);
        if (!string.IsNullOrWhiteSpace(rejection))
        {
            logger.LogWarning(
                "Intelligent Golf rejected the planner details update for event {IntelligentGolfEventId}: {Rejection}",
                externalId.Value,
                rejection);
            throw new IntelligentGolfMutationException(
                "planner-details-update",
                $"Intelligent Golf planner entry {externalId.Value} exists, but Intelligent Golf rejected its event details.",
                externalId,
                responseDetail: rejection);
        }

        IntelligentGolfTransportResponse verificationResponse;
        try
        {
            verificationResponse = await transport.GetResponseAsync(
                $"/event.php?eventid={externalId.Value}&eventPlaybookVerify={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}",
                cancellationToken);
        }
        catch (IntelligentGolfAuthenticationException)
        {
            throw;
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            throw new IntelligentGolfMutationException(
                "planner-details-verification",
                $"Intelligent Golf planner entry {externalId.Value} exists and the update was submitted, but the saved details could not be checked.",
                externalId,
                responseDetail: exception.Message,
                innerException: exception);
        }

        if (!IntelligentGolfMutationResponseInspector.ContainsText(
                verificationResponse.Body,
                request.Name.Trim()))
        {
            var responseSummary = IntelligentGolfMutationResponseInspector.Summarise(updateResponse.Body);
            var detail = string.IsNullOrWhiteSpace(responseSummary)
                ? "The update endpoint returned an empty response, and the event name was absent when the planner entry was read back."
                : $"The update endpoint replied: {responseSummary} The event name was absent when the planner entry was read back.";
            logger.LogWarning(
                "Could not verify the planner details update for Intelligent Golf event {IntelligentGolfEventId}. {Detail}",
                externalId.Value,
                detail);
            throw new IntelligentGolfMutationException(
                "planner-details-verification",
                $"Intelligent Golf planner entry {externalId.Value} was created, but its saved details could not be verified.",
                externalId,
                responseDetail: detail);
        }

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
            @"(?:^|[?&])(?:booking|eventid)=(\d+)(?:&|$)",
            RegexOptions.IgnoreCase);
        if (queryMatch.Success && int.TryParse(queryMatch.Groups[1].Value, out var queryId)) return queryId;

        var document = new HtmlDocument();
        document.LoadHtml(response.Body);
        var eventIdInput = document.DocumentNode.SelectSingleNode(
            "//input[translate(@name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='eventid' or " +
            "translate(@id,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='eventid']");
        if (int.TryParse(eventIdInput?.GetAttributeValue("value", string.Empty), out var inputId) && inputId > 0)
            return inputId;

        var bodyMatch = Regex.Match(
            WebUtility.HtmlDecode(response.Body),
            @"(?:event\.php\?eventid=|eventbookingid=|(?:^|[?&])booking=)(\d+)",
            RegexOptions.IgnoreCase);
        return bodyMatch.Success && int.TryParse(bodyMatch.Groups[1].Value, out var bodyId) ? bodyId : null;
    }

    private sealed record ExternalEventLink(int IntelligentGolfEventId);
}

public sealed class AdoptPlannerEventHandler(
    IIntelligentGolfTransport transport,
    ICacheService cache,
    IDistributedLockManager lockManager,
    ILogger<AdoptPlannerEventHandler> logger)
    : IRequestHandler<AdoptPlannerEventCommand, AdoptPlannerEventResult>
{
    private static readonly TimeSpan LinkLifetime = TimeSpan.FromDays(3650);

    public async Task<AdoptPlannerEventResult> Handle(
        AdoptPlannerEventCommand command,
        CancellationToken cancellationToken)
    {
        var request = command.Request;
        if (string.IsNullOrWhiteSpace(request.EventPlaybookEventId))
            throw new ArgumentException("The Event Playbook event ID is required.");
        if (request.EventDate == default)
            throw new ArgumentException("The event date is required.");
        if (request.IntelligentGolfEventId <= 0)
            throw new ArgumentException("A valid Intelligent Golf event ID is required.");

        var eventPlaybookEventId = request.EventPlaybookEventId.Trim();
        var cacheKey = EventCacheKey(eventPlaybookEventId);
        await using var adoptionLock = await lockManager.AcquireAsync(
            $"intelligent-golf:event-allocation:{eventPlaybookEventId.ToLowerInvariant()}",
            cancellationToken);
        if (!adoptionLock.IsAcquired)
        {
            throw new TimeoutException(
                "Another request is currently linking this Intelligent Golf event. Try again shortly.");
        }

        var existingLink = await cache.GetAsync<ExternalEventLink>(cacheKey, cancellationToken);
        if (existingLink?.IntelligentGolfEventId is > 0)
        {
            if (existingLink.IntelligentGolfEventId != request.IntelligentGolfEventId)
            {
                throw new ArgumentException(
                    $"This Event Playbook event is already linked to Intelligent Golf event {existingLink.IntelligentGolfEventId}.");
            }

            return new AdoptPlannerEventResult(
                eventPlaybookEventId,
                request.IntelligentGolfEventId,
                false,
                DateTimeOffset.UtcNow);
        }

        var candidates = await IntelligentGolfPlannerEventDiscovery.FindByDateAsync(
            transport,
            request.EventDate,
            cancellationToken);
        if (candidates.All(candidate => candidate.IntelligentGolfEventId != request.IntelligentGolfEventId))
        {
            throw new IntelligentGolfPlannerMatchRequiredException(
                request.EventDate,
                candidates,
                "planner-event-match-expired",
                candidates.Count == 0
                    ? $"Intelligent Golf event {request.IntelligentGolfEventId} is no longer present on {request.EventDate:yyyy-MM-dd}. Refresh the available events before choosing again."
                    : "The Intelligent Golf events on this date have changed. Choose one of the refreshed events or explicitly create a separate event.");
        }

        await cache.SetAsync(
            cacheKey,
            new ExternalEventLink(request.IntelligentGolfEventId),
            LinkLifetime,
            cancellationToken);
        var adoptedAt = DateTimeOffset.UtcNow;
        logger.LogInformation(
            "Adopted existing Intelligent Golf event {IntelligentGolfEventId} for Event Playbook event {EventPlaybookEventId} without changing its details.",
            request.IntelligentGolfEventId,
            eventPlaybookEventId);
        return new AdoptPlannerEventResult(
            eventPlaybookEventId,
            request.IntelligentGolfEventId,
            true,
            adoptedAt);
    }

    private static string EventCacheKey(string eventPlaybookEventId) =>
        $"intelligent-golf:event-link:{eventPlaybookEventId.Trim().ToLowerInvariant()}";

    private sealed record ExternalEventLink(int IntelligentGolfEventId);
}

internal static class IntelligentGolfPlannerEventDiscovery
{
    public static async Task<IReadOnlyList<IntelligentGolfPlannerEventCandidate>> FindByDateAsync(
        IIntelligentGolfTransport transport,
        DateOnly eventDate,
        CancellationToken cancellationToken)
    {
        try
        {
            var date = eventDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var response = await transport.GetResponseAsync(
                $"/eventview.php?date={date}&view=day&subView=all",
                cancellationToken);
            var candidates = Parse(response.Body);
            if (candidates.Count == 0) return candidates;

            var matching = new List<IntelligentGolfPlannerEventCandidate>(candidates.Count);
            foreach (var candidate in candidates)
            {
                try
                {
                    var eventResponse = await transport.GetResponseAsync(
                        $"/event.php?eventid={candidate.IntelligentGolfEventId}",
                        cancellationToken);
                    var candidateDate = ParseEventDate(eventResponse.Body);

                    // Day views can contain links for neighbouring dates. Exclude one only when
                    // Intelligent Golf gives us a definitive, different date. Some installations
                    // load the date field later in an edit fragment, so an unavailable date remains
                    // a candidate for the organiser rather than allowing a duplicate automatically.
                    if (candidateDate.HasValue && candidateDate.Value != eventDate) continue;
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch
                {
                    // The day-view result is still positive evidence of an existing event. Retain
                    // it as an unverified candidate if its individual detail page is unavailable.
                }

                matching.Add(candidate);
            }

            return matching;
        }
        catch (IntelligentGolfAuthenticationException)
        {
            throw;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (IntelligentGolfMutationException)
        {
            throw;
        }
        catch (Exception exception)
        {
            throw new IntelligentGolfMutationException(
                "planner-event-discovery",
                $"Intelligent Golf planner events on {eventDate:yyyy-MM-dd} could not be checked.",
                responseDetail: exception.Message,
                innerException: exception);
        }
    }

    internal static IReadOnlyList<IntelligentGolfPlannerEventCandidate> Parse(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return [];

        var candidates = new Dictionary<int, string>();
        foreach (Match anchorMatch in Regex.Matches(
                     raw,
                     @"<a\b(?<attributes>[^>]*)>(?<content>.*?)</a\s*>",
                     RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.CultureInvariant))
        {
            var hrefMatch = Regex.Match(
                anchorMatch.Groups["attributes"].Value,
                "\\bhref\\s*=\\s*(?:\"(?<double>[^\"]*)\"|'(?<single>[^']*)'|(?<bare>[^\\s>]+))",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            if (!hrefMatch.Success) continue;

            var href = hrefMatch.Groups["double"].Success
                ? hrefMatch.Groups["double"].Value
                : hrefMatch.Groups["single"].Success
                    ? hrefMatch.Groups["single"].Value
                    : hrefMatch.Groups["bare"].Value;
            href = WebUtility.HtmlDecode(href);
            var eventIdMatch = Regex.Match(
                href,
                @"(?:^|/)event\.php\?[^#]*?\beventid=(?<id>\d+)(?:[&#]|$)",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            if (!eventIdMatch.Success ||
                !int.TryParse(
                    eventIdMatch.Groups["id"].Value,
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out var eventId) ||
                eventId <= 0)
            {
                continue;
            }

            var name = Regex.Replace(
                anchorMatch.Groups["content"].Value,
                @"<[^>]+>",
                " ",
                RegexOptions.Singleline | RegexOptions.CultureInvariant);
            name = Regex.Replace(
                    WebUtility.HtmlDecode(name),
                    @"\s+",
                    " ",
                    RegexOptions.CultureInvariant)
                .Trim();
            if (string.IsNullOrWhiteSpace(name)) name = $"Intelligent Golf event {eventId}";

            if (!candidates.TryGetValue(eventId, out var existingName) || name.Length > existingName.Length)
                candidates[eventId] = name;
        }

        return candidates
            .OrderBy(candidate => candidate.Key)
            .Select(candidate => new IntelligentGolfPlannerEventCandidate(candidate.Key, candidate.Value))
            .ToArray();
    }

    internal static DateOnly? ParseEventDate(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;

        foreach (Match inputMatch in Regex.Matches(
                     raw,
                     @"<input\b(?<attributes>[^>]*)>",
                     RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.CultureInvariant))
        {
            var attributes = inputMatch.Groups["attributes"].Value;
            var name = ReadAttribute(attributes, "name");
            if (!string.Equals(name, "date", StringComparison.OrdinalIgnoreCase)) continue;

            var value = ReadAttribute(attributes, "value");
            if (DateOnly.TryParseExact(
                    value,
                    "dd/MM/yyyy",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out var eventDate))
            {
                return eventDate;
            }
        }

        return null;
    }

    private static string? ReadAttribute(string attributes, string attributeName)
    {
        var match = Regex.Match(
            attributes,
            $@"(?:^|\s){Regex.Escape(attributeName)}\s*=\s*(?:""(?<double>[^""]*)""|'(?<single>[^']*)'|(?<bare>[^\s>]+))",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (!match.Success) return null;

        var value = match.Groups["double"].Success
            ? match.Groups["double"].Value
            : match.Groups["single"].Success
                ? match.Groups["single"].Value
                : match.Groups["bare"].Value;
        return WebUtility.HtmlDecode(value).Trim();
    }
}

public sealed class PublishPlannerDiaryHandler(
    IIntelligentGolfTransport transport,
    ICacheService cache,
    IDistributedLockManager lockManager,
    ILogger<PublishPlannerDiaryHandler> logger)
    : IRequestHandler<PublishPlannerDiaryCommand, PublishPlannerDiaryResult>
{
    private static readonly TimeSpan LinkLifetime = TimeSpan.FromDays(3650);
    private const int MaximumArtworkBytes = 20 * 1024 * 1024;

    public async Task<PublishPlannerDiaryResult> Handle(
        PublishPlannerDiaryCommand command,
        CancellationToken cancellationToken)
    {
        var request = command.Request;
        Validate(request);
        var artwork = DecodeArtwork(request.Artwork);
        var diaryFingerprint = CreateDiaryFingerprint(request);
        var artworkFingerprint = CreateArtworkFingerprint(artwork);
        var cacheKey = $"intelligent-golf:diary-link:{request.EventPlaybookEventId.Trim().ToLowerInvariant()}";
        var plannerCacheKey = $"intelligent-golf:diary-link:planner:{request.IntelligentGolfEventId}";

        await using var diaryLock = await lockManager.AcquireAsync(
            $"intelligent-golf:member-diary:planner:{request.IntelligentGolfEventId}",
            cancellationToken);
        if (!diaryLock.IsAcquired)
        {
            throw new TimeoutException("Another request is currently publishing this member diary entry. Try again shortly.");
        }

        var link = await LoadDiaryLinkAsync(cacheKey, plannerCacheKey, cancellationToken);
        var diaryId = request.IntelligentGolfDiaryEntryId is > 0
            ? request.IntelligentGolfDiaryEntryId
            : link?.IntelligentGolfDiaryEntryId;

        // An administrator can remove or replace the member diary entry directly
        // in Intelligent Golf. Confirm every stored link against the planner page
        // before trusting cached fingerprints; otherwise an unchanged publish can
        // silently retain an ID which no longer exists.
        if (diaryId is > 0)
        {
            var staleDiaryId = diaryId.Value;
            var linkedDiaryId = await FindLinkedDiaryIdAsync(request, staleDiaryId, cancellationToken);
            if (linkedDiaryId != staleDiaryId)
            {
                diaryId = linkedDiaryId;
                link = linkedDiaryId is > 0
                    ? new ExternalDiaryLink { IntelligentGolfDiaryEntryId = linkedDiaryId.Value }
                    : null;

                if (link is not null)
                {
                    await SaveDiaryLinksAsync(cacheKey, plannerCacheKey, link, cancellationToken);
                    logger.LogInformation(
                        "Re-linked Event Playbook event {EventPlaybookEventId} from stale diary entry {StaleDiaryEntryId} to Intelligent Golf diary entry {DiaryEntryId}.",
                        request.EventPlaybookEventId,
                        staleDiaryId,
                        linkedDiaryId);
                }
                else
                {
                    logger.LogInformation(
                        "Intelligent Golf diary entry {StaleDiaryEntryId} is no longer linked to planner event {IntelligentGolfEventId}; a replacement will be created.",
                        staleDiaryId,
                        request.IntelligentGolfEventId);
                }
            }
        }

        var created = diaryId is null or <= 0;
        if (created)
        {
            IntelligentGolfTransportResponse creationResponse;
            try
            {
                creationResponse = await transport.GetResponseAsync(
                    $"/event.php?eventid={request.IntelligentGolfEventId}&requestType=ajax&ajaxaction=addtodiary&bookingid={request.IntelligentGolfEventId}",
                    cancellationToken);
            }
            catch (IntelligentGolfAuthenticationException)
            {
                throw;
            }
            catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                throw new IntelligentGolfMutationException(
                    "member-diary-add",
                    $"Intelligent Golf could not create a member diary entry for planner entry {request.IntelligentGolfEventId}.",
                    request.IntelligentGolfEventId,
                    responseDetail: exception.Message,
                    innerException: exception);
            }

            diaryId = ExtractCreatedDiaryId(creationResponse.Body);
            if (diaryId is null or <= 0)
            {
                throw new IntelligentGolfMutationException(
                    "member-diary-add-response",
                    "Intelligent Golf reported that the diary entry was created but did not return its ID, so no edit was submitted.",
                    request.IntelligentGolfEventId,
                    responseDetail: "Expected actions[].html to contain data-ajax-action=\"editdiary\" and data-ajax-data-inline-id.");
            }

            link = new ExternalDiaryLink { IntelligentGolfDiaryEntryId = diaryId.Value };
            await SaveDiaryLinksAsync(cacheKey, plannerCacheKey, link, cancellationToken);
            logger.LogInformation(
                "Created Intelligent Golf diary entry {DiaryEntryId}, linked to event {IntelligentGolfEventId}.",
                diaryId.Value,
                request.IntelligentGolfEventId);
        }

        var resolvedDiaryId = diaryId.GetValueOrDefault();
        if (resolvedDiaryId <= 0)
        {
            throw new InvalidOperationException("The Intelligent Golf diary-entry ID was not resolved.");
        }

        if (link?.IntelligentGolfDiaryEntryId != resolvedDiaryId)
        {
            link = new ExternalDiaryLink { IntelligentGolfDiaryEntryId = resolvedDiaryId };
        }

        var diaryAlreadyPublished = string.Equals(
            link.DiaryFingerprint,
            diaryFingerprint,
            StringComparison.Ordinal);
        var publishedAt = link.DiaryPublishedAtUtc ?? DateTimeOffset.UtcNow;
        if (!diaryAlreadyPublished)
        {
            var fields = CreateDiaryFields(request, resolvedDiaryId);
            IntelligentGolfTransportResponse diaryUpdateResponse;
            try
            {
                diaryUpdateResponse = await transport.PostFormResponseAsync(
                    "/diaryadmin.php?&requestType=ajax&ajaxaction=editnow",
                    fields,
                    cancellationToken);
            }
            catch (IntelligentGolfAuthenticationException)
            {
                throw;
            }
            catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                throw new IntelligentGolfMutationException(
                    "member-diary-update",
                    $"Intelligent Golf diary entry {resolvedDiaryId} exists, but its HTML content could not be submitted.",
                    request.IntelligentGolfEventId,
                    resolvedDiaryId,
                    exception.Message,
                    exception);
            }

            var diaryRejection = IntelligentGolfMutationResponseInspector.FindRejection(diaryUpdateResponse.Body);
            if (!string.IsNullOrWhiteSpace(diaryRejection))
            {
                logger.LogWarning(
                    "Intelligent Golf rejected the HTML update for diary entry {DiaryEntryId}: {Rejection}",
                    resolvedDiaryId,
                    diaryRejection);
                throw new IntelligentGolfMutationException(
                    "member-diary-update",
                    $"Intelligent Golf diary entry {resolvedDiaryId} exists, but Intelligent Golf rejected its HTML update.",
                    request.IntelligentGolfEventId,
                    resolvedDiaryId,
                    diaryRejection);
            }

            publishedAt = DateTimeOffset.UtcNow;
            link = new ExternalDiaryLink
            {
                IntelligentGolfDiaryEntryId = resolvedDiaryId,
                DiaryFingerprint = diaryFingerprint,
                DiaryPublishedAtUtc = publishedAt,
                ArtworkFingerprint = link.ArtworkFingerprint
            };
            // Record that the diary HTML is already live before starting the
            // separate image mutation, so a retry can resume at the failed step.
            await SaveDiaryLinksAsync(cacheKey, plannerCacheKey, link, cancellationToken);
        }

        var imageAlreadyAttached = string.Equals(
            link.ArtworkFingerprint,
            artworkFingerprint,
            StringComparison.Ordinal);
        if (!imageAlreadyAttached)
        {
            await AttachEventImageAsync(request, resolvedDiaryId, publishedAt, artwork, cancellationToken);
            link = new ExternalDiaryLink
            {
                IntelligentGolfDiaryEntryId = resolvedDiaryId,
                DiaryFingerprint = diaryFingerprint,
                DiaryPublishedAtUtc = publishedAt,
                ArtworkFingerprint = artworkFingerprint
            };
            await SaveDiaryLinksAsync(cacheKey, plannerCacheKey, link, cancellationToken);
        }

        logger.LogInformation(
            "{Operation} Intelligent Golf diary entry {DiaryEntryId} and attached its event artwork to planner entry {IntelligentGolfEventId}.",
            created ? "Created and updated" : diaryAlreadyPublished ? "Retained" : "Updated",
            resolvedDiaryId,
            request.IntelligentGolfEventId);
        return new PublishPlannerDiaryResult(
            request.EventPlaybookEventId,
            request.IntelligentGolfEventId,
            resolvedDiaryId,
            created,
            true,
            publishedAt);
    }

    private async Task<int?> FindLinkedDiaryIdAsync(
        PublishPlannerDiaryRequest request,
        int expectedDiaryId,
        CancellationToken cancellationToken)
    {
        IntelligentGolfTransportResponse response;
        try
        {
            response = await transport.GetResponseAsync(
                $"/event.php?eventid={request.IntelligentGolfEventId}",
                cancellationToken);
        }
        catch (IntelligentGolfAuthenticationException)
        {
            throw;
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            throw new IntelligentGolfMutationException(
                "member-diary-existence-check",
                $"Event Playbook could not confirm whether diary entry {expectedDiaryId} is still linked to Intelligent Golf planner entry {request.IntelligentGolfEventId}.",
                request.IntelligentGolfEventId,
                expectedDiaryId,
                exception.Message,
                exception);
        }

        var discovery = DiscoverDiaryLinks(response.Body);
        if (!discovery.DiarySectionRecognised)
        {
            throw new IntelligentGolfMutationException(
                "member-diary-existence-check",
                $"Event Playbook could not recognise the member diary section on Intelligent Golf planner entry {request.IntelligentGolfEventId}, so it did not risk creating a duplicate entry.",
                request.IntelligentGolfEventId,
                expectedDiaryId,
                "Expected the event_overview_diary section on the planner page.");
        }

        if (discovery.LinkedIds.Count > 1)
        {
            throw new IntelligentGolfMutationException(
                "member-diary-existence-check",
                $"Intelligent Golf planner entry {request.IntelligentGolfEventId} returned more than one linked member diary entry, so Event Playbook did not change any of them.",
                request.IntelligentGolfEventId,
                expectedDiaryId,
                string.Join(", ", discovery.LinkedIds));
        }

        var id = discovery.LinkedIds.SingleOrDefault();
        return id > 0 ? id : null;
    }

    private async Task AttachEventImageAsync(
        PublishPlannerDiaryRequest request,
        int diaryId,
        DateTimeOffset diaryPublishedAtUtc,
        ResolvedPlannerEventArtwork artwork,
        CancellationToken cancellationToken)
    {
        await using var imageLock = await lockManager.AcquireAsync(
            "intelligent-golf:event-image-upload-and-save",
            cancellationToken);
        if (!imageLock.IsAcquired)
        {
            throw CreateImageMutationException(
                "planner-event-image-upload",
                request,
                diaryId,
                diaryPublishedAtUtc,
                "The member diary entry was published, but another planner image is currently being attached. Try again shortly.");
        }

        // Intelligent Golf keeps the uploaded file in its authenticated PHP
        // session until eventdetailssave. Hold the shared session across both
        // requests so no background login or other operation can replace it.
        await transport.ExecuteExclusiveAsync(async operationToken =>
        {
            // If the save itself has to refresh the session, repeat the complete
            // pair once rather than accepting a detached save response.
            for (var attempt = 0; attempt < 2; attempt++)
            {
                IntelligentGolfTransportResponse uploadResponse;
                try
                {
                    uploadResponse = await transport.PostMultipartResponseAsync(
                        $"/event.php?eventid={request.IntelligentGolfEventId}&requestType=ajax&ajaxaction=eventimageupload",
                        [
                            new("name", artwork.FileName),
                            new("undefined", "undefined")
                        ],
                        new IntelligentGolfMultipartFile(
                            "file",
                            artwork.FileName,
                            "image/png",
                            artwork.Content),
                        operationToken);
                }
                catch (Exception exception) when (exception is not OperationCanceledException || !operationToken.IsCancellationRequested)
                {
                    throw CreateImageMutationException(
                        "planner-event-image-upload",
                        request,
                        diaryId,
                        diaryPublishedAtUtc,
                        $"The member diary entry was published, but its artwork could not be uploaded to Intelligent Golf planner entry {request.IntelligentGolfEventId}.",
                        exception.Message,
                        exception);
                }

                var uploadRejection = IntelligentGolfMutationResponseInspector.FindRejection(uploadResponse.Body);
                if (!string.IsNullOrWhiteSpace(uploadRejection))
                {
                    throw CreateImageMutationException(
                        "planner-event-image-upload",
                        request,
                        diaryId,
                        diaryPublishedAtUtc,
                        "The member diary entry was published, but Intelligent Golf rejected its planner artwork upload.",
                        uploadRejection);
                }

                IntelligentGolfTransportResponse saveResponse;
                try
                {
                    saveResponse = await transport.PostFormResponseAsync(
                        $"/event.php?eventid={request.IntelligentGolfEventId}&requestType=ajax&ajaxaction=eventdetailssave",
                        [new("description", MemberEmailHtmlSanitizer.Sanitise(request.PlannerDescriptionHtml ?? string.Empty))],
                        operationToken);
                }
                catch (Exception exception) when (exception is not OperationCanceledException || !operationToken.IsCancellationRequested)
                {
                    throw CreateImageMutationException(
                        "planner-event-image-save",
                        request,
                        diaryId,
                        diaryPublishedAtUtc,
                        $"The member diary entry was published and its artwork was uploaded, but Intelligent Golf could not attach it to planner entry {request.IntelligentGolfEventId}.",
                        exception.Message,
                        exception);
                }

                if (saveResponse.SessionRefreshed)
                {
                    continue;
                }

                var saveRejection = IntelligentGolfMutationResponseInspector.FindRejection(saveResponse.Body);
                if (!string.IsNullOrWhiteSpace(saveRejection))
                {
                    throw CreateImageMutationException(
                        "planner-event-image-save",
                        request,
                        diaryId,
                        diaryPublishedAtUtc,
                        "The member diary entry was published and its artwork was uploaded, but Intelligent Golf rejected the request to attach it to the planner event.",
                        saveRejection);
                }

                logger.LogInformation(
                    "Uploaded {FileName} and attached it to Intelligent Golf planner entry {IntelligentGolfEventId}.",
                    artwork.FileName,
                    request.IntelligentGolfEventId);
                return true;
            }

            throw CreateImageMutationException(
                "planner-event-image-save",
                request,
                diaryId,
                diaryPublishedAtUtc,
                "The member diary entry was published, but Intelligent Golf refreshed its session while attaching the planner image. Try again.");
        }, cancellationToken);
    }

    private static IReadOnlyCollection<KeyValuePair<string, string>> CreateDiaryFields(
        PublishPlannerDiaryRequest request,
        int diaryId)
    {
        var fields = new List<KeyValuePair<string, string>>
        {
            new("id", diaryId.ToString(CultureInfo.InvariantCulture)),
            new("booking", request.IntelligentGolfEventId.ToString(CultureInfo.InvariantCulture)),
            new("warning", "0"),
            new("headline", request.Headline.Trim())
        };
        fields.AddRange(NormaliseTagIds(request.TagIds).Select(
            id => new KeyValuePair<string, string>("tags[]", id.ToString(CultureInfo.InvariantCulture))));
        fields.AddRange(
        [
            new("diarydate", request.DiaryDate.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)),
            new("starttime", request.StartTime?.Trim() ?? string.Empty),
            new("endtime", request.EndTime?.Trim() ?? string.Empty),
            new("venue", request.Venue?.Trim() ?? "Clubhouse"),
            new("body", MemberEmailHtmlSanitizer.Sanitise(request.BodyHtml))
        ]);
        return fields;
    }

    private static int[] NormaliseTagIds(IReadOnlyCollection<int>? tagIds) =>
        (tagIds?.Where(id => id > 0).Distinct().Order().ToArray() ?? [1, 2, 3, 4]);

    private static IntelligentGolfMutationException CreateImageMutationException(
        string stage,
        PublishPlannerDiaryRequest request,
        int diaryId,
        DateTimeOffset diaryPublishedAtUtc,
        string message,
        string? responseDetail = null,
        Exception? innerException = null) =>
        new(
            stage,
            message,
            request.IntelligentGolfEventId,
            diaryId,
            responseDetail,
            innerException,
            memberDiaryPublished: true,
            memberDiaryPublishedAtUtc: diaryPublishedAtUtc);

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
        if (request.Artwork is null)
            throw new ArgumentException("Finished event artwork is required before publishing to the member diary.");
        SynchronisePlannerEventHandler.ValidateTimeRange(request.StartTime, request.EndTime);
    }

    private static ResolvedPlannerEventArtwork DecodeArtwork(PlannerEventArtwork artwork)
    {
        if (!string.Equals(artwork.ContentType?.Trim(), "image/png", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("The Intelligent Golf event artwork must be a PNG image.");

        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(artwork.Base64Data?.Trim() ?? string.Empty);
        }
        catch (FormatException)
        {
            throw new ArgumentException("The Intelligent Golf event artwork contains invalid image data.");
        }

        if (bytes.Length == 0 || bytes.Length > MaximumArtworkBytes)
            throw new ArgumentException("The Intelligent Golf event artwork is empty or larger than 20 MB.");

        ReadOnlySpan<byte> pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (bytes.Length < pngSignature.Length || !bytes.AsSpan(0, pngSignature.Length).SequenceEqual(pngSignature))
            throw new ArgumentException("The Intelligent Golf event artwork is not a valid PNG image.");

        return new ResolvedPlannerEventArtwork(NormaliseArtworkFileName(artwork.FileName), bytes);
    }

    private static string NormaliseArtworkFileName(string? value)
    {
        var stem = Path.GetFileNameWithoutExtension(Path.GetFileName(value?.Trim() ?? string.Empty));
        stem = Regex.Replace(stem, @"[^A-Za-z0-9._-]+", "-").Trim('-', '.', '_');
        if (string.IsNullOrWhiteSpace(stem)) stem = "event-artwork";
        if (stem.Length > 140) stem = stem[..140].TrimEnd('-', '.', '_');
        return $"{stem}.png";
    }

    private static string CreateDiaryFingerprint(PublishPlannerDiaryRequest request)
    {
        var canonical = JsonSerializer.Serialize(new
        {
            Headline = request.Headline.Trim(),
            DiaryDate = request.DiaryDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            StartTime = request.StartTime?.Trim() ?? string.Empty,
            EndTime = request.EndTime?.Trim() ?? string.Empty,
            Venue = request.Venue?.Trim() ?? "Clubhouse",
            BodyHtml = MemberEmailHtmlSanitizer.Sanitise(request.BodyHtml),
            TagIds = NormaliseTagIds(request.TagIds)
        });
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    private static string CreateArtworkFingerprint(ResolvedPlannerEventArtwork artwork)
    {
        var fileNameBytes = Encoding.UTF8.GetBytes(artwork.FileName);
        var combined = new byte[fileNameBytes.Length + 1 + artwork.Content.Length];
        fileNameBytes.CopyTo(combined, 0);
        artwork.Content.CopyTo(combined, fileNameBytes.Length + 1);
        return Convert.ToHexString(SHA256.HashData(combined));
    }

    private static int? ExtractCreatedDiaryId(string raw)
    {
        var discovery = DiscoverDiaryLinks(raw);
        return discovery.AllIds.Count == 1 ? discovery.AllIds.Single() : null;
    }

    private static DiaryLinkDiscovery DiscoverDiaryLinks(string raw)
    {
        var htmlFragments = new List<string>();
        var diarySectionFragments = new List<string>();
        var diarySectionRecognised = false;
        try
        {
            using var response = JsonDocument.Parse(raw);
            if (response.RootElement.TryGetProperty("actions", out var actions) &&
                actions.ValueKind == JsonValueKind.Array)
            {
                foreach (var action in actions.EnumerateArray())
                {
                    if (action.TryGetProperty("selector", out var selector) &&
                        selector.ValueKind == JsonValueKind.String &&
                        string.Equals(selector.GetString(), "#event_overview_diary", StringComparison.OrdinalIgnoreCase))
                    {
                        diarySectionRecognised = true;
                        if (action.TryGetProperty("html", out var selectedHtml) &&
                            selectedHtml.ValueKind == JsonValueKind.String)
                        {
                            diarySectionFragments.Add(selectedHtml.GetString() ?? string.Empty);
                        }
                    }

                    if (action.TryGetProperty("html", out var htmlElement) &&
                        htmlElement.ValueKind == JsonValueKind.String)
                    {
                        var html = htmlElement.GetString() ?? string.Empty;
                        htmlFragments.Add(html);
                        var sections = ExtractDiarySectionFragments(html);
                        if (sections.Count > 0)
                        {
                            diarySectionRecognised = true;
                            diarySectionFragments.AddRange(sections);
                        }
                    }
                }
            }
        }
        catch (JsonException)
        {
            htmlFragments.Add(raw);
            var sections = ExtractDiarySectionFragments(raw);
            if (sections.Count > 0)
            {
                diarySectionRecognised = true;
                diarySectionFragments.AddRange(sections);
            }
        }

        return new DiaryLinkDiscovery(
            diarySectionRecognised,
            ExtractDiaryIds(diarySectionFragments),
            ExtractDiaryIds(htmlFragments));
    }

    private static IReadOnlyCollection<string> ExtractDiarySectionFragments(string html)
    {
        var tags = Regex.Matches(
            html,
            @"<\s*(?<closing>/)?\s*(?<name>[a-z][a-z0-9]*)\b(?<attributes>[^>]*)>",
            RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.CultureInvariant);
        var sections = new List<string>();

        for (var index = 0; index < tags.Count; index++)
        {
            var openingTag = tags[index];
            if (openingTag.Groups["closing"].Success ||
                !string.Equals(
                    ReadHtmlAttribute(openingTag.Groups["attributes"].Value, "id"),
                    "event_overview_diary",
                    StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var elementName = openingTag.Groups["name"].Value;
            var depth = 1;
            for (var candidateIndex = index + 1; candidateIndex < tags.Count; candidateIndex++)
            {
                var candidate = tags[candidateIndex];
                if (!string.Equals(candidate.Groups["name"].Value, elementName, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (candidate.Groups["closing"].Success)
                {
                    depth--;
                }
                else if (!candidate.Groups["attributes"].Value.TrimEnd().EndsWith("/", StringComparison.Ordinal))
                {
                    depth++;
                }

                if (depth != 0) continue;

                sections.Add(html.Substring(
                    openingTag.Index,
                    candidate.Index + candidate.Length - openingTag.Index));
                index = candidateIndex;
                break;
            }
        }

        return sections;
    }

    private static IReadOnlyCollection<int> ExtractDiaryIds(IEnumerable<string> htmlFragments)
    {
        var ids = new HashSet<int>();
        foreach (var html in htmlFragments)
        {
            foreach (Match tagMatch in Regex.Matches(
                         html,
                         @"<[a-z][^>]*>",
                         RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.CultureInvariant))
            {
                var tag = tagMatch.Value;
                if (!string.Equals(
                        ReadHtmlAttribute(tag, "data-ajax-action"),
                        "editdiary",
                        StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (int.TryParse(
                        ReadHtmlAttribute(tag, "data-ajax-data-inline-id"),
                        NumberStyles.None,
                        CultureInfo.InvariantCulture,
                        out var id) &&
                    id > 0)
                {
                    ids.Add(id);
                }
            }
        }

        return ids.Order().ToArray();
    }

    private static string? ReadHtmlAttribute(string tag, string attributeName)
    {
        var match = Regex.Match(
            tag,
            $@"(?:^|\s){Regex.Escape(attributeName)}\s*=\s*(?:""(?<double>[^""]*)""|'(?<single>[^']*)'|(?<bare>[^\s>]+))",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (!match.Success) return null;

        var value = match.Groups["double"].Success
            ? match.Groups["double"].Value
            : match.Groups["single"].Success
                ? match.Groups["single"].Value
                : match.Groups["bare"].Value;
        return WebUtility.HtmlDecode(value).Trim();
    }

    private async Task<ExternalDiaryLink?> LoadDiaryLinkAsync(
        string cacheKey,
        string plannerCacheKey,
        CancellationToken cancellationToken) =>
        await cache.GetAsync<ExternalDiaryLink>(cacheKey, cancellationToken)
        ?? await cache.GetAsync<ExternalDiaryLink>(plannerCacheKey, cancellationToken);

    private async Task SaveDiaryLinksAsync(
        string cacheKey,
        string plannerCacheKey,
        ExternalDiaryLink link,
        CancellationToken cancellationToken)
    {
        await cache.SetAsync(cacheKey, link, LinkLifetime, cancellationToken);
        await cache.SetAsync(plannerCacheKey, link, LinkLifetime, cancellationToken);
    }

    private sealed class ExternalDiaryLink
    {
        public int IntelligentGolfDiaryEntryId { get; init; }
        public string? DiaryFingerprint { get; init; }
        public DateTimeOffset? DiaryPublishedAtUtc { get; init; }
        public string? ArtworkFingerprint { get; init; }
    }

    private sealed record ResolvedPlannerEventArtwork(string FileName, byte[] Content);
    private sealed record DiaryLinkDiscovery(
        bool DiarySectionRecognised,
        IReadOnlyCollection<int> LinkedIds,
        IReadOnlyCollection<int> AllIds);
}

internal static class IntelligentGolfMutationResponseInspector
{
    private static readonly string[] ErrorClassFragments =
    [
        "alert-danger",
        "user-message-error",
        "validation-error",
        "ui-state-error"
    ];

    public static string? FindRejection(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var trimmed = raw.Trim();

        try
        {
            using var json = JsonDocument.Parse(trimmed);
            if (json.RootElement.ValueKind == JsonValueKind.Object)
            {
                var root = json.RootElement;
                if (root.TryGetProperty("success", out var success) &&
                    success.ValueKind == JsonValueKind.False)
                {
                    return ReadJsonMessage(root) ?? "Intelligent Golf returned success=false.";
                }

                if (root.TryGetProperty("result", out var result) &&
                    result.ValueKind == JsonValueKind.String &&
                    string.Equals(result.GetString(), "error", StringComparison.OrdinalIgnoreCase))
                {
                    return ReadJsonMessage(root) ?? "Intelligent Golf returned result=error.";
                }

                if (root.TryGetProperty("error", out var error) &&
                    error.ValueKind is not JsonValueKind.Null and not JsonValueKind.False)
                {
                    var errorMessage = ReadJsonValue(error);
                    if (!string.IsNullOrWhiteSpace(errorMessage)) return errorMessage;
                }
            }
        }
        catch (JsonException)
        {
            // The legacy IG AJAX handlers also return plain text or HTML.
        }

        if (trimmed.Equals("false", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals("error", StringComparison.OrdinalIgnoreCase))
        {
            return $"Intelligent Golf returned '{trimmed}'.";
        }

        var document = new HtmlDocument();
        document.LoadHtml(raw);
        foreach (var classFragment in ErrorClassFragments)
        {
            var node = document.DocumentNode.SelectSingleNode(
                $"//*[contains(concat(' ', normalize-space(@class), ' '), ' {classFragment} ')]");
            var message = NormaliseText(node?.InnerText);
            if (!string.IsNullOrWhiteSpace(message)) return message;
        }

        var plainText = NormaliseText(document.DocumentNode.InnerText);
        if (plainText.Contains("fatal error", StringComparison.OrdinalIgnoreCase) ||
            plainText.Contains("access denied", StringComparison.OrdinalIgnoreCase) ||
            plainText.Contains("permission denied", StringComparison.OrdinalIgnoreCase))
        {
            return Truncate(plainText, 500);
        }

        return null;
    }

    public static bool ContainsText(string raw, string expected)
    {
        if (string.IsNullOrWhiteSpace(raw) || string.IsNullOrWhiteSpace(expected)) return false;
        var document = new HtmlDocument();
        document.LoadHtml(raw);
        var text = WebUtility.HtmlDecode(document.DocumentNode.InnerText);
        return text.Contains(expected, StringComparison.OrdinalIgnoreCase) ||
               WebUtility.HtmlDecode(raw).Contains(expected, StringComparison.OrdinalIgnoreCase);
    }

    public static string? Summarise(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var rejection = FindRejection(raw);
        if (!string.IsNullOrWhiteSpace(rejection)) return rejection;

        var document = new HtmlDocument();
        document.LoadHtml(raw);
        return Truncate(NormaliseText(document.DocumentNode.InnerText), 500);
    }

    private static string? ReadJsonMessage(JsonElement root)
    {
        foreach (var name in new[] { "message", "error", "detail", "reason" })
        {
            if (root.TryGetProperty(name, out var value))
            {
                var message = ReadJsonValue(value);
                if (!string.IsNullOrWhiteSpace(message)) return message;
            }
        }
        return null;
    }

    private static string? ReadJsonValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Object or JsonValueKind.Array => value.GetRawText(),
        JsonValueKind.True or JsonValueKind.False or JsonValueKind.Number => value.GetRawText(),
        _ => null
    };

    private static string NormaliseText(string? value) =>
        Regex.Replace(WebUtility.HtmlDecode(value ?? string.Empty), @"\s+", " ").Trim();

    private static string? Truncate(string? value, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return value.Length <= maximumLength ? value : $"{value[..maximumLength]}…";
    }
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
            .Produces<SynchronisePlannerEventResult>()
            .ProducesProblem(StatusCodes.Status409Conflict);

        endpoints.MapPost(
                "/api/event-planner/events/adopt",
                async (AdoptPlannerEventRequest request, IMediator mediator, CancellationToken cancellationToken) =>
                    Results.Ok(await mediator.Send(new AdoptPlannerEventCommand(request), cancellationToken)))
            .WithName("AdoptPlannerEvent")
            .WithTags("Event planner")
            .WithSummary("Link an Event Playbook event to an existing same-day Intelligent Golf event without changing it")
            .Produces<AdoptPlannerEventResult>()
            .ProducesProblem(StatusCodes.Status409Conflict);

        endpoints.MapPut(
                "/api/event-planner/member-diary",
                async (PublishPlannerDiaryRequest request, IMediator mediator, CancellationToken cancellationToken) =>
                    Results.Ok(await mediator.Send(new PublishPlannerDiaryCommand(request), cancellationToken)))
            .WithName("PublishPlannerMemberDiary")
            .WithTags("Event planner")
            .WithSummary("Publish the Intelligent Golf member diary entry and attach its approved planner artwork")
            .Produces<PublishPlannerDiaryResult>();

        return endpoints;
    }
}
