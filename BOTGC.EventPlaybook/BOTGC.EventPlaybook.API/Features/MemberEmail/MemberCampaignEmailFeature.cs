using BOTGC.EventPlaybook.API.Features.Members;
using MediatR;

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

        var activeMembers = await mediator.Send(new GetMembersQuery(false), cancellationToken);
        var membersByNumber = activeMembers.ToDictionary(member => member.MemberNumber);
        var missing = requestedMemberNumbers.Where(number => !membersByNumber.ContainsKey(number)).ToArray();
        if (missing.Length > 0)
        {
            throw new ArgumentException($"{missing.Length} selected member(s) are no longer active. Refresh the audience and try again.");
        }

        // Use the same proven /member.php email flow as BOTGC.API and the existing
        // Playbook test-email endpoint. The bulk-composer screen is a stateful UI,
        // not an API; driving its send/confirm actions directly produced HTTP-200
        // validation responses that were incorrectly reported as deliveries.
        var recipientEmails = MemberCampaignEmailRecipients.Resolve(requestedMemberNumbers, membersByNumber);
        var delivery = await mediator.Send(
            new SendMemberEmailsCommand(recipientEmails, request.Subject.Trim(), bodyHtml),
            cancellationToken);
        if (delivery.Sent != delivery.Requested)
        {
            throw new IntelligentGolfEmailDeliveryException(
                $"Intelligent Golf accepted {delivery.Sent} of {delivery.Requested} attendee email requests. The Playbook has not marked the feedback email as fully sent.");
        }

        logger.LogInformation(
            "Sent attendee feedback email through the established Intelligent Golf member-email endpoint to {RecipientCount} address(es).",
            delivery.Sent);
        return new MemberCampaignEmailResult(
            delivery.Requested,
            delivery.Sent,
            string.Empty,
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

internal static class MemberCampaignEmailRecipients
{
    public static string[] Resolve(
        IReadOnlyCollection<int> memberNumbers,
        IReadOnlyDictionary<int, MemberSummary> membersByNumber)
    {
        var withoutEmail = memberNumbers
            .Where(number => string.IsNullOrWhiteSpace(membersByNumber[number].Email))
            .ToArray();
        if (withoutEmail.Length > 0)
        {
            throw new InvalidOperationException(
                $"Intelligent Golf did not return an email address for {withoutEmail.Length} selected member(s). Refresh the member directory and try again.");
        }

        return memberNumbers
            .Select(number => membersByNumber[number].Email!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
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
            .WithSummary("Send an email to selected active members through the established member-email flow")
            .Produces<MemberCampaignEmailResult>();

        return endpoints;
    }
}
