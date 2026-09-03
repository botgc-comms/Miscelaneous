using System.Text.Json;
using System.Threading.Channels;
using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface IPlaybookEventChangePublisher
{
    ValueTask PublishAsync(
        JsonElement? previousState,
        JsonElement? currentState,
        CancellationToken cancellationToken);
}

public sealed class PlaybookEventChangePipeline : BackgroundService, IPlaybookEventChangePublisher
{
    private readonly Channel<PlaybookEventIntegrationSnapshot> _changes =
        Channel.CreateUnbounded<PlaybookEventIntegrationSnapshot>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false
        });
    private readonly IIntelligentGolfEventIntegration _integration;
    private readonly ILogger<PlaybookEventChangePipeline> _logger;

    public PlaybookEventChangePipeline(
        IIntelligentGolfEventIntegration integration,
        ILogger<PlaybookEventChangePipeline> logger)
    {
        _integration = integration;
        _logger = logger;
    }

    public async ValueTask PublishAsync(
        JsonElement? previousState,
        JsonElement? currentState,
        CancellationToken cancellationToken)
    {
        var previous = ReadEvents(previousState);
        var current = ReadEvents(currentState);
        foreach (var (eventId, snapshot) in current)
        {
            if (previous.TryGetValue(eventId, out var prior) && SignificantDetailsEqual(prior, snapshot))
                continue;
            await _changes.Writer.WriteAsync(snapshot, cancellationToken);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var snapshot in _changes.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                if (!await _integration.IsAvailableAsync(stoppingToken)) continue;
                await _integration.SynchroniseEventAsync(snapshot, false, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                _logger.LogError(
                    exception,
                    "Intelligent Golf event synchronisation failed for Event Playbook event {EventId}. The Playbook save remains valid and the integration can be retried.",
                    snapshot.EventId);
            }
        }
    }

    private static Dictionary<string, PlaybookEventIntegrationSnapshot> ReadEvents(JsonElement? state)
    {
        var result = new Dictionary<string, PlaybookEventIntegrationSnapshot>(StringComparer.OrdinalIgnoreCase);
        if (!state.HasValue || state.Value.ValueKind != JsonValueKind.Object ||
            !state.Value.TryGetProperty("events", out var events) || events.ValueKind != JsonValueKind.Array)
            return result;

        foreach (var item in events.EnumerateArray())
        {
            var eventId = ReadString(item, "id");
            var name = ReadString(item, "name");
            var eventDate = ReadString(item, "eventDate");
            var description = ReadString(item, "description");
            if (string.IsNullOrWhiteSpace(eventId) || string.IsNullOrWhiteSpace(name) ||
                string.IsNullOrWhiteSpace(eventDate) || string.IsNullOrWhiteSpace(description))
                continue;

            result[eventId] = new PlaybookEventIntegrationSnapshot
            {
                EventId = eventId,
                Name = name,
                EventDate = eventDate,
                Description = description,
                StartTime = ReadString(item, "startTime"),
                EndTime = ReadString(item, "endTime"),
                EventTypeId = ReadNullableInt(item, "intelligentGolfEventTypeId"),
                Attendees = Math.Max(0, ReadNullableInt(item, "expectedAttendees") ?? 0),
                GroupId = ReadString(item, "intelligentGolfGroupId") ?? "151",
                GroupName = ReadString(item, "intelligentGolfGroupName") ?? "BOTGC Event Planner"
            };
        }
        return result;
    }

    private static bool SignificantDetailsEqual(
        PlaybookEventIntegrationSnapshot left,
        PlaybookEventIntegrationSnapshot right) =>
        string.Equals(left.Name, right.Name, StringComparison.Ordinal) &&
        string.Equals(left.EventDate, right.EventDate, StringComparison.Ordinal) &&
        string.Equals(left.Description, right.Description, StringComparison.Ordinal) &&
        string.Equals(left.StartTime, right.StartTime, StringComparison.Ordinal) &&
        string.Equals(left.EndTime, right.EndTime, StringComparison.Ordinal) &&
        left.EventTypeId == right.EventTypeId &&
        left.Attendees == right.Attendees &&
        string.Equals(left.GroupId, right.GroupId, StringComparison.Ordinal) &&
        string.Equals(left.GroupName, right.GroupName, StringComparison.Ordinal);

    private static string? ReadString(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.String)
            return null;
        return value.GetString()?.Trim();
    }

    private static int? ReadNullableInt(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
        return value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out number) ? number : null;
    }
}
