using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.Services;

public interface IIntelligentGolfEventIntegration
{
    Task<bool> IsAvailableAsync(CancellationToken cancellationToken);
    Task<IntelligentGolfEventSynchroniseResult> SynchroniseEventAsync(
        PlaybookEventIntegrationSnapshot eventSnapshot,
        bool force,
        CancellationToken cancellationToken);
    Task<IntelligentGolfEventSynchroniseResult> CreateSeparateEventAsync(
        PlaybookEventIntegrationSnapshot eventSnapshot,
        CancellationToken cancellationToken);
    Task<IntelligentGolfEventAdoptResult> AdoptExistingEventAsync(
        PlaybookEventIntegrationSnapshot eventSnapshot,
        int intelligentGolfEventId,
        CancellationToken cancellationToken);
    Task<IntelligentGolfDiaryPublishResult> PublishDiaryAsync(
        MemberDiaryPublishRequest request,
        byte[] artworkBytes,
        CancellationToken cancellationToken);
}

public sealed class IntelligentGolfEventIntegration(
    IHttpClientFactory httpClientFactory,
    IIntelligentGolfApiSessionClient sessionClient,
    IPluginSettingsStore pluginSettingsStore,
    IIntelligentGolfIntegrationLinkStore linkStore,
    IIntegrationActivityStore activityStore,
    IOptions<EventPlaybookApiOptions> options,
    ILogger<IntelligentGolfEventIntegration> logger) : IIntelligentGolfEventIntegration
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const int MaximumMemberDiaryArtworkBytes = 20 * 1024 * 1024;
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _eventLocks = new(StringComparer.OrdinalIgnoreCase);
    private readonly SemaphoreSlim _adoptionLock = new(1, 1);

    public async Task<bool> IsAvailableAsync(CancellationToken cancellationToken)
    {
        var plugins = await pluginSettingsStore.GetOverviewAsync(cancellationToken);
        return plugins.IntelligentGolf.Enabled &&
               plugins.IntelligentGolf.Configured &&
               Uri.TryCreate(options.Value.BaseUrl, UriKind.Absolute, out _) &&
               !string.IsNullOrWhiteSpace(options.Value.ApiKey);
    }

    public async Task<IntelligentGolfEventSynchroniseResult> SynchroniseEventAsync(
        PlaybookEventIntegrationSnapshot eventSnapshot,
        bool force,
        CancellationToken cancellationToken) =>
        await SynchroniseEventCoreAsync(eventSnapshot, force, false, cancellationToken);

    public async Task<IntelligentGolfEventSynchroniseResult> CreateSeparateEventAsync(
        PlaybookEventIntegrationSnapshot eventSnapshot,
        CancellationToken cancellationToken) =>
        await SynchroniseEventCoreAsync(eventSnapshot, true, true, cancellationToken);

    private async Task<IntelligentGolfEventSynchroniseResult> SynchroniseEventCoreAsync(
        PlaybookEventIntegrationSnapshot eventSnapshot,
        bool force,
        bool createNewWhenDateOccupied,
        CancellationToken cancellationToken)
    {
        ValidateSnapshot(eventSnapshot);
        var eventLock = _eventLocks.GetOrAdd(eventSnapshot.EventId, _ => new SemaphoreSlim(1, 1));
        await eventLock.WaitAsync(cancellationToken);
        try
        {
            await EnsureAvailableAsync(cancellationToken);
            var fingerprint = Fingerprint(eventSnapshot);
            var link = await linkStore.GetAsync(eventSnapshot.EventId, cancellationToken);
            if (!force &&
                link?.IntelligentGolfEventId is > 0 &&
                string.Equals(link.LastEventFingerprint, fingerprint, StringComparison.Ordinal))
            {
                return new IntelligentGolfEventSynchroniseResult
                {
                    EventPlaybookEventId = eventSnapshot.EventId,
                    IntelligentGolfEventId = link.IntelligentGolfEventId.Value,
                    Allocated = false,
                    SynchronisedAtUtc = link.EventSynchronisedAtUtc ?? link.UpdatedAtUtc
                };
            }

            using var message = CreateRequest(HttpMethod.Post, "api/event-planner/events/synchronise");
            message.Content = JsonContent.Create(new
            {
                eventPlaybookEventId = eventSnapshot.EventId,
                intelligentGolfEventId = link?.IntelligentGolfEventId,
                name = eventSnapshot.Name,
                eventDate = eventSnapshot.EventDate,
                startTime = EmptyAsNull(eventSnapshot.StartTime),
                endTime = EmptyAsNull(eventSnapshot.EndTime),
                eventTypeId = eventSnapshot.EventTypeId,
                attendees = Math.Max(0, eventSnapshot.Attendees),
                groupId = eventSnapshot.GroupId,
                groupName = eventSnapshot.GroupName,
                descriptionHtml = PlainTextToHtml(eventSnapshot.Description),
                createNewWhenDateOccupied
            });
            using var response = await SendAsync(message, cancellationToken);
            var result = await response.Content.ReadFromJsonAsync<IntelligentGolfEventSynchroniseResult>(JsonOptions, cancellationToken)
                ?? throw new InvalidOperationException("The Event Playbook API did not return the Intelligent Golf event ID.");
            await linkStore.SaveEventAsync(
                eventSnapshot.EventId,
                result.IntelligentGolfEventId,
                fingerprint,
                result.SynchronisedAtUtc,
                cancellationToken);
            await RecordActivitySafelyAsync(new IntegrationActivityWrite
            {
                Operation = "Synchronise planner event",
                Outcome = "succeeded",
                EventPlaybookEventId = eventSnapshot.EventId,
                EventName = eventSnapshot.Name,
                ExternalEventId = result.IntelligentGolfEventId,
                Stage = result.Allocated ? "planner-allocation-and-update" : "planner-details-update",
                Message = result.Allocated
                    ? $"Created Intelligent Golf planner entry {result.IntelligentGolfEventId} and synchronised its event details."
                    : $"Updated Intelligent Golf planner entry {result.IntelligentGolfEventId}."
            }, cancellationToken);
            return result;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            if (exception is IntelligentGolfApiRequestException { RequiresPlannerMatch: true } matchException &&
                matchException.Candidates.Count > 0)
            {
                await linkStore.SaveMatchRequiredAsync(
                    eventSnapshot.EventId,
                    matchException.EventDate ?? eventSnapshot.EventDate,
                    matchException.Candidates,
                    cancellationToken);
                await RecordActivitySafelyAsync(new IntegrationActivityWrite
                {
                    Operation = "Match planner event",
                    Outcome = "action-required",
                    EventPlaybookEventId = eventSnapshot.EventId,
                    EventName = eventSnapshot.Name,
                    Stage = matchException.Stage,
                    StatusCode = matchException.StatusCode,
                    Message = matchException.Candidates.Count == 1
                        ? "An Intelligent Golf planner entry already exists on this date. Choose whether to use it or create a separate entry."
                        : $"{matchException.Candidates.Count} Intelligent Golf planner entries already exist on this date. Choose one to use or create a separate entry."
                }, cancellationToken);
                throw;
            }

            if (exception is IntelligentGolfApiRequestException { IntelligentGolfEventId: > 0 } apiException)
            {
                // The IG allocation and update are two separate operations. Retain the
                // allocated ID even when the update fails so a retry updates the same
                // blank record instead of creating a duplicate.
                await linkStore.SaveAllocatedEventAsync(
                    eventSnapshot.EventId,
                    apiException.IntelligentGolfEventId.Value,
                    cancellationToken);
            }
            var requestException = exception as IntelligentGolfApiRequestException;
            await linkStore.RecordFailureAsync(
                eventSnapshot.EventId,
                exception.Message,
                requestException?.Stage,
                requestException?.StatusCode,
                cancellationToken);
            var failedLink = await linkStore.GetAsync(eventSnapshot.EventId, cancellationToken);
            await RecordActivitySafelyAsync(new IntegrationActivityWrite
            {
                Operation = "Synchronise planner event",
                Outcome = "failed",
                EventPlaybookEventId = eventSnapshot.EventId,
                EventName = eventSnapshot.Name,
                ExternalEventId = requestException is not null
                    ? requestException.IntelligentGolfEventId ?? failedLink?.IntelligentGolfEventId
                    : failedLink?.IntelligentGolfEventId,
                ExternalRecordId = requestException?.IntelligentGolfRecordId,
                Stage = requestException?.Stage ?? "planner-synchronisation",
                StatusCode = requestException?.StatusCode,
                Message = exception.Message
            }, cancellationToken);
            throw;
        }
        finally
        {
            eventLock.Release();
        }
    }

    public async Task<IntelligentGolfEventAdoptResult> AdoptExistingEventAsync(
        PlaybookEventIntegrationSnapshot eventSnapshot,
        int intelligentGolfEventId,
        CancellationToken cancellationToken)
    {
        ValidateSnapshot(eventSnapshot);
        if (intelligentGolfEventId <= 0)
            throw new ArgumentException("Choose a valid Intelligent Golf planner entry.", nameof(intelligentGolfEventId));

        var eventLock = _eventLocks.GetOrAdd(eventSnapshot.EventId, _ => new SemaphoreSlim(1, 1));
        var adoptionLockHeld = false;
        var eventLockHeld = false;
        try
        {
            await _adoptionLock.WaitAsync(cancellationToken);
            adoptionLockHeld = true;
            await eventLock.WaitAsync(cancellationToken);
            eventLockHeld = true;
            await EnsureAvailableAsync(cancellationToken);
            var linkedPlaybookEventId = await linkStore.FindPlaybookEventIdByIntelligentGolfEventIdAsync(
                intelligentGolfEventId,
                cancellationToken);
            if (!string.IsNullOrWhiteSpace(linkedPlaybookEventId) &&
                !string.Equals(linkedPlaybookEventId, eventSnapshot.EventId, StringComparison.OrdinalIgnoreCase))
            {
                throw new IntelligentGolfPlannerEventAlreadyLinkedException(intelligentGolfEventId);
            }

            using var message = CreateRequest(HttpMethod.Post, "api/event-planner/events/adopt");
            message.Content = JsonContent.Create(new
            {
                eventPlaybookEventId = eventSnapshot.EventId,
                intelligentGolfEventId,
                eventDate = eventSnapshot.EventDate
            });
            using var response = await SendAsync(message, cancellationToken);
            var result = await response.Content.ReadFromJsonAsync<IntelligentGolfEventAdoptResult>(JsonOptions, cancellationToken)
                ?? throw new InvalidOperationException("The Event Playbook API did not confirm the adopted Intelligent Golf event ID.");
            await linkStore.SaveEventAsync(
                eventSnapshot.EventId,
                result.IntelligentGolfEventId,
                Fingerprint(eventSnapshot),
                result.AdoptedAtUtc,
                cancellationToken);
            await RecordActivitySafelyAsync(new IntegrationActivityWrite
            {
                Operation = "Link existing planner event",
                Outcome = "succeeded",
                EventPlaybookEventId = eventSnapshot.EventId,
                EventName = eventSnapshot.Name,
                ExternalEventId = result.IntelligentGolfEventId,
                Stage = "planner-event-adoption",
                Message = $"Linked existing Intelligent Golf planner entry {result.IntelligentGolfEventId} without changing its existing configuration."
            }, cancellationToken);
            return result;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            var requestException = exception as IntelligentGolfApiRequestException;
            if (exception is IntelligentGolfPlannerEventAlreadyLinkedException linkedException)
            {
                await RecordActivitySafelyAsync(new IntegrationActivityWrite
                {
                    Operation = "Match planner event",
                    Outcome = "action-required",
                    EventPlaybookEventId = eventSnapshot.EventId,
                    EventName = eventSnapshot.Name,
                    ExternalEventId = linkedException.IntelligentGolfEventId,
                    Stage = "planner-event-already-linked",
                    Message = linkedException.Message
                }, cancellationToken);
                throw;
            }

            if (requestException is { RequiresPlannerMatch: true } && requestException.Candidates.Count > 0)
            {
                await linkStore.SaveMatchRequiredAsync(
                    eventSnapshot.EventId,
                    requestException.EventDate ?? eventSnapshot.EventDate,
                    requestException.Candidates,
                    cancellationToken);
                await RecordActivitySafelyAsync(new IntegrationActivityWrite
                {
                    Operation = "Match planner event",
                    Outcome = "action-required",
                    EventPlaybookEventId = eventSnapshot.EventId,
                    EventName = eventSnapshot.Name,
                    Stage = requestException.Stage,
                    StatusCode = requestException.StatusCode,
                    Message = "The available Intelligent Golf planner entries changed before the selection was confirmed. Review the updated choices."
                }, cancellationToken);
                throw;
            }

            if (requestException is { RequiresPlannerMatch: true } &&
                requestException.Candidates.Count == 0)
            {
                // IG revalidates the date immediately before adoption. If the
                // selected entry has disappeared, discard the stale choice so
                // the organiser is not trapped in an unresolvable dialog.
                await linkStore.ClearMatchRequiredAsync(eventSnapshot.EventId, cancellationToken);
            }

            await linkStore.RecordFailureAsync(
                eventSnapshot.EventId,
                exception.Message,
                requestException?.Stage ?? "planner-event-adoption",
                requestException?.StatusCode,
                cancellationToken);
            await RecordActivitySafelyAsync(new IntegrationActivityWrite
            {
                Operation = "Link existing planner event",
                Outcome = "failed",
                EventPlaybookEventId = eventSnapshot.EventId,
                EventName = eventSnapshot.Name,
                ExternalEventId = intelligentGolfEventId,
                Stage = requestException?.Stage ?? "planner-event-adoption",
                StatusCode = requestException?.StatusCode,
                Message = exception.Message
            }, cancellationToken);
            throw;
        }
        finally
        {
            if (eventLockHeld) eventLock.Release();
            if (adoptionLockHeld) _adoptionLock.Release();
        }
    }

    public async Task<IntelligentGolfDiaryPublishResult> PublishDiaryAsync(
        MemberDiaryPublishRequest request,
        byte[] artworkBytes,
        CancellationToken cancellationToken)
    {
        if (artworkBytes.Length == 0 || artworkBytes.Length > MaximumMemberDiaryArtworkBytes)
        {
            throw new ArgumentException(
                "The member diary artwork is empty or larger than the 20 MB upload limit.",
                nameof(artworkBytes));
        }

        var snapshot = new PlaybookEventIntegrationSnapshot
        {
            EventId = request.EventId.Trim(),
            Name = request.EventName.Trim(),
            EventDate = request.EventDate.Trim(),
            Description = string.IsNullOrWhiteSpace(request.EventDescription)
                ? request.Description.Trim()
                : request.EventDescription.Trim(),
            StartTime = request.StartTime,
            EndTime = request.EndTime,
            EventTypeId = request.EventTypeId,
            Attendees = Math.Max(0, request.Attendees ?? 0)
        };

        // This deliberately provisions the IG event when an older Playbook event
        // has no external link yet, then immediately uses that link for the diary.
        // A linked event (including one deliberately adopted from IG) is left
        // untouched unless its Playbook details have actually changed.
        var eventResult = await SynchroniseEventAsync(snapshot, false, cancellationToken);
        try
        {
            var link = await linkStore.GetAsync(request.EventId, cancellationToken);
            using var message = CreateRequest(HttpMethod.Put, "api/event-planner/member-diary");
            message.Content = JsonContent.Create(new
            {
                eventPlaybookEventId = request.EventId.Trim(),
                intelligentGolfEventId = eventResult.IntelligentGolfEventId,
                intelligentGolfDiaryEntryId = link?.IntelligentGolfDiaryEntryId,
                headline = string.IsNullOrWhiteSpace(request.Title) ? request.EventName.Trim() : request.Title.Trim(),
                diaryDate = request.EventDate.Trim(),
                startTime = EmptyAsNull(request.StartTime),
                endTime = EmptyAsNull(request.EndTime),
                venue = string.IsNullOrWhiteSpace(request.Venue) ? "Clubhouse" : request.Venue.Trim(),
                bodyHtml = request.Description.Trim(),
                tagIds = new[] { 1, 2, 3, 4 },
                plannerDescriptionHtml = PlainTextToHtml(snapshot.Description),
                artwork = new
                {
                    fileName = BuildEventArtworkFileName(request),
                    contentType = "image/png",
                    base64Data = Convert.ToBase64String(artworkBytes)
                }
            });
            using var response = await SendAsync(message, cancellationToken);
            var result = await response.Content.ReadFromJsonAsync<IntelligentGolfDiaryPublishResult>(JsonOptions, cancellationToken)
                ?? throw new InvalidOperationException("The Event Playbook API did not return the member diary entry ID.");
            if (result.EventImageAttached is not true)
            {
                throw new IntelligentGolfApiRequestException(
                    "The member diary entry was published, but the Event Playbook API did not confirm that its artwork was attached to the Intelligent Golf planner event. Deploy the matching API version, then retry the planner artwork.",
                    502,
                    "planner-event-image-contract",
                    result.IntelligentGolfEventId,
                    result.IntelligentGolfDiaryEntryId,
                    true,
                    request.EventDate,
                    [],
                    memberDiaryPublished: true,
                    memberDiaryPublishedAtUtc: result.PublishedAtUtc);
            }
            await linkStore.SaveDiaryAsync(
                request.EventId,
                result.IntelligentGolfEventId,
                result.IntelligentGolfDiaryEntryId,
                result.PublishedAtUtc,
                cancellationToken);
            await RecordActivitySafelyAsync(new IntegrationActivityWrite
            {
                Operation = "Publish member diary",
                Outcome = "succeeded",
                EventPlaybookEventId = request.EventId,
                EventName = request.EventName,
                ExternalEventId = result.IntelligentGolfEventId,
                ExternalRecordId = result.IntelligentGolfDiaryEntryId,
                Stage = result.Created ? "member-diary-create-and-update" : "member-diary-update",
                Message = result.Created
                    ? $"Created and updated member diary entry {result.IntelligentGolfDiaryEntryId}, then attached its artwork to planner entry {result.IntelligentGolfEventId}."
                    : $"Updated member diary entry {result.IntelligentGolfDiaryEntryId} and attached its artwork to planner entry {result.IntelligentGolfEventId}."
            }, cancellationToken);
            return result;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            var requestException = exception as IntelligentGolfApiRequestException;
            if (requestException is
                {
                    IntelligentGolfRecordId: > 0,
                    MemberDiaryPublished: true,
                    MemberDiaryPublishedAtUtc: not null
                })
            {
                await linkStore.SaveDiaryAsync(
                    request.EventId,
                    requestException.IntelligentGolfEventId ?? eventResult.IntelligentGolfEventId,
                    requestException.IntelligentGolfRecordId.Value,
                    requestException.MemberDiaryPublishedAtUtc.Value,
                    cancellationToken);
            }
            else if (requestException?.IntelligentGolfRecordId is > 0)
            {
                await linkStore.SaveAllocatedDiaryAsync(
                    request.EventId,
                    requestException.IntelligentGolfEventId ?? eventResult.IntelligentGolfEventId,
                    requestException.IntelligentGolfRecordId.Value,
                    cancellationToken);
            }
            await linkStore.RecordFailureAsync(
                request.EventId,
                exception.Message,
                requestException?.Stage,
                requestException?.StatusCode,
                cancellationToken);
            var failedLink = await linkStore.GetAsync(request.EventId, cancellationToken);
            await RecordActivitySafelyAsync(new IntegrationActivityWrite
            {
                Operation = "Publish member diary",
                Outcome = "failed",
                EventPlaybookEventId = request.EventId,
                EventName = request.EventName,
                ExternalEventId = eventResult.IntelligentGolfEventId,
                ExternalRecordId = requestException?.IntelligentGolfRecordId ?? failedLink?.IntelligentGolfDiaryEntryId,
                Stage = requestException?.Stage ?? "member-diary-publish",
                StatusCode = requestException?.StatusCode,
                Message = requestException?.MemberDiaryPublished == true
                    ? $"Member diary entry {requestException.IntelligentGolfRecordId} was published, but its planner artwork was not attached. {exception.Message}"
                    : exception.Message
            }, cancellationToken);
            throw;
        }
    }

    private static string BuildEventArtworkFileName(MemberDiaryPublishRequest request)
    {
        var eventSlug = Regex.Replace(request.EventName.Trim().ToLowerInvariant(), @"[^a-z0-9]+", "-")
            .Trim('-');
        if (string.IsNullOrWhiteSpace(eventSlug)) eventSlug = "event";
        if (eventSlug.Length > 120) eventSlug = eventSlug[..120].TrimEnd('-');

        var outputId = request.Artwork?.OutputId?.Trim().ToLowerInvariant() ?? string.Empty;
        var suffix = outputId.Contains("social", StringComparison.Ordinal) ||
                     outputId.Contains("square", StringComparison.Ordinal)
            ? "social"
            : outputId.Contains("a4", StringComparison.Ordinal)
                ? "poster"
                : "artwork";
        return $"{eventSlug}-{suffix}.png";
    }

    private async Task EnsureAvailableAsync(CancellationToken cancellationToken)
    {
        if (!await IsAvailableAsync(cancellationToken))
            throw new InvalidOperationException("The Intelligent Golf plugin must be configured and switched on before synchronising events.");
    }

    private HttpRequestMessage CreateRequest(HttpMethod method, string relativePath)
    {
        var settings = options.Value;
        if (!Uri.TryCreate(settings.BaseUrl?.TrimEnd('/') + "/", UriKind.Absolute, out var baseUri) ||
            string.IsNullOrWhiteSpace(settings.ApiKey))
            throw new InvalidOperationException("The Event Playbook API connection is not configured.");
        return new HttpRequestMessage(method, new Uri(baseUri, relativePath));
    }

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        await sessionClient.AuthorizeAsync(request, cancellationToken);
        var client = httpClientFactory.CreateClient(IntelligentGolfApiSessionClient.HttpClientName);
        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request, cancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new InvalidOperationException("The Event Playbook API did not respond in time.");
        }
        catch (HttpRequestException exception)
        {
            throw new InvalidOperationException("The Event Playbook API could not be reached.", exception);
        }

        if (response.IsSuccessStatusCode) return response;
        var statusCode = (int)response.StatusCode;
        var raw = await response.Content.ReadAsStringAsync(cancellationToken);
        response.Dispose();
        var problem = ExtractProblem(raw);
        throw new IntelligentGolfApiRequestException(
            problem?.Message ?? $"The Intelligent Golf event request failed ({statusCode}).",
            statusCode,
            problem?.Stage,
            problem?.IntelligentGolfEventId,
            problem?.IntelligentGolfRecordId,
            problem?.Retryable ?? true,
            problem?.EventDate,
            problem?.Candidates ?? [],
            problem?.MemberDiaryPublished ?? false,
            problem?.MemberDiaryPublishedAtUtc);
    }

    private static IntelligentGolfApiProblem? ExtractProblem(string raw)
    {
        try
        {
            using var json = JsonDocument.Parse(raw);
            var root = json.RootElement;
            var title = ReadString(root, "title");
            var detail = ReadString(root, "detail");
            var error = ReadString(root, "error");
            var stage = ReadString(root, "stage");
            var eventId = ReadInt(root, "intelligentGolfEventId");
            var recordId = ReadInt(root, "intelligentGolfRecordId");
            var retryable = ReadBool(root, "retryable");
            var eventDate = ReadString(root, "eventDate");
            var candidates = ReadCandidates(root);
            var memberDiaryPublished = ReadBool(root, "memberDiaryPublished");
            var memberDiaryPublishedAtUtc = ReadDateTimeOffset(root, "memberDiaryPublishedAtUtc");
            var message = detail;
            if (string.IsNullOrWhiteSpace(message)) message = error;
            if (string.IsNullOrWhiteSpace(message)) message = title;
            else if (!string.IsNullOrWhiteSpace(title) &&
                     !message.Contains(title, StringComparison.OrdinalIgnoreCase))
                message = $"{title} {message}";

            return string.IsNullOrWhiteSpace(message)
                ? null
                : new IntelligentGolfApiProblem(
                    message.Trim(),
                    stage,
                    eventId,
                    recordId,
                    retryable,
                    eventDate,
                    candidates,
                    memberDiaryPublished,
                    memberDiaryPublishedAtUtc);
        }
        catch (JsonException)
        {
            // A concise status fallback is preferable to returning an IG HTML page.
        }
        return null;
    }

    private static string? ReadString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int? ReadInt(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
        return value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out number)
            ? number
            : null;
    }

    private static bool? ReadBool(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value)) return null;
        if (value.ValueKind == JsonValueKind.True) return true;
        if (value.ValueKind == JsonValueKind.False) return false;
        return value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var result)
            ? result
            : null;
    }

    private static DateTimeOffset? ReadDateTimeOffset(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String &&
        DateTimeOffset.TryParse(value.GetString(), out var result)
            ? result
            : null;

    private static IReadOnlyList<IntelligentGolfPlannerEventCandidate> ReadCandidates(JsonElement root)
    {
        if (!root.TryGetProperty("candidates", out var candidates) || candidates.ValueKind != JsonValueKind.Array)
            return [];

        var result = new List<IntelligentGolfPlannerEventCandidate>();
        foreach (var candidate in candidates.EnumerateArray())
        {
            var id = ReadInt(candidate, "intelligentGolfEventId");
            var name = ReadString(candidate, "name");
            if (id is not > 0 || string.IsNullOrWhiteSpace(name)) continue;
            result.Add(new IntelligentGolfPlannerEventCandidate
            {
                IntelligentGolfEventId = id.Value,
                Name = name.Trim()
            });
        }
        return result;
    }

    private static string PlainTextToHtml(string value)
    {
        if (value.TrimStart().StartsWith('<')) return value.Trim();
        return string.Join(
            string.Empty,
            value.Replace("\r\n", "\n", StringComparison.Ordinal)
                .Split("\n\n", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(paragraph => $"<p>{HtmlEncoder.Default.Encode(paragraph).Replace("\n", "<br>", StringComparison.Ordinal)}</p>"));
    }

    private static string Fingerprint(PlaybookEventIntegrationSnapshot snapshot)
    {
        var json = JsonSerializer.Serialize(new
        {
            snapshot.Name,
            snapshot.EventDate,
            snapshot.Description,
            snapshot.StartTime,
            snapshot.EndTime,
            snapshot.EventTypeId,
            snapshot.Attendees,
            snapshot.GroupId,
            snapshot.GroupName
        });
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)));
    }

    private static string? EmptyAsNull(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private async Task RecordActivitySafelyAsync(
        IntegrationActivityWrite activity,
        CancellationToken cancellationToken)
    {
        try
        {
            await activityStore.RecordAsync(activity, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Could not persist the {Operation} integration activity entry.", activity.Operation);
        }
    }

    private static void ValidateSnapshot(PlaybookEventIntegrationSnapshot snapshot)
    {
        if (string.IsNullOrWhiteSpace(snapshot.EventId) ||
            string.IsNullOrWhiteSpace(snapshot.Name) ||
            string.IsNullOrWhiteSpace(snapshot.EventDate) ||
            string.IsNullOrWhiteSpace(snapshot.Description))
            throw new ArgumentException("Event ID, name, date and description are required for Intelligent Golf.");
        if (!DateOnly.TryParseExact(snapshot.EventDate, "yyyy-MM-dd", out _))
            throw new ArgumentException("The event date must use yyyy-MM-dd format.");
    }

    private sealed record IntelligentGolfApiProblem(
        string Message,
        string? Stage,
        int? IntelligentGolfEventId,
        int? IntelligentGolfRecordId,
        bool? Retryable,
        string? EventDate,
        IReadOnlyList<IntelligentGolfPlannerEventCandidate> Candidates,
        bool? MemberDiaryPublished,
        DateTimeOffset? MemberDiaryPublishedAtUtc);
}

public sealed class IntelligentGolfApiRequestException(
    string message,
    int statusCode,
    string? stage,
    int? intelligentGolfEventId,
    int? intelligentGolfRecordId,
    bool retryable,
    string? eventDate,
    IReadOnlyList<IntelligentGolfPlannerEventCandidate> candidates,
    bool memberDiaryPublished = false,
    DateTimeOffset? memberDiaryPublishedAtUtc = null) : InvalidOperationException(message)
{
    public int StatusCode { get; } = statusCode;
    public string? Stage { get; } = stage;
    public int? IntelligentGolfEventId { get; } = intelligentGolfEventId;
    public int? IntelligentGolfRecordId { get; } = intelligentGolfRecordId;
    public bool Retryable { get; } = retryable;
    public string? EventDate { get; } = eventDate;
    public IReadOnlyList<IntelligentGolfPlannerEventCandidate> Candidates { get; } = candidates;
    public bool MemberDiaryPublished { get; } = memberDiaryPublished;
    public DateTimeOffset? MemberDiaryPublishedAtUtc { get; } = memberDiaryPublishedAtUtc;
    public bool RequiresPlannerMatch =>
        string.Equals(Stage, "planner-event-match-required", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(Stage, "planner-event-match-expired", StringComparison.OrdinalIgnoreCase);
}

public sealed class IntelligentGolfPlannerEventAlreadyLinkedException(int intelligentGolfEventId)
    : InvalidOperationException(
        $"Intelligent Golf planner entry {intelligentGolfEventId} is already linked to another Event Playbook event.")
{
    public int IntelligentGolfEventId { get; } = intelligentGolfEventId;
}
