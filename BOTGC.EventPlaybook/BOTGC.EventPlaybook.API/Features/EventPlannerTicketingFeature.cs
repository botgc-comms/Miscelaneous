using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using MediatR;

namespace BOTGC.EventPlaybook.API.Features;

public sealed record SynchronisePlannerTicketsRequest(
    string EventPlaybookEventId,
    int IntelligentGolfEventId,
    int MaximumTickets,
    bool AllowMembersOnline,
    int? MaximumTicketsPerMember,
    bool RequireMemberGuestDetails,
    bool MembersPaymentDueOnEntry,
    bool AllowVisitorsOnline,
    int? MaximumTicketsPerVisitor,
    bool AddOptions,
    IReadOnlyList<PlannerTicketTypeRequest> TicketTypes);

public sealed record PlannerTicketTypeRequest(string Name, decimal Price);

public sealed record SynchronisePlannerTicketsResult(
    string EventPlaybookEventId,
    int IntelligentGolfEventId,
    int TicketTypeCount,
    DateTimeOffset SynchronisedAtUtc);

public sealed record SynchronisePlannerTicketsCommand(
    SynchronisePlannerTicketsRequest Request) : IRequest<SynchronisePlannerTicketsResult>;

public sealed class SynchronisePlannerTicketsHandler(
    IIntelligentGolfTransport transport,
    IDistributedLockManager lockManager,
    ILogger<SynchronisePlannerTicketsHandler> logger)
    : IRequestHandler<SynchronisePlannerTicketsCommand, SynchronisePlannerTicketsResult>
{
    public async Task<SynchronisePlannerTicketsResult> Handle(
        SynchronisePlannerTicketsCommand command,
        CancellationToken cancellationToken)
    {
        var request = command.Request;
        Validate(request);
        await using var eventLock = await lockManager.AcquireAsync(
            $"intelligent-golf:event-tickets:{request.IntelligentGolfEventId}",
            cancellationToken);
        if (!eventLock.IsAcquired)
            throw new TimeoutException("Another request is currently updating these Intelligent Golf tickets. Try again shortly.");

        var ticketAdminPath = $"/event.php?eventid={request.IntelligentGolfEventId}&tab=ticket_admin";
        await GetAsync(ticketAdminPath, "planner-ticket-page-preparation", request, cancellationToken);
        var settingsForm = await GetAsync(
            $"{ticketAdminPath}&requestType=ajax&ajaxaction=editsettings",
            "planner-ticket-settings-contract",
            request,
            cancellationToken);
        var typeForm = await GetAsync(
            $"{ticketAdminPath}&requestType=ajax&ajaxaction=edittickettypes",
            "planner-ticket-types-contract",
            request,
            cancellationToken);

        var settingsFields = BuildSettingsFields(request, ExtractAjaxHtml(settingsForm.Body));
        await PostAsync(
            $"{ticketAdminPath}&requestType=ajax&ajaxaction=editsettingsconfirm",
            settingsFields,
            "planner-ticket-settings-update",
            request,
            cancellationToken);

        var ticketTypeFields = BuildTicketTypeFields(request, ExtractAjaxHtml(typeForm.Body));
        await PostAsync(
            $"{ticketAdminPath}&requestType=ajax&ajaxaction=edittickettypesconfirm",
            ticketTypeFields,
            "planner-ticket-types-update",
            request,
            cancellationToken);

        var verification = await GetAsync(
            $"{ticketAdminPath}&eventPlaybookVerify={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}",
            "planner-ticket-verification",
            request,
            cancellationToken);
        var missingType = request.TicketTypes.FirstOrDefault(type =>
            !IntelligentGolfMutationResponseInspector.ContainsText(verification.Body, type.Name.Trim()));
        if (missingType is not null)
        {
            throw Failure(
                "planner-ticket-verification",
                request,
                $"Intelligent Golf did not return ticket type '{missingType.Name.Trim()}' after saving the ticket setup.");
        }
        var verificationText = WebUtility.HtmlDecode(Regex.Replace(verification.Body, "<[^>]+>", " "));
        if (!Regex.IsMatch(
                verificationText,
                $@"\b{request.MaximumTickets.ToString(CultureInfo.InvariantCulture)}\s+tickets?\b",
                RegexOptions.IgnoreCase))
        {
            throw Failure(
                "planner-ticket-verification",
                request,
                $"Intelligent Golf did not return the saved allocation of {request.MaximumTickets} tickets.");
        }
        var expectedMemberLimit = request.AllowMembersOnline ? request.MaximumTicketsPerMember ?? 0 : 0;
        var expectedVisitorLimit = request.AllowVisitorsOnline ? request.MaximumTicketsPerVisitor ?? 0 : 0;
        if (!Regex.IsMatch(
                verificationText,
                $@"\bMax\s+{expectedMemberLimit}\s+tickets?\s+per\s+member\s*,\s*{expectedVisitorLimit}\s+per\s+visitor\b",
                RegexOptions.IgnoreCase))
        {
            throw Failure(
                "planner-ticket-verification",
                request,
                $"Intelligent Golf did not return the saved per-person limits (member {expectedMemberLimit}, visitor {expectedVisitorLimit}).");
        }

        var synchronisedAt = DateTimeOffset.UtcNow;
        logger.LogInformation(
            "Configured {TicketTypeCount} ticket types on Intelligent Golf planner entry {IntelligentGolfEventId} for Event Playbook event {EventPlaybookEventId}.",
            request.TicketTypes.Count,
            request.IntelligentGolfEventId,
            request.EventPlaybookEventId);
        return new SynchronisePlannerTicketsResult(
            request.EventPlaybookEventId.Trim(),
            request.IntelligentGolfEventId,
            request.TicketTypes.Count,
            synchronisedAt);
    }

    internal static IReadOnlyList<KeyValuePair<string, string>> BuildSettingsFields(
        SynchronisePlannerTicketsRequest request,
        string settingsHtml)
    {
        var fields = new List<KeyValuePair<string, string>>
        {
            new("max_tickets", request.MaximumTickets.ToString(CultureInfo.InvariantCulture))
        };
        if (request.AllowMembersOnline) fields.Add(new("show_for_members", "on"));
        fields.Add(new("max_tickets_member", request.AllowMembersOnline
            ? (request.MaximumTicketsPerMember ?? 0).ToString(CultureInfo.InvariantCulture)
            : string.Empty));
        if (request.RequireMemberGuestDetails)
            fields.Add(new(ResolveCheckboxName(settingsHtml,
                ["require_guest_details", "members_require_guest_details", "member_guest_details"],
                ["guest", "detail"]), "on"));
        if (request.MembersPaymentDueOnEntry)
            fields.Add(new(ResolveCheckboxName(settingsHtml,
                ["members_payment_due_on_entry", "member_payment_due_on_entry", "members_pay_on_entry"],
                ["member", "pay", "entry"]), "on"));
        if (request.AllowVisitorsOnline) fields.Add(new("show_for_visitors", "on"));
        fields.Add(new("max_tickets_visitor", request.AllowVisitorsOnline
            ? (request.MaximumTicketsPerVisitor ?? 0).ToString(CultureInfo.InvariantCulture)
            : string.Empty));
        if (request.AddOptions)
            fields.Add(new(ResolveCheckboxName(settingsHtml,
                ["add_options", "ticket_options", "show_options"],
                ["option"]), "on"));
        return fields;
    }

    internal static IReadOnlyList<KeyValuePair<string, string>> BuildTicketTypeFields(
        SynchronisePlannerTicketsRequest request,
        string ticketTypesHtml)
    {
        var existingIds = ReadExistingTicketTypeIds(ticketTypesHtml);
        var fields = new List<KeyValuePair<string, string>>(request.TicketTypes.Count * 4);
        foreach (var ticketType in request.TicketTypes)
        {
            var name = ticketType.Name.Trim();
            fields.Add(new("name[]", name));
            fields.Add(new("price[]", ticketType.Price.ToString("0.##", CultureInfo.InvariantCulture)));
            fields.Add(new("id[]", existingIds.GetValueOrDefault(name, string.Empty)));
            fields.Add(new("status[]", "Active"));
        }
        return fields;
    }

    private async Task<IntelligentGolfTransportResponse> GetAsync(
        string path,
        string stage,
        SynchronisePlannerTicketsRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            return await transport.GetResponseAsync(path, cancellationToken);
        }
        catch (IntelligentGolfAuthenticationException) { throw; }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            throw Failure(stage, request, exception.Message, exception);
        }
    }

    private async Task PostAsync(
        string path,
        IReadOnlyCollection<KeyValuePair<string, string>> fields,
        string stage,
        SynchronisePlannerTicketsRequest request,
        CancellationToken cancellationToken)
    {
        IntelligentGolfTransportResponse response;
        try
        {
            response = await transport.PostFormResponseAsync(path, fields, cancellationToken);
        }
        catch (IntelligentGolfAuthenticationException) { throw; }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            throw Failure(stage, request, exception.Message, exception);
        }

        var rejection = IntelligentGolfMutationResponseInspector.FindRejection(response.Body);
        if (!string.IsNullOrWhiteSpace(rejection)) throw Failure(stage, request, rejection);
    }

    private static IntelligentGolfMutationException Failure(
        string stage,
        SynchronisePlannerTicketsRequest request,
        string detail,
        Exception? innerException = null) =>
        new(
            stage,
            $"Intelligent Golf planner entry {request.IntelligentGolfEventId} could not save its ticket setup.",
            request.IntelligentGolfEventId,
            responseDetail: detail,
            innerException: innerException);

    private static string ExtractAjaxHtml(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return string.Empty;
        try
        {
            using var document = JsonDocument.Parse(raw);
            if (!document.RootElement.TryGetProperty("actions", out var actions) ||
                actions.ValueKind != JsonValueKind.Array) return raw;
            return string.Join("\n", actions.EnumerateArray()
                .Where(action => action.TryGetProperty("html", out var html) && html.ValueKind == JsonValueKind.String)
                .Select(action => action.GetProperty("html").GetString()));
        }
        catch (JsonException)
        {
            return raw;
        }
    }

    private static Dictionary<string, string> ReadExistingTicketTypeIds(string html)
    {
        var inputs = ReadInputs(html);
        var names = inputs.Where(input => input.Name.Equals("name[]", StringComparison.OrdinalIgnoreCase)).ToArray();
        var ids = inputs.Where(input => input.Name.Equals("id[]", StringComparison.OrdinalIgnoreCase)).ToArray();
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < names.Length; index++)
        {
            var name = names[index].Value.Trim();
            if (name.Length > 0) result[name] = index < ids.Length ? ids[index].Value.Trim() : string.Empty;
        }
        return result;
    }

    private static string ResolveCheckboxName(string html, string[] preferredNames, string[] requiredTokens)
    {
        var checkboxes = ReadInputs(html)
            .Where(input => input.Type.Equals("checkbox", StringComparison.OrdinalIgnoreCase))
            .Select(input => input.Name)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToArray();
        foreach (var preferred in preferredNames)
        {
            var match = checkboxes.FirstOrDefault(name => name.Equals(preferred, StringComparison.OrdinalIgnoreCase));
            if (match is not null) return match;
        }
        var tokenMatch = checkboxes.FirstOrDefault(name => requiredTokens.All(token =>
            name.Contains(token, StringComparison.OrdinalIgnoreCase)));
        if (tokenMatch is not null) return tokenMatch;
        throw new IntelligentGolfMutationException(
            "planner-ticket-settings-contract",
            "The Intelligent Golf ticket settings form no longer exposes the expected option.",
            responseDetail: $"Could not identify the checkbox containing: {string.Join(", ", requiredTokens)}.");
    }

    private static IReadOnlyList<HtmlInput> ReadInputs(string html)
    {
        var result = new List<HtmlInput>();
        foreach (Match inputMatch in Regex.Matches(html ?? string.Empty, @"<input\b(?<attributes>[^>]*)>", RegexOptions.IgnoreCase))
        {
            var attributes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (Match attributeMatch in Regex.Matches(
                         inputMatch.Groups["attributes"].Value,
                         @"(?<name>[\w:-]+)\s*=\s*(?:[""'](?<quoted>.*?)[""']|(?<plain>[^\s>]+))",
                         RegexOptions.Singleline))
            {
                attributes[attributeMatch.Groups["name"].Value] = WebUtility.HtmlDecode(
                    attributeMatch.Groups["quoted"].Success
                        ? attributeMatch.Groups["quoted"].Value
                        : attributeMatch.Groups["plain"].Value);
            }
            if (!attributes.TryGetValue("name", out var name) || string.IsNullOrWhiteSpace(name)) continue;
            result.Add(new HtmlInput(
                name,
                attributes.GetValueOrDefault("value", string.Empty),
                attributes.GetValueOrDefault("type", "text")));
        }
        return result;
    }

    private static void Validate(SynchronisePlannerTicketsRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.EventPlaybookEventId))
            throw new ArgumentException("The Event Playbook event ID is required.");
        if (request.IntelligentGolfEventId <= 0)
            throw new ArgumentException("A linked Intelligent Golf planner entry is required.");
        if (request.MaximumTickets <= 0)
            throw new ArgumentException("Intelligent Golf must make at least one ticket available.");
        if (!request.AllowMembersOnline && !request.AllowVisitorsOnline)
            throw new ArgumentException("Intelligent Golf online ticketing must be available to members, visitors or both.");
        if (request.AllowMembersOnline && (request.MaximumTicketsPerMember is null or < 0))
            throw new ArgumentException("The maximum number of tickets per member is required.");
        if (request.AllowVisitorsOnline && (request.MaximumTicketsPerVisitor is null or < 0))
            throw new ArgumentException("The maximum number of tickets per visitor is required.");
        if (request.TicketTypes is not { Count: > 0 })
            throw new ArgumentException("At least one Intelligent Golf ticket type is required.");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var type in request.TicketTypes)
        {
            var name = type.Name?.Trim() ?? string.Empty;
            if (name.Length is 0 or > 120) throw new ArgumentException("Every ticket type requires a name of 120 characters or fewer.");
            if (!names.Add(name)) throw new ArgumentException($"Ticket type '{name}' is repeated.");
            if (type.Price is < 0 or > 10000) throw new ArgumentException($"Ticket type '{name}' has an invalid price.");
        }
    }

    private sealed record HtmlInput(string Name, string Value, string Type);
}
