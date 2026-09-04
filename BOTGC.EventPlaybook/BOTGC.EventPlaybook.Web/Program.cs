using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using QRCoder;

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
var adminPassword = Environment.GetEnvironmentVariable("ADMIN_PASSWORD") ?? string.Empty;
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
builder.Services
    .AddOptions<EventPlaybookApiOptions>()
    .Bind(builder.Configuration.GetSection(EventPlaybookApiOptions.SectionName));
builder.Services.AddSingleton<IPosterConfigurationService, PosterConfigurationService>();
builder.Services.AddHttpClient("OpenAI", client =>
{
    client.BaseAddress = new Uri("https://api.openai.com/v1/");
    client.Timeout = TimeSpan.FromMinutes(5);
});
builder.Services.AddSingleton<IImagePromptService, OpenAiPromptService>();
builder.Services.AddSingleton<IReferenceRelevanceService, OpenAiReferenceRelevanceService>();
builder.Services.AddSingleton<IOpenAiImageService, OpenAiImageService>();
builder.Services.AddHttpClient("Yodeck", client =>
{
    client.BaseAddress = new Uri(string.IsNullOrWhiteSpace(yodeckApiBaseUrl)
        ? "https://app.yodeck.com/api/v2/"
        : yodeckApiBaseUrl.TrimEnd('/') + "/");
    client.Timeout = TimeSpan.FromMinutes(3);
});
builder.Services.AddSingleton<IYodeckPublisher, YodeckPublisher>();
builder.Services.AddHttpClient(IntelligentGolfApiSessionClient.HttpClientName, client =>
{
    client.Timeout = TimeSpan.FromMinutes(2);
});
builder.Services.AddSingleton<IIntelligentGolfApiSessionClient, IntelligentGolfApiSessionClient>();
builder.Services.AddSingleton<IIntelligentGolfMemberCommunicationsClient, IntelligentGolfMemberCommunicationsClient>();
builder.Services.AddSingleton<IIntelligentGolfIntegrationLinkStore, IntelligentGolfIntegrationLinkStore>();
builder.Services.AddSingleton<IIntegrationActivityStore, IntegrationActivityStore>();
builder.Services.AddSingleton<IIntelligentGolfEventIntegration, IntelligentGolfEventIntegration>();
builder.Services.AddSingleton<PlaybookEventChangePipeline>();
builder.Services.AddSingleton<IPlaybookEventChangePublisher>(services => services.GetRequiredService<PlaybookEventChangePipeline>());
builder.Services.AddHostedService(services => services.GetRequiredService<PlaybookEventChangePipeline>());
builder.Services.AddSingleton<IMemberEmailComposer, MemberEmailComposer>();
builder.Services.AddSingleton<IMemberDiaryComposer, MemberDiaryComposer>();
builder.Services.AddSingleton<IMemberEmailArtworkStore, MemberEmailArtworkStore>();
builder.Services.AddSingleton<ITaskCompletionRegistry, TaskCompletionRegistry>();
builder.Services.AddSingleton<IFeedbackStore, FeedbackStore>();
builder.Services.AddSingleton<IRetrospectiveAnalysisService, RetrospectiveAnalysisService>();
builder.Services.AddSingleton<IEventBriefingService, EventBriefingService>();
builder.Services.AddSingleton<IPluginSettingsStore, PluginSettingsStore>();
builder.Services.AddSingleton<IClubBrandingStore, ClubBrandingStore>();
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
    "Communications Centre configured. API key: {ApiKeyStatus}; image model: {ImageModel}; image quality: {ImageQuality}; prompt model: {PromptModel}; Yodeck: {YodeckStatus}; demo access: {DemoAccessStatus}; administrator access: {AdminAccessStatus}",
    string.IsNullOrWhiteSpace(openAiApiKey) ? "not configured - mock mode" : "OPENAI_API_KEY",
    effectiveImageModel,
    effectiveImageQuality,
    effectivePromptModel,
    !string.IsNullOrWhiteSpace(yodeckApiToken) && yodeckPlaylistId > 0
        ? $"playlist {yodeckPlaylistId}"
        : "not configured",
    string.IsNullOrWhiteSpace(demoPassword) ? "disabled" : "password protected",
    string.IsNullOrWhiteSpace(adminPassword) ? "not configured" : "password protected");

