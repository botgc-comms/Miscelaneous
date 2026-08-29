using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using BOTGC.EventPlaybook.API.Options;
using MediatR;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.API.Features.MemberEmail;

public sealed record SendMemberEmailsRequest(
    IReadOnlyCollection<string> RecipientEmails,
    string Subject,
    string BodyHtml);

public sealed record MemberEmailDelivery(string RecipientEmail, bool Sent, string? Error);

public sealed record SendMemberEmailsResult(IReadOnlyList<MemberEmailDelivery> Deliveries)
{
    public int Requested => Deliveries.Count;
    public int Sent => Deliveries.Count(delivery => delivery.Sent);
}

public sealed record SendMemberEmailsCommand(
    IReadOnlyCollection<string> RecipientEmails,
    string Subject,
    string BodyHtml) : IRequest<SendMemberEmailsResult>;

public sealed class SendMemberEmailsHandler(
    IOptions<IntelligentGolfOptions> options,
    IIntelligentGolfTransport transport,
    ILogger<SendMemberEmailsHandler> logger)
    : IRequestHandler<SendMemberEmailsCommand, SendMemberEmailsResult>
{
    public async Task<SendMemberEmailsResult> Handle(
        SendMemberEmailsCommand request,
        CancellationToken cancellationToken)
    {
        if (request.RecipientEmails is null || request.RecipientEmails.Count == 0)
        {
            throw new ArgumentException("At least one recipient email address is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Subject))
        {
            throw new ArgumentException("An email subject is required.");
        }

        if (string.IsNullOrWhiteSpace(request.BodyHtml))
        {
            throw new ArgumentException("An HTML email body is required.");
        }

        var settings = options.Value;
        if (settings.EmailSenderMemberNumber <= 0 ||
            string.IsNullOrWhiteSpace(settings.EmailFromName) ||
            string.IsNullOrWhiteSpace(settings.EmailFromAddress))
        {
            throw new IntelligentGolfFeatureNotConfiguredException("email sender");
        }

        var pathTemplate = settings.Endpoints.SendEmailPathTemplate;
        if (string.IsNullOrWhiteSpace(pathTemplate))
        {
            throw new IntelligentGolfFeatureNotConfiguredException("member email");
        }

        var path = pathTemplate.Replace(
            "{senderMemberNumber}",
            settings.EmailSenderMemberNumber.ToString(),
            StringComparison.OrdinalIgnoreCase);

        var recipients = request.RecipientEmails
            .Where(email => !string.IsNullOrWhiteSpace(email))
            .Select(email => email.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (recipients.Count == 0)
        {
            throw new ArgumentException("At least one non-empty recipient email address is required.");
        }

        var deliveries = new List<MemberEmailDelivery>();
        foreach (var recipient in recipients)
        {
            try
            {
                await transport.PostFormAsync(
                    path,
                    new Dictionary<string, string>
                    {
                        ["email_subject"] = request.Subject,
                        ["email_fromname"] = settings.EmailFromName,
                        ["email_fromaddress"] = settings.EmailFromAddress,
                        ["recipient"] = recipient,
                        ["email_content"] = request.BodyHtml,
                        ["email_preview_to"] = recipient
                    },
                    cancellationToken);

                deliveries.Add(new MemberEmailDelivery(recipient, true, null));
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogError(exception, "Failed to send an Intelligent Golf email to {Recipient}.", recipient);
                deliveries.Add(new MemberEmailDelivery(
                    recipient,
                    false,
                    "Intelligent Golf did not accept the email request."));
            }
        }

        return new SendMemberEmailsResult(deliveries);
    }
}

public static class MemberEmailEndpoints
{
    public static IEndpointRouteBuilder MapMemberEmailEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost(
                "/api/members/emails",
                async (
                    SendMemberEmailsRequest request,
                    IMediator mediator,
                    CancellationToken cancellationToken) =>
                {
                    var result = await mediator.Send(
                        new SendMemberEmailsCommand(
                            request.RecipientEmails,
                            request.Subject,
                            request.BodyHtml),
                        cancellationToken);

                    return result.Sent == result.Requested
                        ? Results.Ok(result)
                        : Results.Json(result, statusCode: StatusCodes.Status502BadGateway);
                })
            .WithName("SendMemberEmails")
            .WithTags("Members")
            .Produces<SendMemberEmailsResult>()
            .Produces<SendMemberEmailsResult>(StatusCodes.Status502BadGateway);

        return endpoints;
    }
}
