using System.Security.Cryptography;
using System.Text;
using BOTGC.EventPlaybook.API.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.API.Infrastructure;

public sealed class ApiKeyMiddleware(
    RequestDelegate next,
    IOptions<EventPlaybookApiOptions> options,
    IHostEnvironment environment,
    ILogger<ApiKeyMiddleware> logger)
{
    public const string HeaderName = "X-Api-Key";

    public async Task InvokeAsync(HttpContext context)
    {
        if (IsOperationalPath(context.Request.Path))
        {
            await next(context);
            return;
        }

        if (string.IsNullOrWhiteSpace(options.Value.ApiKey))
        {
            if (environment.IsDevelopment())
            {
                await next(context);
                return;
            }

            logger.LogError("The event-planner API key is not configured.");
            await Results.Problem(
                    statusCode: StatusCodes.Status503ServiceUnavailable,
                    title: "The event-planner API key is not configured.")
                .ExecuteAsync(context);
            return;
        }

        var suppliedKey = context.Request.Headers[HeaderName].ToString();
        if (!KeysMatch(suppliedKey, options.Value.ApiKey))
        {
            logger.LogWarning("Rejected an event-planner API request with a missing or invalid API key.");
            await Results.Problem(
                    statusCode: StatusCodes.Status401Unauthorized,
                    title: "A valid event-planner API key is required.")
                .ExecuteAsync(context);
            return;
        }

        await next(context);
    }

    private static bool IsOperationalPath(PathString path) =>
        path.StartsWithSegments("/health") ||
        path.StartsWithSegments("/swagger");

    private static bool KeysMatch(string supplied, string configured)
    {
        var suppliedBytes = Encoding.UTF8.GetBytes(supplied);
        var configuredBytes = Encoding.UTF8.GetBytes(configured);
        return suppliedBytes.Length == configuredBytes.Length &&
               CryptographicOperations.FixedTimeEquals(suppliedBytes, configuredBytes);
    }
}
