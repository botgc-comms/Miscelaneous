using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.Services;

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
        var styleVariation = ResolveStyleVariation(style, request.StyleVariationId);
        var fallbackPrompt = BuildPrimaryFallbackPrompt(
            configuration,
            request,
            eventDefinition,
            style,
            styleVariation,
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
            task = "Create the final image-generation prompt for the PRIMARY finished event poster. The prompt must visibly dramatise the organiser-supplied event description, not merely acknowledge it.",
            brand = request.IncludeClubBranding ? configuration.Brand.Name : null,
            eventData = new
            {
                title = eventDefinition.Name,
                organiserDescription = request.Description.Trim(),
                descriptionPriority = "The organiser description is the primary source of truth for the visual concept. Extract every concrete, distinctive visual element from it and make the most memorable ones visible in the scene. Do not collapse a colourful or unusual event into generic golf imagery.",
                requiredVisualExtraction = "Before writing the final image prompt, identify the event's distinctive nouns, characters, activities, props, entertainment, food, setting and humour. Convert those into explicit must-show visual instructions. If the description contains unusual elements such as animals, costumes, performers, themed food or entertainment, those elements must visibly drive the poster concept rather than becoming background flavour.",
                eventDefinition.SceneRecipe
            },
            stylePreset = new
            {
                metadataName = style.Name,
                style.StyleDirection,
                style.ColourDirection,
                style.VisualLanguage,
                style.Mood,
                style.Avoid,
                selectedVariation = styleVariation is null
                    ? null
                    : new
                    {
                        metadataId = styleVariation.Id,
                        metadataName = styleVariation.Name,
                        namedIllustrator = styleVariation.ArtistName,
                        referenceWork = styleVariation.ReferenceWork,
                        explicitStyleInstruction = BuildExplicitVariationInstruction(styleVariation, isVariant: false),
                        styleVariation.StyleDirection,
                        styleVariation.ColourDirection
                    }
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
                fullFrameRule = "The generated image is the finished artwork itself. Fill the complete requested canvas edge to edge; do not show a poster, sheet, border, frame or mockup inside the image.",
                clubName = request.IncludeClubBranding ? configuration.Brand.Name : null,
                clubBrandingRequested = request.IncludeClubBranding,
                eventTitle = eventDefinition.Name,
                eventDate = request.IncludeDate ? FormatEventDate(request.EventDate) : null,
                price = request.IncludePrice ? request.Price?.Trim() : null,
                exactTextRule = request.IncludeClubBranding
                    ? "Render the supplied club name, event title, date and price exactly as written. Do not paraphrase, correct, abbreviate or invent alternatives."
                    : "Render the supplied event title, date and price exactly as written. Do not paraphrase, correct, abbreviate or invent alternatives.",
                clubBrandingRule = request.IncludeClubBranding
                    ? "The real Club mark will be applied after generation. Keep the upper-right safe area visually quiet for it, but do not draw, imitate or invent a crest, shield, monogram or logo."
                    : "This is an internal Club asset. Do not show the Club name, BOTGC initials, a crest, shield, monogram, wordmark or any other Club logo or branding anywhere in the poster.",
                textSafetyRule = "Every required word must be fully visible. Obey the output-specific safe margins as a hard boundary. No glyph, word, date, price, text box, text badge or text-bearing panel may touch, cross or be clipped by any image edge. Reflow or reduce type size before violating the safe area.",
                supportingCopyRule = "You may devise a short event-specific subtitle, explanatory line and call to action when they improve the poster. Keep them concise, relevant and consistent with the event description.",
                colourQualityRule = configuration.Prompting.ColourQualityDirection,
                stylePresetNameIsMetadataOnly = true
            },
            supportingReferences = DescribeSupportingImages(
                request.SupportingImages,
                "Supporting images are attached separately. Use them as visual references for real-world details that should appear in the poster, such as a trophy, mascot, prop, logo placement context or venue-specific object. When a supporting image clearly depicts a featured object, incorporate that object's recognisable design rather than inventing a generic substitute."),
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
        var styleVariation = ResolveStyleVariation(style, request.StyleVariationId);
        var fallbackPrompt = BuildVariantFallbackPrompt(
            configuration,
            request,
            eventDefinition,
            style,
            styleVariation,
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
            task = "Create the final image-edit prompt for adapting the supplied DIGITAL-SCREEN MASTER poster into another format. The result is another version of the same campaign, with only the compositional differences required by the target dimensions.",
            sourceImageInstruction = "The first attached image, named primary-campaign-artwork.png, is the authoritative key reference and approved finished campaign master. Preserve its subjects, campaign idea, art direction, colour relationships, visual details, typography character and exact required text. Preserve or improve the master's colour richness and tonal separation; never mute, desaturate or wash out its palette. Supporting images are secondary references only. Recompose the complete design for the new frame rather than cropping the master or inventing a new concept.",
            brand = request.IncludeClubBranding ? configuration.Brand.Name : null,
            eventData = new
            {
                title = eventDefinition.Name,
                organiserDescription = request.Description.Trim(),
                descriptionPriority = "The organiser description is the primary source of truth for the visual concept. Extract every concrete, distinctive visual element from it and make the most memorable ones visible in the scene. Do not collapse a colourful or unusual event into generic golf imagery.",
                requiredVisualExtraction = "Before writing the final image prompt, identify the event's distinctive nouns, characters, activities, props, entertainment, food, setting and humour. Convert those into explicit must-show visual instructions. If the description contains unusual elements such as animals, costumes, performers, themed food or entertainment, those elements must visibly drive the poster concept rather than becoming background flavour.",
                eventDefinition.SceneRecipe
            },
            stylePreset = new
            {
                metadataName = style.Name,
                style.StyleDirection,
                style.ColourDirection,
                style.VisualLanguage,
                style.Mood,
                style.Avoid,
                selectedVariation = styleVariation is null
                    ? null
                    : new
                    {
                        metadataId = styleVariation.Id,
                        metadataName = styleVariation.Name,
                        namedIllustrator = styleVariation.ArtistName,
                        referenceWork = styleVariation.ReferenceWork,
                        explicitStyleInstruction = BuildExplicitVariationInstruction(styleVariation, isVariant: true),
                        styleVariation.StyleDirection,
                        styleVariation.ColourDirection
                    }
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
                fullFrameRule = "The adapted image is the finished target artwork itself. Recompose it edge to edge for the complete target canvas; never place the source poster inside a frame, border, mat, mockup or blurred duplicate background.",
                clubName = request.IncludeClubBranding ? configuration.Brand.Name : null,
                clubBrandingRequested = request.IncludeClubBranding,
                eventTitle = eventDefinition.Name,
                eventDate = request.IncludeDate ? FormatEventDate(request.EventDate) : null,
                price = request.IncludePrice ? request.Price?.Trim() : null,
                exactTextRule = "Preserve and render all supplied required text exactly. The adapted image must not change spelling, wording, dates, currency or event identity.",
                clubBrandingRule = request.IncludeClubBranding
                    ? "The real Club mark will be applied after generation. Keep the upper-right safe area visually quiet for it, but do not draw, imitate or invent a crest, shield, monogram or logo."
                    : "Remove and do not reproduce any Club name, BOTGC initials, crest, shield, monogram, wordmark or other Club logo that may be present in the source artwork.",
                textSafetyRule = "Recompose every text element fully inside the target output safe margins. No glyph, word, date, price, text box, text badge or text-bearing panel may be cropped, clipped or touch an image edge. Reduce or reflow typography as needed.",
                adaptationContinuityRule = "The target must read as the same campaign at a different dimension: retain the master's recognisable scene and hierarchy, then reposition, reflow or resize elements only as needed. Never solve the aspect-ratio change with a crop.",
                colourQualityRule = configuration.Prompting.ColourQualityDirection,
                supportingCopyRule = "Preserve useful supporting campaign copy from the primary poster unless the target format requires a shorter version for legibility.",
                stylePresetNameIsMetadataOnly = true
            },
            supportingReferences = DescribeSupportingImages(
                request.SupportingImages,
                "The primary poster image is attached together with any supporting reference images. Preserve campaign consistency from the primary poster, and also use the supporting references for specific objects or details that must carry through the campaign, such as a trophy or other recognisable event asset."),
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
        PosterStyleVariationDefinition? styleVariation,
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
        if (styleVariation is not null)
        {
            builder.AppendLine(BuildExplicitVariationInstruction(styleVariation, isVariant: false));
            builder.AppendLine("Use this selected art direction consistently while creating a new, event-specific composition:");
            builder.AppendLine(styleVariation.StyleDirection);
        }
        AppendList(builder, style.VisualLanguage);
        builder.AppendLine();
        builder.AppendLine("COLOUR DIRECTION — REQUIRED");
        builder.AppendLine(configuration.Prompting.ColourQualityDirection);
        builder.AppendLine(style.ColourDirection);
        if (!string.IsNullOrWhiteSpace(styleVariation?.ColourDirection))
        {
            builder.AppendLine(styleVariation.ColourDirection);
        }
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
        builder.AppendLine("Create one clear focal scene and integrate the required typography into the composition rather than reserving empty areas for later application overlays. Every required text element must be fully visible with generous margins. Never crop, clip, truncate or let text touch the poster edge. If necessary, use smaller type or more line breaks.");
        AppendList(builder, configuration.Prompting.GlobalImageRules);

        AppendSupportingImagePrompt(builder, request.SupportingImages,
            "Use any separately supplied supporting images as factual visual references for distinctive event details. If a supporting image shows a trophy, prop, mascot or other important object, incorporate that recognisable design into the poster rather than inventing a generic substitute.");
        builder.AppendLine();
        builder.AppendLine("REQUIRED POSTER TEXT");
        if (request.IncludeClubBranding)
        {
            builder.AppendLine($"Club name: {configuration.Brand.Name}");
            builder.AppendLine("The real Club mark will be applied after generation. Keep the upper-right safe area visually quiet for it, but do not draw, imitate or invent a crest, shield, monogram or logo.");
        }
        else
        {
            builder.AppendLine("Do not include the Club name, BOTGC initials, a crest, shield, monogram, wordmark or any other Club logo or branding anywhere in the poster.");
        }
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
        builder.AppendLine("TEXT SAFETY — NON-NEGOTIABLE");
        builder.AppendLine("Every required word, date, price and text-bearing design element must be fully visible and comfortably inside the output-specific safe margins. Never crop, clip or truncate typography. No glyph may touch or cross any edge. Reflow or reduce type size before violating the safe area.");
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
        PosterStyleVariationDefinition? styleVariation,
        PosterOutputDefinition output)
    {
        var builder = new StringBuilder();
        builder.AppendLine($"Adapt the supplied approved '{eventDefinition.Name}' campaign artwork for {output.Name}.");
        builder.AppendLine("The first attached image, primary-campaign-artwork.png, is the authoritative digital-screen master and dominant key reference. Any other attached files are supporting references only.");
        builder.AppendLine("Preserve the same campaign concept, main characters or subjects, visual language, colour relationships, mood and storytelling. Preserve or improve the master's colour richness and tonal separation; never mute, desaturate or wash out its palette. The result must obviously belong to the same campaign.");
        builder.AppendLine("Recompose the scene and typography deliberately for the new frame. Never crop, zoom or clip the source to fill the target. Reposition, reflow or reduce elements so every required word remains complete and comfortably inside the target safe area.");
        builder.AppendLine($"Target composition: {output.Width}:{output.Height}. {output.CompositionGuidance}");
        AppendList(builder, output.ReservedOverlayZones);
        builder.AppendLine("Maintain the event's defining visual idea:");
        builder.AppendLine(eventDefinition.SceneRecipe.CentralIdea);
        AppendList(builder, eventDefinition.SceneRecipe.MustShow);
        builder.AppendLine("Keep the selected visual style consistent:");
        builder.AppendLine(style.StyleDirection);
        if (styleVariation is not null)
        {
            builder.AppendLine(BuildExplicitVariationInstruction(styleVariation, isVariant: true));
            builder.AppendLine("Use the same selected art direction consistently for this adapted format:");
            builder.AppendLine(styleVariation.StyleDirection);
        }

        builder.AppendLine("COLOUR DIRECTION — REQUIRED");
        builder.AppendLine(configuration.Prompting.ColourQualityDirection);
        builder.AppendLine(style.ColourDirection);
        if (!string.IsNullOrWhiteSpace(styleVariation?.ColourDirection))
        {
            builder.AppendLine(styleVariation.ColourDirection);
        }

        if (!string.IsNullOrWhiteSpace(request.AdditionalInstructions))
        {
            builder.AppendLine($"Organiser-specific direction: {request.AdditionalInstructions.Trim()}");
        }

        if (!string.IsNullOrWhiteSpace(request.RefinementNotes))
        {
            builder.AppendLine($"Campaign refinement direction: {request.RefinementNotes.Trim()}");
        }

        AppendSupportingImagePrompt(builder, request.SupportingImages,
            "Use any separately supplied supporting images as visual references for specific objects or details that the campaign should preserve, such as a trophy, prop, mascot or other distinctive event asset.");

        builder.AppendLine("REQUIRED TEXT TO PRESERVE");
        if (request.IncludeClubBranding)
        {
            builder.AppendLine($"Club name: {configuration.Brand.Name}");
            builder.AppendLine("The real Club mark will be applied after generation. Keep the upper-right safe area visually quiet for it, but do not draw, imitate or invent a crest, shield, monogram or logo.");
        }
        else
        {
            builder.AppendLine("Remove and do not reproduce any Club name, BOTGC initials, crest, shield, monogram, wordmark or other Club logo that may be present in the source artwork.");
        }
        builder.AppendLine($"Event title: {eventDefinition.Name}");

        if (request.IncludeDate)
        {
            builder.AppendLine($"Event date: {FormatEventDate(request.EventDate)}");
        }

        if (request.IncludePrice && !string.IsNullOrWhiteSpace(request.Price))
        {
            builder.AppendLine($"Price: {request.Price.Trim()}");
        }

        builder.AppendLine("Preserve the wording, spelling and numeric values exactly while recomposing the typography for the target format. Every required text element must remain fully visible with generous margins and must never be clipped by the image edge. The style preset name is metadata only and must never appear in the image.");
        AppendList(builder, configuration.Prompting.GlobalImageRules);
        AppendList(builder, configuration.Prompting.GlobalExclusions);
        AppendList(builder, style.Avoid);
        AppendList(builder, eventDefinition.SceneRecipe.Avoid);

        return builder.ToString().Trim();
    }


    private static PosterStyleVariationDefinition? ResolveStyleVariation(
        PosterStyleDefinition style,
        string? variationId)
    {
        if (style.Variations.Count == 0)
        {
            return null;
        }

        if (!string.IsNullOrWhiteSpace(variationId))
        {
            var selected = style.Variations.FirstOrDefault(variation =>
                string.Equals(variation.Id, variationId, StringComparison.OrdinalIgnoreCase));

            if (selected is not null)
            {
                return selected;
            }
        }

        return style.Variations[Random.Shared.Next(style.Variations.Count)];
    }

    private static string BuildExplicitVariationInstruction(
        PosterStyleVariationDefinition variation,
        bool isVariant)
    {
        if (string.IsNullOrWhiteSpace(variation.ArtistName))
        {
            return isVariant
                ? $"Preserve the master campaign's '{variation.Name}' art direction."
                : $"Use the selected '{variation.Name}' art direction.";
        }

        var workReference = string.IsNullOrWhiteSpace(variation.ReferenceWork)
            ? string.Empty
            : $", taking {variation.ReferenceWork} as the named reference work";

        return isVariant
            ? $"Preserve the master campaign's style of {variation.ArtistName}{workReference}."
            : $"Create this poster in the style of {variation.ArtistName}{workReference}.";
    }


    private static object? DescribeSupportingImages(
        IReadOnlyCollection<SupportingImageReference> supportingImages,
        string instruction)
    {
        if (supportingImages.Count == 0)
        {
            return null;
        }

        return new
        {
            count = supportingImages.Count,
            instruction,
            files = supportingImages.Select(image => new
            {
                fileName = image.FileName,
                title = image.Title,
                category = image.Category,
                description = image.Description,
                tags = image.Tags,
                source = image.Source
            }).ToArray()
        };
    }

    private static void AppendSupportingImagePrompt(
        StringBuilder builder,
        IReadOnlyCollection<SupportingImageReference> supportingImages,
        string instruction)
    {
        if (supportingImages.Count == 0)
        {
            return;
        }

        builder.AppendLine();
        builder.AppendLine("SUPPORTING REFERENCE IMAGES");
        builder.AppendLine(instruction);
        builder.AppendLine("Treat each descriptive note as part of the brief when deciding what club details or objects to carry into the artwork.");
        foreach (var image in supportingImages)
        {
            var title = string.IsNullOrWhiteSpace(image.Title) ? image.FileName.Trim() : image.Title.Trim();
            var parts = new List<string> { $"Reference file: {title}" };

            if (!string.IsNullOrWhiteSpace(image.Category))
            {
                parts.Add($"category {image.Category.Trim()}");
            }

            if (!string.IsNullOrWhiteSpace(image.Description))
            {
                parts.Add($"description {image.Description.Trim()}");
            }

            var tags = image.Tags.Where(tag => !string.IsNullOrWhiteSpace(tag)).ToArray();
            if (tags.Length > 0)
            {
                parts.Add($"tags {string.Join(", ", tags)}");
            }

            if (!string.IsNullOrWhiteSpace(image.Source))
            {
                parts.Add($"source {image.Source.Trim()}");
            }

            builder.AppendLine($"- {string.Join("; ", parts)}");
        }
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
