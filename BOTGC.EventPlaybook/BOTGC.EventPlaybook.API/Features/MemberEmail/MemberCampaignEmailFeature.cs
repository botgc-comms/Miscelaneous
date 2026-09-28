using System.Text.Json;
using BOTGC.EventPlaybook.API.Features.Members;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using BOTGC.EventPlaybook.API.Options;
using HtmlAgilityPack;
using MediatR;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.API.Features.MemberEmail;

public sealed record SendMemberCampaignEmailRequest(
    IReadOnlyCollection<int> MemberNumbers,
    string Subject,
    string BodyHtml);

public sealed record MemberCampaignEmailResult(
    int Requested,
    int Sent,
    string DraftId,
    IReadOnlyList<int> MemberNumbers);

public sealed record SendMemberCampaignEmailCommand(
    IReadOnlyCollection<int> MemberNumbers,
    string Subject,
    string BodyHtml) : IRequest<MemberCampaignEmailResult>;

public sealed class SendMemberCampaignEmailHandler(
    IOptions<IntelligentGolfOptions> options,
    IIntelligentGolfSession session,
    IIntelligentGolfTransport transport,
    IMediator mediator,
    ILogger<SendMemberCampaignEmailHandler> logger)
    : IRequestHandler<SendMemberCampaignEmailCommand, MemberCampaignEmailResult>
{
    public async Task<MemberCampaignEmailResult> Handle(
        SendMemberCampaignEmailCommand request,
        CancellationToken cancellationToken)
    {
        var bodyHtml = MemberEmailHtmlSanitizer.Sanitise(request.BodyHtml);
        ValidateMessage(request.Subject, bodyHtml);
        var requestedMemberNumbers = request.MemberNumbers?
            .Where(number => number > 0)
            .Distinct()
            .ToArray() ?? [];
        if (requestedMemberNumbers.Length == 0)
        {
            throw new ArgumentException("Choose at least one active member to receive the email.");
        }

        var settings = options.Value;
        var sender = session.EmailSender;
        if (sender.MemberNumber is null or <= 0 ||
            string.IsNullOrWhiteSpace(sender.FromName) ||
            string.IsNullOrWhiteSpace(sender.FromAddress) ||
            string.IsNullOrWhiteSpace(settings.Endpoints.BulkEmailPreparePath) ||
            string.IsNullOrWhiteSpace(settings.Endpoints.BulkEmailSendPath))
        {
            throw new IntelligentGolfEmailSenderNotConfiguredException();
        }

        var activeMembers = await mediator.Send(new GetMembersQuery(false), cancellationToken);
        var membersByNumber = activeMembers.ToDictionary(member => member.MemberNumber);
        var missing = requestedMemberNumbers.Where(number => !membersByNumber.ContainsKey(number)).ToArray();
        if (missing.Length > 0)
        {
            throw new ArgumentException($"{missing.Length} selected member(s) are no longer active. Refresh the audience and try again.");
        }

        var unmapped = requestedMemberNumbers
            .Where(number => membersByNumber[number].IntelligentGolfUserId is null or <= 0)
            .ToArray();
        if (unmapped.Length > 0)
        {
            throw new InvalidOperationException($"Intelligent Golf could not resolve a recipient ID for {unmapped.Length} selected member(s). Refresh the member directory and try again.");
        }

        var fields = new List<KeyValuePair<string, string>>
        {
            new("searchtype", "simple"),
            new("selectRecipient", "all"),
            new("is_newsletter", "0"),
            new("minage", string.Empty),
            new("maxage", string.Empty),
            new("minhcap", "-6.0"),
            new("maxhcap", "54.0")
        };
        fields.AddRange(requestedMemberNumbers.Select(number =>
            new KeyValuePair<string, string>("user_ids[]", membersByNumber[number].IntelligentGolfUserId!.Value.ToString())));
        fields.AddRange(
        [
            new("searchemails", string.Empty),
            new("id", string.Empty),
            new("email_subject", request.Subject.Trim()),
            new("email_fromname", sender.FromName.Trim()),
            new("email_fromaddress", sender.FromAddress.Trim()),
            new("template", "0"),
            new("headerandfooter", "useemail"),
            new("email_content", bodyHtml)
        ]);

        // Intelligent Golf's own UI is a two-step flow. The first `send` request
        // creates/updates the draft and returns the real numeric draft ID in its
        // confirmation dialog. Only then may `confirmsend` be called. Previously
        // this integration skipped the first step and guessed an ID from arbitrary
        // page HTML; an unrelated survey URL could therefore be mistaken for the
        // draft while Intelligent Golf returned an HTTP-200 error action.
        var prepared = await transport.PostFormResponseAsync(
            settings.Endpoints.BulkEmailPreparePath,
            fields,
            cancellationToken);
        IntelligentGolfBulkEmailResponse.EnsureSendPrepared(prepared.Body);
        var draftId = IntelligentGolfBulkEmailResponse.ExtractDraftId(prepared.Body);

        // A newly composed Intelligent Golf email legitimately has no draft ID.
        // The browser posts the same blank `id` to `confirmsend`; only an email
        // that was saved as a draft first receives a numeric value. Preserve the
        // blank value unless the prepare response explicitly supplies an ID.
        if (!string.IsNullOrWhiteSpace(draftId))
        {
            fields = fields
                .Select(field => field.Key.Equals("id", StringComparison.OrdinalIgnoreCase)
                    ? new KeyValuePair<string, string>(field.Key, draftId)
                    : field)
                .ToList();
        }

        var delivery = await transport.PostFormResponseAsync(
            settings.Endpoints.BulkEmailSendPath,
            fields,
            cancellationToken);
        IntelligentGolfBulkEmailResponse.EnsureSendConfirmed(delivery.Body);
        logger.LogInformation(
            "Submitted member campaign email draft {DraftId} to {RecipientCount} selected Intelligent Golf members.",
            string.IsNullOrWhiteSpace(draftId) ? "new" : draftId,
            requestedMemberNumbers.Length);
        return new MemberCampaignEmailResult(
            requestedMemberNumbers.Length,
            requestedMemberNumbers.Length,
            draftId ?? string.Empty,
            requestedMemberNumbers);
    }

    private static void ValidateMessage(string subject, string bodyHtml)
    {
        if (string.IsNullOrWhiteSpace(subject)) throw new ArgumentException("An email subject is required.");
        if (string.IsNullOrWhiteSpace(bodyHtml)) throw new ArgumentException("An HTML email body is required.");
        if (subject.Trim().Length > 250) throw new ArgumentException("The email subject cannot exceed 250 characters.");
        if (bodyHtml.Length > 200_000) throw new ArgumentException("The HTML email body is too large.");
    }

}

