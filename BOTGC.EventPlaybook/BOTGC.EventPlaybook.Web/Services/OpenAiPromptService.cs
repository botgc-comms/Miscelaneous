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
    IClubBrandingStore clubBrandingStore,
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
        var clubName = (await clubBrandingStore.GetOverviewAsync(cancellationToken)).ClubName;
        var styleVariation = ResolveStyleVariation(style, request.StyleVariationId);
        var fallbackPrompt = BuildPrimaryFallbackPrompt(
            configuration,
            clubName,
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

        // Keep this property order deliberate. Subject matter is settled first,
        // relevant factual references second, visual treatment third, and the
        // invariant production rules last.
        var brief = new
        {
            task = request.IsConceptPreview
                ? "Create an image-generation prompt for ONE low-resolution DIGITAL-SCREEN CONCEPT PREVIEW. It is one of three alternative ideas from which the organiser will choose."
                : "Create the final image-generation prompt for the PRIMARY high-resolution finished event poster.",
            conceptWorkflow = request.IsConceptPreview
                ? new
                {
                    role = "Explore one distinctive, complete poster concept at draft quality. Commit to this selected visual direction so it is meaningfully different from the other concepts, while remaining faithful to the event brief.",
                    output = "A complete 9:16 digital-screen poster preview, not a mood board, contact sheet, framed poster or mockup.",
                    typography = "Include the required title, date and price clearly enough for concept selection. Keep every text element inside generous safe margins. The selected preview is a composition reference; exact typography will be re-rendered in the final master."
                }
                : null,
            selectedConceptReference = !request.IsConceptPreview && !string.IsNullOrWhiteSpace(request.SelectedConceptDataUrl)
                ? new
                {
                    source = "The first attached image, selected-concept-preview.png, is the organiser's chosen concept and the authoritative reference for composition, subjects, visual hierarchy, palette, mood and art direction.",
                    continuity = "Produce a polished high-resolution version of that chosen concept. Preserve its recognisable idea and layout relationships; do not substitute a different campaign concept.",
                    typography = "Treat text visible in the preview as provisional artwork, not authoritative copy. Re-render the exact required event title, date and price from this brief, correcting spelling or legibility problems and keeping every character fully inside the safe area."
                }
                : null,
            contentIntent = new
            {
                eventTitle = eventDefinition.Name,
                eventDescription = request.Description.Trim(),
                additionalCreativeInstructions = NormaliseOptional(request.AdditionalInstructions),
                refinementNotes = NormaliseOptional(request.RefinementNotes),
                authorityRule = "The event description and additional creative instructions exclusively control what is depicted. Extract their concrete people, organisations, causes, characters, activities, props, entertainment, food, setting and humour. Do not add a separate catalogue scene recipe or replace a distinctive brief with generic golf imagery.",
                requestedContent = new
                {
                    eventDate = request.IncludeDate ? FormatEventDate(request.EventDate) : null,
                    price = request.IncludePrice ? request.Price?.Trim() : null,
                    clubName = request.IncludeClubBranding ? clubName : null,
                    clubLogoRequested = request.IncludeClubBranding,
                    clubLogoRule = request.IncludeClubBranding
                        ? "The real Club mark will be applied after generation. Keep the upper-right safe area visually quiet for it, but do not draw, imitate or invent it."
                        : "Do not show the Club name, club initials, a crest, shield, monogram, wordmark or any Club logo or branding."
                }
            },
            safetyRecovery = BuildSafetyRecoveryDirection(request),
            selectedRelevantReferences = DescribeSupportingImages(
                request.SupportingImages,
                "These images have already passed semantic relevance assessment against the complete content intent. Use each one only for the specific real-world subject identified by its matching instruction and relevance reason. Do not let a reference introduce unrelated subject matter."),
            selectedStyleDirection = new
            {
                metadataName = style.Name,
                baseDirection = style.StyleDirection,
                selectedInstruction = styleVariation is null
                    ? null
                    : new
                    {
                        metadataId = styleVariation.Id,
                        metadataName = styleVariation.Name,
                        namedIllustrator = styleVariation.ArtistName,
                        referenceWork = styleVariation.ReferenceWork,
                        references = styleVariation.References,
                        camera = styleVariation.Camera,
                        explicitInstruction = BuildExplicitVariationInstruction(styleVariation, isVariant: false),
                        description = styleVariation.StyleDirection,
                        styleVariation.ColourDirection
                    },
                style.ColourDirection,
                style.VisualLanguage,
                style.Mood,
                style.Avoid,
                rule = "Style changes treatment only. It must not replace, dilute or invent the content intent. The selected style name is metadata and must not appear as poster copy."
            },
            finalProductionRules = new
            {
                output = new
                {
                    output.Name,
                    output.Width,
                    output.Height,
                    output.Purpose,
                    output.CompositionGuidance,
                    output.ReservedOverlayZones
                },
                renderAsFinishedPoster = "Fill the complete requested canvas edge to edge. Do not show a poster, sheet, border, frame or mockup inside the image.",
                exactTextRule = "Render every supplied title, date and price exactly as written. Do not paraphrase, correct, abbreviate or invent alternatives.",
                titlePlacementRule = "Place the complete event title in a prominent text-safe area at or near the top of the poster, with generous clear space around every letter.",
                textSafetyRule = "Every required word must be fully visible. No glyph, word, date, price, text box, text badge or text-bearing panel may touch, cross or be clipped by any image edge. Reflow or reduce type size before violating the safe area.",
                supportingCopyRule = "Optional supporting copy must be concise, factually grounded in the event description and fully inside the safe area.",
                colourQualityRule = configuration.Prompting.ColourQualityDirection,
                globalImageRules = configuration.Prompting.GlobalImageRules,
                globalExclusions = configuration.Prompting.GlobalExclusions
            }
        };

        return await CreatePromptAsync(
            ApplyClubName(configuration.Prompting.CreativeDirectorInstruction, configuration.Brand.Name, clubName),
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
        var clubName = (await clubBrandingStore.GetOverviewAsync(cancellationToken)).ClubName;
        var styleVariation = ResolveStyleVariation(style, request.StyleVariationId);
        var fallbackPrompt = BuildVariantFallbackPrompt(
            configuration,
            clubName,
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
            brand = request.IncludeClubBranding ? clubName : null,
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
                        references = styleVariation.References,
                        camera = styleVariation.Camera,
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
                clubName = request.IncludeClubBranding ? clubName : null,
                clubBrandingRequested = request.IncludeClubBranding,
                eventTitle = eventDefinition.Name,
                eventDate = request.IncludeDate ? FormatEventDate(request.EventDate) : null,
                price = request.IncludePrice ? request.Price?.Trim() : null,
                exactTextRule = "Preserve and render all supplied required text exactly. The adapted image must not change spelling, wording, dates, currency or event identity.",
                clubBrandingRule = request.IncludeClubBranding
                    ? "The real Club mark will be applied after generation. Keep the upper-right safe area visually quiet for it, but do not draw, imitate or invent a crest, shield, monogram or logo."
                    : "Remove and do not reproduce any Club name, club initials, crest, shield, monogram, wordmark or other Club logo that may be present in the source artwork.",
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
            ApplyClubName(configuration.Prompting.CreativeDirectorInstruction, configuration.Brand.Name, clubName),
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
        string clubName,
        GeneratePosterRequest request,
        EventDefinition eventDefinition,
        PosterStyleDefinition style,
        PosterStyleVariationDefinition? styleVariation,
        PosterOutputDefinition output)
    {
        var builder = new StringBuilder();
        builder.AppendLine(request.IsConceptPreview
            ? $"Create one low-resolution 9:16 digital-screen poster concept for the golf-club event '{eventDefinition.Name}'. This is one of three alternative concepts from which the organiser will choose."
            : $"Create a premium high-resolution finished event poster for the golf-club event '{eventDefinition.Name}'.");
        if (request.IsConceptPreview)
        {
            builder.AppendLine("Commit to one distinctive, complete visual idea using the selected art direction. Produce the finished concept itself edge to edge, not a mood board, contact sheet, framed poster or mockup.");
            builder.AppendLine("Required text must be legible enough to assess and fully inside generous safe margins. The selected concept will later be re-rendered at high resolution with exact typography.");
        }
        else if (!string.IsNullOrWhiteSpace(request.SelectedConceptDataUrl))
        {
            builder.AppendLine("The first attached image, selected-concept-preview.png, is the organiser's chosen concept. Preserve its recognisable subjects, composition, hierarchy, palette, mood and art direction while producing a polished high-resolution master.");
            builder.AppendLine("Text visible in the concept is provisional. Re-render the exact required title, date and price from this brief, correct any preview spelling or legibility problems, and keep every character fully inside the safe area.");
        }
        builder.AppendLine();
        builder.AppendLine("1. EVENT CONTENT INTENT — CONTROLS WHAT IS DEPICTED");
        builder.AppendLine($"Event title: {eventDefinition.Name}");
        builder.AppendLine("Event description:");
        builder.AppendLine(request.Description.Trim());
        builder.AppendLine("Additional creative instructions:");
        builder.AppendLine(string.IsNullOrWhiteSpace(request.AdditionalInstructions)
            ? "None supplied."
            : request.AdditionalInstructions.Trim());
        if (!string.IsNullOrWhiteSpace(request.RefinementNotes))
        {
            builder.AppendLine("Refinement of the supplied previous campaign:");
            builder.AppendLine(request.RefinementNotes.Trim());
        }
        builder.AppendLine("The event description and additional creative instructions exclusively control the depicted subjects and story. Extract their concrete people, organisations, causes, characters, activities, props, entertainment, food, setting and humour. Do not replace them with a generic golf scene.");
        AppendSafetyRecoveryDirection(builder, request);
        builder.AppendLine();
        builder.AppendLine("Requested poster content:");
        if (request.IncludeDate)
        {
            builder.AppendLine($"- Include event date exactly: {FormatEventDate(request.EventDate)}");
        }
        if (request.IncludePrice && !string.IsNullOrWhiteSpace(request.Price))
        {
            builder.AppendLine($"- Include price exactly: {request.Price.Trim()}");
        }
        if (request.IncludeClubBranding)
        {
            builder.AppendLine($"- Include club name exactly: {clubName}");
            builder.AppendLine("- The real Club mark is added after generation. Keep the upper-right safe area quiet, but do not draw, imitate or invent a logo.");
        }
        else
        {
            builder.AppendLine("- Do not include the Club name, club initials, a crest, shield, monogram, wordmark or other Club branding.");
        }

        builder.AppendLine();
        builder.AppendLine("2. SELECTED RELEVANT REFERENCE IMAGES");
        AppendSupportingImagePrompt(builder, request.SupportingImages,
            "These images have already passed semantic relevance assessment against the event content intent. Use each only for the specific subject stated in its matching rule and reason. Do not introduce unrelated content from a reference.");
        if (request.SupportingImages.Count == 0)
        {
            builder.AppendLine("No library or event-specific reference image was supplied.");
        }

        builder.AppendLine();
        builder.AppendLine("3. RANDOMLY SELECTED STYLE INSTRUCTION — CONTROLS TREATMENT ONLY");
        builder.AppendLine(style.StyleDirection);
        if (styleVariation is not null)
        {
            builder.AppendLine(BuildExplicitVariationInstruction(styleVariation, isVariant: false));
            builder.AppendLine(styleVariation.StyleDirection);
        }
        AppendList(builder, style.VisualLanguage);
        AppendList(builder, style.Mood);
        builder.AppendLine(configuration.Prompting.ColourQualityDirection);
        builder.AppendLine(style.ColourDirection);
        if (!string.IsNullOrWhiteSpace(styleVariation?.ColourDirection)) builder.AppendLine(styleVariation.ColourDirection);
        builder.AppendLine("The style changes visual treatment only; it must not replace, dilute or invent the event content.");

        builder.AppendLine();
        builder.AppendLine("4. CONSISTENT PRODUCTION RULES");
        builder.AppendLine("Create the complete finished poster, integrating artwork and typography into one coherent professional design that fills the requested canvas edge to edge.");
        builder.AppendLine($"Design for {output.Name}, {output.Width}:{output.Height}. {output.CompositionGuidance}");
        AppendList(builder, output.ReservedOverlayZones);
        builder.AppendLine("Place the complete event title prominently at or near the top, fully within the safe area and with generous breathing room around every letter.");
        builder.AppendLine("Render all required copy exactly as written. Every word, date, price and text-bearing shape must be fully visible. Never crop, clip or truncate typography, and never let a glyph or text container touch an edge. Reflow or reduce type size before violating the safe area.");
        builder.AppendLine("The selected style name is metadata and must never appear as poster copy.");
        AppendList(builder, configuration.Prompting.GlobalImageRules);
        AppendList(builder, configuration.Prompting.GlobalExclusions);
        AppendList(builder, style.Avoid);
        builder.AppendLine("Do not invent fake dates, prices, sponsor names, competition details or club branding.");

        return builder.ToString().Trim();
    }

    private static object? BuildSafetyRecoveryDirection(GeneratePosterRequest request)
    {
        if (request.SafetyRecoveryAttempt <= 0) return null;

        return new
        {
            attempt = Math.Clamp(request.SafetyRecoveryAttempt, 1, 4),
            alternativeStyleDirection = request.SafetyFallbackStyle,
            instruction = "Rewrite the legitimate club-event poster request in plain, neutral, non-graphic language before giving it to the image model. Preserve harmless event facts and the intended celebratory meaning, but omit or soften ambiguous wording or visual framing that could reasonably be read as unsafe. Do not argue with, mention or attempt to override any safety decision. The finished prompt must remain fully policy-compliant."
        };
    }

    private static void AppendSafetyRecoveryDirection(StringBuilder builder, GeneratePosterRequest request)
    {
        if (request.SafetyRecoveryAttempt <= 0) return;

        builder.AppendLine();
        builder.AppendLine("SAFETY-COMPLIANT RECOVERY");
        builder.AppendLine("Express this legitimate club-event poster request in plain, neutral, non-graphic language. Preserve harmless event facts and the intended celebratory meaning, but omit or soften ambiguous wording or visual framing that could reasonably be read as unsafe. Do not argue with, mention or attempt to override a safety decision. Produce only a fully policy-compliant poster request.");
        if (request.SafetyFallbackStyle)
        {
            builder.AppendLine("Use the newly selected alternative art direction below while keeping the same harmless event content and exact required poster copy.");
        }
    }

    private static string BuildVariantFallbackPrompt(
        PosterConfiguration configuration,
        string clubName,
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
            builder.AppendLine($"Club name: {clubName}");
            builder.AppendLine("The real Club mark will be applied after generation. Keep the upper-right safe area visually quiet for it, but do not draw, imitate or invent a crest, shield, monogram or logo.");
        }
        else
        {
            builder.AppendLine("Remove and do not reproduce any Club name, club initials, crest, shield, monogram, wordmark or other Club logo that may be present in the source artwork.");
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
        if (variation.References.Count > 0 || !string.IsNullOrWhiteSpace(variation.Camera))
        {
            var referenceDirection = variation.References.Count > 0
                ? $" Visual references: {string.Join(", ", variation.References)}."
                : string.Empty;
            var cameraDirection = string.IsNullOrWhiteSpace(variation.Camera)
                ? string.Empty
                : $" Camera and lens direction: {variation.Camera}.";

            return isVariant
                ? $"Preserve the master campaign's selected '{variation.Name}' art direction.{referenceDirection}{cameraDirection}"
                : $"Use the selected '{variation.Name}' art direction.{referenceDirection}{cameraDirection}";
        }

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
                libraryId = image.LibraryId,
                fileName = image.FileName,
                title = image.Title,
                category = image.Category,
                description = image.Description,
                tags = image.Tags,
                source = image.Source,
                matchingInstruction = image.MatchingInstruction,
                relevanceConfidence = image.RelevanceConfidence,
                relevanceReason = image.RelevanceReason
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

            if (!string.IsNullOrWhiteSpace(image.MatchingInstruction))
            {
                parts.Add($"matching rule {image.MatchingInstruction.Trim()}");
            }

            if (image.RelevanceConfidence is not null)
            {
                parts.Add($"relevance confidence {Math.Clamp(image.RelevanceConfidence.Value, 0, 100)} out of 100");
            }

            if (!string.IsNullOrWhiteSpace(image.RelevanceReason))
            {
                parts.Add($"selection reason {image.RelevanceReason.Trim()}");
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

    private static string ApplyClubName(string value, string configuredClubName, string clubName) =>
        string.IsNullOrWhiteSpace(configuredClubName)
            ? value
            : value.Replace(configuredClubName, clubName, StringComparison.OrdinalIgnoreCase);

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
