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
            task = "Create a concise event summary suitable for the planner and a separate practical operational briefing for staff delivering the event.",
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
            recordedPlanningOutcomes = cleanRequest.Tasks
                .Where(task => task.Completed && !string.IsNullOrWhiteSpace(task.Notes))
                .Select(task => new
                {
                    area = task.Area,
                    subject = task.Title,
                    outcome = task.Notes
                }),
            operationalStaffDuties = cleanRequest.Tasks
                .Where(task => IsStaffBriefingPhase(task.StaffBriefingPhase))
                .Select(task => new
                {
                    phase = task.StaffBriefingPhase,
                    audience = task.StaffBriefingAudience,
                    instruction = Prefer(task.StaffBriefingInstruction, task.Title),
                    area = task.Area,
                    owner = EmptyAsNull(task.Owner),
                    notes = EmptyAsNull(task.Notes)
                }),
            rules = new[]
            {
                "Use only facts in the supplied event details, planning answers, recorded planning outcomes and explicitly classified operational staff duties. Never invent timings, attendance, suppliers, staffing, prices, food, entertainment, safety measures or completed work.",
                "Resolve repeated information into one clear statement. If sources appear inconsistent, state that the point needs confirmation instead of choosing one.",
                "The event summary is concise copy for the event planner, not a task report. Explain what the event is and capture confirmed date and timings, expected attendance or catering covers, meal choices and service times, opening hours, entertainment, room or course arrangements, guest information, staffing requirements and other relevant operational facts.",
                "Never put task deadlines, planning milestones, completion status or reminders to agree, decide, document, arrange or book something into the event summary.",
                "Recorded planning outcomes are free-form task notes. Use a note as a settled fact only when it explicitly records a confirmed value or completed outcome; otherwise omit it or identify the point as unconfirmed.",
                "Omit irrelevant headings rather than filling them with generic advice.",
                "The staff briefing is for club staff who will physically deliver the event, especially Kitchen, Bar, Clubhouse or Front of House, Golf Operations and Greens where relevant. It is not the organisers' planning checklist.",
                "Use operationalStaffDuties as the only source of task-based staff actions. You may turn confirmed planning answers or recorded outcomes into concise information for the relevant team—for example recorded covers, meal choices or bar hours—but never convert an unclassified planning task title into a staff instruction.",
                "Preparation means immediate setup and shift readiness shortly before guests arrive, not planning work performed days or weeks earlier. Event-day means service and delivery while the event is running. Afterwards means close-down and immediate reconciliation.",
                "Each staff action must name the team or role that needs it and give a direct practical instruction. Do not include project deadlines, task completion labels or instructions to prepare the briefing itself.",
                "The staff introduction should summarise what staff need to know about the event. Where supplied, include covers, meal choices, food-service and bar timings, room use and the event start and finish.",
                "Put only unresolved facts that could affect immediate setup, service, safety or close-down in importantNotes. Do not copy general planning decisions, future organiser actions or deadlines into the staff notice. Do not conceal operational uncertainty.",
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
                                        preparation = StaffActionArraySchema(18),
                                        eventDay = StaffActionArraySchema(18),
                                        afterwards = StaffActionArraySchema(12),
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

    private static object StaffActionArraySchema(int maxItems) => new
    {
        type = "array",
        maxItems,
        items = new
        {
            type = "object",
            additionalProperties = false,
            properties = new
            {
                audience = new { type = "string" },
                instruction = new { type = "string" }
            },
            required = new[] { "audience", "instruction" }
        }
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
                QuestionId = TrimTo(answer.QuestionId, 160),
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
                Area = TrimTo(task.Area, 160),
                Title = TrimTo(task.Title, 500),
                Detail = TrimTo(task.Detail, 1_500),
                DueDate = TrimTo(task.DueDate, 80),
                Owner = TrimTo(task.Owner, 200),
                Notes = TrimTo(task.Notes, 1_500),
                Completed = task.Completed,
                StaffBriefingPhase = NormaliseStaffBriefingPhase(task.StaffBriefingPhase),
                StaffBriefingAudience = TrimTo(task.StaffBriefingAudience, 160),
                StaffBriefingInstruction = TrimTo(task.StaffBriefingInstruction, 500)
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
                    Preparation = CleanStaffActions(staff.Preparation, fallback.StaffBriefing.Preparation, 18),
                    EventDay = CleanStaffActions(staff.EventDay, fallback.StaffBriefing.EventDay, 18),
                    Afterwards = CleanStaffActions(staff.Afterwards, fallback.StaffBriefing.Afterwards, 12),
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
        AddPlannerCateringFacts(request.Answers, facts);

        var sections = request.Answers
            .GroupBy(answer => answer.Module, StringComparer.OrdinalIgnoreCase)
            .Select(group => new EventBriefingSection
            {
                Title = group.Key,
                Points = group.Select(answer => $"{answer.Question}: {answer.Answer}").Take(12).ToList()
            })
            .Take(8)
            .ToList();

        var preparation = StaffActions(request.Tasks, "before-event", 18);
        var eventDay = StaffActions(request.Tasks, "event-day", 18);
        var afterwards = StaffActions(request.Tasks, "after-event", 12);
        AddCateringFacts(request.Answers, preparation, eventDay);
        var contacts = request.Tasks
            .Where(task => IsStaffBriefingPhase(task.StaffBriefingPhase) && !string.IsNullOrWhiteSpace(task.Owner))
            .Select(task => string.IsNullOrWhiteSpace(task.StaffBriefingAudience)
                ? $"{task.Area}: {task.Owner}"
                : $"{task.StaffBriefingAudience}: {task.Owner}")
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(12)
            .ToList();
        var important = new List<string>();
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

    private static List<StaffBriefingAction> StaffActions(
        IEnumerable<EventBriefingTask> tasks,
        string phase,
        int take) => tasks
        .Where(task => task.StaffBriefingPhase.Equals(phase, StringComparison.OrdinalIgnoreCase))
        .Select(task => new StaffBriefingAction
        {
            Audience = Prefer(task.StaffBriefingAudience, task.Area),
            Instruction = StaffInstruction(task)
        })
        .DistinctBy(action => $"{action.Audience}\n{action.Instruction}", StringComparer.OrdinalIgnoreCase)
        .Take(take)
        .ToList();

    private static void AddCateringFacts(
        IReadOnlyCollection<EventBriefingAnswer> answers,
        List<StaffBriefingAction> preparation,
        List<StaffBriefingAction> eventDay)
    {
        var covers = Answer(answers, "catering-covers");
        var menu = Answer(answers, "agreed-menu-choices");
        var mealTime = Answer(answers, "meal-service-time");
        var dietary = Answer(answers, "dietary-requirements-summary");
        var externallyProvided = Answer(answers, "external-food-supplier").Equals("Yes", StringComparison.OrdinalIgnoreCase);
        var audience = externallyProvided ? "Supplier liaison / Front of House" : "Kitchen & Catering";
        var kitchenFacts = new List<string>();
        if (!string.IsNullOrWhiteSpace(covers)) kitchenFacts.Add(externallyProvided ? $"Confirm service for {covers}" : $"Prepare for {covers}");
        if (!string.IsNullOrWhiteSpace(menu)) kitchenFacts.Add($"agreed menu: {menu}");
        if (!string.IsNullOrWhiteSpace(mealTime)) kitchenFacts.Add($"food service begins at {mealTime}");
        if (!string.IsNullOrWhiteSpace(dietary)) kitchenFacts.Add($"dietary and alternative-meal requirements: {dietary}");
        if (kitchenFacts.Count > 0)
        {
            preparation.Insert(0, new StaffBriefingAction
            {
                Audience = audience,
                Instruction = $"{string.Join("; ", kitchenFacts)}."
            });
        }

        var cateringStart = Answer(answers, "required-catering-start");
        var cateringEnd = Answer(answers, "extended-catering-until");
        var extendedService = Answer(answers, "extended-catering-service");
        if (!string.IsNullOrWhiteSpace(cateringStart) || !string.IsNullOrWhiteSpace(cateringEnd) || !string.IsNullOrWhiteSpace(extendedService))
        {
            var details = new List<string>();
            if (!string.IsNullOrWhiteSpace(cateringStart) && !string.IsNullOrWhiteSpace(cateringEnd)) details.Add($"from {cateringStart} until {cateringEnd}");
            else if (!string.IsNullOrWhiteSpace(cateringStart)) details.Add($"from {cateringStart}");
            else if (!string.IsNullOrWhiteSpace(cateringEnd)) details.Add($"until {cateringEnd}");
            if (!string.IsNullOrWhiteSpace(extendedService)) details.Add($"extended service: {extendedService}");
            eventDay.Insert(0, new StaffBriefingAction
            {
                Audience = audience,
                Instruction = $"Provide the agreed catering service {string.Join("; ", details)}."
            });
        }

        var barStart = Answer(answers, "bar-service-start");
        var barEnd = Answer(answers, "bar-service-end");
        if (!string.IsNullOrWhiteSpace(barStart) || !string.IsNullOrWhiteSpace(barEnd))
        {
            eventDay.RemoveAll(action =>
                action.Audience.Equals("Bar", StringComparison.OrdinalIgnoreCase)
                && action.Instruction.Contains("agreed service hours", StringComparison.OrdinalIgnoreCase));
            var hours = !string.IsNullOrWhiteSpace(barStart) && !string.IsNullOrWhiteSpace(barEnd)
                ? $"from {barStart} until {barEnd}"
                : !string.IsNullOrWhiteSpace(barStart) ? $"from {barStart}" : $"until {barEnd}";
            eventDay.Insert(0, new StaffBriefingAction
            {
                Audience = "Bar",
                Instruction = $"Provide the event bar service {hours}."
            });
        }
    }

    private static string StaffInstruction(EventBriefingTask task)
    {
        var instruction = Prefer(task.StaffBriefingInstruction, task.Title);
        return string.IsNullOrWhiteSpace(task.Notes)
            ? instruction
            : $"{instruction} Event-specific note: {task.Notes}";
    }

    private static void AddPlannerCateringFacts(
        IReadOnlyCollection<EventBriefingAnswer> answers,
        List<EventBriefingFact> facts)
    {
        AddFact(facts, "Food covers", Answer(answers, "catering-covers"));
        AddFact(facts, "Meal choices", Answer(answers, "agreed-menu-choices"));
        AddFact(facts, "Food service", Answer(answers, "meal-service-time"));
        AddFact(facts, "Dietary requirements", Answer(answers, "dietary-requirements-summary"));

        var cateringStart = Answer(answers, "required-catering-start");
        var cateringEnd = Answer(answers, "extended-catering-until");
        var cateringHours = FormatOperatingHours(cateringStart, cateringEnd);
        AddFact(facts, "Catering hours", cateringHours);

        var barStart = Answer(answers, "bar-service-start");
        var barEnd = Answer(answers, "bar-service-end");
        AddFact(facts, "Bar hours", FormatOperatingHours(barStart, barEnd));
    }

    private static string FormatOperatingHours(string start, string end) =>
        !string.IsNullOrWhiteSpace(start) && !string.IsNullOrWhiteSpace(end)
            ? $"{start}–{end}"
            : !string.IsNullOrWhiteSpace(start) ? $"From {start}" : !string.IsNullOrWhiteSpace(end) ? $"Until {end}" : string.Empty;

    private static string Answer(IEnumerable<EventBriefingAnswer> answers, string questionId) =>
        answers.FirstOrDefault(answer => answer.QuestionId.Equals(questionId, StringComparison.OrdinalIgnoreCase))?.Answer
        ?? string.Empty;

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

    private static List<StaffBriefingAction> CleanStaffActions(
        List<StaffBriefingAction>? values,
        List<StaffBriefingAction> fallback,
        int take) =>
        values?.Where(value =>
                !string.IsNullOrWhiteSpace(value.Audience) &&
                !string.IsNullOrWhiteSpace(value.Instruction))
            .Select(value => new StaffBriefingAction
            {
                Audience = value.Audience.Trim(),
                Instruction = value.Instruction.Trim()
            })
            .DistinctBy(value => $"{value.Audience}\n{value.Instruction}", StringComparer.OrdinalIgnoreCase)
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

    private static bool IsStaffBriefingPhase(string? value) =>
        value is "before-event" or "event-day" or "after-event";

    private static string NormaliseStaffBriefingPhase(string? value)
    {
        var clean = value?.Trim().ToLowerInvariant() ?? string.Empty;
        return IsStaffBriefingPhase(clean) ? clean : string.Empty;
    }

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
        public List<StaffBriefingAction> Preparation { get; init; } = [];
        public List<StaffBriefingAction> EventDay { get; init; } = [];
        public List<StaffBriefingAction> Afterwards { get; init; } = [];
        public List<string> KeyContacts { get; init; } = [];
        public List<string> ImportantNotes { get; init; } = [];
    }
}