internal static class IntelligentGolfBulkEmailResponse
{
    private static readonly string[] FailureTerms =
        ["error", "failed", "could not", "cannot", "no recipient"];

    public static void EnsureSendPrepared(string raw)
    {
        ThrowIfFailure(raw, "prepare");
        if (!TryParseJson(raw, out var json))
            throw new IntelligentGolfEmailDeliveryException(
                "Intelligent Golf did not return the send-confirmation step. No member email was sent.");

        using (json)
        {
            // Intelligent Golf has used several different action types for this
            // intermediate response. It may open a dialog, update the existing
            // form or simply close its progress state. The important contract is
            // that it returned a non-empty action list without a validation/error
            // action. The following `confirmsend` response remains the authoritative
            // proof that delivery was accepted.
            if (json.RootElement.TryGetProperty("actions", out var actions) &&
                actions.ValueKind == JsonValueKind.Array &&
                actions.GetArrayLength() > 0)
            {
                return;
            }
        }

        throw new IntelligentGolfEmailDeliveryException(
            "Intelligent Golf did not return the send-confirmation step. No member email was sent.");
    }

    public static string? ExtractDraftId(string raw)
    {
        foreach (var fragment in EnumerateFragments(raw))
        {
            var document = new HtmlDocument();
            document.LoadHtml(fragment);
            var value = document.DocumentNode
                .SelectSingleNode("//input[translate(@name,'ID','id')='id']")?
                .GetAttributeValue("value", string.Empty)
                .Trim();
            if (long.TryParse(value, out var draftId) && draftId > 0) return value;
        }

        if (!TryParseJson(raw, out var json)) return null;
        using (json)
        {
            foreach (var action in EnumerateActions(json.RootElement))
            {
                if (!TryGetString(action, "selector", out var selector) ||
                    !selector.Equals("#id", StringComparison.OrdinalIgnoreCase) ||
                    !TryGetString(action, "value", out var value) ||
                    !long.TryParse(value, out var draftId) || draftId <= 0)
                {
                    continue;
                }

                return value;
            }
        }

        return null;
    }

