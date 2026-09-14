using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.Services;

public interface IRetrospectiveAnalysisService
{
    Task<RetrospectiveAnalysisResult> AnalyseAsync(RetrospectiveAnalysisRequest request, CancellationToken cancellationToken);
}

public sealed class RetrospectiveAnalysisService(
    IHttpClientFactory httpClientFactory,
    IOptions<OpenAiOptions> options,
    ILogger<RetrospectiveAnalysisService> logger) : IRetrospectiveAnalysisService
{
    private static readonly HashSet<string> IgnoredWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "event", "for", "from", "had", "has", "have", "if", "in", "is", "it", "next", "of", "on", "or", "our", "should", "so", "that", "the", "their", "there", "this", "to", "was", "we", "were", "will", "with"
    };

    private static readonly Dictionary<string, string[]> ModuleSignals = new(StringComparer.OrdinalIgnoreCase)
    {
        ["catering"] = ["bain-marie", "bar", "buffet", "cater", "catering", "chef", "chili", "chilli", "curry", "diet", "dietary", "drink", "food", "kitchen", "meal", "menu", "mild", "potato", "rice", "self-service", "serve", "service-point", "spicy", "supervise", "vegetarian", "vegan"],
        ["communications"] = ["advert", "advertising", "communication", "email", "member", "message", "promotion", "publicity", "signage"],
        ["golf"] = ["competition", "course", "golf", "green", "handicap", "hole", "marshal", "result", "score", "tee"],
        ["clubhouse"] = ["av", "decoration", "layout", "room", "screen", "seating", "table"],
        ["entertainment"] = ["act", "band", "comedian", "dance", "dj", "entertainment", "host", "lighting", "magician", "microphone", "music", "performer", "playlist", "sound", "speaker"],
        ["admission"] = ["admission", "booking", "cash", "door", "entry", "guest list", "payment", "price", "refund", "ticket"],
        ["presentation"] = ["award", "medal", "presentation", "prize", "trophy", "voucher"],
        ["staffing"] = ["briefing", "cover", "rota", "shift", "staff", "volunteer"],
        ["safety"] = ["contingency", "hazard", "risk", "safe", "safety", "weather"],
        ["close-down"] = ["clear", "close", "follow-up", "remove", "reset", "return"]
    };

    private static readonly Dictionary<string, string> TermAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["apps"] = "app",
        ["assigned"] = "assign",
        ["assigning"] = "assign",
        ["attendees"] = "attendee",
        ["catered"] = "cater",
        ["catering"] = "cater",
        ["children"] = "child",
        ["cleared"] = "clear",
        ["clearing"] = "clear",
        ["connections"] = "connectivity",
        ["connected"] = "connectivity",
        ["connection"] = "connectivity",
        ["dependent"] = "depend",
        ["dependencies"] = "depend",
        ["dependency"] = "depend",
        ["depends"] = "depend",
        ["devices"] = "device",
        ["juniors"] = "junior",
        ["meals"] = "meal",
        ["networks"] = "network",
        ["operated"] = "operate",
        ["operates"] = "operate",
        ["operating"] = "operate",
        ["prepared"] = "prepare",
        ["preparing"] = "prepare",
        ["results"] = "result",
        ["returned"] = "return",
        ["returning"] = "return",
        ["scored"] = "score",
        ["scores"] = "score",
        ["scoring"] = "score",
        ["served"] = "serve",
        ["server"] = "serve",
        ["servers"] = "serve",
        ["serves"] = "serve",
        ["serving"] = "serve",
        ["staffed"] = "staff",
        ["staffing"] = "staff",
        ["supervised"] = "supervise",
        ["supervises"] = "supervise",
        ["supervising"] = "supervise",
        ["supervision"] = "supervise",
        ["supervisor"] = "supervise",
        ["supervisors"] = "supervise",
        ["technological"] = "technology",
        ["technologies"] = "technology",
        ["winners"] = "result",
        ["winner"] = "result",
        ["wi-fi"] = "wifi"
    };

    private static readonly string[] FoodContextTerms =
        ["bain", "bain-marie", "buffet", "cater", "food", "hot-food", "kitchen", "meal"];

    private static readonly string[] FoodServiceTerms =
        ["adult", "attendee", "help", "operate", "self-service", "serve", "service", "service-point", "staff", "supervise"];

    private static readonly string[] ServiceMethodTerms =
        ["arrangement", "bain", "bain-marie", "buffet", "handed-out", "method", "pre-portioned", "receive", "self-service", "service-point", "table-service"];

    private static readonly string[] ServiceOwnershipTerms =
        ["adult", "assign", "nobody", "operate", "owner", "person", "responsibility", "responsible", "serve", "somebody", "staff", "supervise"];

    private static readonly string[] JuniorTerms = ["child", "junior"];

    private static readonly string[] CloseDownTerms =
        ["clear", "close", "remove", "reset", "return"];

    private static readonly string[] ResultTerms =
        ["calculate", "leaderboard", "result", "score"];

    private static readonly string[] TechnologyDependencyTerms =
        ["app", "battery", "charge", "connectivity", "device", "fallback", "hotspot", "internet", "login", "manual", "mobile", "network", "offline", "online", "paper", "power", "software", "system", "technology", "wifi"];

    private readonly OpenAiOptions _options = options.Value;

    public async Task<RetrospectiveAnalysisResult> AnalyseAsync(RetrospectiveAnalysisRequest request, CancellationToken cancellationToken)
    {
        var cleanRequest = Clean(request);
        var fallback = BuildFallback(cleanRequest);
        if (string.IsNullOrWhiteSpace(_options.ApiKey)) return fallback;

        var input = new
        {
            task = "Summarise anonymous member feedback, analyse the organiser's agile retrospective, and associate each reusable lesson with the most relevant existing planning question or task.",
            eventName = cleanRequest.EventName,
            eventDescription = cleanRequest.EventDescription,
            organiserRetrospective = cleanRequest.RetrospectiveText,
            organiserSentiment = cleanRequest.SentimentRating,
            memberFeedbackResponseCount = cleanRequest.CustomerFeedbackResponseCount,
            anonymousMemberFeedback = cleanRequest.CustomerFeedbackText,
            candidatePlanningItems = cleanRequest.Tasks.Select(task => new
            {
                task.Id,
                task.ItemType,
                task.Title,
                task.Detail,
                task.ModuleId,
                task.ModuleTitle,
                task.SectionId,
                task.SectionTitle,
                task.Completed
            }),
            rules = new[]
            {
                "Return only lessons that are explicitly supported by the organiser retrospective or anonymous member feedback. Do not invent criticism, outcomes or recommendations.",
                "Summarise the anonymous member feedback separately and neutrally. Mention recurring strengths, concerns and useful minority views; do not identify or speculate about individuals.",
                "If there is no member feedback, return exactly: No member feedback has been received yet.",
                "Split distinct operational lessons into separate proposals.",
                "Associate each proposal with exactly one supplied planning item id. It may be a question or a task. Prefer the item where the learning will be most useful next time and never force an unrelated match.",
                "The summary must tell the future task owner what to consider or change and preserve the useful factual detail from the retrospective.",
                "Use importance consider, important or critical. Critical is only for safety, legal, severe financial or event-threatening learning.",
                "Confidence measures the semantic link between the feedback and the chosen task, not whether the feedback is true.",
                "Do not include names, email addresses or personal criticism in the proposed reusable summary.",
                "Return at most eight high-value proposals. Omit vague praise that does not affect future planning."
            }
        };

        try
        {
            using var apiRequest = new HttpRequestMessage(HttpMethod.Post, "chat/completions");
            apiRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
            apiRequest.Content = JsonContent.Create(new
            {
                model = _options.PromptModel,
                messages = new object[]
                {
                    new
                    {
                        role = "system",
                        content = "You are an event-operations analyst. Summarise anonymous member feedback and convert retrospective evidence into concise, reusable learning attached to the right planning questions and tasks. Return strict JSON only."
                    },
                    new { role = "user", content = JsonSerializer.Serialize(input) }
                },
                response_format = new
                {
                    type = "json_schema",
                    json_schema = new
                    {
                        name = "retrospective_task_learning",
                        strict = true,
                        schema = new
                        {
                            type = "object",
                            additionalProperties = false,
                            properties = new
                            {
                                summary = new { type = "string" },
                                customerFeedbackSummary = new { type = "string" },
                                proposals = new
                                {
                                    type = "array",
                                    maxItems = 8,
                                    items = new
                                    {
                                        type = "object",
                                        additionalProperties = false,
                                        properties = new
                                        {
                                            title = new { type = "string" },
                                            summary = new { type = "string" },
                                            importance = new { type = "string", @enum = new[] { "consider", "important", "critical" } },
                                            targetItemId = new { type = "string" },
                                            confidence = new { type = "integer", minimum = 0, maximum = 100 },
                                            reason = new { type = "string" },
                                            sourceExcerpt = new { type = "string" }
                                        },
                                        required = new[] { "title", "summary", "importance", "targetItemId", "confidence", "reason", "sourceExcerpt" }
                                    }
                                }
                            },
                            required = new[] { "summary", "customerFeedbackSummary", "proposals" }
                        }
                    }
                }
            });

            using var client = httpClientFactory.CreateClient("OpenAI");
            using var response = await client.SendAsync(apiRequest, cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"OpenAI retrospective analysis failed ({(int)response.StatusCode}). {body}");
            }

            using var document = JsonDocument.Parse(body);
            var content = document.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString();
            var output = string.IsNullOrWhiteSpace(content)
                ? null
                : JsonSerializer.Deserialize<AnalysisOutput>(content, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            return output is null ? fallback : BuildResult(cleanRequest, output, "openai", _options.PromptModel, fallback);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Unable to analyse retrospective learning with OpenAI. Using deterministic task matching.");
            return fallback;
        }
    }

    private static RetrospectiveAnalysisRequest Clean(RetrospectiveAnalysisRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.RetrospectiveText) && string.IsNullOrWhiteSpace(request.CustomerFeedbackText))
        {
            throw new InvalidOperationException("Record some retrospective notes or collect member feedback before finalising the review.");
        }

        var text = request.RetrospectiveText?.Trim() ?? string.Empty;
        if (text.Length > 12_000)
        {
            throw new InvalidOperationException("Retrospective notes must be 12,000 characters or fewer.");
        }

        var customerFeedback = request.CustomerFeedbackText?.Trim();
        if (customerFeedback?.Length > 16_000)
        {
            throw new InvalidOperationException("Member feedback must be 16,000 characters or fewer.");
        }

        var tasks = request.Tasks
            .Where(task => !string.IsNullOrWhiteSpace(task.Id) && !string.IsNullOrWhiteSpace(task.Title))
            .GroupBy(task => task.Id, StringComparer.Ordinal)
            .Select(group => group.First())
            .Take(120)
            .ToList();
        if (tasks.Count == 0)
        {
            throw new InvalidOperationException("There are no planning questions or tasks available to associate with this retrospective.");
        }

        return new RetrospectiveAnalysisRequest
        {
            EventName = request.EventName.Trim(),
            EventDescription = request.EventDescription?.Trim(),
            RetrospectiveText = text,
            CustomerFeedbackText = customerFeedback,
            CustomerFeedbackResponseCount = Math.Max(0, request.CustomerFeedbackResponseCount),
            SentimentRating = request.SentimentRating is >= 1 and <= 5 ? request.SentimentRating : null,
            Tasks = tasks
        };
    }

    private static RetrospectiveAnalysisResult BuildResult(
        RetrospectiveAnalysisRequest request,
        AnalysisOutput output,
        string mode,
        string model,
        RetrospectiveAnalysisResult fallback)
    {
        var tasks = request.Tasks.ToDictionary(task => task.Id, StringComparer.Ordinal);
        var proposals = (output.Proposals ?? [])
            .Where(proposal => proposal.Confidence >= 45 && tasks.ContainsKey(proposal.TargetItemId))
            .GroupBy(proposal => $"{proposal.TargetItemId}\n{proposal.Summary}", StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Take(8)
            .Select(proposal =>
            {
                var task = tasks[proposal.TargetItemId];
                return new RetrospectiveLearningProposal
                {
                    Id = Guid.NewGuid().ToString("N"),
                    Title = CleanText(proposal.Title, 120, task.Title),
                    Summary = CleanText(proposal.Summary, 1_500, proposal.SourceExcerpt),
                    Importance = proposal.Importance is "important" or "critical" ? proposal.Importance : "consider",
                    TargetItemId = task.Id,
                    TargetModuleId = task.ModuleId,
                    TargetSectionId = task.SectionId,
                    Confidence = Math.Clamp(proposal.Confidence, 0, 100),
                    Reason = CleanText(proposal.Reason, 400, "Matched to this planning item."),
                    SourceExcerpt = CleanText(proposal.SourceExcerpt, 500, string.IsNullOrWhiteSpace(request.RetrospectiveText) ? request.CustomerFeedbackText : request.RetrospectiveText)
                };
            })
            .ToList();

        return new RetrospectiveAnalysisResult
        {
            Mode = mode,
            Model = model,
            Summary = CleanText(output.Summary, 500, proposals.Count > 0 ? $"Found {proposals.Count} planning-linked learning proposal(s)." : fallback.Summary),
            CustomerFeedbackSummary = CleanText(output.CustomerFeedbackSummary, 1_500, fallback.CustomerFeedbackSummary),
            Proposals = proposals
        };
    }

    private static RetrospectiveAnalysisResult BuildFallback(RetrospectiveAnalysisRequest request)
    {
        var evidenceText = string.Join('\n', new[] { request.RetrospectiveText, request.CustomerFeedbackText }.Where(value => !string.IsNullOrWhiteSpace(value)));
        var segments = Regex.Split(evidenceText, @"(?<=[.!?])\s+|[\r\n]+")
            .Select(segment => segment.Trim())
            .Where(segment => segment.Length >= 12)
            .Take(40)
            .ToList();
        var proposals = new List<RetrospectiveLearningProposal>();

        foreach (var segment in segments)
        {
            var reusableSummary = StripEvidenceLabel(segment);
            var segmentTerms = Terms(segment);
            var ranked = request.Tasks
                .Select(task => new { Task = task, Score = MatchScore(segmentTerms, task) })
                .Where(candidate => candidate.Score >= 3)
                .OrderByDescending(candidate => candidate.Score)
                .ThenByDescending(candidate => candidate.Task.Completed)
                .ToList();
            var best = ranked.FirstOrDefault();
            if (best is null) continue;

            proposals.Add(new RetrospectiveLearningProposal
            {
                Id = Guid.NewGuid().ToString("N"),
                Title = SuggestTitle(reusableSummary, best.Task),
                Summary = reusableSummary,
                Importance = ContainsAny(segmentTerms, ["danger", "risk", "safety", "cancelled", "failed"])
                    ? "important"
                    : "consider",
                TargetItemId = best.Task.Id,
                TargetModuleId = best.Task.ModuleId,
                TargetSectionId = best.Task.SectionId,
                Confidence = Math.Clamp(42 + (best.Score * 6), 45, 88),
                Reason = $"The note shares operational terms with {best.Task.ModuleTitle} / {best.Task.SectionTitle} and the {best.Task.ItemType} ‘{best.Task.Title}’." + (best.Task.Completed ? " This item was completed for the event." : string.Empty),
                SourceExcerpt = segment
            });
        }

        proposals = proposals
            .GroupBy(proposal => $"{proposal.TargetItemId}\n{proposal.Summary}", StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Take(8)
            .ToList();
        return new RetrospectiveAnalysisResult
        {
            Mode = "deterministic-fallback",
            Model = "deterministic-fallback",
            Summary = proposals.Count > 0
                ? $"Found {proposals.Count} possible planning-linked lesson{(proposals.Count == 1 ? string.Empty : "s")} and attached the evidence for review."
                : "No confident planning links were found. Add more specific operational detail or choose a target manually below.",
            CustomerFeedbackSummary = BuildFallbackFeedbackSummary(request),
            Proposals = proposals
        };
    }

    private static int MatchScore(HashSet<string> segmentTerms, RetrospectiveTaskContext task)
    {
        var taskTerms = Terms($"{task.Id} {task.ItemType} {task.Title} {task.Detail} {task.ModuleId} {task.ModuleTitle} {task.SectionId} {task.SectionTitle}");
        var isNonFoodCloseDownLesson = ContainsAny(segmentTerms, CloseDownTerms)
            && !ContainsAny(segmentTerms, FoodContextTerms);
        if (isNonFoodCloseDownLesson && IsFoodServicePlanningItem(task, taskTerms)) return 0;

        var sharedTerms = segmentTerms.Intersect(taskTerms, StringComparer.OrdinalIgnoreCase).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var isUnscopedTechnologyLesson = ContainsAny(segmentTerms, TechnologyDependencyTerms)
            && !ContainsAny(segmentTerms, ResultTerms);
        var isGolfResultsTechnologyItem = task.ModuleId.Equals("golf", StringComparison.OrdinalIgnoreCase)
            && ContainsAny(taskTerms, ResultTerms)
            && ContainsAny(taskTerms, TechnologyDependencyTerms);
        if (isUnscopedTechnologyLesson && isGolfResultsTechnologyItem)
        {
            sharedTerms.RemoveWhere(term => TechnologyDependencyTerms.Contains(term, StringComparer.OrdinalIgnoreCase));
        }

        var score = sharedTerms.Count * 2;
        if (ModuleSignals.TryGetValue(task.ModuleId, out var signals))
        {
            score += signals.Count(signal => segmentTerms.Contains(signal));
        }

        score += FoodServiceMatchScore(segmentTerms, task, taskTerms);
        score += GolfResultsTechnologyMatchScore(segmentTerms, task, taskTerms);
        return score + (task.Completed && score > 0 ? 1 : 0);
    }

    private static int FoodServiceMatchScore(
        HashSet<string> evidenceTerms,
        RetrospectiveTaskContext task,
        HashSet<string> planningItemTerms)
    {
        var hasSpecificServiceEquipment = ContainsAny(evidenceTerms, ["bain", "bain-marie", "buffet", "hot-food"]);
        var hasFoodContext = ContainsAny(evidenceTerms, FoodContextTerms);
        var hasServiceContext = ContainsAny(evidenceTerms, FoodServiceTerms);
        var involvesJuniors = ContainsAny(evidenceTerms, JuniorTerms);
        var isFoodServiceLesson = hasSpecificServiceEquipment
            || (hasFoodContext && hasServiceContext)
            || (involvesJuniors && ContainsAny(evidenceTerms, ["self-service", "serve", "service-point"]));
        if (!isFoodServiceLesson || !task.ModuleId.Equals("catering", StringComparison.OrdinalIgnoreCase)) return 0;

        if (!IsFoodServicePlanningItem(task, planningItemTerms)) return 0;

        var score = 10;
        var describesServiceMethod = ContainsAny(evidenceTerms, ServiceMethodTerms);
        var describesServiceOwnership = ContainsAny(evidenceTerms, ServiceOwnershipTerms);

        if (describesServiceMethod && ContainsAny(planningItemTerms, ["arrangement", "method", "receive"])) score += 8;
        if (describesServiceOwnership && ContainsAny(planningItemTerms, ["assign", "operate", "owner", "responsibility", "responsible", "supervise"])) score += 8;
        if (involvesJuniors && ContainsAny(planningItemTerms, ["safe", "serve", "supervise"])) score += 3;
        if (describesServiceMethod && task.Id.Equals("food-service-arrangement", StringComparison.OrdinalIgnoreCase)) score += 18;
        if (describesServiceOwnership && task.Id.Equals("food-service-owner", StringComparison.OrdinalIgnoreCase)) score += 18;

        // This remains the best legacy target when an older event does not expose the
        // newer service-arrangement and owner questions in its candidate list.
        if (task.Id.Equals("event-day-food-service-task", StringComparison.OrdinalIgnoreCase)) score += 5;

        return score;
    }

    private static bool IsFoodServicePlanningItem(
        RetrospectiveTaskContext task,
        HashSet<string> planningItemTerms) =>
        task.ModuleId.Equals("catering", StringComparison.OrdinalIgnoreCase)
        && ContainsAny(planningItemTerms, ["food", "meal", "cater"])
        && ContainsAny(planningItemTerms, ["arrangement", "operate", "owner", "receive", "serve", "service", "staff", "supervise"]);

    private static int GolfResultsTechnologyMatchScore(
        HashSet<string> evidenceTerms,
        RetrospectiveTaskContext task,
        HashSet<string> planningItemTerms)
    {
        if (!ContainsAny(evidenceTerms, ResultTerms)
            || !ContainsAny(evidenceTerms, TechnologyDependencyTerms)
            || !task.ModuleId.Equals("golf", StringComparison.OrdinalIgnoreCase)
            || !ContainsAny(planningItemTerms, ["result", "score"]))
        {
            return 0;
        }

        var score = 10;
        if (ContainsAny(planningItemTerms, TechnologyDependencyTerms)) score += 10;
        if (ContainsAny(planningItemTerms, ["fallback", "prepare", "readiness", "test"])) score += 6;
        if (task.ItemType.Equals("task", StringComparison.OrdinalIgnoreCase)) score += 3;
        return score;
    }

    private static HashSet<string> Terms(string? value)
    {
        var terms = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var normalizedValue = Regex.Replace(
            (value ?? string.Empty).ToLowerInvariant(),
            "[\u00ad\u2010-\u2015\u2212]",
            "-");
        foreach (Match match in Regex.Matches(normalizedValue, "[a-z][a-z'-]{2,}"))
        {
            var rawTerm = match.Value.Trim('\'', '-');
            AddTerm(rawTerm);
            foreach (var component in rawTerm.Split(['-', '\''], StringSplitOptions.RemoveEmptyEntries))
            {
                AddTerm(component);
            }
        }

        return terms;

        void AddTerm(string term)
        {
            if (term.Length < 3 || IgnoredWords.Contains(term)) return;
            terms.Add(term);
            if (TermAliases.TryGetValue(term, out var alias)) terms.Add(alias);
        }
    }

    private static bool ContainsAny(HashSet<string> values, IEnumerable<string> candidates) => candidates.Any(values.Contains);

    private static string SuggestTitle(string segment, RetrospectiveTaskContext task)
    {
        var trimmed = segment.Trim();
        if (trimmed.Length <= 90) return trimmed;
        return $"Previous feedback for {task.SectionTitle}";
    }

    private static string StripEvidenceLabel(string value) => Regex.Replace(value,
        @"^(What went well\?|What did not go well\?|What can we improve for next time\?|Overall team feeling):\s*",
        string.Empty,
        RegexOptions.IgnoreCase).Trim();

    private static string BuildFallbackFeedbackSummary(RetrospectiveAnalysisRequest request)
    {
        if (request.CustomerFeedbackResponseCount <= 0 || string.IsNullOrWhiteSpace(request.CustomerFeedbackText))
        {
            return "No member feedback has been received yet.";
        }

        var comments = Regex.Split(request.CustomerFeedbackText, @"[\r\n]+")
            .Select(value => value.Trim())
            .Where(value => value.Length >= 20 && !value.StartsWith("Responses received", StringComparison.OrdinalIgnoreCase))
            .Take(3)
            .ToList();
        var opening = $"Received {request.CustomerFeedbackResponseCount} anonymous member response{(request.CustomerFeedbackResponseCount == 1 ? string.Empty : "s")}.";
        return comments.Count == 0
            ? $"{opening} Review the ratings and comments below alongside the organiser retrospective."
            : $"{opening} The recorded themes include: {string.Join(" ", comments)}";
    }

    private static string CleanText(string? value, int maximumLength, string? fallback)
    {
        var result = string.IsNullOrWhiteSpace(value) ? (fallback ?? string.Empty).Trim() : value.Trim();
        return result.Length <= maximumLength ? result : result[..maximumLength].TrimEnd();
    }

    private sealed class AnalysisOutput
    {
        public string? Summary { get; init; }
        public string? CustomerFeedbackSummary { get; init; }
        public List<ProposalOutput>? Proposals { get; init; }
    }

    private sealed class ProposalOutput
    {
        public string? Title { get; init; }
        public string? Summary { get; init; }
        public string? Importance { get; init; }
        public required string TargetItemId { get; init; }
        public int Confidence { get; init; }
        public string? Reason { get; init; }
        public string? SourceExcerpt { get; init; }
    }
}
