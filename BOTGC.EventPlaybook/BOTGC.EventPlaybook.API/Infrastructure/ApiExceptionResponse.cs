using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using Microsoft.AspNetCore.Diagnostics;

namespace BOTGC.EventPlaybook.API.Infrastructure;

public static class ApiExceptionResponse
{
    public static async Task WriteAsync(HttpContext context)
    {
        var exception = context.Features.Get<IExceptionHandlerFeature>()?.Error;

        var (status, title) = exception switch
        {
            IntelligentGolfEmailSenderNotConfiguredException sender =>
                (StatusCodes.Status501NotImplemented, sender.Message),
            IntelligentGolfFeatureNotConfiguredException feature =>
                (StatusCodes.Status501NotImplemented, feature.Message),
            IntelligentGolfAuthenticationException =>
                (StatusCodes.Status503ServiceUnavailable, "The Intelligent Golf session is unavailable."),
            IntelligentGolfMutationException mutationException =>
                (StatusCodes.Status502BadGateway, mutationException.Message),
            HttpRequestException =>
                (StatusCodes.Status502BadGateway, "Intelligent Golf returned an unsuccessful response."),
            TimeoutException =>
                (StatusCodes.Status503ServiceUnavailable, "The Intelligent Golf report is currently busy."),
            ArgumentException argument =>
                (StatusCodes.Status400BadRequest, argument.Message),
            _ =>
                (StatusCodes.Status500InternalServerError, "An unexpected error occurred.")
        };

        var mutation = exception as IntelligentGolfMutationException;
        var extensions = mutation is null
            ? null
            : new Dictionary<string, object?>
            {
                ["stage"] = mutation.Stage,
                ["intelligentGolfEventId"] = mutation.IntelligentGolfEventId,
                ["retryable"] = true
            };

        await Results.Problem(
                statusCode: status,
                title: title,
                detail: mutation?.ResponseDetail,
                extensions: extensions)
            .ExecuteAsync(context);
    }
}
