using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.Services;

public sealed class YodeckPublisher(
    IHttpClientFactory httpClientFactory,
    IOptions<YodeckOptions> options,
    ILogger<YodeckPublisher> logger) : IYodeckPublisher
{
    private readonly YodeckOptions _options = options.Value;
    private readonly SemaphoreSlim _mediaTagGate = new(1, 1);
    private readonly SemaphoreSlim _publishGate = new(1, 1);

    public bool IsConfigured => _options.IsConfigured;

    public async Task<YodeckPublishResult> PublishAsync(
        YodeckPublishCommand command,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException(
                "Clubhouse screen sharing is not configured. Ask an administrator to complete the server connection settings.");
        }

        await _publishGate.WaitAsync(cancellationToken);
        try
        {
            return await UpsertAsync(command, cancellationToken);
        }
        finally
        {
            _publishGate.Release();
        }
    }

    private async Task<YodeckPublishResult> UpsertAsync(
        YodeckPublishCommand command,
        CancellationToken cancellationToken)
    {
        var playlist = await GetPlaylistAsync(cancellationToken);
        var playlistName = ReadString(playlist, "name") ?? _options.PlaylistName;
        var workspaceId = ReadNestedInt64(playlist, "workspace", "id");
        var eventTag = BuildEventTag(command.EventId);
        var tags = BuildMediaTags(command.Tags, eventTag);

        await EnsureMediaTagsAsync(tags, cancellationToken);
        var matchingMedia = await FindEventMediaAsync(command.EventId, eventTag, workspaceId, cancellationToken);
        var media = SelectCanonicalMedia(matchingMedia, playlist);
        var mediaWasCreated = media is null;
        media = mediaWasCreated
            ? await CreateMediaAsync(command, tags, workspaceId, cancellationToken)
            : await UpdateMediaAsync(media!, command, tags, cancellationToken);
        var mediaId = ReadInt64(media, "id")
            ?? throw new InvalidOperationException("The screen service did not return an ID for the event artwork.");

        PlaylistUpdateResult playlistUpdate;
        ScreenPushResult screenPush;
        var failedPhase = "upload the artwork";
        try
        {
            var uploadUrl = await GetUploadUrlAsync(mediaId, cancellationToken);
            await UploadImageAsync(uploadUrl, command.ImageBytes, cancellationToken);
            await CompleteUploadAsync(mediaId, uploadUrl, cancellationToken);
            failedPhase = "update the Clubhouse screen rotation";
            playlistUpdate = await EnsurePlaylistContainsAsync(
                playlist,
                mediaId,
                matchingMedia.Select(item => ReadInt64(item, "id")).OfType<long>().ToHashSet(),
                cancellationToken);
            failedPhase = "push the changes to the screens";
            screenPush = await PushScreensAsync(workspaceId, cancellationToken);
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Yodeck publishing failed while upserting media {MediaId} for event {EventId}.",
                mediaId,
                command.EventId);
            throw new InvalidOperationException(
                $"The screen service retained artwork item {mediaId}, but it could not {failedPhase}. " +
                $"{exception.Message} Try again: Event Playbook will recover by updating this same item rather than creating another one.",
                exception);
        }

        logger.LogInformation(
            "{Operation} Yodeck media {MediaId} for event {EventId}; playlist {PlaylistId} changed: {PlaylistChanged}; duplicate entries removed: {DuplicatesRemoved}; screen push: {PushStatus} (confirmed: {PushConfirmed}).",
            mediaWasCreated ? "Created" : "Updated",
            mediaId,
            command.EventId,
            _options.PlaylistId,
            playlistUpdate.Changed,
            playlistUpdate.DuplicateEntriesRemoved,
            screenPush.Status,
            screenPush.Confirmed);

        return new YodeckPublishResult
        {
            MediaId = mediaId,
            MediaName = command.MediaName,
            PlaylistId = _options.PlaylistId,
            PlaylistName = playlistName,
            StartDate = command.StartDate,
            EndDate = command.EndDate,
            Tags = tags,
            MediaWasCreated = mediaWasCreated,
            PlaylistWasChanged = playlistUpdate.Changed,
            DuplicatePlaylistEntriesRemoved = playlistUpdate.DuplicateEntriesRemoved,
            ScreenPushRequested = true,
            ScreenPushConfirmed = screenPush.Confirmed,
            ScreenPushStatus = screenPush.Status
        };
    }

    private static IReadOnlyList<string> BuildMediaTags(
        IReadOnlyCollection<string> requestedTags,
        string eventTag)
    {
        var result = new List<string> { "event-playbook", eventTag };
        foreach (var tag in requestedTags)
        {
            var value = tag.Trim();
            if (string.IsNullOrWhiteSpace(value) || result.Contains(value, StringComparer.OrdinalIgnoreCase)) continue;
            if (result.Count >= 20) break;
            result.Add(value);
        }
        return result;
    }

    private static string BuildEventTag(string eventId)
    {
        var normalised = new string(eventId.Trim().ToLowerInvariant()
            .Select(character => char.IsLetterOrDigit(character) || character == '-' ? character : '-')
            .ToArray()).Trim('-');
        return $"event-playbook-{normalised}";
    }

    private async Task EnsureMediaTagsAsync(
        IReadOnlyCollection<string> requiredTags,
        CancellationToken cancellationToken)
    {
        if (requiredTags.Count == 0) return;

        await _mediaTagGate.WaitAsync(cancellationToken);
        try
        {
            var existingTags = await GetMediaTagNamesAsync(cancellationToken);
            foreach (var tag in requiredTags)
            {
                if (!existingTags.Add(tag)) continue;

                using var content = JsonContent.Create(new JsonObject { ["name"] = tag });
                using var response = await SendYodeckAsync(
                    HttpMethod.Post,
                    "media/tags",
                    content,
                    cancellationToken);
                await ReadObjectAsync(response, $"create the required artwork tag '{tag}'", cancellationToken);
                logger.LogInformation("Created Yodeck media tag {TagName}.", tag);
            }
        }
        finally
        {
            _mediaTagGate.Release();
        }
    }

    private async Task<HashSet<string>> GetMediaTagNamesAsync(CancellationToken cancellationToken)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var visitedPages = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string? pageUrl = "media/tags?limit=100";

        while (!string.IsNullOrWhiteSpace(pageUrl) && visitedPages.Add(pageUrl))
        {
            using var response = await SendYodeckAsync(
                HttpMethod.Get,
                pageUrl,
                content: null,
                cancellationToken);
            var page = await ReadObjectAsync(response, "retrieve the available artwork tags", cancellationToken);

            if (page["results"] is JsonArray results)
            {
                foreach (var tag in results.OfType<JsonObject>())
                {
                    var name = ReadString(tag, "name")?.Trim();
                    if (!string.IsNullOrWhiteSpace(name)) names.Add(name);
                }
            }

            pageUrl = ReadString(page, "next");
        }

        return names;
    }

    private async Task<JsonObject> GetPlaylistAsync(CancellationToken cancellationToken)
    {
        using var response = await SendYodeckAsync(
            HttpMethod.Get,
            $"playlists/{_options.PlaylistId}",
            content: null,
            cancellationToken);
        return await ReadObjectAsync(response, "retrieve the Clubhouse screen rotation", cancellationToken);
    }

    private async Task<List<JsonObject>> FindEventMediaAsync(
        string eventId,
        string eventTag,
        long? workspaceId,
        CancellationToken cancellationToken)
    {
        var taggedMedia = await GetMediaByTagAsync(eventTag, workspaceId, cancellationToken);
        var exactTaggedMatches = taggedMedia
            .Where(item => HasTag(item, eventTag) || MatchesEventDescription(item, eventId))
            .ToList();
        if (exactTaggedMatches.Count > 0) return exactTaggedMatches;

        // Media created by earlier Event Playbook versions did not have the
        // per-event tag, but did record the event ID in the description.
        var legacyMedia = await GetMediaByTagAsync("event-playbook", workspaceId, cancellationToken);
        return legacyMedia.Where(item => MatchesEventDescription(item, eventId)).ToList();
    }

    private async Task<List<JsonObject>> GetMediaByTagAsync(
        string tag,
        long? workspaceId,
        CancellationToken cancellationToken)
    {
        var results = new List<JsonObject>();
        var visitedPages = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var workspaceFilter = workspaceId is > 0 ? $"&workspace={workspaceId.Value}" : string.Empty;
        string? pageUrl = $"media?limit=100&media_type=image&tags={Uri.EscapeDataString(tag)}{workspaceFilter}";

        while (!string.IsNullOrWhiteSpace(pageUrl) && visitedPages.Add(pageUrl))
        {
            using var response = await SendYodeckAsync(HttpMethod.Get, pageUrl, content: null, cancellationToken);
            var page = await ReadObjectAsync(response, "look for existing event artwork", cancellationToken);
            if (page["results"] is JsonArray pageResults)
            {
                results.AddRange(pageResults.OfType<JsonObject>());
            }
            pageUrl = ReadString(page, "next");
        }

        return results;
    }

    private static JsonObject? SelectCanonicalMedia(
        IReadOnlyCollection<JsonObject> candidates,
        JsonObject playlist)
    {
        if (candidates.Count == 0) return null;
        var playlistMediaIds = playlist["items"] is JsonArray items
            ? items.OfType<JsonObject>()
                .Where(item => string.Equals(ReadString(item, "type"), "media", StringComparison.OrdinalIgnoreCase))
                .Select(item => ReadInt64(item, "id"))
                .OfType<long>()
                .ToHashSet()
            : [];

        return candidates
            .OrderByDescending(item => ReadInt64(item, "id") is { } id && playlistMediaIds.Contains(id))
            .ThenByDescending(item => ReadTimestamp(item, "last_modified"))
            .ThenByDescending(item => ReadInt64(item, "id") ?? 0)
            .First();
    }

    private async Task<JsonObject> CreateMediaAsync(
        YodeckPublishCommand command,
        IReadOnlyCollection<string> tags,
        long? workspaceId,
        CancellationToken cancellationToken)
    {
        var payload = BuildMediaPayload(command, tags);
        payload["arguments"] = new JsonObject();

        if (workspaceId is > 0)
        {
            payload["workspace"] = workspaceId.Value;
        }

        using var content = JsonContent.Create(payload);
        using var response = await SendYodeckAsync(
            HttpMethod.Post,
            "media",
            content,
            cancellationToken);
        return await ReadObjectAsync(response, "create the clubhouse screen artwork item", cancellationToken);
    }

    private async Task<JsonObject> UpdateMediaAsync(
        JsonObject existingMedia,
        YodeckPublishCommand command,
        IReadOnlyCollection<string> tags,
        CancellationToken cancellationToken)
    {
        var mediaId = ReadInt64(existingMedia, "id")
            ?? throw new InvalidOperationException("The existing screen artwork did not include its ID.");
        using var content = JsonContent.Create(BuildMediaPayload(command, tags));
        using var response = await SendYodeckAsync(
            HttpMethod.Patch,
            $"media/{mediaId}",
            content,
            cancellationToken);
        return await ReadObjectAsync(response, "update the existing clubhouse screen artwork item", cancellationToken);
    }

    private JsonObject BuildMediaPayload(
        YodeckPublishCommand command,
        IReadOnlyCollection<string> tags) =>
        new()
        {
            ["name"] = command.MediaName,
            ["media_origin"] = new JsonObject
            {
                ["type"] = "image",
                ["source"] = "local",
                ["format"] = null
            },
            ["description"] = $"Event Playbook event id: {command.EventId}. Artwork for {command.EventName}.",
            ["default_duration"] = Math.Clamp(_options.MediaDurationSeconds, 5, 300),
            ["tags"] = new JsonArray(tags
                .Select(tag => (JsonNode?)JsonValue.Create(tag))
                .ToArray()),
            ["availability_schedule"] = new JsonObject
            {
                ["enable"] = true,
                ["available_after"] = $"{command.StartDate:yyyy-MM-dd}T00:00:00Z",
                ["available_before"] = $"{command.EndDate:yyyy-MM-dd}T23:59:59Z",
                ["availability_slots"] = new JsonArray
                {
                    new JsonObject
                    {
                        ["start"] = "00:00:00",
                        ["end"] = "23:59:59",
                        ["days_of_week"] = "1111111"
                    }
                }
            }
        };

    private async Task<string> GetUploadUrlAsync(long mediaId, CancellationToken cancellationToken)
    {
        using var response = await SendYodeckAsync(
            HttpMethod.Get,
            $"media/{mediaId}/upload",
            content: null,
            cancellationToken);
        var payload = await ReadObjectAsync(response, "request the screen artwork upload URL", cancellationToken);
        return ReadString(payload, "upload_url")
            ?? throw new InvalidOperationException("The screen service did not return an upload URL for the artwork.");
    }

    private async Task UploadImageAsync(
        string uploadUrl,
        byte[] imageBytes,
        CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient("Yodeck");
        using var request = new HttpRequestMessage(HttpMethod.Put, uploadUrl);
        request.Content = new ByteArrayContent(imageBytes);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("image/png");

        using var response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var details = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"The clubhouse screen artwork upload failed ({(int)response.StatusCode}). {TrimDetails(details)}");
        }
    }

    private async Task CompleteUploadAsync(
        long mediaId,
        string uploadUrl,
        CancellationToken cancellationToken)
    {
        using var content = JsonContent.Create(new { upload_url = uploadUrl });
        using var response = await SendYodeckAsync(
            HttpMethod.Put,
            $"media/{mediaId}/upload/complete",
            content,
            cancellationToken);
        await EnsureSuccessAsync(response, "complete the clubhouse screen artwork upload", cancellationToken);
    }

    private async Task<PlaylistUpdateResult> EnsurePlaylistContainsAsync(
        JsonObject playlist,
        long mediaId,
        IReadOnlySet<long> matchingMediaIds,
        CancellationToken cancellationToken)
    {
        var items = new JsonArray();
        var highestPriority = 0L;
        var canonicalItemFound = false;
        var changed = false;
        var duplicateEntriesRemoved = 0;
        var duration = Math.Clamp(_options.MediaDurationSeconds, 5, 300);

        if (playlist["items"] is JsonArray existingItems)
        {
            foreach (var existing in existingItems.OfType<JsonObject>())
            {
                var normalised = NormalisePlaylistItem(existing);
                if (normalised is null) continue;

                var itemType = ReadString(normalised, "type");
                var itemId = ReadInt64(normalised, "id");
                if (string.Equals(itemType, "media", StringComparison.OrdinalIgnoreCase) && itemId is { } id)
                {
                    if (id == mediaId)
                    {
                        if (canonicalItemFound)
                        {
                            duplicateEntriesRemoved += 1;
                            changed = true;
                            continue;
                        }
                        canonicalItemFound = true;
                        if ((ReadInt64(normalised, "duration") ?? 0) != duration)
                        {
                            normalised["duration"] = duration;
                            changed = true;
                        }
                    }
                    else if (matchingMediaIds.Contains(id))
                    {
                        duplicateEntriesRemoved += 1;
                        changed = true;
                        continue;
                    }
                }

                items.Add(normalised);
                highestPriority = Math.Max(highestPriority, ReadInt64(normalised, "priority") ?? 0);
            }
        }

        if (!canonicalItemFound)
        {
            items.Add(new JsonObject
            {
                ["id"] = mediaId,
                ["priority"] = highestPriority + 1,
                ["duration"] = duration,
                ["type"] = "media"
            });
            changed = true;
        }

        if (!changed)
        {
            return new PlaylistUpdateResult(false, 0);
        }

        using var content = JsonContent.Create(new JsonObject { ["items"] = items });
        using var response = await SendYodeckAsync(
            HttpMethod.Patch,
            $"playlists/{_options.PlaylistId}",
            content,
            cancellationToken);
        await EnsureSuccessAsync(response, "update the Clubhouse screen rotation", cancellationToken);
        return new PlaylistUpdateResult(true, duplicateEntriesRemoved);
    }

    private async Task<ScreenPushResult> PushScreensAsync(
        long? workspaceId,
        CancellationToken cancellationToken)
    {
        var payload = new JsonObject
        {
            ["use_download_timeslots"] = false
        };
        if (workspaceId is > 0)
        {
            payload["filter_workspaces"] = new JsonArray(JsonValue.Create(workspaceId.Value));
        }

        using var content = JsonContent.Create(payload);
        using var response = await SendYodeckAsync(
            HttpMethod.Post,
            "screens/push",
            content,
            cancellationToken);
        var push = await ReadObjectAsync(response, "push the updated rotation to the screens", cancellationToken);
        var statusUrl = ReadString(push, "push_status_url");
        var status = NormalisePushStatus(ReadString(push, "status"));

        if (IsSuccessfulPushStatus(status))
        {
            return new ScreenPushResult(true, status);
        }

        if (string.IsNullOrWhiteSpace(statusUrl))
        {
            return new ScreenPushResult(false, string.IsNullOrWhiteSpace(status) ? "accepted" : status);
        }

        const int maximumStatusChecks = 20;
        for (var attempt = 0; attempt < maximumStatusChecks; attempt += 1)
        {
            if (attempt > 0)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(750), cancellationToken);
            }

            using var statusResponse = await SendYodeckAsync(
                HttpMethod.Get,
                statusUrl,
                content: null,
                cancellationToken);
            var statusPayload = await ReadObjectAsync(
                statusResponse,
                "confirm that the screen update was pushed",
                cancellationToken);
            status = NormalisePushStatus(ReadString(statusPayload, "status"));
            if (IsSuccessfulPushStatus(status))
            {
                return new ScreenPushResult(true, status);
            }

            if (IsFailedPushStatus(status))
            {
                throw new InvalidOperationException(
                    $"The screen service reported that the push ended with status '{status}'.");
            }
        }

        logger.LogWarning(
            "Yodeck accepted a push for playlist {PlaylistId}, but did not report completion within the confirmation window. Last status: {PushStatus}.",
            _options.PlaylistId,
            status);
        return new ScreenPushResult(false, string.IsNullOrWhiteSpace(status) ? "pending" : status);
    }

    private async Task<HttpResponseMessage> SendYodeckAsync(
        HttpMethod method,
        string relativeUrl,
        HttpContent? content,
        CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient("Yodeck");
        using var request = new HttpRequestMessage(method, relativeUrl) { Content = content };
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Token",
            $"{_options.ApiTokenLabel}:{_options.ApiToken}");
        return await client.SendAsync(request, cancellationToken);
    }

    private static JsonObject? NormalisePlaylistItem(JsonObject item)
    {
        var type = ReadString(item, "type")?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(type)) return null;

        var result = new JsonObject
        {
            ["type"] = type,
            ["priority"] = ReadInt64(item, "priority") ?? 1
        };

        if (type != "hide_playlist")
        {
            var id = ReadInt64(item, "id");
            if (id is null) return null;
            result["id"] = id.Value;
        }

        if (type == "subplaylist")
        {
            result["max_time"] = ReadInt64(item, "max_time") ?? 0;
            result["max_items"] = ReadInt64(item, "max_items") ?? 0;
        }
        else
        {
            result["duration"] = ReadInt64(item, "duration") ?? 15;
        }

        return result;
    }

    private async Task<JsonObject> ReadObjectAsync(
        HttpResponseMessage response,
        string action,
        CancellationToken cancellationToken)
    {
        await EnsureSuccessAsync(response, action, cancellationToken);
        var node = await response.Content.ReadFromJsonAsync<JsonNode>(cancellationToken: cancellationToken);
        return node as JsonObject
            ?? throw new InvalidOperationException($"The screen service returned an unexpected response while trying to {action}.");
    }

    private static async Task EnsureSuccessAsync(
        HttpResponseMessage response,
        string action,
        CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode) return;

        var details = await response.Content.ReadAsStringAsync(cancellationToken);
        var retryAfter = response.Headers.RetryAfter?.Delta is { } delay
            ? $" Retry after approximately {Math.Ceiling(delay.TotalSeconds)} seconds."
            : string.Empty;
        throw new InvalidOperationException(
            $"The screen service could not {action} ({(int)response.StatusCode}).{retryAfter} {TrimDetails(details)}".Trim());
    }

    private static long? ReadInt64(JsonObject value, string propertyName) =>
        value[propertyName] is JsonValue node && node.TryGetValue<long>(out var number) ? number : null;

    private static long? ReadNestedInt64(JsonObject value, string objectName, string propertyName) =>
        value[objectName] is JsonObject nested ? ReadInt64(nested, propertyName) : null;

    private static DateTimeOffset ReadTimestamp(JsonObject value, string propertyName) =>
        DateTimeOffset.TryParse(ReadString(value, propertyName), out var timestamp)
            ? timestamp
            : DateTimeOffset.MinValue;

    private static bool HasTag(JsonObject value, string expectedTag) =>
        value["tags"] is JsonArray tags && tags.Any(tag =>
            tag is JsonValue textTag &&
            textTag.TryGetValue<string>(out var tagName) &&
            string.Equals(tagName, expectedTag, StringComparison.OrdinalIgnoreCase));

    private static bool MatchesEventDescription(JsonObject value, string eventId)
    {
        var description = ReadString(value, "description") ?? string.Empty;
        return description.Contains($"Event Playbook event id: {eventId}.", StringComparison.OrdinalIgnoreCase) ||
            description.Contains($"({eventId}).", StringComparison.OrdinalIgnoreCase);
    }

    private static string? ReadString(JsonObject value, string propertyName) =>
        value[propertyName] is JsonValue node && node.TryGetValue<string>(out var text) ? text : null;

    private static string TrimDetails(string details)
    {
        var compact = details.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return compact.Length <= 400 ? compact : compact[..400] + "…";
    }

    private sealed record PlaylistUpdateResult(bool Changed, int DuplicateEntriesRemoved);

    private sealed record ScreenPushResult(bool Confirmed, string Status);

    private static string NormalisePushStatus(string? status) =>
        (status ?? string.Empty).Trim().ToLowerInvariant().Replace('-', '_').Replace(' ', '_');

    private static bool IsSuccessfulPushStatus(string status) =>
        status is "success" or "successful" or "complete" or "completed";

    private static bool IsFailedPushStatus(string status) =>
        status is "error" or "failed" or "failure" or "cancelled" or "canceled";
}
