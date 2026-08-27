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

    public bool IsConfigured => _options.IsConfigured;

    public async Task<YodeckPublishResult> PublishAsync(
        YodeckPublishCommand command,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException(
                "Yodeck publishing is not configured. Add YODECK_API_TOKEN and YODECK_PLAYLIST_ID to the server environment.");
        }

        var playlist = await GetPlaylistAsync(cancellationToken);
        var playlistName = ReadString(playlist, "name") ?? _options.PlaylistName;
        var workspaceId = ReadNestedInt64(playlist, "workspace", "id");

        var media = await CreateMediaAsync(command, workspaceId, cancellationToken);
        var mediaId = ReadInt64(media, "id")
            ?? throw new InvalidOperationException("Yodeck created the media resource but did not return its ID.");

        try
        {
            var uploadUrl = await GetUploadUrlAsync(mediaId, cancellationToken);
            await UploadImageAsync(uploadUrl, command.ImageBytes, cancellationToken);
            await CompleteUploadAsync(mediaId, uploadUrl, cancellationToken);
            await AppendToPlaylistAsync(playlist, mediaId, cancellationToken);
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Yodeck publishing failed after creating media {MediaId} for event {EventId}.",
                mediaId,
                command.EventId);
            throw new InvalidOperationException(
                $"Yodeck created media item {mediaId}, but the upload or playlist update did not finish. " +
                "The item may need removing or completing in Yodeck before retrying.",
                exception);
        }

        logger.LogInformation(
            "Published event {EventId} to Yodeck media {MediaId} and playlist {PlaylistId}.",
            command.EventId,
            mediaId,
            _options.PlaylistId);

        return new YodeckPublishResult
        {
            MediaId = mediaId,
            MediaName = command.MediaName,
            PlaylistId = _options.PlaylistId,
            PlaylistName = playlistName,
            StartDate = command.StartDate,
            EndDate = command.EndDate,
            Tags = command.Tags
        };
    }

    private async Task<JsonObject> GetPlaylistAsync(CancellationToken cancellationToken)
    {
        using var response = await SendYodeckAsync(
            HttpMethod.Get,
            $"playlists/{_options.PlaylistId}",
            content: null,
            cancellationToken);
        return await ReadObjectAsync(response, "retrieve the Clubhouse playlist", cancellationToken);
    }

    private async Task<JsonObject> CreateMediaAsync(
        YodeckPublishCommand command,
        long? workspaceId,
        CancellationToken cancellationToken)
    {
        var payload = new JsonObject
        {
            ["name"] = command.MediaName,
            ["media_origin"] = new JsonObject
            {
                ["type"] = "image",
                ["source"] = "local",
                ["format"] = null
            },
            ["description"] = $"Event Playbook artwork for {command.EventName} ({command.EventId}).",
            ["default_duration"] = Math.Clamp(_options.MediaDurationSeconds, 5, 300),
            ["tags"] = new JsonArray(command.Tags
                .Select(tag => (JsonNode?)JsonValue.Create(tag))
                .ToArray()),
            ["availability_schedule"] = new JsonObject
            {
                ["enable"] = true,
                ["available_after"] = $"{command.StartDate:yyyy-MM-dd}T00:00:00",
                ["available_before"] = $"{command.EndDate:yyyy-MM-dd}T23:59:59",
                ["availability_slots"] = new JsonArray()
            },
            ["arguments"] = new JsonObject()
        };

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
        return await ReadObjectAsync(response, "create the Yodeck media item", cancellationToken);
    }

    private async Task<string> GetUploadUrlAsync(long mediaId, CancellationToken cancellationToken)
    {
        using var response = await SendYodeckAsync(
            HttpMethod.Get,
            $"media/{mediaId}/upload",
            content: null,
            cancellationToken);
        var payload = await ReadObjectAsync(response, "request the Yodeck upload URL", cancellationToken);
        return ReadString(payload, "upload_url")
            ?? throw new InvalidOperationException("Yodeck did not return an upload URL for the media item.");
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
                $"The Yodeck signed file upload failed ({(int)response.StatusCode}). {TrimDetails(details)}");
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
        await EnsureSuccessAsync(response, "complete the Yodeck media upload", cancellationToken);
    }

    private async Task AppendToPlaylistAsync(
        JsonObject playlist,
        long mediaId,
        CancellationToken cancellationToken)
    {
        var items = new JsonArray();
        var highestPriority = 0L;

        if (playlist["items"] is JsonArray existingItems)
        {
            foreach (var existing in existingItems.OfType<JsonObject>())
            {
                var normalised = NormalisePlaylistItem(existing);
                if (normalised is null) continue;
                items.Add(normalised);
                highestPriority = Math.Max(highestPriority, ReadInt64(normalised, "priority") ?? 0);
            }
        }

        items.Add(new JsonObject
        {
            ["id"] = mediaId,
            ["priority"] = highestPriority + 1,
            ["duration"] = Math.Clamp(_options.MediaDurationSeconds, 5, 300),
            ["type"] = "media"
        });

        using var content = JsonContent.Create(new JsonObject { ["items"] = items });
        using var response = await SendYodeckAsync(
            HttpMethod.Patch,
            $"playlists/{_options.PlaylistId}",
            content,
            cancellationToken);
        await EnsureSuccessAsync(response, "add the media item to the Clubhouse playlist", cancellationToken);
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
            ?? throw new InvalidOperationException($"Yodeck returned an unexpected response while trying to {action}.");
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
            $"Yodeck could not {action} ({(int)response.StatusCode}).{retryAfter} {TrimDetails(details)}".Trim());
    }

    private static long? ReadInt64(JsonObject value, string propertyName) =>
        value[propertyName] is JsonValue node && node.TryGetValue<long>(out var number) ? number : null;

    private static long? ReadNestedInt64(JsonObject value, string objectName, string propertyName) =>
        value[objectName] is JsonObject nested ? ReadInt64(nested, propertyName) : null;

    private static string? ReadString(JsonObject value, string propertyName) =>
        value[propertyName] is JsonValue node && node.TryGetValue<string>(out var text) ? text : null;

    private static string TrimDetails(string details)
    {
        var compact = details.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return compact.Length <= 400 ? compact : compact[..400] + "…";
    }
}