app.UseAuthentication();

if (!string.IsNullOrWhiteSpace(demoPassword))
{
    app.Use(async (context, next) =>
    {
        var path = context.Request.Path;
        var isPublicPath = path.StartsWithSegments("/demo-login.html") ||
                           path.StartsWithSegments("/admin-login.html") ||
                           path.StartsWithSegments("/auth/login") ||
                           path.StartsWithSegments("/auth/admin-login") ||
                           path.StartsWithSegments("/api/auth/session") ||
                           path.StartsWithSegments("/api/branding") ||
                           path.StartsWithSegments("/branding.js") ||
                           path.StartsWithSegments("/feedback.html") ||
                           path.StartsWithSegments("/feedback.css") ||
                           path.StartsWithSegments("/feedback.js") ||
                           path.StartsWithSegments("/assets") ||
                           path.StartsWithSegments("/api/feedback/public") ||
                           path.StartsWithSegments("/api/poster/member-email/artwork") ||
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

app.Use(async (context, next) =>
{
    var path = context.Request.Path;
    var isAdmin = context.User.IsInRole("Admin");
    var requestedAdminView = (path == "/" || path.StartsWithSegments("/index.html")) &&
                             (string.Equals(context.Request.Query["view"], "admin", StringComparison.OrdinalIgnoreCase) ||
                              string.Equals(context.Request.Query["view"], "plugins", StringComparison.OrdinalIgnoreCase));

    if (path.StartsWithSegments("/api/admin") && !isAdmin)
    {
        context.Response.StatusCode = context.User.Identity?.IsAuthenticated == true
            ? StatusCodes.Status403Forbidden
            : StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new { error = "Administrator access is required." });
        return;
    }

    if (requestedAdminView && !isAdmin)
    {
        var requestedUrl = $"{context.Request.PathBase}{context.Request.Path}{context.Request.QueryString}";
        context.Response.Redirect($"/admin-login.html?returnUrl={Uri.EscapeDataString(requestedUrl)}");
        return;
    }

    await next();
});

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

app.MapPost("/auth/admin-login", async (HttpContext context, CancellationToken cancellationToken) =>
{
    var form = await context.Request.ReadFormAsync(cancellationToken);
    var returnUrl = NormaliseAdminReturnUrl(form["returnUrl"].ToString());

    if (string.IsNullOrWhiteSpace(adminPassword))
    {
        var unavailableUrl = $"/admin-login.html?error=not-configured&returnUrl={Uri.EscapeDataString(returnUrl)}";
        return Results.Redirect(unavailableUrl);
    }

    if (!PasswordMatches(form["password"].ToString(), adminPassword))
    {
        var failureUrl = $"/admin-login.html?error=invalid&returnUrl={Uri.EscapeDataString(returnUrl)}";
        return Results.Redirect(failureUrl);
    }

    var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.Name, "Event Playbook administrator"),
            new Claim(ClaimTypes.Role, "Admin")
        ],
        demoCookieScheme);
    var principal = new ClaimsPrincipal(identity);
    await context.SignInAsync(
        demoCookieScheme,
        principal,
        new AuthenticationProperties
        {
            IsPersistent = true,
            ExpiresUtc = DateTimeOffset.UtcNow.AddHours(4)
        });

    return Results.Redirect(returnUrl);
});

app.MapPost("/auth/logout", async (HttpContext context) =>
{
    await context.SignOutAsync(demoCookieScheme);
    return Results.Redirect(string.IsNullOrWhiteSpace(demoPassword) ? "/" : "/demo-login.html");
});

