using System.Text.RegularExpressions;
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
            string.IsNullOrWhiteSpace(settings.Endpoints.BulkEmailComposerPath) ||
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

        var composer = await transport.GetDocumentAsync(settings.Endpoints.BulkEmailComposerPath, cancellationToken);
        var draftId = ExtractDraftId(composer)
            ?? throw new InvalidOperationException("Intelligent Golf did not provide an email draft ID. No member email was sent.");

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
            new("id", draftId),
            new("email_subject", request.Subject.Trim()),
            new("email_fromname", sender.FromName.Trim()),
            new("email_fromaddress", sender.FromAddress.Trim()),
            new("template", "0"),
            new("headerandfooter", "useemail"),
            new("email_content", bodyHtml)
        ]);

        await transport.PostFormAsync(settings.Endpoints.BulkEmailSendPath, fields, cancellationToken);
        logger.LogInformation(
            "Submitted member campaign email draft {DraftId} to {RecipientCount} selected Intelligent Golf members.",
            draftId,
            requestedMemberNumbers.Length);
        return new MemberCampaignEmailResult(
            requestedMemberNumbers.Length,
            requestedMemberNumbers.Length,
            draftId,
            requestedMemberNumbers);
    }

    private static void ValidateMessage(string subject, string bodyHtml)
    {
        if (string.IsNullOrWhiteSpace(subject)) throw new ArgumentException("An email subject is required.");
        if (string.IsNullOrWhiteSpace(bodyHtml)) throw new ArgumentException("An HTML email body is required.");
        if (subject.Trim().Length > 250) throw new ArgumentException("The email subject cannot exceed 250 characters.");
        if (bodyHtml.Length > 200_000) throw new ArgumentException("The HTML email body is too large.");
    }

    private static string? ExtractDraftId(HtmlDocument document)
    {
        var value = document.DocumentNode
            .SelectSingleNode("//input[@name='id']")?
            .GetAttributeValue("value", string.Empty)
            .Trim();
        if (!string.IsNullOrWhiteSpace(value) && long.TryParse(value, out _)) return value;

        var match = Regex.Match(
            document.DocumentNode.OuterHtml,
            @"(?:name=[""']id[""'][^>]*value|\bid\s*[:=])\s*=?\s*[""']?(\d+)",
            RegexOptions.IgnoreCase);
        return match.Success ? match.Groups[1].Value : null;
    }
}

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
