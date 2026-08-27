using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 150L * 1024L * 1024L;
});
builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(options =>
{
    options.SingleLine = true;
    options.TimestampFormat = "yyyy-MM-dd HH:mm:ss ";
});

const string defaultImageModel = "gpt-image-2";
const string defaultPromptModel = "gpt-5.6";

var openAiApiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")?.Trim() ?? string.Empty;
var openAiImageModel = Environment.GetEnvironmentVariable("OPENAI_IMAGE_MODEL")?.Trim();
var openAiImageQuality = Environment.GetEnvironmentVariable("OPENAI_IMAGE_QUALITY")?.Trim();
var openAiPromptModel = Environment.GetEnvironmentVariable("OPENAI_PROMPT_MODEL")?.Trim();
var yodeckApiToken = Environment.GetEnvironmentVariable("YODECK_API_TOKEN")?.Trim() ?? string.Empty;
var yodeckApiTokenLabel = Environment.GetEnvironmentVariable("YODECK_API_TOKEN_LABEL")?.Trim();
var yodeckApiBaseUrl = Environment.GetEnvironmentVariable("YODECK_API_BASE_URL")?.Trim();
var yodeckPlaylistName = Environment.GetEnvironmentVariable("YODECK_PLAYLIST_NAME")?.Trim();
var yodeckPlaylistId = long.TryParse(
    Environment.GetEnvironmentVariable("YODECK_PLAYLIST_ID"),
    out var configuredYodeckPlaylistId)
        ? configuredYodeckPlaylistId
        : 0;
var yodeckMediaDuration = int.TryParse(
    Environment.GetEnvironmentVariable("YODECK_MEDIA_DURATION_SECONDS"),
    out var configuredYodeckMediaDuration)
        ? Math.Clamp(configuredYodeckMediaDuration, 5, 300)
        : 15;
var demoPassword = Environment.GetEnvironmentVariable("DEMO_PASSWORD") ?? string.Empty;
const string demoCookieScheme = "BOTGC.EventPlaybook.Demo";
var dataProtectionDirectory = Path.Combine(builder.Environment.ContentRootPath, "App_Data", "DataProtection-Keys");
Directory.CreateDirectory(dataProtectionDirectory);

var effectiveImageModel = string.IsNullOrWhiteSpace(openAiImageModel)
    ? defaultImageModel
    : openAiImageModel;

var effectiveImageQuality = string.IsNullOrWhiteSpace(openAiImageQuality)
    ? "high"
    : openAiImageQuality;

var effectivePromptModel = string.IsNullOrWhiteSpace(openAiPromptModel)
    ? defaultPromptModel
    : openAiPromptModel;

builder.Services.Configure<OpenAiOptions>(options =>
{
    options.ApiKey = openAiApiKey;
    options.ImageModel = effectiveImageModel;
    options.ImageQuality = effectiveImageQuality;
    options.PromptModel = effectivePromptModel;
});
builder.Services.Configure<YodeckOptions>(options =>
{
    options.ApiToken = yodeckApiToken;
    options.ApiTokenLabel = string.IsNullOrWhiteSpace(yodeckApiTokenLabel)
        ? "event-playbook"
        : yodeckApiTokenLabel;
    options.ApiBaseUrl = string.IsNullOrWhiteSpace(yodeckApiBaseUrl)
        ? "https://app.yodeck.com/api/v2/"
        : yodeckApiBaseUrl.TrimEnd('/') + "/";
    options.PlaylistId = yodeckPlaylistId;
    options.PlaylistName = string.IsNullOrWhiteSpace(yodeckPlaylistName)
        ? "Clubhouse"
        : yodeckPlaylistName;
    options.MediaDurationSeconds = yodeckMediaDuration;
});
builder.Services.AddSingleton<IPosterConfigurationService, PosterConfigurationService>();
builder.Services.AddHttpClient("OpenAI", client =>
{
    client.BaseAddress = new Uri("https://api.openai.com/v1/");
    client.Timeout = TimeSpan.FromMinutes(5);
});
builder.Services.AddSingleton<IImagePromptService, OpenAiPromptService>();
builder.Services.AddSingleton<IOpenAiImageService, OpenAiImageService>();
builder.Services.AddHttpClient("Yodeck", client =>
{
    client.BaseAddress = new Uri(string.IsNullOrWhiteSpace(yodeckApiBaseUrl)
        ? "https://app.yodeck.com/api/v2/"
        : yodeckApiBaseUrl.TrimEnd('/') + "/");
    client.Timeout = TimeSpan.FromMinutes(3);
});
builder.Services.AddSingleton<IYodeckPublisher, YodeckPublisher>();
builder.Services.AddSingleton<ITaskCompletionRegistry, TaskCompletionRegistry>();
builder.Services.AddSingleton<PrototypePersistenceStore>();
builder.Services.AddSingleton<ISharedPlaybookStateStore>(services => services.GetRequiredService<PrototypePersistenceStore>());
builder.Services.AddSingleton<IPosterSessionStore>(services => services.GetRequiredService<PrototypePersistenceStore>());
builder.Services
    .AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionDirectory));
