using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
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
    Task<IntelligentGolfDiaryPublishResult> PublishDiaryAsync(
        MemberDiaryPublishRequest request,
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
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _eventLocks = new(StringComparer.OrdinalIgnoreCase);

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
                descriptionHtml = PlainTextToHtml(eventSnapshot.Description)
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
            await linkStore.RecordFailureAsync(eventSnapshot.EventId, exception.Message, cancellationToken);
            var failedLink = await linkStore.GetAsync(eventSnapshot.EventId, cancellationToken);
            await RecordActivitySafelyAsync(new IntegrationActivityWrite
            {
                Operation = "Synchronise planner event",
                Outcome = "failed",
                EventPlaybookEventId = eventSnapshot.EventId,
                EventName = eventSnapshot.Name,
                ExternalEventId = exception is IntelligentGolfApiRequestException requestException
                    ? requestException.IntelligentGolfEventId ?? failedLink?.IntelligentGolfEventId
                    : failedLink?.IntelligentGolfEventId,
                Stage = (exception as IntelligentGolfApiRequestException)?.Stage ?? "planner-synchronisation",
                StatusCode = (exception as IntelligentGolfApiRequestException)?.StatusCode,
                Message = exception.Message
            }, cancellationToken);
            throw;
        }
        finally
        {
            eventLock.Release();
        }
    }

    public async Task<IntelligentGolfDiaryPublishResult> PublishDiaryAsync(
        MemberDiaryPublishRequest request,
        CancellationToken cancellationToken)
    {
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
        var eventResult = await SynchroniseEventAsync(snapshot, true, cancellationToken);
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
                tagIds = new[] { 1, 2, 3, 4 }
            });
            using var response = await SendAsync(message, cancellationToken);
            var result = await response.Content.ReadFromJsonAsync<IntelligentGolfDiaryPublishResult>(JsonOptions, cancellationToken)
                ?? throw new InvalidOperationException("The Event Playbook API did not return the member diary entry ID.");
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
                    ? $"Created and updated member diary entry {result.IntelligentGolfDiaryEntryId}."
                    : $"Updated member diary entry {result.IntelligentGolfDiaryEntryId}."
            }, cancellationToken);
            return result;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            await linkStore.RecordFailureAsync(request.EventId, exception.Message, cancellationToken);
            var failedLink = await linkStore.GetAsync(request.EventId, cancellationToken);
            await RecordActivitySafelyAsync(new IntegrationActivityWrite
            {
                Operation = "Publish member diary",
                Outcome = "failed",
                EventPlaybookEventId = request.EventId,
                EventName = request.EventName,
                ExternalEventId = eventResult.IntelligentGolfEventId,
                ExternalRecordId = failedLink?.IntelligentGolfDiaryEntryId,
                Stage = (exception as IntelligentGolfApiRequestException)?.Stage ?? "member-diary-publish",
                StatusCode = (exception as IntelligentGolfApiRequestException)?.StatusCode,
                Message = exception.Message
            }, cancellationToken);
            throw;
        }
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
            problem?.IntelligentGolfEventId);
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
            var message = detail;
            if (string.IsNullOrWhiteSpace(message)) message = error;
            if (string.IsNullOrWhiteSpace(message)) message = title;
            else if (!string.IsNullOrWhiteSpace(title) &&
                     !message.Contains(title, StringComparison.OrdinalIgnoreCase))
                message = $"{title} {message}";

            return string.IsNullOrWhiteSpace(message)
                ? null
                : new IntelligentGolfApiProblem(message.Trim(), stage, eventId);
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
        int? IntelligentGolfEventId);

    private sealed class IntelligentGolfApiRequestException(
        string message,
        int statusCode,
        string? stage,
        int? intelligentGolfEventId) : InvalidOperationException(message)
    {
        public int StatusCode { get; } = statusCode;
        public string? Stage { get; } = stage;
        public int? IntelligentGolfEventId { get; } = intelligentGolfEventId;
    }
}
