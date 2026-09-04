using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.Services;

public interface IEventBriefingService
{
    Task<EventBriefingResult> GenerateAsync(EventBriefingRequest request, CancellationToken cancellationToken);
}

public sealed class EventBriefingService(
    IHttpClientFactory httpClientFactory,
    IOptions<OpenAiOptions> options,
    ILogger<EventBriefingService> logger) : IEventBriefingService
{
    private readonly OpenAiOptions _options = options.Value;

    public async Task<EventBriefingResult> GenerateAsync(
        EventBriefingRequest request,
        CancellationToken cancellationToken)
    {
        var cleanRequest = Clean(request);
        var fallback = BuildFallback(cleanRequest);
        if (string.IsNullOrWhiteSpace(_options.ApiKey)) return fallback;

        var source = new
        {
            task = "Create an accurate, concise management briefing and a separate practical staff briefing for this event.",
            eventDetails = new
            {
                name = cleanRequest.EventName,
                description = cleanRequest.EventDescription,
                date = FormatDate(cleanRequest.EventDate),
                startTime = EmptyAsNull(cleanRequest.StartTime),
                endTime = EmptyAsNull(cleanRequest.EndTime),
                organiser = EmptyAsNull(cleanRequest.Organiser),
                status = EmptyAsNull(cleanRequest.Status),
                statusReason = EmptyAsNull(cleanRequest.StatusReason),
                expectedAttendees = cleanRequest.ExpectedAttendees > 0 ? cleanRequest.ExpectedAttendees : null as int?
            },
            planningAnswers = cleanRequest.Answers,
            generatedTasks = cleanRequest.Tasks,
            rules = new[]
            {
                "Use only facts in the supplied event details, planning answers and generated tasks. Never invent timings, attendance, suppliers, staffing, prices, food, entertainment, safety measures or completed work.",
                "Resolve repeated information into one clear statement. If sources appear inconsistent, state that the point needs confirmation instead of choosing one.",
                "The event summary is for organisers and managers. Explain what the event is, the important timings, guest experience, staffing and operational requirements, communications, money and risks that are actually relevant.",
                "Omit irrelevant headings rather than filling them with generic advice.",
                "The staff briefing must be suitable for printing on a staff noticeboard. Use direct, practical British English and separate preparation, event-day actions and afterwards.",
                "Include owners and due dates where supplied. Do not describe a completed task as outstanding.",
                "Put unresolved decisions and operational warnings in importantNotes. Do not conceal uncertainty.",
                "Do not mention AI, the Playbook, question identifiers, JSON or the process used to create the briefing."
            }
        };

        try
        {
            using var message = new HttpRequestMessage(HttpMethod.Post, "chat/completions");
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
            message.Content = JsonContent.Create(new
            {
                model = _options.PromptModel,
                messages = new object[]
                {
                    new
                    {
                        role = "system",
                        content = "You prepare precise operational event briefings for a British golf club. Use supplied facts only and return strict JSON."
                    },
                    new { role = "user", content = JsonSerializer.Serialize(source) }
                },
                response_format = new
                {
                    type = "json_schema",
                    json_schema = new
                    {
                        name = "event_and_staff_briefing",
                        strict = true,
                        schema = new
                        {
                            type = "object",
                            additionalProperties = false,
                            properties = new
                            {
                                headline = new { type = "string" },
                                eventSummary = new { type = "string" },
                                keyInformation = new
                                {
                                    type = "array",
                                    maxItems = 10,
                                    items = new
                                    {
                                        type = "object",
                                        additionalProperties = false,
                                        properties = new
                                        {
                                            label = new { type = "string" },
                                            value = new { type = "string" }
                                        },
                                        required = new[] { "label", "value" }
                                    }
                                },
                                sections = new
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
                                            points = new
                                            {
                                                type = "array",
                                                maxItems = 10,
                                                items = new { type = "string" }
                                            }
                                        },
                                        required = new[] { "title", "points" }
                                    }
                                },
                                staffBriefing = new
                                {
                                    type = "object",
                                    additionalProperties = false,
                                    properties = new
                                    {
                                        heading = new { type = "string" },
                                        introduction = new { type = "string" },
                                        preparation = StringArraySchema(18),
                                        eventDay = StringArraySchema(18),
                                        afterwards = StringArraySchema(12),
                                        keyContacts = StringArraySchema(12),
                                        importantNotes = StringArraySchema(12)
                                    },
                                    required = new[] { "heading", "introduction", "preparation", "eventDay", "afterwards", "keyContacts", "importantNotes" }
                                }
                            },
                            required = new[] { "headline", "eventSummary", "keyInformation", "sections", "staffBriefing" }
                        }
                    }
                }
            });

            using var client = httpClientFactory.CreateClient("OpenAI");
            using var response = await client.SendAsync(message, cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("OpenAI event briefing generation failed with {StatusCode}.", response.StatusCode);
                throw new InvalidOperationException($"The AI briefing service returned an error ({(int)response.StatusCode}). Try again in a moment.");
            }

            var generated = Parse(body);
            if (generated is null)
            {
                throw new InvalidOperationException("The AI briefing service returned an empty response. Try again in a moment.");
            }
            return BuildResult(generated, fallback, _options.PromptModel);
        }
        catch (InvalidOperationException)
        {
            throw;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "OpenAI event briefing generation failed.");
            throw new InvalidOperationException("The AI briefing service could not be reached. Try again in a moment.", exception);
        }
    }

    private static object StringArraySchema(int maxItems) => new
    {
        type = "array",
        maxItems,
        items = new { type = "string" }
    };

    private static EventBriefingRequest Clean(EventBriefingRequest request)
    {
        var name = TrimTo(request.EventName, 240);
        if (string.IsNullOrWhiteSpace(name)) throw new InvalidOperationException("An event name is required to prepare a briefing.");

        var answers = request.Answers
            .Where(answer => !string.IsNullOrWhiteSpace(answer.Question) && !string.IsNullOrWhiteSpace(answer.Answer))
            .Take(220)
            .Select(answer => new EventBriefingAnswer
            {
                Module = TrimTo(answer.Module, 160),
                Section = TrimTo(answer.Section, 160),
                Question = TrimTo(answer.Question, 500),
                Answer = TrimTo(answer.Answer, 1_500)
            })
            .ToList();
        var tasks = request.Tasks
            .Where(task => !string.IsNullOrWhiteSpace(task.Title))
            .Take(220)
            .Select(task => new EventBriefingTask
            {
                Phase = TrimTo(task.Phase, 40),
                Area = TrimTo(task.Area, 160),
                Title = TrimTo(task.Title, 500),
                Detail = TrimTo(task.Detail, 1_500),
                DueDate = TrimTo(task.DueDate, 80),
                Owner = TrimTo(task.Owner, 200),
                Notes = TrimTo(task.Notes, 1_500),
                Completed = task.Completed
            })
            .ToList();

        if (string.IsNullOrWhiteSpace(request.EventDescription) && answers.Count == 0)
        {
            throw new InvalidOperationException("Add an event description or answer some planning questions before preparing the briefing.");
        }

        return new EventBriefingRequest
        {
            EventName = name,
            EventDescription = TrimTo(request.EventDescription, 12_000),
            EventDate = TrimTo(request.EventDate, 40),
            StartTime = TrimTo(request.StartTime, 20),
            EndTime = TrimTo(request.EndTime, 20),
            Organiser = TrimTo(request.Organiser, 240),
            Status = TrimTo(request.Status, 100),
            StatusReason = TrimTo(request.StatusReason, 2_000),
            ExpectedAttendees = Math.Max(0, request.ExpectedAttendees),
            Answers = answers,
            Tasks = tasks
        };
    }

    private static GeneratedBriefing? Parse(string body)
    {
        using var document = JsonDocument.Parse(body);
        var content = document.RootElement.GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString();
        return string.IsNullOrWhiteSpace(content)
            ? null
            : JsonSerializer.Deserialize<GeneratedBriefing>(content, new JsonSerializerOptions(JsonSerializerDefaults.Web));
    }

    private static EventBriefingResult BuildResult(
        GeneratedBriefing generated,
        EventBriefingResult fallback,
        string model)
    {
        var staff = generated.StaffBriefing;
        return new EventBriefingResult
        {
            Mode = "openai",
            Model = model,
            Headline = Prefer(generated.Headline, fallback.Headline),
            EventSummary = Prefer(generated.EventSummary, fallback.EventSummary),
            KeyInformation = CleanFacts(generated.KeyInformation, fallback.KeyInformation),
            Sections = CleanSections(generated.Sections, fallback.Sections),
            StaffBriefing = staff is null
                ? fallback.StaffBriefing
                : new StaffBriefingResult
                {
                    Heading = Prefer(staff.Heading, fallback.StaffBriefing.Heading),
                    Introduction = Prefer(staff.Introduction, fallback.StaffBriefing.Introduction),
                    Preparation = CleanList(staff.Preparation, fallback.StaffBriefing.Preparation, 18),
                    EventDay = CleanList(staff.EventDay, fallback.StaffBriefing.EventDay, 18),
                    Afterwards = CleanList(staff.Afterwards, fallback.StaffBriefing.Afterwards, 12),
                    KeyContacts = CleanList(staff.KeyContacts, fallback.StaffBriefing.KeyContacts, 12),
                    ImportantNotes = CleanList(staff.ImportantNotes, fallback.StaffBriefing.ImportantNotes, 12)
                }
        };
    }

    private static EventBriefingResult BuildFallback(EventBriefingRequest request)
    {
        var facts = new List<EventBriefingFact>();
        AddFact(facts, "Date", FormatDate(request.EventDate));
        AddFact(facts, "Time", FormatTimeRange(request.StartTime, request.EndTime));
        AddFact(facts, "Organiser", request.Organiser);
        AddFact(facts, "Status", request.Status);
        if (request.ExpectedAttendees > 0) AddFact(facts, "Expected attendance", request.ExpectedAttendees.ToString(CultureInfo.InvariantCulture));

        var sections = request.Answers
            .GroupBy(answer => answer.Module, StringComparer.OrdinalIgnoreCase)
            .Select(group => new EventBriefingSection
            {
                Title = group.Key,
                Points = group.Select(answer => $"{answer.Question}: {answer.Answer}").Take(12).ToList()
            })
            .Take(8)
            .ToList();

        var preparation = TaskPoints(request.Tasks, "preparation", 18);
        var eventDay = TaskPoints(request.Tasks, "event-day", 18);
        var afterwards = TaskPoints(request.Tasks, "afterwards", 12);
        var contacts = request.Tasks
            .Where(task => !string.IsNullOrWhiteSpace(task.Owner))
            .Select(task => string.IsNullOrWhiteSpace(task.Area) ? task.Owner : $"{task.Area}: {task.Owner}")
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(12)
            .ToList();
        var important = request.Answers
            .Where(answer => answer.Answer.Equals("Decision pending", StringComparison.OrdinalIgnoreCase))
            .Select(answer => $"Decision still required: {answer.Question}")
            .Take(12)
            .ToList();
        if (!string.IsNullOrWhiteSpace(request.StatusReason)) important.Insert(0, $"Status note: {request.StatusReason}");

        return new EventBriefingResult
        {
            Mode = "fallback",
            Model = "deterministic-fallback",
            Headline = request.EventName,
            EventSummary = string.IsNullOrWhiteSpace(request.EventDescription)
                ? $"Planning information for {request.EventName}."
                : request.EventDescription,
            KeyInformation = facts,
            Sections = sections,
            StaffBriefing = new StaffBriefingResult
            {
                Heading = $"Staff briefing: {request.EventName}",
                Introduction = BuildStaffIntroduction(request),
                Preparation = preparation,
                EventDay = eventDay,
                Afterwards = afterwards,
                KeyContacts = contacts,
                ImportantNotes = important
            }
        };
    }

    private static string BuildStaffIntroduction(EventBriefingRequest request)
    {
        var date = FormatDate(request.EventDate);
        var time = FormatTimeRange(request.StartTime, request.EndTime);
        var parts = new List<string> { request.EventName };
        if (!string.IsNullOrWhiteSpace(date)) parts.Add(date);
        if (!string.IsNullOrWhiteSpace(time)) parts.Add(time);
        if (request.ExpectedAttendees > 0) parts.Add($"approximately {request.ExpectedAttendees} attendees");
        return string.Join(" · ", parts);
    }

    private static List<string> TaskPoints(IEnumerable<EventBriefingTask> tasks, string phase, int take) => tasks
        .Where(task => task.Phase.Equals(phase, StringComparison.OrdinalIgnoreCase))
        .Select(FormatTask)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .Take(take)
        .ToList();

    private static string FormatTask(EventBriefingTask task)
    {
        var details = new List<string>();
        if (!string.IsNullOrWhiteSpace(task.Owner)) details.Add(task.Owner);
        if (!string.IsNullOrWhiteSpace(task.DueDate)) details.Add($"due {task.DueDate}");
        if (task.Completed) details.Add("complete");
        var title = string.IsNullOrWhiteSpace(task.Notes) ? task.Title : $"{task.Title}. Note: {task.Notes}";
        return details.Count == 0 ? title : $"{title} — {string.Join(", ", details)}";
    }

    private static string FormatDate(string value) =>
        DateOnly.TryParseExact(value, "yyyy-MM-dd", out var date)
            ? date.ToDateTime(TimeOnly.MinValue).ToString("dddd d MMMM yyyy", CultureInfo.GetCultureInfo("en-GB"))
            : value;

    private static string FormatTimeRange(string start, string end)
    {
        if (string.IsNullOrWhiteSpace(start)) return string.Empty;
        return string.IsNullOrWhiteSpace(end) ? start : $"{start}–{end}";
    }

    private static void AddFact(List<EventBriefingFact> facts, string label, string value)
    {
        if (!string.IsNullOrWhiteSpace(value)) facts.Add(new EventBriefingFact { Label = label, Value = value });
    }

    private static List<EventBriefingFact> CleanFacts(
        List<EventBriefingFact>? values,
        List<EventBriefingFact> fallback) =>
        values?.Where(value => !string.IsNullOrWhiteSpace(value.Label) && !string.IsNullOrWhiteSpace(value.Value))
            .Take(10)
            .ToList() is { Count: > 0 } clean ? clean : fallback;

    private static List<EventBriefingSection> CleanSections(
        List<EventBriefingSection>? values,
        List<EventBriefingSection> fallback) =>
        values?.Where(value => !string.IsNullOrWhiteSpace(value.Title))
            .Select(value => new EventBriefingSection
            {
                Title = value.Title.Trim(),
                Points = CleanList(value.Points, [], 10)
            })
            .Where(value => value.Points.Count > 0)
            .Take(8)
            .ToList() is { Count: > 0 } clean ? clean : fallback;

    private static List<string> CleanList(List<string>? values, List<string> fallback, int take) =>
        values?.Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(take)
            .ToList() is { Count: > 0 } clean ? clean : fallback;

    private static string Prefer(string? value, string fallback) =>
        string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();

    private static string TrimTo(string? value, int maxLength)
    {
        var clean = value?.Trim() ?? string.Empty;
        return clean.Length <= maxLength ? clean : clean[..maxLength];
    }

    private static string? EmptyAsNull(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private sealed class GeneratedBriefing
    {
        public string Headline { get; init; } = string.Empty;
        public string EventSummary { get; init; } = string.Empty;
        public List<EventBriefingFact> KeyInformation { get; init; } = [];
        public List<EventBriefingSection> Sections { get; init; } = [];
        public GeneratedStaffBriefing? StaffBriefing { get; init; }
    }

    private sealed class GeneratedStaffBriefing
    {
        public string Heading { get; init; } = string.Empty;
        public string Introduction { get; init; } = string.Empty;
        public List<string> Preparation { get; init; } = [];
        public List<string> EventDay { get; init; } = [];
        public List<string> Afterwards { get; init; } = [];
        public List<string> KeyContacts { get; init; } = [];
        public List<string> ImportantNotes { get; init; } = [];
    }
}