builder.Services
    .AddAuthentication(demoCookieScheme)
    .AddCookie(demoCookieScheme, options =>
    {
        options.Cookie.Name = "BOTGC.EventPlaybook.DemoAccess";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.ExpireTimeSpan = TimeSpan.FromHours(12);
        options.SlidingExpiration = true;
    });

var app = builder.Build();

app.Logger.LogInformation(
    "Poster Studio configured. API key: {ApiKeyStatus}; image model: {ImageModel}; image quality: {ImageQuality}; prompt model: {PromptModel}; Yodeck: {YodeckStatus}; demo access: {DemoAccessStatus}",
    string.IsNullOrWhiteSpace(openAiApiKey) ? "not configured - mock mode" : "OPENAI_API_KEY",
    effectiveImageModel,
    effectiveImageQuality,
    effectivePromptModel,
    !string.IsNullOrWhiteSpace(yodeckApiToken) && yodeckPlaylistId > 0
        ? $"playlist {yodeckPlaylistId}"
        : "not configured",
    string.IsNullOrWhiteSpace(demoPassword) ? "disabled" : "password protected");

app.UseAuthentication();

if (!string.IsNullOrWhiteSpace(demoPassword))
{
    app.Use(async (context, next) =>
    {
        var path = context.Request.Path;
        var isPublicPath = path.StartsWithSegments("/demo-login.html") ||
                           path.StartsWithSegments("/auth/login") ||
                           path.StartsWithSegments("/health");

        if (isPublicPath || context.User.Identity?.IsAuthenticated == true)
        {
            await next();
            return;
        }

        if (path.StartsWithSegments("/api"))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new { error = "Demo access authentication is required." });
            return;
        }

        var requestedUrl = $"{context.Request.PathBase}{context.Request.Path}{context.Request.QueryString}";
        context.Response.Redirect($"/demo-login.html?returnUrl={Uri.EscapeDataString(requestedUrl)}");
    });
}

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapPost("/auth/login", async (HttpContext context, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(demoPassword))
    {
        return Results.NotFound();
    }

    var form = await context.Request.ReadFormAsync(cancellationToken);
    var returnUrl = NormaliseLocalReturnUrl(form["returnUrl"].ToString());

    if (!PasswordMatches(form["password"].ToString(), demoPassword))
    {
        var failureUrl = $"/demo-login.html?error=1&returnUrl={Uri.EscapeDataString(returnUrl)}";
        return Results.Redirect(failureUrl);
    }

    var identity = new ClaimsIdentity(
        [new Claim(ClaimTypes.Name, "Development tester")],
        demoCookieScheme);
    var principal = new ClaimsPrincipal(identity);
    await context.SignInAsync(
        demoCookieScheme,
        principal,
        new AuthenticationProperties
        {
            IsPersistent = true,
            ExpiresUtc = DateTimeOffset.UtcNow.AddHours(12)
        });

    return Results.Redirect(returnUrl);
});

