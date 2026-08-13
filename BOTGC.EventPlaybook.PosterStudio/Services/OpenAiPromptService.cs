using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BOTGC.EventPlaybook.PosterStudio.Models;
using BOTGC.EventPlaybook.PosterStudio.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.PosterStudio.Services;

public sealed class OpenAiPromptService(
    IHttpClientFactory httpClientFactory,
    IPosterConfigurationService posterConfiguration,
    IOptions<OpenAiOptions> options,
    ILogger<OpenAiPromptService> logger) : IImagePromptService
{
    private readonly OpenAiOptions _options = options.Value;

    public async Task<ImagePromptResult> BuildPrimaryPromptAsync(
        GeneratePosterRequest request,
        EventDefinition eventDefinition,
        PosterStyleDefinition style,
        PosterOutputDefinition output,
        CancellationToken cancellationToken)
    {
        var configuration = posterConfiguration.Get();
        var fallbackPrompt = BuildPrimaryFallbackPrompt(
            configuration,
            request,
            eventDefinition,
            style,
            output);

        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            return new ImagePromptResult
            {
                Prompt = fallbackPrompt,
                Model = "deterministic-fallback"
            };
        }

        var brief = new
        {
            task = "Create the final image-generation prompt for the PRIMARY finished event poster.",
            brand = configuration.Brand.Name,
            eventData = new
            {
                title = eventDefinition.Name,
                description = request.Description.Trim(),
                eventDefinition.SceneRecipe
            },
            stylePreset = new
            {
                metadataName = style.Name,
                style.StyleDirection,
                style.VisualLanguage,
                style.Mood,
                style.Avoid
            },
            output = new
            {
                output.Name,
                output.Width,
                output.Height,
                output.Purpose,
                output.CompositionGuidance,
                output.ReservedOverlayZones
            },
            posterContent = new
            {
                renderAsFinishedPoster = true,
                clubName = configuration.Brand.Name,
                eventTitle = eventDefinition.Name,
                eventDate = request.IncludeDate ? FormatEventDate(request.EventDate) : null,
                price = request.IncludePrice ? request.Price?.Trim() : null,
                exactTextRule = "Render the supplied club name, event title, date and price exactly as written. Do not paraphrase, correct, abbreviate or invent alternatives.",
                supportingCopyRule = "You may devise a short event-specific subtitle, explanatory line and call to action when they improve the poster. Keep them concise, relevant and consistent with the event description.",
                stylePresetNameIsMetadataOnly = true
            },
            organiserInstructions = NormaliseOptional(request.AdditionalInstructions),
            refinementNotes = NormaliseOptional(request.RefinementNotes),
            globalImageRules = configuration.Prompting.GlobalImageRules,
            globalExclusions = configuration.Prompting.GlobalExclusions
        };

        return await CreatePromptAsync(
            configuration.Prompting.CreativeDirectorInstruction,
            brief,
            fallbackPrompt,
            cancellationToken);
    }

    public async Task<ImagePromptResult> BuildVariantPromptAsync(
        GenerateVariantRequest request,
        EventDefinition eventDefinition,
        PosterStyleDefinition style,
        PosterOutputDefinition output,
        CancellationToken cancellationToken)
    {
        var configuration = posterConfiguration.Get();
        var fallbackPrompt = BuildVariantFallbackPrompt(
            configuration,
            request,
            eventDefinition,
            style,
            output);

        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            return new ImagePromptResult
            {
                Prompt = fallbackPrompt,
                Model = "deterministic-fallback"
            };
        }

        var brief = new
        {
            task = "Create the final image-edit prompt for adapting the supplied PRIMARY finished event poster into another format.",
            sourceImageInstruction = "The supplied image is the approved finished campaign poster and must remain recognisably the same campaign. Preserve the exact required text and recompose the complete design rather than inventing a new concept.",
            brand = configuration.Brand.Name,
            eventData = new
            {
                title = eventDefinition.Name,
                description = request.Description.Trim(),
                eventDefinition.SceneRecipe
            },
            stylePreset = new
            {
                metadataName = style.Name,
                style.StyleDirection,
                style.VisualLanguage,
                style.Mood,
                style.Avoid
            },
            targetOutput = new
            {
                output.Name,
                output.Width,
                output.Height,
                output.Purpose,
                output.CompositionGuidance,
                output.ReservedOverlayZones
            },
            posterContent = new
            {
                renderAsFinishedPoster = true,
                clubName = configuration.Brand.Name,
                eventTitle = eventDefinition.Name,
                eventDate = request.IncludeDate ? FormatEventDate(request.EventDate) : null,
                price = request.IncludePrice ? request.Price?.Trim() : null,
                exactTextRule = "Preserve and render all supplied required text exactly. The adapted image must not change spelling, wording, dates, currency or event identity.",
                supportingCopyRule = "Preserve useful supporting campaign copy from the primary poster unless the target format requires a shorter version for legibility.",
                stylePresetNameIsMetadataOnly = true
            },
            organiserInstructions = NormaliseOptional(request.AdditionalInstructions),
            refinementNotes = NormaliseOptional(request.RefinementNotes),
            globalImageRules = configuration.Prompting.GlobalImageRules,
            globalExclusions = configuration.Prompting.GlobalExclusions
        };

        return await CreatePromptAsync(
            configuration.Prompting.CreativeDirectorInstruction,
            brief,
            fallbackPrompt,
            cancellationToken);
    }

    private async Task<ImagePromptResult> CreatePromptAsync(
        string systemInstruction,
        object brief,
        string fallbackPrompt,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "chat/completions");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
        request.Content = JsonContent.Create(new
        {
            model = _options.PromptModel,
            messages = new object[]
            {
                new
                {
                    role = "system",
                    content = systemInstruction
                },
                new
                {
                    role = "user",
                    content = JsonSerializer.Serialize(brief, new JsonSerializerOptions
                    {
                        WriteIndented = true
                    })
                }
            }
        });

        using var client = httpClientFactory.CreateClient("OpenAI");
        using var response = await client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning(
                "OpenAI prompt generation failed with {StatusCode}. Falling back to deterministic prompt. Response: {Body}",
                response.StatusCode,
                body);

            return new ImagePromptResult
            {
                Prompt = fallbackPrompt,
                Model = "deterministic-fallback"
            };
        }

        var prompt = ParseChatCompletion(body);

        if (string.IsNullOrWhiteSpace(prompt))
        {
            logger.LogWarning("OpenAI prompt generation returned no usable prompt. Falling back to deterministic prompt.");

            return new ImagePromptResult
            {
                Prompt = fallbackPrompt,
                Model = "deterministic-fallback"
            };
        }

        logger.LogInformation(
            "Creative-director prompt generated with {PromptModel}. Prompt length: {PromptLength} characters.",
            _options.PromptModel,
            prompt.Length);
        logger.LogDebug("Generated image prompt: {Prompt}", prompt);

        return new ImagePromptResult
        {
            Prompt = prompt,
            Model = _options.PromptModel
        };
    }

    private static string ParseChatCompletion(string body)
    {
        using var document = JsonDocument.Parse(body);

        if (!document.RootElement.TryGetProperty("choices", out var choices) ||
            choices.ValueKind != JsonValueKind.Array ||
            choices.GetArrayLength() == 0)
        {
            return string.Empty;
        }

        var message = choices[0].GetProperty("message");

        if (!message.TryGetProperty("content", out var content))
        {
            return string.Empty;
        }

        return StripCodeFence(content.GetString()?.Trim() ?? string.Empty);
    }

    private static string BuildPrimaryFallbackPrompt(
        PosterConfiguration configuration,
        GeneratePosterRequest request,
        EventDefinition eventDefinition,
        PosterStyleDefinition style,
        PosterOutputDefinition output)
    {
        var builder = new StringBuilder();
        builder.AppendLine($"Create a premium finished event poster for the golf-club event '{eventDefinition.Name}'.");
        builder.AppendLine();
        builder.AppendLine("OBJECTIVE");
        builder.AppendLine("Create the complete finished poster, integrating illustration, typography and event information into one coherent professional design. The poster must instantly communicate the event concept and remain readable at distance.");
        builder.AppendLine();
        builder.AppendLine("EVENT CONCEPT");
        builder.AppendLine(request.Description.Trim());
        builder.AppendLine(eventDefinition.SceneRecipe.CentralIdea);
        builder.AppendLine();
        builder.AppendLine("PRIMARY SCENE");
        builder.AppendLine(eventDefinition.SceneRecipe.PrimaryScene);
        AppendList(builder, eventDefinition.SceneRecipe.MustShow);
        builder.AppendLine();
        builder.AppendLine("VISUAL STYLE");
        builder.AppendLine(style.StyleDirection);
        AppendList(builder, style.VisualLanguage);
        builder.AppendLine();
        builder.AppendLine("MOOD AND CHARACTER");
        AppendList(builder, style.Mood);
        AppendList(builder, eventDefinition.SceneRecipe.MoodAndHumour);
        builder.AppendLine();
        builder.AppendLine("SUPPORTING DETAIL");
        AppendList(builder, eventDefinition.SceneRecipe.SupportingDetails);
        builder.AppendLine();
        builder.AppendLine("COMPOSITION");
        builder.AppendLine($"Design for {output.Name}, {output.Width}:{output.Height} portrait ratio. {output.CompositionGuidance}");
        AppendList(builder, output.ReservedOverlayZones);
        builder.AppendLine("Create one clear focal scene and integrate the required typography into the composition rather than reserving empty areas for later application overlays.");
        AppendList(builder, configuration.Prompting.GlobalImageRules);
        builder.AppendLine();
        builder.AppendLine("REQUIRED POSTER TEXT");
        builder.AppendLine($"Club name: {configuration.Brand.Name}");
        builder.AppendLine($"Event title: {eventDefinition.Name}");

        if (request.IncludeDate)
        {
            builder.AppendLine($"Event date: {FormatEventDate(request.EventDate)}");
        }

        if (request.IncludePrice && !string.IsNullOrWhiteSpace(request.Price))
        {
            builder.AppendLine($"Price: {request.Price.Trim()}");
        }

        builder.AppendLine("Render the required poster text exactly as written. Do not paraphrase, abbreviate, alter spelling, alter dates or invent a different price.");
        builder.AppendLine("You may add a concise event-specific subtitle, simple explanatory copy and a short call to action if they improve the campaign, but keep the poster uncluttered.");
        builder.AppendLine("The selected style name is internal metadata and must never appear as poster copy.");

        if (!string.IsNullOrWhiteSpace(request.AdditionalInstructions))
        {
            builder.AppendLine();
            builder.AppendLine("ORGANISER-SPECIFIC DIRECTION");
            builder.AppendLine(request.AdditionalInstructions.Trim());
        }

        if (!string.IsNullOrWhiteSpace(request.RefinementNotes))
        {
            builder.AppendLine();
            builder.AppendLine("REFINEMENT OF THE SUPPLIED PREVIOUS ARTWORK");
            builder.AppendLine(request.RefinementNotes.Trim());
            builder.AppendLine("Preserve successful aspects of the previous campaign unless the refinement notes explicitly ask for them to change.");
        }

        builder.AppendLine();
        builder.AppendLine("CRITICAL EXCLUSIONS");
        AppendList(builder, configuration.Prompting.GlobalExclusions);
        AppendList(builder, style.Avoid);
        AppendList(builder, eventDefinition.SceneRecipe.Avoid);
        builder.AppendLine("Do not write the selected style name anywhere in the image.");
        builder.AppendLine("Do not invent fake dates, prices, sponsor names, competition details or club branding.");

        return builder.ToString().Trim();
    }

    private static string BuildVariantFallbackPrompt(
        PosterConfiguration configuration,
        GenerateVariantRequest request,
        EventDefinition eventDefinition,
        PosterStyleDefinition style,
        PosterOutputDefinition output)
    {
        var builder = new StringBuilder();
        builder.AppendLine($"Adapt the supplied approved '{eventDefinition.Name}' campaign artwork for {output.Name}.");
        builder.AppendLine("Preserve the same campaign concept, main characters or subjects, visual language, palette, mood and storytelling. The result must obviously belong to the same campaign.");
        builder.AppendLine("Recompose the scene deliberately for the new frame. Do not merely crop the source image and do not invent a different campaign concept.");
        builder.AppendLine($"Target composition: {output.Width}:{output.Height}. {output.CompositionGuidance}");
        AppendList(builder, output.ReservedOverlayZones);
        builder.AppendLine("Maintain the event's defining visual idea:");
        builder.AppendLine(eventDefinition.SceneRecipe.CentralIdea);
        AppendList(builder, eventDefinition.SceneRecipe.MustShow);
        builder.AppendLine("Keep the selected visual style consistent:");
        builder.AppendLine(style.StyleDirection);

        if (!string.IsNullOrWhiteSpace(request.AdditionalInstructions))
        {
            builder.AppendLine($"Organiser-specific direction: {request.AdditionalInstructions.Trim()}");
        }

        if (!string.IsNullOrWhiteSpace(request.RefinementNotes))
        {
            builder.AppendLine($"Campaign refinement direction: {request.RefinementNotes.Trim()}");
        }

        builder.AppendLine("REQUIRED TEXT TO PRESERVE");
        builder.AppendLine($"Club name: {configuration.Brand.Name}");
        builder.AppendLine($"Event title: {eventDefinition.Name}");

        if (request.IncludeDate)
        {
            builder.AppendLine($"Event date: {FormatEventDate(request.EventDate)}");
        }

        if (request.IncludePrice && !string.IsNullOrWhiteSpace(request.Price))
        {
            builder.AppendLine($"Price: {request.Price.Trim()}");
        }

        builder.AppendLine("Preserve the wording, spelling and numeric values exactly while recomposing the typography for the target format. The style preset name is metadata only and must never appear in the image.");
        AppendList(builder, configuration.Prompting.GlobalImageRules);
        AppendList(builder, configuration.Prompting.GlobalExclusions);
        AppendList(builder, style.Avoid);
        AppendList(builder, eventDefinition.SceneRecipe.Avoid);

        return builder.ToString().Trim();
    }

    private static void AppendList(StringBuilder builder, IEnumerable<string> items)
    {
        foreach (var item in items.Where(x => !string.IsNullOrWhiteSpace(x)))
        {
            builder.AppendLine($"- {item.Trim()}");
        }
    }

    private static string FormatEventDate(string value)
    {
        if (!DateOnly.TryParse(value, out var date))
        {
            return value.Trim();
        }

        return date.ToDateTime(TimeOnly.MinValue).ToString("dddd d MMMM yyyy", System.Globalization.CultureInfo.GetCultureInfo("en-GB"));
    }

    private static string? NormaliseOptional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string StripCodeFence(string value)
    {
        if (!value.StartsWith("```", StringComparison.Ordinal))
        {
            return value;
        }

        var firstLineBreak = value.IndexOf('\n');
        var lastFence = value.LastIndexOf("```", StringComparison.Ordinal);

        if (firstLineBreak < 0 || lastFence <= firstLineBreak)
        {
            return value;
        }

        return value[(firstLineBreak + 1)..lastFence].Trim();
    }
}
