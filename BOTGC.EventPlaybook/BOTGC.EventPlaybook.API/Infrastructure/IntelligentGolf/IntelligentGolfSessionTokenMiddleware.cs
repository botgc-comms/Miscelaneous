namespace BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;

public sealed class IntelligentGolfSessionTokenMiddleware(
    RequestDelegate next,
    IIntelligentGolfSession session,
    ILogger<IntelligentGolfSessionTokenMiddleware> logger)
{
    public const string HeaderName = "X-Intelligent-Golf-Session";

    public async Task InvokeAsync(HttpContext context)
    {
        if (IsUnprotectedPath(context.Request.Path))
        {
            await next(context);
            return;
        }

        var token = context.Request.Headers[HeaderName].ToString();
        if (!session.IsSessionTokenValid(token))
        {
            logger.LogWarning("Rejected an Intelligent Golf API request without a valid Playbook session token.");
            await Results.Problem(
                    statusCode: StatusCodes.Status401Unauthorized,
                    title: "A valid Intelligent Golf session is required.")
                .ExecuteAsync(context);
            return;
        }

        await next(context);
    }

    private static bool IsUnprotectedPath(PathString path) =>
        path.StartsWithSegments("/health") ||
        path.StartsWithSegments("/swagger") ||
        path.StartsWithSegments("/v1/auth/intelligent-golf/session");
}