    public static void ThrowIfFailure(string raw, string stage)
    {
        if (string.IsNullOrWhiteSpace(raw))
            throw new IntelligentGolfEmailDeliveryException($"Intelligent Golf returned an empty response while attempting to {stage} the member email.");

        if (!TryParseJson(raw, out var json)) return;
        using (json)
        {
            foreach (var action in EnumerateActions(json.RootElement))
            {
                var type = TryGetString(action, "type", out var actionType) ? actionType : string.Empty;
                var message = ReadActionMessage(action);
                var isErrorAction = type.Equals("showerrors", StringComparison.OrdinalIgnoreCase) ||
                                    type.Contains("error", StringComparison.OrdinalIgnoreCase);
                var isFailureMessage = type.Equals("message", StringComparison.OrdinalIgnoreCase) &&
                                       FailureTerms.Any(term => message.Contains(term, StringComparison.OrdinalIgnoreCase));
                if (isErrorAction || isFailureMessage)
                {
                    throw new IntelligentGolfEmailDeliveryException(
                        string.IsNullOrWhiteSpace(message)
                            ? $"Intelligent Golf rejected the request while attempting to {stage} the member email."
                            : $"Intelligent Golf rejected the member email: {message}");
                }
            }
        }
    }

    public static void EnsureSendConfirmed(string raw)
    {
        ThrowIfFailure(raw, "send");
        if (!TryParseJson(raw, out var json))
            throw new IntelligentGolfEmailDeliveryException("Intelligent Golf did not confirm that the member email was sent.");

        using (json)
        {
            // `confirmsend` reports completion through Intelligent Golf's normal
            // UI action list. Depending on the page version this may redirect,
            // display a message, close the modal or replace part of the page. A
            // non-empty action list is therefore the success contract once the
            // failure actions above have been rejected.
            if (json.RootElement.TryGetProperty("actions", out var actions) &&
                actions.ValueKind == JsonValueKind.Array &&
                actions.GetArrayLength() > 0)
            {
                return;
            }
        }

        throw new IntelligentGolfEmailDeliveryException("Intelligent Golf did not confirm that the member email was sent.");
    }

    private static IEnumerable<string> EnumerateFragments(string raw)
    {
        yield return raw;
        if (!TryParseJson(raw, out var json)) yield break;
        using (json)
        {
            foreach (var action in EnumerateActions(json.RootElement))
            {
                foreach (var property in new[] { "html", "data" })
                {
                    if (TryGetString(action, property, out var value) && !string.IsNullOrWhiteSpace(value))
                        yield return value;
                }
            }
        }
    }

    private static IEnumerable<JsonElement> EnumerateActions(JsonElement root)
    {
        if (!root.TryGetProperty("actions", out var actions) || actions.ValueKind != JsonValueKind.Array) yield break;
        foreach (var action in actions.EnumerateArray())
            if (action.ValueKind == JsonValueKind.Object) yield return action;
    }

    private static string ReadActionMessage(JsonElement action)
    {
        var values = new List<string>();
        foreach (var property in new[] { "message", "detail", "data", "text", "shortmessage" })
        {
            if (TryGetString(action, property, out var value) && !string.IsNullOrWhiteSpace(value))
            {
                var document = new HtmlDocument();
                document.LoadHtml(value);
                var decoded = System.Net.WebUtility.HtmlDecode(document.DocumentNode.InnerText).Trim();
                if (!string.IsNullOrWhiteSpace(decoded)) values.Add(decoded);
            }
        }

        if (action.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Array)
        {
            foreach (var error in errors.EnumerateArray())
            {
                if (error.ValueKind != JsonValueKind.Object) continue;
                foreach (var property in new[] { "message", "detail", "text", "error" })
                {
                    if (TryGetString(error, property, out var value) && !string.IsNullOrWhiteSpace(value))
                        values.Add(System.Net.WebUtility.HtmlDecode(value).Trim());
                }
            }
        }
        return string.Join(" ", values);
    }

    private static bool TryGetString(JsonElement element, string name, out string value)
    {
        value = string.Empty;
        if (!element.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String) return false;
        value = property.GetString() ?? string.Empty;
        return true;
    }

    private static bool TryParseJson(string raw, out JsonDocument document)
    {
        try
        {
            document = JsonDocument.Parse(raw);
            return document.RootElement.ValueKind == JsonValueKind.Object;
        }
        catch (JsonException)
        {
            document = null!;
            return false;
        }
    }
}

public sealed class IntelligentGolfEmailDeliveryException(string message)
    : InvalidOperationException(message);

public static class MemberCampaignEmailEndpoints
{
    public static IEndpointRouteBuilder MapMemberCampaignEmailEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost(
                "/api/members/emails/campaign",
                async (SendMemberCampaignEmailRequest request, IMediator mediator, CancellationToken cancellationToken) =>
                    Results.Ok(await mediator.Send(
                        new SendMemberCampaignEmailCommand(request.MemberNumbers, request.Subject, request.BodyHtml),
                        cancellationToken)))
            .WithName("SendMemberCampaignEmail")
            .WithTags("Member communications")
            .WithSummary("Send one campaign email to selected active members")
            .Produces<MemberCampaignEmailResult>();

        return endpoints;
    }
}
