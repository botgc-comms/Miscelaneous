using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.Services;

public sealed class OpenAiReferenceRelevanceService(
    IHttpClientFactory httpClientFactory,
    IPosterConfigurationService posterConfiguration,
    IClubBrandingStore clubBrandingStore,
    IOptions<OpenAiOptions> options,
    ILogger<OpenAiReferenceRelevanceService> logger) : IReferenceRelevanceService
{
    private static readonly HashSet<string> GenericTerms = new(StringComparer.OrdinalIgnoreCase)
    {
        "and", "the", "for", "with", "from", "into", "that", "this", "image", "photo", "photograph",
        "event", "poster", "club", "clubhouse", "golf", "course", "reference", "use", "when", "shows"
    };

    private readonly OpenAiOptions _options = options.Value;

    public async Task<ReferenceRelevanceProfile> CompileProfileAsync(
        CompileReferenceProfileRequest request,
        CancellationToken cancellationToken)
    {
        var fallback = BuildFallbackProfile(request);
        if (string.IsNullOrWhiteSpace(_options.ApiKey)) return fallback;

        var configuration = posterConfiguration.Get().ReferenceSelection;
        var input = new
        {
            task = "Compile a reusable semantic matching profile for one image in an event-poster reference library.",
            imageMetadata = new
            {
                title = request.Title.Trim(),
                category = request.Category.Trim(),
                description = request.Description.Trim(),
                tags = CleanTags(request.Tags)
            },
            requirements = new[]
            {
                "The matching instruction must be a direct test of whether a future event brief explicitly or semantically calls for this particular subject, organisation, cause, place, object or theme.",
                "Extract aliases and closely related phrases, including named charities, organisations, trophies, rooms and landmarks.",
                "Do not treat generic overlap such as golf, club, clubhouse, poster or event as sufficient relevance.",
                "Negative signals should identify circumstances where a superficially similar image should not be selected."
            }
        };

        try
        {
            var result = await CreateStructuredCompletionAsync<ProfileOutput>(
                configuration.ProfileInstruction,
                input,
                "reference_relevance_profile",
                new
                {
                    type = "object",
                    additionalProperties = false,
                    properties = new
                    {
                        matchingInstruction = new { type = "string" },
                        positiveSignals = new { type = "array", items = new { type = "string" } },
                        namedEntities = new { type = "array", items = new { type = "string" } },
                        negativeSignals = new { type = "array", items = new { type = "string" } }
                    },
                    required = new[] { "matchingInstruction", "positiveSignals", "namedEntities", "negativeSignals" }
                },
                cancellationToken);

            if (result is null || string.IsNullOrWhiteSpace(result.MatchingInstruction)) return fallback;

            return new ReferenceRelevanceProfile
            {
                MatchingInstruction = result.MatchingInstruction.Trim(),
                PositiveSignals = CleanStrings(result.PositiveSignals),
                NamedEntities = CleanStrings(result.NamedEntities),
                NegativeSignals = CleanStrings(result.NegativeSignals),
                Mode = "openai",
                Model = _options.PromptModel,
                GeneratedAt = DateTimeOffset.UtcNow.ToString("O")
            };
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Unable to compile an AI reference profile. Using the deterministic profile.");
            return fallback;
        }
    }

    public async Task<ReferenceSelectionResult> SelectAsync(
        SelectReferenceImagesRequest request,
        CancellationToken cancellationToken)
    {
        var clubName = (await clubBrandingStore.GetOverviewAsync(cancellationToken)).ClubName;
        var eventIntent = BuildEventIntent(request, clubName);
        if (request.References.Count == 0)
        {
            return EmptySelection(eventIntent);
        }

        var fallbackMatches = ScoreFallback(eventIntent, request.References);
        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            return BuildSelection(eventIntent, "deterministic-fallback", "deterministic-fallback", fallbackMatches, request.References);
        }

        var configuration = posterConfiguration.Get().ReferenceSelection;
        var input = new
        {
            task = "Score each library image for semantic relevance to the supplied event-poster intent.",
            eventIntent,
            scoringRules = new[]
            {
                "Score from 0 to 100. A score of 65 or more means the image is specifically relevant enough to attach to the image generator.",
                "Named organisations, charities, trophies, rooms, landmarks, people and exact subject matter are strong evidence.",
                "A merely generic relationship to golf, a golf club, an event, a poster or a clubhouse is not enough.",
                "Honour negative requirements in the event intent. In particular, a logo reference is irrelevant when club branding is not requested.",
                "Return one result for every supplied reference id and explain the decisive evidence briefly."
            },
            references = request.References.Select(reference => new
            {
                reference.Id,
                reference.Title,
                reference.Category,
                reference.Description,
                tags = CleanTags(reference.Tags),
                reference.Priority,
                matchingProfile = reference.RelevanceProfile is null
                    ? (object)BuildFallbackProfile(new CompileReferenceProfileRequest
                    {
                        Title = reference.Title,
                        Category = reference.Category,
                        Description = reference.Description,
                        Tags = reference.Tags
                    })
                    : (object)new
                    {
                        reference.RelevanceProfile.MatchingInstruction,
                        reference.RelevanceProfile.PositiveSignals,
                        reference.RelevanceProfile.NamedEntities,
                        reference.RelevanceProfile.NegativeSignals
                    }
            }).ToArray()
        };

        try
        {
            var result = await CreateStructuredCompletionAsync<SelectionOutput>(
                configuration.ScoringInstruction,
                input,
                "reference_relevance_scores",
                new
                {
                    type = "object",
                    additionalProperties = false,
                    properties = new
                    {
                        matches = new
                        {
                            type = "array",
                            items = new
                            {
                                type = "object",
                                additionalProperties = false,
                                properties = new
                                {
                                    id = new { type = "string" },
                                    confidence = new { type = "integer", minimum = 0, maximum = 100 },
                                    reason = new { type = "string" }
                                },
                                required = new[] { "id", "confidence", "reason" }
                            }
                        }
                    },
                    required = new[] { "matches" }
                },
                cancellationToken);

            var knownIds = request.References.Select(reference => reference.Id).ToHashSet(StringComparer.Ordinal);
            var returned = result?.Matches?
                .Where(match => knownIds.Contains(match.Id))
                .GroupBy(match => match.Id, StringComparer.Ordinal)
                .Select(group => group.First())
                .ToDictionary(
                    match => match.Id,
                    match => new ReferenceMatchResult
                    {
                        Id = match.Id,
                        Confidence = Math.Clamp(match.Confidence, 0, 100),
                        Reason = string.IsNullOrWhiteSpace(match.Reason) ? "No decisive relevance evidence was supplied." : match.Reason.Trim()
                    },
                    StringComparer.Ordinal) ?? new Dictionary<string, ReferenceMatchResult>(StringComparer.Ordinal);

            var completeMatches = request.References.Select(reference => returned.GetValueOrDefault(reference.Id)
                ?? fallbackMatches.First(match => match.Id == reference.Id)).ToList();

            return BuildSelection(eventIntent, "openai", _options.PromptModel, completeMatches, request.References);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Unable to score reference relevance with OpenAI. Using deterministic scoring.");
            return BuildSelection(eventIntent, "deterministic-fallback", "deterministic-fallback", fallbackMatches, request.References);
        }
    }

    private async Task<T?> CreateStructuredCompletionAsync<T>(
        string systemInstruction,
        object input,
        string schemaName,
        object schema,
        CancellationToken cancellationToken)
    {
        using var apiRequest = new HttpRequestMessage(HttpMethod.Post, "chat/completions");
        apiRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
        apiRequest.Content = JsonContent.Create(new
        {
            model = _options.PromptModel,
            messages = new object[]
            {
                new { role = "system", content = systemInstruction },
                new { role = "user", content = JsonSerializer.Serialize(input) }
            },
            response_format = new
            {
                type = "json_schema",
                json_schema = new
                {
                    name = schemaName,
                    strict = true,
                    schema
                }
            }
        });

        using var client = httpClientFactory.CreateClient("OpenAI");
        using var response = await client.SendAsync(apiRequest, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"OpenAI relevance analysis failed ({(int)response.StatusCode}). {body}");
        }

        using var document = JsonDocument.Parse(body);
        var content = document.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString();
        return string.IsNullOrWhiteSpace(content)
            ? default
            : JsonSerializer.Deserialize<T>(content, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
    }

    private ReferenceSelectionResult BuildSelection(
        string eventIntent,
        string mode,
        string model,
        List<ReferenceMatchResult> matches,
        IReadOnlyCollection<ReferenceSelectionCandidate> references)
    {
        var configuration = posterConfiguration.Get().ReferenceSelection;
        var priorities = references.ToDictionary(reference => reference.Id, reference => reference.Priority, StringComparer.Ordinal);
        var ordered = matches
            .OrderByDescending(match => match.Confidence)
            .ThenByDescending(match => priorities.GetValueOrDefault(match.Id))
            .ThenBy(match => match.Id, StringComparer.Ordinal)
            .ToList();
        var selected = ordered
            .Where(match => match.Confidence >= configuration.MinimumConfidence)
            .Take(Math.Max(0, configuration.MaximumAutomaticReferences))
            .ToList();

        return new ReferenceSelectionResult
        {
            EventIntent = eventIntent,
            Mode = mode,
            Model = model,
            Matches = ordered,
            Selected = selected
        };
    }

    private static ReferenceSelectionResult EmptySelection(string eventIntent) => new()
    {
        EventIntent = eventIntent,
        Mode = "none",
        Model = "none",
        Matches = [],
        Selected = []
    };

    private static string BuildEventIntent(SelectReferenceImagesRequest request, string clubName)
    {
        var builder = new StringBuilder();
        builder.AppendLine("EVENT POSTER CONTENT INTENT");
        builder.AppendLine($"Event title: {request.EventName.Trim()}");
        builder.AppendLine("Event description:");
        builder.AppendLine(request.Description.Trim());
        builder.AppendLine();
        builder.AppendLine("Additional creative instructions:");
        builder.AppendLine(string.IsNullOrWhiteSpace(request.AdditionalInstructions)
            ? "None supplied."
            : request.AdditionalInstructions.Trim());
        builder.AppendLine();
        builder.AppendLine("Requested poster content:");
        builder.AppendLine(request.IncludeDate
            ? $"- Include the event date: {request.EventDate.Trim()}."
            : "- Do not include the event date.");
        builder.AppendLine(request.IncludePrice && !string.IsNullOrWhiteSpace(request.Price)
            ? $"- Include the price: {request.Price.Trim()}."
            : "- Do not include a price.");
        builder.AppendLine(request.IncludeClubBranding
            ? $"- Include the official {clubName} logo as a real post-generation overlay; an official club-logo reference can be relevant, but the image model must not invent or redraw it."
            : "- Do not include a club logo, crest, wordmark, initials or club branding; logo-only library images are not relevant.");
        return builder.ToString().Trim();
    }

    private static ReferenceRelevanceProfile BuildFallbackProfile(CompileReferenceProfileRequest request)
    {
        var signals = CleanStrings([
            request.Title,
            request.Category,
            .. CleanTags(request.Tags),
            .. ExtractTerms(request.Description)
        ]).Take(16).ToList();
        var entities = new[] { request.Title }
            .Concat(CleanTags(request.Tags).Where(tag => tag.Contains(' ') || tag.Length > 8))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(8)
            .ToList();

        return new ReferenceRelevanceProfile
        {
            MatchingInstruction = $"Select this image only when the event brief explicitly or semantically calls for {request.Title.Trim()} ({request.Category.Trim()}): {request.Description.Trim()}",
            PositiveSignals = signals,
            NamedEntities = entities,
            NegativeSignals = ["Do not select it solely because the event involves golf, the club, the clubhouse or a poster."],
            Mode = "deterministic-fallback",
            Model = "deterministic-fallback",
            GeneratedAt = DateTimeOffset.UtcNow.ToString("O")
        };
    }

    private static List<ReferenceMatchResult> ScoreFallback(
        string eventIntent,
        IReadOnlyCollection<ReferenceSelectionCandidate> references)
    {
        var normalisedIntent = Normalise(eventIntent);
        var intentTerms = ExtractTerms(eventIntent).ToHashSet(StringComparer.OrdinalIgnoreCase);

        return references.Select(reference =>
        {
            var profile = reference.RelevanceProfile ?? BuildFallbackProfile(new CompileReferenceProfileRequest
            {
                Title = reference.Title,
                Category = reference.Category,
                Description = reference.Description,
                Tags = reference.Tags
            });
            var confidence = 0;
            var reasons = new List<string>();

            foreach (var entity in profile.NamedEntities.Where(entity => entity.Trim().Length > 3))
            {
                if (!normalisedIntent.Contains(Normalise(entity), StringComparison.Ordinal)) continue;
                confidence += 55;
                reasons.Add($"The brief names or closely matches “{entity.Trim()}”.");
            }

            var title = Normalise(reference.Title);
            if (title.Length > 4 && normalisedIntent.Contains(title, StringComparison.Ordinal))
            {
                confidence += 45;
                reasons.Add("The library image title appears in the event intent.");
            }

            var signalTerms = profile.PositiveSignals
                .SelectMany(ExtractTerms)
                .Where(term => !GenericTerms.Contains(term))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
            var overlap = signalTerms.Count(intentTerms.Contains);
            confidence += Math.Min(36, overlap * 9);
            if (overlap > 0) reasons.Add($"{overlap} specific matching concept{(overlap == 1 ? string.Empty : "s")} found.");

            if (IsClubLogoReference(reference, profile) &&
                normalisedIntent.Contains("do not include a club logo", StringComparison.Ordinal))
            {
                confidence = 0;
                reasons.Clear();
                reasons.Add("Club branding was not requested.");
            }

            return new ReferenceMatchResult
            {
                Id = reference.Id,
                Confidence = Math.Clamp(confidence, 0, 100),
                Reason = reasons.Count == 0
                    ? "No specific semantic link to the event brief was found."
                    : string.Join(" ", reasons)
            };
        }).ToList();
    }

    private static bool IsClubLogoReference(
        ReferenceSelectionCandidate reference,
        ReferenceRelevanceProfile profile)
    {
        var content = Normalise(string.Join(' ', new[]
        {
            reference.Title,
            reference.Description,
            string.Join(' ', reference.Tags),
            string.Join(' ', profile.PositiveSignals),
            string.Join(' ', profile.NamedEntities)
        }));
        return content.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Any(term => term is "logo" or "crest" or "wordmark" or "botgc") ||
               content.Contains("burton on trent golf club", StringComparison.Ordinal);
    }

    private static List<string> CleanTags(IEnumerable<string>? values) => CleanStrings(values ?? []);

    private static List<string> CleanStrings(IEnumerable<string> values) => values
        .Select(value => value?.Trim() ?? string.Empty)
        .Where(value => value.Length > 0)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToList();

    private static IEnumerable<string> ExtractTerms(string value) => Normalise(value)
        .Split(' ', StringSplitOptions.RemoveEmptyEntries)
        .Where(term => term.Length > 2 && !GenericTerms.Contains(term));

    private static string Normalise(string value) => new(value
        .ToLowerInvariant()
        .Select(character => char.IsLetterOrDigit(character) ? character : ' ')
        .ToArray());

    private sealed class ProfileOutput
    {
        public string MatchingInstruction { get; init; } = string.Empty;
        public List<string> PositiveSignals { get; init; } = [];
        public List<string> NamedEntities { get; init; } = [];
        public List<string> NegativeSignals { get; init; } = [];
    }

    private sealed class SelectionOutput
    {
        public List<SelectionMatchOutput> Matches { get; init; } = [];
    }

    private sealed class SelectionMatchOutput
    {
        public string Id { get; init; } = string.Empty;
        public int Confidence { get; init; }
        public string Reason { get; init; } = string.Empty;
    }
}
