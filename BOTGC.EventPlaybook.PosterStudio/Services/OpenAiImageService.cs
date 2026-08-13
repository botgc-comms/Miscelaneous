using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BOTGC.EventPlaybook.PosterStudio.Models;
using BOTGC.EventPlaybook.PosterStudio.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.PosterStudio.Services;

public sealed class OpenAiImageService(
    IHttpClientFactory httpClientFactory,
    IPosterConfigurationService posterConfiguration,
    IImagePromptService promptService,
    IOptions<OpenAiOptions> options,
    ILogger<OpenAiImageService> logger) : IOpenAiImageService
{
    private readonly OpenAiOptions _options = options.Value;

    public async Task<GeneratedArtworkResponse> GeneratePrimaryAsync(
        GeneratePosterRequest request,
        CancellationToken cancellationToken)
    {
        var eventDefinition = posterConfiguration.GetEvent(request.EventId);
        var style = posterConfiguration.GetStyle(request.StyleId);
        var primaryOutput = posterConfiguration.Get().Outputs.Single(x => x.IsPrimary);
        var promptResult = await promptService.BuildPrimaryPromptAsync(
            request,
            eventDefinition,
            style,
            primaryOutput,
            cancellationToken);

        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            return CreateMockArtwork(
                eventDefinition,
                primaryOutput,
                request.RefinementNotes,
                promptResult);
        }

        if (!string.IsNullOrWhiteSpace(request.PreviousArtworkDataUrl))
        {
            return await EditImageAsync(
                request.PreviousArtworkDataUrl,
                promptResult,
                primaryOutput.OpenAiSize,
                cancellationToken);
        }

        return await GenerateImageAsync(
            promptResult,
            primaryOutput.OpenAiSize,
            cancellationToken);
    }

    public async Task<GeneratedArtworkResponse> GenerateVariantAsync(
        GenerateVariantRequest request,
        CancellationToken cancellationToken)
    {
        var eventDefinition = posterConfiguration.GetEvent(request.EventId);
        var style = posterConfiguration.GetStyle(request.StyleId);
        var output = posterConfiguration.GetOutput(request.OutputId);
        var promptResult = await promptService.BuildVariantPromptAsync(
            request,
            eventDefinition,
            style,
            output,
            cancellationToken);

        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            return CreateMockArtwork(
                eventDefinition,
                output,
                request.RefinementNotes,
                promptResult);
        }

        return await EditImageAsync(
            request.PrimaryArtworkDataUrl,
            promptResult,
            output.OpenAiSize,
            cancellationToken);
    }

    private async Task<GeneratedArtworkResponse> GenerateImageAsync(
        ImagePromptResult promptResult,
        string size,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "images/generations");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
        request.Content = JsonContent.Create(new
        {
            model = _options.ImageModel,
            prompt = promptResult.Prompt,
            size,
            quality = _options.ImageQuality,
            output_format = "png",
            background = "opaque",
            n = 1
        });

        using var client = httpClientFactory.CreateClient("OpenAI");
        using var response = await client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            logger.LogError(
                "OpenAI image generation failed with {StatusCode}: {Body}",
                response.StatusCode,
                body);
            throw new InvalidOperationException("OpenAI image generation failed.");
        }

        return ParseImageResponse(body, promptResult);
    }

    private async Task<GeneratedArtworkResponse> EditImageAsync(
        string sourceImageDataUrl,
        ImagePromptResult promptResult,
        string size,
        CancellationToken cancellationToken)
    {
        var imageBytes = DecodeDataUrl(sourceImageDataUrl);

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(_options.ImageModel), "model");
        form.Add(new StringContent(promptResult.Prompt), "prompt");
        form.Add(new StringContent(size), "size");
        form.Add(new StringContent(_options.ImageQuality), "quality");
        form.Add(new StringContent("png"), "output_format");

        var imageContent = new ByteArrayContent(imageBytes);
        imageContent.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        form.Add(imageContent, "image[]", "primary-campaign-artwork.png");

        using var request = new HttpRequestMessage(HttpMethod.Post, "images/edits");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
        request.Content = form;

        using var client = httpClientFactory.CreateClient("OpenAI");
        using var response = await client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            logger.LogError(
                "OpenAI image edit failed with {StatusCode}: {Body}",
                response.StatusCode,
                body);
            throw new InvalidOperationException("OpenAI image editing failed.");
        }

        return ParseImageResponse(body, promptResult);
    }

    private GeneratedArtworkResponse ParseImageResponse(
        string body,
        ImagePromptResult promptResult)
    {
        using var document = JsonDocument.Parse(body);
        var data = document.RootElement.GetProperty("data");

        if (data.GetArrayLength() == 0 || !data[0].TryGetProperty("b64_json", out var base64Element))
        {
            throw new InvalidOperationException("OpenAI returned no image data.");
        }

        var base64 = base64Element.GetString();

        if (string.IsNullOrWhiteSpace(base64))
        {
            throw new InvalidOperationException("OpenAI returned an empty image.");
        }

        return new GeneratedArtworkResponse
        {
            DataUrl = $"data:image/png;base64,{base64}",
            Mode = "openai",
            Model = _options.ImageModel,
            PromptModel = promptResult.Model,
            PromptUsed = promptResult.Prompt
        };
    }

    private GeneratedArtworkResponse CreateMockArtwork(
        EventDefinition eventDefinition,
        PosterOutputDefinition output,
        string? refinementNotes,
        ImagePromptResult promptResult)
    {
        var portrait = output.Height > output.Width;
        var square = output.Height == output.Width;
        var width = square ? 1024 : portrait ? 1024 : 1536;
        var height = square ? 1024 : portrait ? 1536 : 1024;
        var feedbackIntensity = string.IsNullOrWhiteSpace(refinementNotes) ? 0.1 : 0.24;

        var svg = $"""
            <svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
              <defs>
                <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#dfeae8"/>
                  <stop offset="1" stop-color="#f6eedc"/>
                </linearGradient>
                <linearGradient id="fairway" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stop-color="#6e9474"/>
                  <stop offset="1" stop-color="#2f6b55"/>
                </linearGradient>
              </defs>
              <rect width="100%" height="100%" fill="url(#sky)"/>
              <circle cx="{width * 0.82}" cy="{height * 0.16}" r="{Math.Min(width, height) * 0.11}" fill="#c6a15b" opacity="0.55"/>
              <path d="M0 {height * 0.55} C {width * 0.18} {height * 0.42}, {width * 0.4} {height * 0.58}, {width * 0.6} {height * 0.47} C {width * 0.78} {height * 0.37}, {width * 0.9} {height * 0.5}, {width} {height * 0.42} L {width} {height} L 0 {height} Z" fill="#95af83"/>
              <path d="M0 {height * 0.7} C {width * 0.22} {height * 0.6}, {width * 0.38} {height * 0.79}, {width * 0.6} {height * 0.65} C {width * 0.76} {height * 0.56}, {width * 0.91} {height * 0.7}, {width} {height * 0.6} L {width} {height} L 0 {height} Z" fill="url(#fairway)"/>
              <g opacity="0.9">
                <path d="M{width * 0.42} {height * 0.66} L{width * 0.47} {height * 0.38} L{width * 0.52} {height * 0.66} Z" fill="#1f5a47"/>
                <path d="M{width * 0.5} {height * 0.67} L{width * 0.56} {height * 0.35} L{width * 0.62} {height * 0.67} Z" fill="#245f4a"/>
                <path d="M{width * 0.58} {height * 0.68} L{width * 0.64} {height * 0.4} L{width * 0.7} {height * 0.68} Z" fill="#1b543f"/>
              </g>
              <g transform="translate({width * 0.24} {height * 0.62})">
                <circle cx="0" cy="0" r="{Math.Min(width, height) * 0.045}" fill="#e8c39d"/>
                <path d="M{-width * 0.035} {height * 0.045} L{width * 0.04} {height * 0.045} L{width * 0.065} {height * 0.19} L{-width * 0.07} {height * 0.19} Z" fill="#134a63"/>
                <path d="M{width * 0.045} {height * 0.1} L{width * 0.17} {-height * 0.06}" stroke="#0d3548" stroke-width="12" stroke-linecap="round"/>
              </g>
              <path d="M{width * 0.34} {height * 0.56} C {width * 0.48} {height * 0.33}, {width * 0.72} {height * 0.3}, {width * 0.84} {height * 0.54}" fill="none" stroke="#ffffff" stroke-width="7" stroke-dasharray="14 18" opacity="0.78"/>
              <circle cx="{width * 0.84}" cy="{height * 0.54}" r="10" fill="#ffffff"/>
              <rect x="{width * 0.08}" y="{height * 0.08}" width="{width * 0.72}" height="{height * 0.2}" rx="28" fill="#ffffff" opacity="{0.18 + feedbackIntensity}"/>
            </svg>
            """;

        var data = Convert.ToBase64String(Encoding.UTF8.GetBytes(svg));

        return new GeneratedArtworkResponse
        {
            DataUrl = $"data:image/svg+xml;base64,{data}",
            Mode = "mock",
            Model = "mock",
            PromptModel = promptResult.Model,
            PromptUsed = promptResult.Prompt
        };
    }

    private static byte[] DecodeDataUrl(string dataUrl)
    {
        var commaIndex = dataUrl.IndexOf(',');

        if (commaIndex < 0)
        {
            throw new InvalidOperationException("The source image is not a valid data URL.");
        }

        return Convert.FromBase64String(dataUrl[(commaIndex + 1)..]);
    }
}
