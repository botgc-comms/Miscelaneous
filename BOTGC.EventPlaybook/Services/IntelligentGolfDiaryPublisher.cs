using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.Services;

public sealed class IntelligentGolfDiaryPublisher(
    IHttpClientFactory httpClientFactory,
    IOptions<IntelligentGolfOptions> options,
    ILogger<IntelligentGolfDiaryPublisher> logger) : IIntelligentGolfDiaryPublisher
{
    private readonly IntelligentGolfOptions _options = options.Value;

    public bool IsConfigured => _options.IsConfigured;

    public async Task<MemberDiaryPublishResult> UpsertAsync(
        MemberDiaryPublishCommand command,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException(
                "Member diary sharing is not configured. Ask an administrator to connect the club diary service.");
        }

        var externalId = $"event-playbook-{NormaliseExternalId(command.EventId)}";
        var endpoint = _options.DiaryEndpoint.Replace(
            "{eventId}",
            Uri.EscapeDataString(externalId),
            StringComparison.OrdinalIgnoreCase);

        using var request = new HttpRequestMessage(ParseMethod(_options.HttpMethod), endpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Content = JsonContent.Create(new
        {
            clubId = _options.ClubId,
            externalId,
            title = command.EventName,
            date = command.EventDate.ToString("yyyy-MM-dd"),
            allDay = string.IsNullOrWhiteSpace(command.StartTime),
            startTime = EmptyAsNull(command.StartTime),
            endTime = EmptyAsNull(command.EndTime),
            description = command.Description,
            bookingUrl = EmptyAsNull(command.BookingUrl),
            image = command.ArtworkBytes is null
                ? null
                : new
                {
                    fileName = command.ArtworkFileName,
                    contentType = "image/png",
                    base64 = Convert.ToBase64String(command.ArtworkBytes)
                },
            source = "BOTGC Event Playbook"
        });

        var client = httpClientFactory.CreateClient("IntelligentGolf");
        using var response = await client.SendAsync(request, cancellationToken);
        var responseText = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var detail = ExtractError(responseText);
            throw new InvalidOperationException(
                $"The member diary service could not save this event ({(int)response.StatusCode}).{(string.IsNullOrWhiteSpace(detail) ? string.Empty : $" {detail}")}");
        }

        var responseObject = TryReadObject(responseText);
        var remoteId = ReadString(responseObject, "id")
            ?? ReadString(responseObject, "eventId")
            ?? ReadString(responseObject, "diaryEntryId")
            ?? externalId;
        var operation = ReadString(responseObject, "operation")
            ?? ReadString(responseObject, "status")
            ?? "saved";

        logger.LogInformation(
            "Saved member diary entry {RemoteId} for event {EventId} using external reference {ExternalId}.",
            remoteId,
            command.EventId,
            externalId);

        return new MemberDiaryPublishResult
        {
            RemoteId = remoteId,
            ExternalId = externalId,
            Operation = operation,
            EventDate = command.EventDate
        };
    }

    private static HttpMethod ParseMethod(string value) =>
        string.Equals(value, "POST", StringComparison.OrdinalIgnoreCase)
            ? HttpMethod.Post
            : HttpMethod.Put;

    private static string NormaliseExternalId(string value)
    {
        var result = new string(value.Trim().ToLowerInvariant()
            .Select(character => char.IsLetterOrDigit(character) || character == '-' ? character : '-')
            .ToArray()).Trim('-');
        return string.IsNullOrWhiteSpace(result) ? "event" : result;
    }

    private static string? EmptyAsNull(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static JsonObject? TryReadObject(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        try
        {
            return JsonNode.Parse(value) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? ReadString(JsonObject? value, string propertyName)
    {
        if (value?[propertyName] is not JsonValue property) return null;
        return property.TryGetValue<string>(out var result) ? result : property.ToJsonString();
    }

    private static string ExtractError(string responseText)
    {
        var response = TryReadObject(responseText);
        return ReadString(response, "message")
            ?? ReadString(response, "error")
            ?? responseText.Trim();
    }
}
