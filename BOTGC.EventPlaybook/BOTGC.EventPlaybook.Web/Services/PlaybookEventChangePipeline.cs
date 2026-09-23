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
            catch (IntelligentGolfApiRequestException exception) when (exception.RequiresPlannerMatch)
            {
                _logger.LogInformation(
                    "Intelligent Golf planner matching requires an organiser decision for Event Playbook event {EventId}.",
                    snapshot.EventId);
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

    internal static Dictionary<string, PlaybookEventIntegrationSnapshot> ReadEvents(JsonElement? state)
    {
        var result = new Dictionary<string, PlaybookEventIntegrationSnapshot>(StringComparer.OrdinalIgnoreCase);
        if (!state.HasValue || state.Value.ValueKind != JsonValueKind.Object ||
            !state.Value.TryGetProperty("events", out var events) || events.ValueKind != JsonValueKind.Array)
            return result;

        foreach (var item in events.EnumerateArray())
        {
            if (string.Equals(ReadString(item, "recordType"), "idea", StringComparison.OrdinalIgnoreCase))
                continue;

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
                LifecycleStatus = ReadNestedString(item, "lifecycle", "status"),
                GroupId = ReadString(item, "intelligentGolfGroupId") ?? "151",
                GroupName = ReadString(item, "intelligentGolfGroupName") ?? "BOTGC Event Planner",
                PlanningNote = ReadString(item, "intelligentGolfPlanningNote"),
                IntelligentGolfTicketsRequested = ReadAnswerBoolean(item, "ig-online-ticketing") == true,
                IntelligentGolfTickets = ReadTicketConfiguration(item, out var ticketValidationError),
                IntelligentGolfTicketValidationError = ticketValidationError
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
        string.Equals(left.GroupName, right.GroupName, StringComparison.Ordinal) &&
        string.Equals(left.PlanningNote, right.PlanningNote, StringComparison.Ordinal);

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

    private static IntelligentGolfTicketConfiguration? ReadTicketConfiguration(
        JsonElement eventElement,
        out string? validationError)
    {
        validationError = null;
        if (ReadAnswerBoolean(eventElement, "ig-online-ticketing") != true) return null;

        var maximumTickets = ReadAnswerInt(eventElement, "ig-ticket-allocation");
        var allowMembers = ReadAnswerBoolean(eventElement, "ig-members-online");
        var allowVisitors = ReadAnswerBoolean(eventElement, "ig-visitors-online");
        var requireGuestDetails = ReadAnswerBoolean(eventElement, "ig-require-member-guest-details");
        var paymentDueOnEntry = ReadAnswerBoolean(eventElement, "ig-members-payment-due-on-entry") ?? false;
        var addOptions = ReadAnswerBoolean(eventElement, "ig-add-ticket-options");
        var maximumPerMember = ReadAnswerInt(eventElement, "ig-max-tickets-member");
        var maximumPerVisitor = ReadAnswerInt(eventElement, "ig-max-tickets-visitor");
        var ticketTypes = ReadTicketTypes(eventElement);

        if (maximumTickets is not > 0)
            validationError = "Enter how many tickets Intelligent Golf should make available.";
        else if (!allowMembers.HasValue)
            validationError = "Choose whether members may book online in Intelligent Golf.";
        else if (allowMembers == true && (maximumPerMember is null or < 0))
            validationError = "Enter the maximum number of tickets per member.";
        else if (allowMembers == true && !requireGuestDetails.HasValue)
            validationError = "Choose whether member guest details are required.";
        else if (!allowVisitors.HasValue)
            validationError = "Choose whether visitors may book online in Intelligent Golf.";
        else if (allowMembers == false && allowVisitors == false)
            validationError = "Allow members, visitors or both to book online in Intelligent Golf.";
        else if (allowVisitors == true && (maximumPerVisitor is null or < 0))
            validationError = "Enter the maximum number of tickets per visitor.";
        else if (!addOptions.HasValue)
            validationError = "Choose whether Intelligent Golf additional ticket options are enabled.";
        else if (ticketTypes.Count == 0)
            validationError = "Add at least one Intelligent Golf ticket type with a valid price.";

        if (validationError is not null) return null;
        return new IntelligentGolfTicketConfiguration
        {
            MaximumTickets = maximumTickets!.Value,
            AllowMembersOnline = allowMembers!.Value,
            MaximumTicketsPerMember = allowMembers.Value ? maximumPerMember : null,
            RequireMemberGuestDetails = allowMembers.Value && requireGuestDetails == true,
            MembersPaymentDueOnEntry = allowMembers.Value && paymentDueOnEntry,
            AllowVisitorsOnline = allowVisitors!.Value,
            MaximumTicketsPerVisitor = allowVisitors.Value ? maximumPerVisitor : null,
            AddOptions = addOptions!.Value,
            TicketTypes = ticketTypes
        };
    }

    private static bool? ReadAnswerBoolean(JsonElement eventElement, string questionId)
    {
        if (!TryGetAnswer(eventElement, questionId, out var value)) return null;
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(value.GetString(), out var parsed) => parsed,
            _ => null
        };
    }

    private static int? ReadAnswerInt(JsonElement eventElement, string questionId)
    {
        if (!TryGetAnswer(eventElement, questionId, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
        return value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out number) ? number : null;
    }

    private static IReadOnlyList<IntelligentGolfTicketType> ReadTicketTypes(JsonElement eventElement)
    {
        if (!TryGetAnswer(eventElement, "ig-ticket-types", out var value) || value.ValueKind != JsonValueKind.Array)
            return [];
        var result = new List<IntelligentGolfTicketType>();
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in value.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Object) return [];
            var name = ReadString(row, "name");
            if (string.IsNullOrWhiteSpace(name) || name.Length > 120 || !names.Add(name)) return [];
            if (!row.TryGetProperty("price", out var priceValue)) return [];
            decimal price;
            if (priceValue.ValueKind == JsonValueKind.Number && priceValue.TryGetDecimal(out price)) { }
            else if (priceValue.ValueKind == JsonValueKind.String &&
                     decimal.TryParse(priceValue.GetString(), System.Globalization.NumberStyles.Number,
                         System.Globalization.CultureInfo.InvariantCulture, out price)) { }
            else return [];
            if (price < 0 || price > 10000) return [];
            result.Add(new IntelligentGolfTicketType { Name = name, Price = price });
        }
        return result;
    }

    private static bool TryGetAnswer(JsonElement eventElement, string questionId, out JsonElement value)
    {
        value = default;
        return eventElement.TryGetProperty("answers", out var answers) &&
               answers.ValueKind == JsonValueKind.Object &&
               answers.TryGetProperty(questionId, out value);
    }

    private static string? ReadNestedString(JsonElement element, string objectName, string propertyName)
    {
        if (!element.TryGetProperty(objectName, out var nested) || nested.ValueKind != JsonValueKind.Object)
            return null;
        return ReadString(nested, propertyName);
    }
}
