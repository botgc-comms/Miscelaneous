using BOTGC.EventPlaybook.PosterStudio.Models;
using BOTGC.EventPlaybook.PosterStudio.Options;
using BOTGC.EventPlaybook.PosterStudio.Services;

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

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();