app.MapPost("/auth/logout", async (HttpContext context) =>
{
    await context.SignOutAsync(demoCookieScheme);
    return Results.Redirect("/demo-login.html");
});

app.MapGet("/api/poster/config", (
    IPosterConfigurationService configurationService,
    IYodeckPublisher yodeckPublisher) =>
{
    var configurationModel = configurationService.Get();
    var hasApiKey = !string.IsNullOrWhiteSpace(openAiApiKey);

    return Results.Ok(new
    {
        brand = configurationModel.Brand,
        events = configurationModel.Events,
        styles = configurationModel.Styles.Select(x => new
        {
            x.Id,
            x.Name,
            x.Summary,
            variations = x.Variations.Select(variation => new
            {
                variation.Id
            })
        }),
        outputs = configurationModel.Outputs,
        generationMode = hasApiKey ? "openai" : "mock",
        imageModel = effectiveImageModel,
        imageQuality = effectiveImageQuality,
        promptModel = effectivePromptModel,
        apiKeySource = hasApiKey ? "OPENAI_API_KEY" : "not configured",
        clubhouseScreens = new
        {
            configured = yodeckPublisher.IsConfigured,
            destinationName = string.IsNullOrWhiteSpace(yodeckPlaylistName) ? "Clubhouse screens" : yodeckPlaylistName,
            mediaDurationSeconds = yodeckMediaDuration
        }
    });
});

app.MapGet("/api/shared-state", async (
    ISharedPlaybookStateStore store,
    CancellationToken cancellationToken) =>
{
    return Results.Ok(await store.GetAsync(cancellationToken));
});

app.MapPut("/api/shared-state", async (
    SaveSharedPlaybookStateRequest request,
    ISharedPlaybookStateStore store,
    CancellationToken cancellationToken) =>
{
    if (request.State.ValueKind != System.Text.Json.JsonValueKind.Object)
    {
        return Results.BadRequest(new { error = "Shared state must be a JSON object." });
    }

    var result = await store.SaveAsync(request, cancellationToken);
    return result.Conflict ? Results.Conflict(result.Document) : Results.Ok(result.Document);
});

app.MapGet("/api/poster/session", async (
    string key,
    IPosterSessionStore store,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(key)) return Results.BadRequest(new { error = "A session key is required." });
    var document = await store.GetAsync(key.Trim(), cancellationToken);
    return document is null ? Results.NotFound() : Results.Ok(document);
});

app.MapPut("/api/poster/session", async (
    string key,
    SavePosterSessionRequest request,
    IPosterSessionStore store,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(key)) return Results.BadRequest(new { error = "A session key is required." });
    if (request.Session.ValueKind != System.Text.Json.JsonValueKind.Object)
    {
        return Results.BadRequest(new { error = "Poster session must be a JSON object." });
    }

    return Results.Ok(await store.SaveAsync(key.Trim(), request.Session, cancellationToken));
});