app.MapGet("/api/auth/session", (HttpContext context) => Results.Ok(new
{
    authenticated = context.User.Identity?.IsAuthenticated == true,
    isAdmin = context.User.IsInRole("Admin"),
    administratorLoginConfigured = !string.IsNullOrWhiteSpace(adminPassword),
    displayName = context.User.Identity?.Name
}));

app.MapGet("/api/branding", async (
    IClubBrandingStore brandingStore,
    CancellationToken cancellationToken) =>
{
    return Results.Ok(await brandingStore.GetOverviewAsync(cancellationToken));
});

app.MapGet("/api/branding/crest", async (
    HttpContext context,
    IClubBrandingStore brandingStore,
    CancellationToken cancellationToken) =>
{
    var crest = await brandingStore.GetCrestAsync(cancellationToken);
    if (crest is null) return Results.Redirect("/assets/botgc-mark.svg");
    context.Response.Headers.CacheControl = "public,max-age=300";
    return Results.File(crest.Content, crest.ContentType);
});

app.MapGet("/api/poster/config", async (
    IPosterConfigurationService configurationService,
    IClubBrandingStore brandingStore,
    IYodeckPublisher yodeckPublisher,
    IIntelligentGolfEventIntegration intelligentGolfIntegration,
    IPluginSettingsStore pluginSettingsStore,
    Microsoft.Extensions.Options.IOptions<EventPlaybookApiOptions> eventPlaybookApiOptions,
    CancellationToken cancellationToken) =>
{
    var configurationModel = configurationService.Get();
    var branding = await brandingStore.GetOverviewAsync(cancellationToken);
    var plugins = await pluginSettingsStore.GetOverviewAsync(cancellationToken);
    var hasApiKey = !string.IsNullOrWhiteSpace(openAiApiKey);

    return Results.Ok(new
    {
        brand = new
        {
            name = branding.ClubName,
            configurationModel.Brand.ShortName,
            configurationModel.Brand.Strapline,
            crestUrl = branding.CrestUrl
        },
        events = configurationModel.Events,
        styles = configurationModel.Styles.Select(x => new
        {
            x.Id,
            x.Name,
            x.Summary,
            variations = x.Variations.Select(variation => new
            {
                variation.Id,
                variation.Name
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
        },
        memberDiary = new
        {
            configured = await intelligentGolfIntegration.IsAvailableAsync(cancellationToken),
            destinationName = "Club member diary"
        },
        memberEmail = new
        {
            configured = plugins.IntelligentGolf.Enabled &&
                         plugins.IntelligentGolf.Configured &&
                         plugins.IntelligentGolf.EmailConfigured &&
                         Uri.TryCreate(eventPlaybookApiOptions.Value.BaseUrl, UriKind.Absolute, out _) &&
                         !string.IsNullOrWhiteSpace(eventPlaybookApiOptions.Value.ApiKey),
            destinationName = "Active club members"
        }
    });
});

app.MapGet("/api/integrations/intelligent-golf/events/{eventId}", async (
    string eventId,
    IIntelligentGolfEventIntegration intelligentGolfIntegration,
    IIntelligentGolfIntegrationLinkStore linkStore,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(eventId))
    {
        return Results.BadRequest(new { error = "An Event Playbook event ID is required." });
    }

    var available = await intelligentGolfIntegration.IsAvailableAsync(cancellationToken);
    var link = await linkStore.GetAsync(eventId.Trim(), cancellationToken);
    return Results.Ok(new
    {
        available,
        plannerEntryId = link?.IntelligentGolfEventId,
        diaryEntryId = link?.IntelligentGolfDiaryEntryId,
        eventSynchronisedAtUtc = link?.EventSynchronisedAtUtc,
        diaryPublishedAtUtc = link?.DiaryPublishedAtUtc,
        lastError = link?.LastError,
        updatedAtUtc = link?.UpdatedAtUtc
    });
});

app.MapGet("/api/poster/member-email/artwork/{token}", (
    string token,
    IMemberEmailArtworkStore artworkStore) =>
{
    var path = artworkStore.Resolve(token);
    return path is null
        ? Results.NotFound()
        : Results.File(path, "image/png", enableRangeProcessing: true);
});

app.MapPost("/api/poster/member-email/draft", async (
    MemberEmailDraftRequest draft,
    HttpRequest httpRequest,
    IMemberEmailArtworkStore artworkStore,
    IMemberEmailComposer composer,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(draft.EventId) ||
        string.IsNullOrWhiteSpace(draft.EventName) ||
        string.IsNullOrWhiteSpace(draft.Description) ||
        !DateOnly.TryParseExact(draft.EventDate, "yyyy-MM-dd", out _))
    {
        return Results.BadRequest(new { error = "Event name, date and description are required to draft the member email." });
    }

    if (draft.Artwork is null)
    {
        return Results.BadRequest(new { error = "Finished campaign artwork is required." });
    }

    if (!TryDecodePngDataUrl(draft.Artwork.DataUrl, out var artworkBytes, out var artworkError))
    {
        return Results.BadRequest(new { error = artworkError });
    }

    var artworkToken = await artworkStore.SaveAsync(draft.EventId, artworkBytes, cancellationToken);
    var publicScheme = httpRequest.Headers["X-Forwarded-Proto"].FirstOrDefault() ?? httpRequest.Scheme;
    var artworkUrl = $"{publicScheme}://{httpRequest.Host}{httpRequest.PathBase}/api/poster/member-email/artwork/{artworkToken}";
    return Results.Ok(await composer.ComposeAsync(draft, artworkUrl, cancellationToken));
});

app.MapGet("/api/poster/member-email/members", async (
    bool? refresh,
    IIntelligentGolfMemberCommunicationsClient communications,
    CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await communications.GetMembersAsync(refresh ?? false, cancellationToken));
    }
    catch (InvalidOperationException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/api/poster/member-email/test", async (
    MemberEmailTestRequest request,
    IIntelligentGolfMemberCommunicationsClient communications,
    CancellationToken cancellationToken) =>
{
    try
    {
        await communications.SendTestAsync(request, cancellationToken);
        return Results.Ok(new { success = true, recipientEmail = request.RecipientEmail });
    }
    catch (InvalidOperationException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/api/poster/member-email/send", async (
    MemberCampaignEmailRequest request,
    IIntelligentGolfMemberCommunicationsClient communications,
    CancellationToken cancellationToken) =>
{
    if (request.MemberNumbers is null || request.MemberNumbers.Count == 0)
    {
        return Results.BadRequest(new { error = "Choose at least one active member to receive the email." });
    }

    try
    {
        return Results.Ok(await communications.SendCampaignAsync(request, cancellationToken));
    }
    catch (InvalidOperationException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
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
    IPlaybookEventChangePublisher eventChangePublisher,
    CancellationToken cancellationToken) =>
{
    if (request.State.ValueKind != System.Text.Json.JsonValueKind.Object)
    {
        return Results.BadRequest(new { error = "Shared state must be a JSON object." });
    }

    var previous = await store.GetAsync(cancellationToken);
    var result = await store.SaveAsync(request, cancellationToken);
    if (!result.Conflict)
    {
        await eventChangePublisher.PublishAsync(previous.State, result.Document.State, cancellationToken);
    }
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

app.MapGet("/api/poster/artwork", async (
    string key,
    string outputId,
    string version,
    HttpContext httpContext,
    IPosterConfigurationService posterConfiguration,
    IPosterSessionStore store,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(outputId) || string.IsNullOrWhiteSpace(version))
    {
        return Results.BadRequest(new { error = "A session key, output id and artwork version are required." });
    }

    try
    {
        ValidatePosterArtworkId(outputId.Trim(), posterConfiguration);
    }
    catch (KeyNotFoundException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }

    var artwork = await store.GetArtworkAsync(key.Trim(), outputId.Trim(), version.Trim(), cancellationToken);
    if (artwork is null) return Results.NotFound();
    httpContext.Response.Headers.CacheControl = "private, no-cache, must-revalidate";
    return Results.File(artwork.Path, artwork.ContentType, enableRangeProcessing: true);
});

app.MapPut("/api/poster/artwork", async (
    string key,
    string outputId,
    HttpRequest request,
    IPosterConfigurationService posterConfiguration,
    IPosterSessionStore store,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(outputId))
    {
        return Results.BadRequest(new { error = "A session key and output id are required." });
    }
    if (request.ContentLength is > 80L * 1024L * 1024L)
    {
        return Results.BadRequest(new { error = "Poster artwork exceeds the 80 MB storage limit." });
    }
    if (string.IsNullOrWhiteSpace(request.ContentType) ||
        !request.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
    {
        return Results.BadRequest(new { error = "Poster artwork must be supplied as an image." });
    }

    try
    {
        ValidatePosterArtworkId(outputId.Trim(), posterConfiguration);
        var artwork = await store.SaveArtworkAsync(
            key.Trim(),
            outputId.Trim(),
            request.Body,
            request.ContentType,
            cancellationToken);
        var url = $"/api/poster/artwork?key={Uri.EscapeDataString(key.Trim())}&outputId={Uri.EscapeDataString(outputId.Trim())}&version={artwork.Version}";
        return Results.Ok(new { url, artwork.Version });
    }
    catch (KeyNotFoundException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (InvalidDataException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPost("/api/poster/reference-profile", async (
    CompileReferenceProfileRequest request,
    IReferenceRelevanceService relevanceService,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Title) ||
        string.IsNullOrWhiteSpace(request.Category) ||
        string.IsNullOrWhiteSpace(request.Description))
    {
        return Results.BadRequest(new { error = "Title, category and description are required to compile an image matching profile." });
    }

    return Results.Ok(await relevanceService.CompileProfileAsync(request, cancellationToken));
});

app.MapPost("/api/poster/select-references", async (
    SelectReferenceImagesRequest request,
    IReferenceRelevanceService relevanceService,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.EventName) || string.IsNullOrWhiteSpace(request.Description))
    {
        return Results.BadRequest(new { error = "An event name and description are required to select image references." });
    }

    if (request.References.Count > 100)
    {
        return Results.BadRequest(new { error = "No more than 100 library images can be assessed in one request." });
    }

    return Results.Ok(await relevanceService.SelectAsync(request, cancellationToken));
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
            safetyRefusal = exception.IsSafetyRefusal,
            requestId = exception.RequestId,
            code = exception.ErrorCode
        }, statusCode: StatusCodes.Status502BadGateway);
    }
    catch (InvalidOperationException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/api/poster/generate-concept", async (
    GeneratePosterRequest request,
    IOpenAiImageService imageService,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.EventId) ||
        string.IsNullOrWhiteSpace(request.StyleId) ||
        string.IsNullOrWhiteSpace(request.Description) ||
        !request.IsConceptPreview)
    {
        return Results.BadRequest(new { error = "Event, style, description and concept-preview mode are required." });
    }

    try
    {
        var result = await imageService.GenerateConceptAsync(request, cancellationToken);
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
            safetyRefusal = exception.IsSafetyRefusal,
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
            safetyRefusal = exception.IsSafetyRefusal,
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
                pushRequested = published.ScreenPushRequested,
                pushConfirmed = published.ScreenPushConfirmed,
                pushStatus = published.ScreenPushStatus,
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

app.MapPost("/api/poster/member-diary/draft", async (
    MemberDiaryDraftRequest draft,
    HttpRequest httpRequest,
    IMemberEmailArtworkStore artworkStore,
    IMemberDiaryComposer composer,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(draft.EventId) ||
        string.IsNullOrWhiteSpace(draft.EventName) ||
        string.IsNullOrWhiteSpace(draft.Description) ||
        !DateOnly.TryParseExact(draft.EventDate, "yyyy-MM-dd", out _))
    {
        return Results.BadRequest(new { error = "Event name, date and description are required to draft the member diary entry." });
    }

    if (draft.Artwork is null)
    {
        return Results.BadRequest(new { error = "Finished campaign artwork is required." });
    }

    if (!TryDecodePngDataUrl(draft.Artwork.DataUrl, out var artworkBytes, out var artworkError))
    {
        return Results.BadRequest(new { error = artworkError });
    }

    var artworkToken = await artworkStore.SaveAsync(draft.EventId, artworkBytes, cancellationToken);
    var publicScheme = httpRequest.Headers["X-Forwarded-Proto"].FirstOrDefault() ?? httpRequest.Scheme;
    var artworkUrl = $"{publicScheme}://{httpRequest.Host}{httpRequest.PathBase}/api/poster/member-email/artwork/{artworkToken}";
    return Results.Ok(await composer.ComposeAsync(draft, artworkUrl, cancellationToken));
});

app.MapPut("/api/poster/member-diary", async (
    MemberDiaryPublishRequest request,
    IIntelligentGolfEventIntegration intelligentGolfIntegration,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.EventId) ||
        string.IsNullOrWhiteSpace(request.EventName) ||
        string.IsNullOrWhiteSpace(request.Description) ||
        !DateOnly.TryParseExact(request.EventDate, "yyyy-MM-dd", out _))
    {
        return Results.BadRequest(new { error = "Event name, date and member-facing description are required." });
    }

    if ((request.Title?.Trim().Length ?? request.EventName.Trim().Length) > 250 || request.Description.Length > 200_000)
    {
        return Results.BadRequest(new { error = "The diary title or description is too long." });
    }

    var startTime = request.StartTime?.Trim() ?? string.Empty;
    var endTime = request.EndTime?.Trim() ?? string.Empty;
    if ((!string.IsNullOrWhiteSpace(startTime) && !TimeOnly.TryParseExact(startTime, "HH:mm", out _)) ||
        (!string.IsNullOrWhiteSpace(endTime) && !TimeOnly.TryParseExact(endTime, "HH:mm", out _)))
    {
        return Results.BadRequest(new { error = "Diary start and end times must use the 24-hour HH:mm format." });
    }

    if (!string.IsNullOrWhiteSpace(startTime) && !string.IsNullOrWhiteSpace(endTime) &&
        TimeOnly.ParseExact(endTime, "HH:mm") <= TimeOnly.ParseExact(startTime, "HH:mm"))
    {
        return Results.BadRequest(new { error = "The diary end time must be after its start time." });
    }

    var bookingUrl = request.BookingUrl?.Trim() ?? string.Empty;
    if (!string.IsNullOrWhiteSpace(bookingUrl) &&
        (!Uri.TryCreate(bookingUrl, UriKind.Absolute, out var parsedBookingUrl) ||
         (parsedBookingUrl.Scheme != Uri.UriSchemeHttp && parsedBookingUrl.Scheme != Uri.UriSchemeHttps)))
    {
        return Results.BadRequest(new { error = "The booking or information link must be a complete http or https URL." });
    }

    try
    {
        var published = await intelligentGolfIntegration.PublishDiaryAsync(request, cancellationToken);

        return Results.Ok(new
        {
            success = true,
            diaryEntryId = published.IntelligentGolfDiaryEntryId,
            intelligentGolfEventId = published.IntelligentGolfEventId,
            operation = published.Created ? "created" : "updated",
            eventDate = request.EventDate
        });
    }
    catch (InvalidOperationException exception)
    {
        return Results.Problem(
            exception.Message,
            statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapGet("/api/admin/plugins", async (
    IPluginSettingsStore pluginSettingsStore,
    CancellationToken cancellationToken) =>
{
    return Results.Ok(await pluginSettingsStore.GetOverviewAsync(cancellationToken));
});

app.MapGet("/api/admin/integration-activity", async (
    int? limit,
    IIntegrationActivityStore activityStore,
    CancellationToken cancellationToken) =>
{
    return Results.Ok(await activityStore.GetRecentAsync(limit ?? 100, cancellationToken));
});

app.MapPut("/api/admin/branding", async (
    HttpContext context,
    IClubBrandingStore brandingStore,
    CancellationToken cancellationToken) =>
{
    try
    {
        var form = await context.Request.ReadFormAsync(cancellationToken);
        var removeCustomCrest = bool.TryParse(form["removeCustomCrest"].ToString(), out var remove) && remove;
        var result = await brandingStore.SaveAsync(
            form["clubName"].ToString(),
            form.Files.GetFile("crest"),
            removeCustomCrest,
            cancellationToken);
        return Results.Ok(result);
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (InvalidDataException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPut("/api/admin/plugins/intelligent-golf", async (
    SaveIntelligentGolfPluginRequest request,
    IPluginSettingsStore pluginSettingsStore,
    IIntelligentGolfApiSessionClient sessionClient,
    CancellationToken cancellationToken) =>
{
    try
    {
        if (request.Enabled)
        {
            var credentials = await pluginSettingsStore.ResolveIntelligentGolfCredentialsAsync(request, cancellationToken);
            await sessionClient.ConnectAsync(credentials, cancellationToken);
        }
        else
        {
            sessionClient.Clear();
        }

        return Results.Ok(await pluginSettingsStore.SaveIntelligentGolfAsync(request, cancellationToken));
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (InvalidOperationException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPut("/api/admin/plugins/monday", async (
    SaveMondayPluginRequest request,
    IPluginSettingsStore pluginSettingsStore,
    CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await pluginSettingsStore.SaveMondayAsync(request, cancellationToken));
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPatch("/api/admin/plugins/{pluginId}/enabled", async (
    string pluginId,
    SetPluginEnabledRequest request,
    IPluginSettingsStore pluginSettingsStore,
    IIntelligentGolfApiSessionClient sessionClient,
    CancellationToken cancellationToken) =>
{
    try
    {
        if (string.Equals(pluginId, "intelligent-golf", StringComparison.OrdinalIgnoreCase))
        {
            if (request.Enabled)
            {
                var credentials = await pluginSettingsStore.GetIntelligentGolfCredentialsAsync(cancellationToken)
                    ?? throw new ArgumentException("Configure Intelligent Golf before turning the module on.");
                await sessionClient.ConnectAsync(credentials, cancellationToken);
            }
            else
            {
                sessionClient.Clear();
            }
        }

        return Results.Ok(await pluginSettingsStore.SetEnabledAsync(pluginId, request.Enabled, cancellationToken));
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = exception.Message });
    }
    catch (InvalidOperationException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapDelete("/api/admin/plugins/{pluginId}", async (
    string pluginId,
    IPluginSettingsStore pluginSettingsStore,
    IIntelligentGolfApiSessionClient sessionClient,
    CancellationToken cancellationToken) =>
{
    try
    {
        if (string.Equals(pluginId, "intelligent-golf", StringComparison.OrdinalIgnoreCase))
        {
            sessionClient.Clear();
        }
        return Results.Ok(await pluginSettingsStore.DisconnectAsync(pluginId, cancellationToken));
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = exception.Message });
    }
});


app.MapGet("/api/feedback/events/{eventId}", async (
    string eventId,
    IFeedbackStore feedbackStore,
    CancellationToken cancellationToken) =>
{
    var result = await feedbackStore.GetForEventAsync(eventId, cancellationToken);
    return Results.Ok(result);
});

app.MapPut("/api/feedback/events/{eventId}/campaign", async (
    string eventId,
    UpsertFeedbackCampaignRequest request,
    IFeedbackStore feedbackStore,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(eventId) || string.IsNullOrWhiteSpace(request.EventName))
    {
        return Results.BadRequest(new { error = "An event and event name are required." });
    }

    try
    {
        var campaign = await feedbackStore.UpsertCampaignAsync(eventId, request, cancellationToken);
        return Results.Ok(campaign);
    }
    catch (InvalidOperationException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapGet("/api/feedback/public/{token}", async (
    string token,
    IFeedbackStore feedbackStore,
    CancellationToken cancellationToken) =>
{
    var campaign = await feedbackStore.GetPublicCampaignAsync(token, cancellationToken);
    if (campaign is null)
    {
        return Results.NotFound(new { error = "This feedback form could not be found." });
    }

    var availability = FeedbackStore.GetAvailability(campaign);
    if (!availability.IsAcceptingResponses)
    {
        return Results.Json(new { error = availability.Message, availability }, statusCode: StatusCodes.Status410Gone);
    }

    return Results.Ok(new
    {
        campaign.EventName,
        campaign.EventDate,
        campaign.ClosesOn,
        campaign.Questions
    });
});

app.MapPost("/api/feedback/public/{token}/responses", async (
    string token,
    SubmitFeedbackRequest request,
    IFeedbackStore feedbackStore,
    CancellationToken cancellationToken) =>
{
    try
    {
        var accepted = await feedbackStore.SubmitAsync(token, request, cancellationToken);
        return accepted
            ? Results.Ok(new { accepted = true })
            : Results.Json(new { error = "This feedback form is not currently accepting responses." }, statusCode: StatusCodes.Status410Gone);
    }
    catch (InvalidOperationException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapGet("/api/feedback/public/{token}/qr.svg", async (
    string token,
    HttpContext context,
    IFeedbackStore feedbackStore,
    CancellationToken cancellationToken) =>
{
    var campaign = await feedbackStore.GetPublicCampaignAsync(token, cancellationToken);
    if (campaign is null)
    {
        return Results.NotFound();
    }

    var publicUrl = $"{context.Request.Scheme}://{context.Request.Host}{context.Request.PathBase}/feedback.html?token={Uri.EscapeDataString(token)}";
    using var generator = new QRCodeGenerator();
    using var data = generator.CreateQrCode(publicUrl, QRCodeGenerator.ECCLevel.Q);
    var qrCode = new SvgQRCode(data);
    var svg = qrCode.GetGraphic(8, "#0d3548", "#ffffff", true);
    return Results.Text(svg, "image/svg+xml", Encoding.UTF8);
});

app.MapPost("/api/retrospective/analyse", async (
    RetrospectiveAnalysisRequest request,
    IRetrospectiveAnalysisService analysisService,
    CancellationToken cancellationToken) =>
{
    try
    {
        var result = await analysisService.AnalyseAsync(request, cancellationToken);
        return Results.Ok(result);
    }
    catch (InvalidOperationException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPost("/api/briefing/generate", async (
    EventBriefingRequest request,
    IEventBriefingService briefingService,
    CancellationToken cancellationToken) =>
{
    try
    {
        var result = await briefingService.GenerateAsync(request, cancellationToken);
        return Results.Ok(result);
    }
    catch (InvalidOperationException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapGet("/api/playbook/config", (IWebHostEnvironment environment) =>
{
    var path = Path.Combine(environment.ContentRootPath, "Data", "event-playbook.json");
    return Results.Text(File.ReadAllText(path), "application/json");
});

var notificationOutboxLock = new SemaphoreSlim(1, 1);

app.MapPost("/api/tasks/notifications", async (System.Text.Json.JsonElement payload, IWebHostEnvironment environment, CancellationToken cancellationToken) =>
{
    await notificationOutboxLock.WaitAsync(cancellationToken);
    try
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
    }
    finally
    {
        notificationOutboxLock.Release();
    }

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

static void ValidatePosterArtworkId(string outputId, IPosterConfigurationService posterConfiguration)
{
    if (System.Text.RegularExpressions.Regex.IsMatch(outputId, "^concept-[1-3]$", System.Text.RegularExpressions.RegexOptions.CultureInvariant))
    {
        return;
    }

    posterConfiguration.GetOutput(outputId);
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

static string NormaliseAdminReturnUrl(string? returnUrl)
{
    var normalised = NormaliseLocalReturnUrl(returnUrl);
    if (normalised == "/") return "/?view=admin";
    return normalised;
}
