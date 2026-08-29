using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.Services;

public sealed class OpenAiImageService(
    IHttpClientFactory httpClientFactory,
    IPosterConfigurationService posterConfiguration,
    IImagePromptService promptService,
    IOptions<OpenAiOptions> options,
    ILogger<OpenAiImageService> logger) : IOpenAiImageService
{
    private const string ConceptPreviewSize = "720x1280";
    private readonly OpenAiOptions _options = options.Value;

    public async Task<GeneratedArtworkResponse> GenerateConceptAsync(
        GeneratePosterRequest request,
        CancellationToken cancellationToken)
    {
        var eventDefinition = ResolveEventDefinition(posterConfiguration.GetEvent(request.EventId), request.EventName, request.Description);
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

        var conceptInputs = new List<SupportingImageReference>();
        if (!string.IsNullOrWhiteSpace(request.PreviousArtworkDataUrl))
        {
            conceptInputs.Add(new SupportingImageReference
            {
                FileName = "previous-campaign-artwork.png",
                DataUrl = request.PreviousArtworkDataUrl
            });
        }
        if (request.SupportingImages.Count > 0)
        {
            conceptInputs.AddRange(request.SupportingImages);
        }

        if (conceptInputs.Count > 0)
        {
            return await EditImageAsync(
                conceptInputs,
                promptResult,
                ConceptPreviewSize,
                "low",
                cancellationToken);
        }

        return await GenerateImageAsync(
            promptResult,
            ConceptPreviewSize,
            "low",
            cancellationToken);
    }

    public async Task<GeneratedArtworkResponse> GeneratePrimaryAsync(
        GeneratePosterRequest request,
        CancellationToken cancellationToken)
    {
        var eventDefinition = ResolveEventDefinition(posterConfiguration.GetEvent(request.EventId), request.EventName, request.Description);
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

        var primaryInputs = new List<SupportingImageReference>();

        if (!string.IsNullOrWhiteSpace(request.SelectedConceptDataUrl))
        {
            primaryInputs.Add(new SupportingImageReference
            {
                FileName = "selected-concept-preview.png",
                DataUrl = request.SelectedConceptDataUrl
            });
        }
        else if (!string.IsNullOrWhiteSpace(request.PreviousArtworkDataUrl))
        {
            primaryInputs.Add(new SupportingImageReference
            {
                FileName = "previous-campaign-artwork.png",
                DataUrl = request.PreviousArtworkDataUrl
            });
        }

        if (request.SupportingImages.Count > 0)
        {
            primaryInputs.AddRange(request.SupportingImages);
        }

        if (primaryInputs.Count > 0)
        {
            return await EditImageAsync(
                primaryInputs,
                promptResult,
                primaryOutput.OpenAiSize,
                _options.ImageQuality,
                cancellationToken);
        }

        return await GenerateImageAsync(
            promptResult,
            primaryOutput.OpenAiSize,
            _options.ImageQuality,
            cancellationToken);
    }

    public async Task<GeneratedArtworkResponse> GenerateVariantAsync(
        GenerateVariantRequest request,
        CancellationToken cancellationToken)
    {
        var eventDefinition = ResolveEventDefinition(posterConfiguration.GetEvent(request.EventId), request.EventName, request.Description);
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

        var variantInputs = new List<SupportingImageReference>
        {
            new()
            {
                FileName = "primary-campaign-artwork.png",
                DataUrl = request.PrimaryArtworkDataUrl
            }
        };

        if (request.SupportingImages.Count > 0)
        {
            variantInputs.AddRange(request.SupportingImages);
        }

        return await EditImageAsync(
            variantInputs,
            promptResult,
            output.OpenAiSize,
            _options.ImageQuality,
            cancellationToken);
    }

    private async Task<GeneratedArtworkResponse> GenerateImageAsync(
        ImagePromptResult promptResult,
        string size,
        string quality,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "images/generations");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
        request.Content = JsonContent.Create(new
        {
            model = _options.ImageModel,
            prompt = promptResult.Prompt,
            size,
            quality,
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
            throw CreateUpstreamException("generate the artwork", response, body);
        }

        return ParseImageResponse(body, promptResult);
    }

    private async Task<GeneratedArtworkResponse> EditImageAsync(
        IReadOnlyCollection<SupportingImageReference> sourceImages,
        ImagePromptResult promptResult,
        string size,
        string quality,
        CancellationToken cancellationToken)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(_options.ImageModel), "model");
        form.Add(new StringContent(promptResult.Prompt), "prompt");
        form.Add(new StringContent(size), "size");
        form.Add(new StringContent(quality), "quality");
        if (SupportsInputFidelity(_options.ImageModel))
        {
            form.Add(new StringContent("high"), "input_fidelity");
        }
        form.Add(new StringContent("png"), "output_format");

        var imageIndex = 0;
        foreach (var sourceImage in sourceImages.Where(x => !string.IsNullOrWhiteSpace(x.DataUrl)))
        {
            var imagePayload = DecodeDataUrl(sourceImage.DataUrl);
            var imageContent = new ByteArrayContent(imagePayload.Bytes);
            imageContent.Headers.ContentType = new MediaTypeHeaderValue(imagePayload.ContentType);
            form.Add(imageContent, "image[]", BuildSafeFileName(sourceImage.FileName, imagePayload.FileExtension, imageIndex));
            imageIndex += 1;
        }

        if (imageIndex == 0)
        {
            throw new InvalidOperationException("At least one source image is required for image editing.");
        }

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
            throw CreateUpstreamException("adapt the artwork", response, body);
        }

        return ParseImageResponse(body, promptResult);
    }

    private static bool SupportsInputFidelity(string? model)
    {
        if (string.IsNullOrWhiteSpace(model)) return false;

        var normalisedModel = model.Trim();
        return normalisedModel.Equals("gpt-image-1", StringComparison.OrdinalIgnoreCase) ||
               normalisedModel.StartsWith("gpt-image-1-", StringComparison.OrdinalIgnoreCase) ||
               normalisedModel.Equals("gpt-image-1.5", StringComparison.OrdinalIgnoreCase) ||
               normalisedModel.StartsWith("gpt-image-1.5-", StringComparison.OrdinalIgnoreCase);
    }

    private static OpenAiImageException CreateUpstreamException(
        string action,
        HttpResponseMessage response,
        string body)
    {
        var statusCode = response.StatusCode;
        var retryable = statusCode == System.Net.HttpStatusCode.RequestTimeout ||
                        statusCode == System.Net.HttpStatusCode.TooManyRequests ||
                        (int)statusCode >= 500;
        var requestId = response.Headers.TryGetValues("x-request-id", out var requestIds)
            ? requestIds.FirstOrDefault()
            : null;
        var (providerMessage, errorCode) = ReadProviderError(body);
        var isSafetyRefusal = IsSafetyRefusal(providerMessage, errorCode);

        var message = statusCode switch
        {
            System.Net.HttpStatusCode.TooManyRequests =>
                "The image service is temporarily rate-limited. The completed artwork has been kept and the missing format can be retried shortly.",
            System.Net.HttpStatusCode.RequestTimeout =>
                "The image service timed out while trying to adapt the artwork. The completed artwork has been kept and the missing format can be retried.",
            System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden =>
                "The image service rejected the server credentials or model access. Ask an administrator to check the OpenAI configuration.",
            _ when isSafetyRefusal =>
                "The image service declined this prompt after safety review. Poster Studio kept the event brief and any completed artwork.",
            _ when (int)statusCode >= 500 =>
                "The image service is temporarily unavailable. The completed artwork has been kept and the missing format can be retried.",
            _ when !string.IsNullOrWhiteSpace(providerMessage) =>
                $"OpenAI could not {action}: {providerMessage}",
            _ =>
                $"OpenAI could not {action} (status {(int)statusCode})."
        };

        return new OpenAiImageException(message, statusCode, retryable, requestId, errorCode, isSafetyRefusal);
    }

    private static bool IsSafetyRefusal(string? providerMessage, string? errorCode)
    {
        var normalisedCode = errorCode?.Trim().ToLowerInvariant();
        if (normalisedCode is
            "content_policy_violation" or
            "content_policy_error" or
            "moderation_blocked" or
            "safety_violation" or
            "safety_violations")
        {
            return true;
        }

        if (string.IsNullOrWhiteSpace(providerMessage)) return false;

        var normalisedMessage = providerMessage.ToLowerInvariant();
        return normalisedMessage.Contains("content policy", StringComparison.Ordinal) ||
               normalisedMessage.Contains("content_policy", StringComparison.Ordinal) ||
               normalisedMessage.Contains("safety system", StringComparison.Ordinal) ||
               normalisedMessage.Contains("safety reasons", StringComparison.Ordinal) ||
               normalisedMessage.Contains("safety guardrail", StringComparison.Ordinal) ||
               normalisedMessage.Contains("moderation", StringComparison.Ordinal);
    }

    private static (string? Message, string? Code) ReadProviderError(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            if (!document.RootElement.TryGetProperty("error", out var error)) return (null, null);
            var message = error.TryGetProperty("message", out var messageElement)
                ? SanitiseProviderValue(messageElement.GetString())
                : null;
            var code = error.TryGetProperty("code", out var codeElement)
                ? SanitiseProviderValue(codeElement.ValueKind == JsonValueKind.String ? codeElement.GetString() : codeElement.ToString(), 100)
                : null;
            return (message, code);
        }
        catch (JsonException)
        {
            return (null, null);
        }
    }

    private static string? SanitiseProviderValue(string? value, int maximumLength = 500)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var compact = Regex.Replace(value, "\\s+", " ").Trim();
        return compact.Length <= maximumLength ? compact : compact[..maximumLength] + "…";
    }


    private static ImagePayload DecodeDataUrl(string dataUrl)
    {
        const string marker = ";base64,";
        var markerIndex = dataUrl.IndexOf(marker, StringComparison.OrdinalIgnoreCase);

        if (!dataUrl.StartsWith("data:", StringComparison.OrdinalIgnoreCase) || markerIndex < 0)
        {
            throw new InvalidOperationException("The supplied image data was not a valid data URL.");
        }

        var contentType = dataUrl[5..markerIndex].Trim();
        if (string.IsNullOrWhiteSpace(contentType))
        {
            contentType = "image/png";
        }

        var base64 = dataUrl[(markerIndex + marker.Length)..];
        var bytes = Convert.FromBase64String(base64);
        return new ImagePayload(bytes, contentType, GuessFileExtension(contentType));
    }

    private static string GuessFileExtension(string contentType) => contentType.ToLowerInvariant() switch
    {
        "image/jpeg" => ".jpg",
        "image/jpg" => ".jpg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        _ => ".png"
    };

    private static string BuildSafeFileName(string? originalName, string extension, int index)
    {
        var stem = Path.GetFileNameWithoutExtension(originalName);
        if (string.IsNullOrWhiteSpace(stem))
        {
            stem = $"supporting-image-{index + 1}";
        }

        stem = Regex.Replace(stem, "[^a-zA-Z0-9-_]+", "-").Trim('-');
        if (string.IsNullOrWhiteSpace(stem))
        {
            stem = $"supporting-image-{index + 1}";
        }

        return $"{stem}{extension}";
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

    private sealed record ImagePayload(byte[] Bytes, string ContentType, string FileExtension);

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

    private static EventDefinition ResolveEventDefinition(EventDefinition configured, string? eventName, string description)
    {
        if (string.IsNullOrWhiteSpace(eventName) || string.Equals(eventName.Trim(), configured.Name, StringComparison.OrdinalIgnoreCase))
        {
            return configured;
        }

        return new EventDefinition
        {
            Id = configured.Id,
            Name = eventName.Trim(),
            Description = string.IsNullOrWhiteSpace(description) ? configured.Description : description.Trim(),
            DefaultDate = configured.DefaultDate,
            DefaultPrice = configured.DefaultPrice,
            SceneRecipe = configured.SceneRecipe
        };
    }

}