app.MapPost("/api/poster/generate-primary", async (
    GeneratePosterRequest request,
    IOpenAiImageService imageService,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.EventId) ||
        string.IsNullOrWhiteSpace(request.StyleId) ||
        string.IsNullOrWhiteSpace(request.Description))
    {
        return Results.BadRequest(new { error = "Event, style and description are required." });
    }

    try
    {
        var result = await imageService.GeneratePrimaryAsync(request, cancellationToken);
        return Results.Ok(result);
    }
    catch (KeyNotFoundException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (OpenAiImageException exception)
    {
        return Results.Json(new
        {
            error = exception.Message,
            retryable = exception.Retryable,
            requestId = exception.RequestId,
            code = exception.ErrorCode
        }, statusCode: StatusCodes.Status502BadGateway);
    }
    catch (InvalidOperationException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/api/poster/generate-variant", async (
    GenerateVariantRequest request,
    IOpenAiImageService imageService,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.OutputId) || string.IsNullOrWhiteSpace(request.PrimaryArtworkDataUrl))
    {
        return Results.BadRequest(new { error = "Output format and primary artwork are required." });
    }

    try
    {
        var result = await imageService.GenerateVariantAsync(request, cancellationToken);
        return Results.Ok(result);
    }
    catch (KeyNotFoundException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (OpenAiImageException exception)
    {
        return Results.Json(new
        {
            error = exception.Message,
            retryable = exception.Retryable,
            requestId = exception.RequestId,
            code = exception.ErrorCode
        }, statusCode: StatusCodes.Status502BadGateway);
    }
    catch (InvalidOperationException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/api/poster/publish", async (
    PublishRequest request,
    IYodeckPublisher yodeckPublisher,
    CancellationToken cancellationToken) =>
{
    if (!request.SendToClubhouseScreens)
    {
        return Results.BadRequest(new { error = "Choose the clubhouse screens before sharing." });
    }

    if (!DateOnly.TryParseExact(request.EventDate, "yyyy-MM-dd", out var eventDate) ||
        !DateOnly.TryParseExact(request.StartDate, "yyyy-MM-dd", out var startDate))
    {
        return Results.BadRequest(new { error = "A valid start date and event date are required." });
    }

    if (startDate > eventDate)
    {
        return Results.BadRequest(new { error = "The poster start date cannot be after the event date." });
    }

    if (string.IsNullOrWhiteSpace(request.EventId) ||
        string.IsNullOrWhiteSpace(request.EventName) ||
        string.IsNullOrWhiteSpace(request.MediaName) ||
        request.DigitalScreenAsset is null)
    {
        return Results.BadRequest(new { error = "Event, media name and digital-screen artwork are required." });
    }

    if (!string.Equals(request.DigitalScreenAsset.OutputId, "clubhouse", StringComparison.OrdinalIgnoreCase))
    {
        return Results.BadRequest(new { error = "The Clubhouse Digital Display artwork must be used for clubhouse screen sharing." });
    }

    if (!TryDecodePngDataUrl(request.DigitalScreenAsset.DataUrl, out var imageBytes, out var imageError))
    {
        return Results.BadRequest(new { error = imageError });
    }

    var tags = request.Tags
        .Select(tag => tag.Trim())
        .Where(tag => !string.IsNullOrWhiteSpace(tag))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .Take(20)
        .ToList();

    if (!tags.Contains("event-playbook", StringComparer.OrdinalIgnoreCase))
    {
        tags.Insert(0, "event-playbook");
    }

    try
    {
        var published = await yodeckPublisher.PublishAsync(new YodeckPublishCommand
        {
            EventId = request.EventId.Trim(),
            EventName = request.EventName.Trim(),
            StartDate = startDate,
            EndDate = eventDate,
            MediaName = request.MediaName.Trim(),
            Tags = tags,
            ImageBytes = imageBytes
        }, cancellationToken);

        return Results.Ok(new
        {
            success = true,
            eventName = request.EventName,
            assets = 1,
            clubhouseScreens = new
            {
                artworkId = published.MediaId,
                artworkName = published.MediaName,
                destinationName = published.PlaylistName,
                startDate = published.StartDate.ToString("yyyy-MM-dd"),
                endDate = published.EndDate.ToString("yyyy-MM-dd"),
                operation = published.MediaWasCreated ? "created" : "updated",
                playlistChanged = published.PlaylistWasChanged,
                duplicatePlaylistEntriesRemoved = published.DuplicatePlaylistEntriesRemoved,
                published.Tags
            }
        });
    }
    catch (InvalidOperationException exception)
    {
        return Results.Problem(
            exception.Message,
            statusCode: yodeckPublisher.IsConfigured
                ? StatusCodes.Status502BadGateway
                : StatusCodes.Status503ServiceUnavailable);
    }
});


app.MapGet("/api/playbook/config", (IWebHostEnvironment environment) =>
{
    var path = Path.Combine(environment.ContentRootPath, "Data", "event-playbook.json");
    return Results.Text(File.ReadAllText(path), "application/json");
});

