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
                IntelligentGolfTransportResponse eventPage;
                try
                {
                    eventPage = await transport.GetResponseAsync(
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
                        "member-diary-discovery",
                        $"Intelligent Golf planner entry {request.IntelligentGolfEventId} is linked, but its member-diary controls could not be read.",
                        request.IntelligentGolfEventId,
                        responseDetail: exception.Message,
                        innerException: exception);
                }
                diaryId = ExtractDiaryId(eventPage, request.IntelligentGolfEventId);
                if (diaryId is null or <= 0)
                {
                    var allocationPath = ExtractDiaryAllocationPath(eventPage.Body);
                    if (!string.IsNullOrWhiteSpace(allocationPath))
                    {
                        IntelligentGolfTransportResponse allocationResponse;
                        try
                        {
                            allocationResponse = await transport.GetResponseAsync(allocationPath, cancellationToken);
                        }
                        catch (IntelligentGolfAuthenticationException)
                        {
                            throw;
                        }
                        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
                        {
                            throw new IntelligentGolfMutationException(
                                "member-diary-allocation",
                                $"Intelligent Golf planner entry {request.IntelligentGolfEventId} is linked, but its member diary entry could not be created.",
                                request.IntelligentGolfEventId,
                                responseDetail: exception.Message,
                                innerException: exception);
                        }
                        created = true;
                        diaryId = ExtractDiaryId(allocationResponse, request.IntelligentGolfEventId);
                    }
                }

                if (diaryId is null or <= 0)
                {
                    IntelligentGolfTransportResponse refreshedEventPage;
                    try
                    {
                        refreshedEventPage = await transport.GetResponseAsync(
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
                            "member-diary-allocation-response",
                            $"Intelligent Golf accepted the diary request for planner entry {request.IntelligentGolfEventId}, but the updated event page could not be read.",
                            request.IntelligentGolfEventId,
                            responseDetail: exception.Message,
                            innerException: exception);
                    }
                    diaryId = ExtractDiaryId(refreshedEventPage, request.IntelligentGolfEventId);
                }

                if (diaryId is null or <= 0)
                {
                    throw new IntelligentGolfMutationException(
                        created ? "member-diary-allocation-response" : "member-diary-discovery",
                        created
                            ? "Intelligent Golf accepted the initial diary request, but Event Playbook could not read the new diary-entry ID."
                            : "Event Playbook could not find an existing diary entry or Intelligent Golf's add-to-diary control on the linked planner entry.",
                        request.IntelligentGolfEventId,
                        responseDetail: created
                            ? "No blank-ID fallback was submitted and no HTML update was attempted. Inspect the linked planner entry in Intelligent Golf before retrying."
                            : "No diary creation request or HTML update was submitted. Confirm that this Intelligent Golf account can add planner events to the members' diary.");
                }

                await cache.SetAsync(cacheKey, new ExternalDiaryLink(diaryId.Value), LinkLifetime, cancellationToken);
                logger.LogInformation(
                    "Resolved Intelligent Golf diary entry {DiaryEntryId} for event {IntelligentGolfEventId}.",
                    diaryId.Value,
                    request.IntelligentGolfEventId);

            }
        }

        // Intelligent Golf's event page always submits this first-stage form with
        // the allocated diary ID. It establishes the event-to-diary relationship
        // and member visibility before diaryadmin.php accepts the richer HTML.
        IntelligentGolfTransportResponse initialUpdateResponse;
        try
        {
            initialUpdateResponse = await transport.PostFormResponseAsync(
                $"/event.php?eventid={request.IntelligentGolfEventId}&requestType=ajax&ajaxaction=confirmeditdiary",
                new List<KeyValuePair<string, string>>
                {
                    new("id", diaryId.Value.ToString(CultureInfo.InvariantCulture)),
                    new("headline", request.Headline.Trim()),
                    new("body", HtmlToPlainText(request.BodyHtml)),
                    new("venue", request.Venue?.Trim() ?? string.Empty),
                    new("visibleToMembers", "1")
                },
                cancellationToken);
        }
        catch (IntelligentGolfAuthenticationException)
        {
            throw;
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            throw new IntelligentGolfMutationException(
                "member-diary-initialisation",
                $"Intelligent Golf diary entry {diaryId.Value} is linked, but its member-facing details could not be saved.",
                request.IntelligentGolfEventId,
                diaryId,
                exception.Message,
                exception);
        }

        var initialRejection = IntelligentGolfMutationResponseInspector.FindRejection(initialUpdateResponse.Body);
        if (!string.IsNullOrWhiteSpace(initialRejection))
        {
            throw new IntelligentGolfMutationException(
                "member-diary-initialisation",
                $"Intelligent Golf diary entry {diaryId.Value} is linked, but Intelligent Golf rejected its member-facing details.",
                request.IntelligentGolfEventId,
                diaryId,
                initialRejection);
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
                $"Intelligent Golf diary entry {diaryId.Value} exists, but its HTML content could not be submitted.",
                request.IntelligentGolfEventId,
                diaryId,
                exception.Message,
                exception);
        }

        var diaryRejection = IntelligentGolfMutationResponseInspector.FindRejection(diaryUpdateResponse.Body);
        if (!string.IsNullOrWhiteSpace(diaryRejection))
        {
            logger.LogWarning(
                "Intelligent Golf rejected the HTML update for diary entry {DiaryEntryId}: {Rejection}",
                diaryId.Value,
                diaryRejection);
            throw new IntelligentGolfMutationException(
                "member-diary-update",
                $"Intelligent Golf diary entry {diaryId.Value} exists, but Intelligent Golf rejected its HTML update.",
                request.IntelligentGolfEventId,
                diaryId,
                diaryRejection);
        }
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
            @"(?:editDiary|openEditDiaryEntryDialog|openDiaryEntryDialog)\s*\([^\d]*(\d+)",
            @"diaryadmin\.php[^""'\s>]*[?&](?:id|diaryid|entryid)=(\d+)",
            @"(?:confirmeditdiary|editdiary)[\s\S]{0,400}?[""']?id[""']?\s*[:=]\s*[""']?(\d+)"
        };
        foreach (var pattern in patterns)
        {
            foreach (Match match in Regex.Matches(raw, pattern, RegexOptions.IgnoreCase))
            {
                if (int.TryParse(match.Groups[1].Value, out var id) && id > 0 && id != eventId)
                    candidates.Add(id);
            }
        }

        var document = new HtmlDocument();
        document.LoadHtml(raw);
        foreach (var node in document.DocumentNode.Descendants())
        {
            var diaryRelated = node.Name.Contains("diary", StringComparison.OrdinalIgnoreCase) ||
                               node.Attributes.Any(attribute =>
                                   attribute.Name.Contains("diary", StringComparison.OrdinalIgnoreCase) ||
                                   attribute.Value.Contains("diary", StringComparison.OrdinalIgnoreCase));
            if (!diaryRelated) continue;

            foreach (var attribute in node.Attributes)
            {
                if (attribute.Name.Equals("data-id", StringComparison.OrdinalIgnoreCase) ||
                    attribute.Name.Equals("data-entry-id", StringComparison.OrdinalIgnoreCase) ||
                    attribute.Name.Equals("data-diary-id", StringComparison.OrdinalIgnoreCase))
                {
                    AddDiaryCandidate(candidates, attribute.Value, eventId);
                    continue;
                }

                if (attribute.Name.Equals("href", StringComparison.OrdinalIgnoreCase) ||
                    attribute.Name.Equals("onclick", StringComparison.OrdinalIgnoreCase))
                {
                    foreach (Match match in Regex.Matches(
                                 WebUtility.HtmlDecode(attribute.Value),
                                 @"(?:^|[?&,('""\s])(?:id|diaryid|entryid)\s*[=:]\s*['""\s]*(\d+)",
                                 RegexOptions.IgnoreCase))
                    {
                        AddDiaryCandidate(candidates, match.Groups[1].Value, eventId);
                    }
                }
            }
        }
        return candidates.Count == 0 ? null : candidates.Max();
    }

    private static void AddDiaryCandidate(ICollection<int> candidates, string? value, int eventId)
    {
        if (int.TryParse(value?.Trim(), out var candidate) && candidate > 0 && candidate != eventId)
            candidates.Add(candidate);
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
