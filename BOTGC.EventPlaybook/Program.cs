using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using BOTGC.EventPlaybook.Services;

var builder = WebApplication.CreateBuilder(args);

const string defaultImageModel = "gpt-image-2";
const string defaultPromptModel = "gpt-5.6";

var openAiApiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")?.Trim() ?? string.Empty;
var openAiImageModel = Environment.GetEnvironmentVariable("OPENAI_IMAGE_MODEL")?.Trim();
var openAiImageQuality = Environment.GetEnvironmentVariable("OPENAI_IMAGE_QUALITY")?.Trim();
var openAiPromptModel = Environment.GetEnvironmentVariable("OPENAI_PROMPT_MODEL")?.Trim();

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
builder.Services.AddSingleton<IPosterConfigurationService, PosterConfigurationService>();
builder.Services.AddHttpClient("OpenAI", client =>
{
    client.BaseAddress = new Uri("https://api.openai.com/v1/");
    client.Timeout = TimeSpan.FromMinutes(5);
});
builder.Services.AddSingleton<IImagePromptService, OpenAiPromptService>();
builder.Services.AddSingleton<IOpenAiImageService, OpenAiImageService>();
builder.Services.AddSingleton<ITaskCompletionRegistry, TaskCompletionRegistry>();

var app = builder.Build();

app.Logger.LogInformation(
    "Poster Studio configured. API key: {ApiKeyStatus}; image model: {ImageModel}; image quality: {ImageQuality}; prompt model: {PromptModel}",
    string.IsNullOrWhiteSpace(openAiApiKey) ? "not configured - mock mode" : "OPENAI_API_KEY",
    effectiveImageModel,
    effectiveImageQuality,
    effectivePromptModel);

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/poster/config", (IPosterConfigurationService configurationService) =>
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
            x.Summary
        }),
        outputs = configurationModel.Outputs,
        generationMode = hasApiKey ? "openai" : "mock",
        imageModel = effectiveImageModel,
        imageQuality = effectiveImageQuality,
        promptModel = effectivePromptModel,
        apiKeySource = hasApiKey ? "OPENAI_API_KEY" : "not configured"
    });
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
    catch (InvalidOperationException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/api/poster/publish", async (PublishRequest request, CancellationToken cancellationToken) =>
{
    await Task.Delay(600, cancellationToken);

    return Results.Ok(new
    {
        success = true,
        eventName = request.EventName,
        assets = request.Assets.Count,
        yodeck = request.PublishToYodeck
            ? "Prototype: assets accepted for future YoDeck integration."
            : "Not selected.",
        email = request.PublishByEmail
            ? "Prototype: assets accepted for future membership email integration."
            : "Not selected."
    });
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