app.MapPost("/api/tasks/notifications", async (System.Text.Json.JsonElement payload, IWebHostEnvironment environment, CancellationToken cancellationToken) =>
{
    var outboxDirectory = Path.Combine(environment.ContentRootPath, "App_Data");
    Directory.CreateDirectory(outboxDirectory);
    var outboxPath = Path.Combine(outboxDirectory, "notification-outbox.jsonl");
    var entry = System.Text.Json.JsonSerializer.Serialize(new
    {
        recordedAtUtc = DateTimeOffset.UtcNow,
        payload
    });
    await File.AppendAllTextAsync(outboxPath, entry + Environment.NewLine, cancellationToken);

    return Results.Ok(new
    {
        accepted = true,
        deliveryMode = "development-outbox",
        message = "Notifications were written to the development outbox. Replace this endpoint with the Club email and/or Monday publisher when those integrations are configured."
    });
});


app.MapPost("/api/tasks/completion-links", async (
    RegisterCompletionLinkRequest request,
    ITaskCompletionRegistry registry,
    CancellationToken cancellationToken) =>
{
    var record = await registry.RegisterAsync(request, cancellationToken);
    return Results.Ok(record);
});

app.MapGet("/api/tasks/completion-links/{token}", async (
    string token,
    ITaskCompletionRegistry registry,
    CancellationToken cancellationToken) =>
{
    var record = await registry.GetAsync(token, cancellationToken);
    return record is null ? Results.NotFound() : Results.Ok(record);
});

app.MapPost("/api/tasks/completion-links/{token}/complete", async (
    string token,
    CompleteTaskRequest request,
    ITaskCompletionRegistry registry,
    CancellationToken cancellationToken) =>
{
    var record = await registry.CompleteAsync(token, request.Notes, cancellationToken);
    return record is null ? Results.NotFound() : Results.Ok(record);
});

app.MapGet("/api/tasks/events/{eventId}/completions", async (
    string eventId,
    ITaskCompletionRegistry registry,
    CancellationToken cancellationToken) =>
{
    var records = await registry.GetCompletedForEventAsync(eventId, cancellationToken);
    return Results.Ok(records);
});

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();

static bool PasswordMatches(string suppliedPassword, string configuredPassword)
{
    var suppliedHash = SHA256.HashData(Encoding.UTF8.GetBytes(suppliedPassword));
    var configuredHash = SHA256.HashData(Encoding.UTF8.GetBytes(configuredPassword));
    return CryptographicOperations.FixedTimeEquals(suppliedHash, configuredHash);
}

static bool TryDecodePngDataUrl(string? dataUrl, out byte[] imageBytes, out string error)
{
    imageBytes = [];
    error = string.Empty;

    const string prefix = "data:image/png;base64,";
    if (string.IsNullOrWhiteSpace(dataUrl) || !dataUrl.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
    {
        error = "The digital-screen artwork must be supplied as a PNG image.";
        return false;
    }

    try
    {
        imageBytes = Convert.FromBase64String(dataUrl[prefix.Length..]);
    }
    catch (FormatException)
    {
        error = "The digital-screen artwork contains invalid image data.";
        return false;
    }

    if (imageBytes.Length == 0 || imageBytes.Length > 40 * 1024 * 1024)
    {
        error = "The digital-screen artwork is empty or larger than the 40 MB upload limit.";
        return false;
    }

    ReadOnlySpan<byte> pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (imageBytes.Length < pngSignature.Length || !imageBytes.AsSpan(0, pngSignature.Length).SequenceEqual(pngSignature))
    {
        error = "The digital-screen artwork is not a valid PNG image.";
        return false;
    }

    return true;
}

static string NormaliseLocalReturnUrl(string? returnUrl)
{
    if (string.IsNullOrWhiteSpace(returnUrl) ||
        !returnUrl.StartsWith('/') ||
        returnUrl.StartsWith("//", StringComparison.Ordinal) ||
        returnUrl.StartsWith("/\\", StringComparison.Ordinal))
    {
        return "/";
    }

    return returnUrl;
}
