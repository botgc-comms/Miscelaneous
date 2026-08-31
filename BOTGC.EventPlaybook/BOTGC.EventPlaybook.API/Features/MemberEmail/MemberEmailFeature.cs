using System.Text.RegularExpressions;
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
    IIntelligentGolfSession session,
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

        var bodyHtml = MemberEmailHtmlSanitizer.Sanitise(request.BodyHtml);
        if (string.IsNullOrWhiteSpace(bodyHtml))
        {
            throw new ArgumentException("An HTML email body is required.");
        }

        var settings = options.Value;
        var senderMemberNumber = settings.EmailSenderMemberNumber > 0
            ? settings.EmailSenderMemberNumber
            : int.TryParse(session.MemberId, out var authenticatedMemberNumber)
                ? authenticatedMemberNumber
                : 0;
        if (senderMemberNumber <= 0 ||
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
            senderMemberNumber.ToString(),
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
                        ["email_content"] = bodyHtml,
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

public static class MemberEmailHtmlSanitizer
{
    public static string Sanitise(string? html)
    {
        if (string.IsNullOrWhiteSpace(html)) return string.Empty;
        var value = Regex.Replace(
            html,
            @"<(script|iframe|object|embed|form)\b[^>]*>.*?</\1\s*>",
            string.Empty,
            RegexOptions.IgnoreCase | RegexOptions.Singleline);
        value = Regex.Replace(
            value,
            @"\s+on[a-z]+\s*=\s*([""']).*?\1",
            string.Empty,
            RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return Regex.Replace(value, @"javascript\s*:", string.Empty, RegexOptions.IgnoreCase).Trim();
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

        endpoints.MapPost(
                "/api/members/emails/test",
                async (
                    SendMemberEmailsRequest request,
                    IMediator mediator,
                    CancellationToken cancellationToken) =>
                {
                    if (request.RecipientEmails?.Count != 1)
                    {
                        return Results.BadRequest(new { error = "Supply exactly one address for a test email." });
                    }

                    var result = await mediator.Send(
                        new SendMemberEmailsCommand(request.RecipientEmails, request.Subject, request.BodyHtml),
                        cancellationToken);
                    return result.Sent == 1
                        ? Results.Ok(result)
                        : Results.Json(result, statusCode: StatusCodes.Status502BadGateway);
                })
            .WithName("SendMemberEmailTest")
            .WithTags("Member communications")
            .WithSummary("Send a test copy of a member campaign email")
            .Produces<SendMemberEmailsResult>();

        return endpoints;
    }
}
