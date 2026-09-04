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
        ["catering"] = ["bar", "buffet", "cater", "catering", "chef", "chili", "chilli", "curry", "diet", "dietary", "drink", "food", "kitchen", "meal", "menu", "mild", "potato", "rice", "spicy", "staffing", "vegetarian", "vegan"],
        ["communications"] = ["advert", "advertising", "communication", "email", "member", "message", "promotion", "publicity", "signage"],
        ["golf"] = ["competition", "course", "golf", "green", "handicap", "hole", "marshal", "score", "tee"],
        ["clubhouse"] = ["av", "decoration", "layout", "room", "screen", "seating", "table"],
        ["entertainment"] = ["act", "band", "comedian", "dance", "dj", "entertainment", "host", "lighting", "magician", "microphone", "music", "performer", "playlist", "sound", "speaker"],
        ["admission"] = ["admission", "booking", "cash", "door", "entry", "guest list", "payment", "price", "refund", "ticket"],
        ["presentation"] = ["award", "medal", "presentation", "prize", "trophy", "voucher"],
        ["staffing"] = ["briefing", "cover", "rota", "shift", "staff", "volunteer"],
        ["safety"] = ["contingency", "hazard", "risk", "safe", "safety", "weather"],
        ["close-down"] = ["clear", "close", "follow-up", "remove", "reset", "return"]
    };

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
        var taskTerms = Terms($"{task.ItemType} {task.Title} {task.Detail} {task.ModuleTitle} {task.SectionTitle}");
        var score = segmentTerms.Intersect(taskTerms, StringComparer.OrdinalIgnoreCase).Count() * 2;
        if (ModuleSignals.TryGetValue(task.ModuleId, out var signals))
        {
            score += signals.Count(signal => segmentTerms.Contains(signal));
        }
        return score + (task.Completed && score > 0 ? 1 : 0);
    }

    private static HashSet<string> Terms(string? value) => Regex.Matches((value ?? string.Empty).ToLowerInvariant(), "[a-z][a-z'-]{2,}")
        .Select(match => match.Value.Trim('\'', '-'))
        .Where(term => term.Length >= 3 && !IgnoredWords.Contains(term))
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

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
