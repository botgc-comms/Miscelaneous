using System.Net;
using System.Text;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using BOTGC.EventPlaybook.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class EventBriefingServiceTests
{
    [Fact]
    public async Task GenerateAsync_FallbackIncludesFoodServiceOwnerAndScoringResilience()
    {
        var service = CreateService();
        var request = Request(
            Answer("food-service-arrangement", "Staffed bain-marie service"),
            Answer("food-service-owner", "Alex Morgan"),
            Answer("food-service-self-service-risk", "Yes"),
            Answer("food-service-self-service-supervisor", "Taylor Reed"),
            Answer("additional-food-staff", "No"),
            Answer("golf-results-technology-dependent", "Yes", "Golf"),
            Answer("golf-results-technology-plan", "Use the scoring tablet on mobile data; keep paper cards and a manual results sheet ready", "Golf"));

        var result = await service.GenerateAsync(request, CancellationToken.None);

        Assert.Equal("fallback", result.Mode);
        Assert.Contains(result.KeyInformation, fact =>
            fact.Label == "Food service arrangement" && fact.Value == "Staffed bain-marie service");
        Assert.Contains(result.KeyInformation, fact =>
            fact.Label == "Food service lead" && fact.Value == "Alex Morgan");
        Assert.Contains(result.KeyInformation, fact =>
            fact.Label == "Self-service safeguard" && fact.Value.Contains("Taylor Reed", StringComparison.Ordinal));
        Assert.Contains(result.KeyInformation, fact =>
            fact.Label == "Scoring technology and fallback"
            && fact.Value.Contains("mobile data", StringComparison.Ordinal));

        var foodService = Assert.Single(result.StaffBriefing.EventDay, action =>
            action.Instruction.Contains("Staffed bain-marie service", StringComparison.Ordinal));
        Assert.Equal("Kitchen & Catering", foodService.Audience);
        Assert.Contains("Alex Morgan is responsible", foodService.Instruction, StringComparison.Ordinal);
        Assert.Contains("Taylor Reed is the named adult supervisor", foodService.Instruction, StringComparison.Ordinal);

        Assert.Contains(result.StaffBriefing.Preparation, action =>
            action.Audience == "Golf Operations"
            && action.Instruction.Contains("test the complete scoring", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.StaffBriefing.EventDay, action =>
            action.Audience == "Golf Operations"
            && action.Instruction.Contains("paper cards", StringComparison.Ordinal));
        Assert.Empty(result.StaffBriefing.ImportantNotes);
    }

    [Fact]
    public async Task GenerateAsync_FallbackHighlightsMissingOperationalOwnershipAndFallback()
    {
        var service = CreateService();
        var request = Request(
            Answer("food-service-arrangement", "Self-service buffet"),
            Answer("food-service-self-service-risk", "Yes"),
            Answer("golf-results-technology-dependent", "Yes", "Golf"));

        var result = await service.GenerateAsync(request, CancellationToken.None);

        Assert.Contains(result.StaffBriefing.ImportantNotes, note =>
            note.Contains("nobody has been named", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.StaffBriefing.ImportantNotes, note =>
            note.Contains("no named adult supervisor", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.StaffBriefing.ImportantNotes, note =>
            note.Contains("no tested setup and fallback plan", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task GenerateAsync_FallbackIncludesNotesFromOpenAndCompletedTasksAsSharedPlanningContext()
    {
        var service = CreateService();
        var request = RequestWithTasks(
            [],
            new EventBriefingTask
            {
                Area = "Clubhouse",
                Title = "Agree the room layout",
                Owner = "Alex Morgan",
                Notes = "Board members need six seats at the top table.",
                Completed = false
            },
            new EventBriefingTask
            {
                Area = "Catering",
                Title = "Confirm the meal service",
                Notes = "Confirmed 60 covers with two vegetarian meals.",
                Completed = true
            });

        var result = await service.GenerateAsync(request, CancellationToken.None);

        var notes = Assert.Single(result.Sections, section => section.Title == "Recorded task notes");
        Assert.Contains(notes.Points, point =>
            point.Contains("Agree the room layout (open)", StringComparison.Ordinal)
            && point.Contains("six seats", StringComparison.Ordinal));
        Assert.Contains(notes.Points, point =>
            point.Contains("Confirm the meal service (completed)", StringComparison.Ordinal)
            && point.Contains("60 covers", StringComparison.Ordinal));
    }

    [Fact]
    public async Task GenerateAsync_UsesOtherFoodServiceDetailInsteadOfGenericOptionLabel()
    {
        var service = CreateService();
        var request = Request(
            Answer("food-service-arrangement", "Other service arrangement"),
            Answer("food-service-arrangement-other", "Pre-packed picnic boxes handed to each junior"),
            Answer("food-service-owner", "Junior organiser"));

        var result = await service.GenerateAsync(request, CancellationToken.None);

        var arrangement = Assert.Single(result.KeyInformation, fact => fact.Label == "Food service arrangement");
        Assert.Equal("Pre-packed picnic boxes handed to each junior", arrangement.Value);
        var action = Assert.Single(result.StaffBriefing.EventDay, item =>
            item.Instruction.Contains("picnic boxes", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain("Other service arrangement", action.Instruction, StringComparison.Ordinal);
    }

    [Fact]
    public async Task GenerateAsync_ConsolidatesConfiguredFoodAndScoringTaskActions()
    {
        var service = CreateService();
        var request = RequestWithTasks(
            [
                Answer("food-service-arrangement", "Staffed buffet"),
                Answer("food-service-owner", "Alex Morgan"),
                Answer("golf-results-technology-dependent", "Yes", "Golf"),
                Answer("golf-results-technology-plan", "Scoring tablet with paper result sheet ready", "Golf")
            ],
            BriefingTask(
                "Kitchen & Catering",
                "The named food-service owner operates or supervises the recorded service arrangement and serves the agreed meal choices.",
                "event-day",
                "Use the low serving station reserved for the junior group."),
            BriefingTask("Golf Operations", "Before scoring begins, check the device, login, power and connections and keep the paper fallback ready.", "before-event"),
            BriefingTask("Golf Operations", "Collect scores, calculate the results and have the final result ready for the presentation.", "event-day"));

        var result = await service.GenerateAsync(request, CancellationToken.None);

        var foodActions = result.StaffBriefing.EventDay.Where(action => action.Audience == "Kitchen & Catering").ToList();
        var scoringPreparation = result.StaffBriefing.Preparation.Where(action =>
            action.Audience == "Golf Operations" && action.Instruction.Contains("scor", StringComparison.OrdinalIgnoreCase)).ToList();
        var scoringEventDay = result.StaffBriefing.EventDay.Where(action =>
            action.Audience == "Golf Operations" && action.Instruction.Contains("scor", StringComparison.OrdinalIgnoreCase)).ToList();

        Assert.Single(foodActions);
        Assert.Contains("Staffed buffet", foodActions[0].Instruction, StringComparison.Ordinal);
        Assert.Contains("Alex Morgan", foodActions[0].Instruction, StringComparison.Ordinal);
        Assert.Contains("Event-specific note: Use the low serving station reserved for the junior group.", foodActions[0].Instruction, StringComparison.Ordinal);
        Assert.Single(scoringPreparation);
        Assert.Single(scoringEventDay);
        Assert.Contains("paper result sheet", scoringPreparation[0].Instruction, StringComparison.Ordinal);
        Assert.Contains("paper result sheet", scoringEventDay[0].Instruction, StringComparison.Ordinal);
    }

    [Fact]
    public async Task GenerateAsync_AiResponseCannotOmitRecordedOperationalFacts()
    {
        var service = CreateService(AiResponse(), "test-api-key");
        var request = Request(
            Answer("food-service-arrangement", "Staffed hot-food counter"),
            Answer("food-service-owner", "Jordan Lee"),
            Answer("golf-results-technology-dependent", "Yes", "Golf"),
            Answer("golf-results-technology-plan", "Primary tablet, independent hotspot and paper backup", "Golf"));

        var result = await service.GenerateAsync(request, CancellationToken.None);

        Assert.Equal("openai", result.Mode);
        Assert.Contains(result.KeyInformation, fact =>
            fact.Label == "Food service lead" && fact.Value == "Jordan Lee");
        Assert.Contains(result.KeyInformation, fact =>
            fact.Label == "Scoring technology and fallback"
            && fact.Value == "Primary tablet, independent hotspot and paper backup");
        Assert.Contains(result.StaffBriefing.EventDay, action =>
            action.Audience == "Kitchen & Catering"
            && action.Instruction.Contains("Jordan Lee", StringComparison.Ordinal));
        Assert.Contains(result.StaffBriefing.Preparation, action =>
            action.Audience == "Golf Operations"
            && action.Instruction.Contains("independent hotspot", StringComparison.Ordinal));
        Assert.Contains(result.StaffBriefing.EventDay, action =>
            action.Audience == "Golf Operations"
            && action.Instruction.Contains("paper backup", StringComparison.Ordinal));
    }

    [Fact]
    public async Task GenerateAsync_AiConsolidationPreservesUniqueFoodAndScoringDeliveryDetails()
    {
        var service = CreateService(AiResponseWithUniqueOperationalDetails(), "test-api-key");
        var request = Request(
            Answer("food-service-arrangement", "Staffed bain-marie service"),
            Answer("food-service-owner", "Jordan Lee"),
            Answer("golf-results-technology-dependent", "Yes", "Golf"),
            Answer("golf-results-technology-plan", "Scoring tablet with paper backup", "Golf"));

        var result = await service.GenerateAsync(request, CancellationToken.None);

        var foodAction = Assert.Single(result.StaffBriefing.EventDay, action =>
            action.Audience == "Kitchen & Catering");
        Assert.Contains("Peacock Lounge", foodAction.Instruction, StringComparison.Ordinal);
        Assert.Contains("evening bar lead at 20:30", foodAction.Instruction, StringComparison.Ordinal);
        Assert.Contains("Event-specific note: Keep the allergy list beside the bain-marie.", foodAction.Instruction, StringComparison.Ordinal);

        var scoringAction = Assert.Single(result.StaffBriefing.EventDay, action =>
            action.Audience == "Golf Operations");
        Assert.Contains("first-tee desk by 18:15", scoringAction.Instruction, StringComparison.Ordinal);
        Assert.Contains("presentation lead", scoringAction.Instruction, StringComparison.Ordinal);
        Assert.Contains("paper backup", scoringAction.Instruction, StringComparison.Ordinal);
        var scoringPreparation = Assert.Single(result.StaffBriefing.Preparation, action =>
            action.Audience == "Golf Operations");
        Assert.Contains("beside the first tee at 16:30", scoringPreparation.Instruction, StringComparison.Ordinal);
    }

    [Fact]
    public async Task GenerateAsync_NoTechnologyDependencyDoesNotConsumeAKeyFactSlot()
    {
        var service = CreateService(AiResponse(10, 1, 1, 0), "test-api-key");
        var result = await service.GenerateAsync(
            Request(Answer("golf-results-technology-dependent", "No", "Golf")),
            CancellationToken.None);

        Assert.Equal(10, result.KeyInformation.Count);
        Assert.DoesNotContain(result.KeyInformation, fact =>
            fact.Label.Equals("Scoring technology dependency", StringComparison.OrdinalIgnoreCase)
            || fact.Label.Equals("Scoring technology and fallback", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task GenerateAsync_EmptyAiStaffListsDoNotDuplicateFallbackOperationalText()
    {
        var service = CreateService(AiResponse(0, 0, 0, 0), "test-api-key");
        var request = Request(
            Answer("food-service-arrangement", "Staffed bain-marie service"),
            Answer("food-service-owner", "Jordan Lee"),
            Answer("golf-results-technology-dependent", "Yes", "Golf"),
            Answer("golf-results-technology-plan", "Tablet with paper backup", "Golf"));

        var result = await service.GenerateAsync(request, CancellationToken.None);

        var foodAction = Assert.Single(result.StaffBriefing.EventDay, action =>
            action.Audience == "Kitchen & Catering");
        Assert.Equal(1, Occurrences(foodAction.Instruction, "Staffed bain-marie service"));
        Assert.Single(result.StaffBriefing.Preparation, action =>
            action.Audience == "Golf Operations" && action.Instruction.Contains("scoring", StringComparison.OrdinalIgnoreCase));
        Assert.Single(result.StaffBriefing.EventDay, action =>
            action.Audience == "Golf Operations" && action.Instruction.Contains("scor", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task GenerateAsync_PostAiEnrichmentKeepsOperationalFactsAndNotesWithinCaps()
    {
        var service = CreateService(AiResponse(10, 18, 18, 12), "test-api-key");
        var request = Request(
            Answer("food-service-arrangement", "Self-service buffet"),
            Answer("food-service-self-service-risk", "Yes"),
            Answer("golf-results-technology-dependent", "Yes", "Golf"));

        var result = await service.GenerateAsync(request, CancellationToken.None);

        Assert.Equal(10, result.KeyInformation.Count);
        Assert.Contains(result.KeyInformation, fact => fact.Label == "Food service arrangement");
        Assert.Contains(result.KeyInformation, fact =>
            fact.Label == "Self-service safeguard" && fact.Value.Contains("not yet named", StringComparison.Ordinal));
        Assert.Contains(result.KeyInformation, fact =>
            fact.Label == "Scoring technology and fallback" && fact.Value.Contains("not yet recorded", StringComparison.Ordinal));
        Assert.Equal(18, result.StaffBriefing.Preparation.Count);
        Assert.Equal(18, result.StaffBriefing.EventDay.Count);
        Assert.Equal(12, result.StaffBriefing.ImportantNotes.Count);
        Assert.Contains(result.StaffBriefing.ImportantNotes, note => note.Contains("nobody has been named", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.StaffBriefing.ImportantNotes, note => note.Contains("adult supervisor", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.StaffBriefing.ImportantNotes, note => note.Contains("fallback plan", StringComparison.OrdinalIgnoreCase));
    }

    private static EventBriefingService CreateService(HttpResponseMessage? response = null, string apiKey = "") =>
        new(
            new TestHttpClientFactory(response),
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions
            {
                ApiKey = apiKey,
                PromptModel = "test-model"
            }),
            NullLogger<EventBriefingService>.Instance);

    private static EventBriefingRequest Request(params EventBriefingAnswer[] answers) => new()
    {
        EventName = "Golf Sixes Final",
        EventDescription = "The junior Golf Sixes final in the clubhouse.",
        EventDate = "2026-09-13",
        StartTime = "17:00",
        ExpectedAttendees = 60,
        Answers = [.. answers]
    };

    private static EventBriefingRequest RequestWithTasks(
        EventBriefingAnswer[] answers,
        params EventBriefingTask[] tasks) => new()
    {
        EventName = "Golf Sixes Final",
        EventDescription = "The junior Golf Sixes final in the clubhouse.",
        EventDate = "2026-09-13",
        StartTime = "17:00",
        ExpectedAttendees = 60,
        Answers = [.. answers],
        Tasks = [.. tasks]
    };

    private static EventBriefingTask BriefingTask(
        string audience,
        string instruction,
        string phase,
        string notes = "") => new()
    {
        Area = audience,
        Title = instruction,
        StaffBriefingPhase = phase,
        StaffBriefingAudience = audience,
        StaffBriefingInstruction = instruction,
        Notes = notes
    };

    private static EventBriefingAnswer Answer(string id, string value, string module = "Food & drink") => new()
    {
        QuestionId = id,
        Module = module,
        Section = "Operational arrangements",
        Question = id,
        Answer = value
    };

    private static int Occurrences(string value, string fragment)
    {
        var count = 0;
        var index = 0;
        while ((index = value.IndexOf(fragment, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += fragment.Length;
        }
        return count;
    }

    private static HttpResponseMessage AiResponse(
        int factCount = 1,
        int preparationCount = 1,
        int eventDayCount = 1,
        int importantNoteCount = 0)
    {
        var generated = JsonSerializer.Serialize(new
        {
            headline = "Golf Sixes Final",
            eventSummary = "A junior golf final.",
            keyInformation = Enumerable.Range(1, factCount).Select(index => new { label = $"Fact {index}", value = $"Value {index}" }),
            sections = new[] { new { title = "Event", points = new[] { "Junior final" } } },
            staffBriefing = new
            {
                heading = "Staff briefing: Golf Sixes Final",
                introduction = "Junior golf final.",
                preparation = Enumerable.Range(1, preparationCount).Select(index => new { audience = $"Preparation team {index}", instruction = $"Preparation instruction {index}." }),
                eventDay = Enumerable.Range(1, eventDayCount).Select(index => new { audience = $"Event team {index}", instruction = $"Event instruction {index}." }),
                afterwards = new[] { new { audience = "Front of House", instruction = "Close the room." } },
                keyContacts = Array.Empty<string>(),
                importantNotes = Enumerable.Range(1, importantNoteCount).Select(index => $"Existing important note {index}.")
            }
        });
        var body = JsonSerializer.Serialize(new
        {
            choices = new[] { new { message = new { content = generated } } }
        });
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
    }

    private static HttpResponseMessage AiResponseWithUniqueOperationalDetails()
    {
        var generated = JsonSerializer.Serialize(new
        {
            headline = "Golf Sixes Final",
            eventSummary = "A junior golf final.",
            keyInformation = new[] { new { label = "Venue", value = "Clubhouse" } },
            sections = new[] { new { title = "Event", points = new[] { "Junior final" } } },
            staffBriefing = new
            {
                heading = "Staff briefing: Golf Sixes Final",
                introduction = "Junior golf final.",
                preparation = new[]
                {
                    new { audience = "Golf Operations", instruction = "Test the scoring tablet beside the first tee at 16:30." }
                },
                eventDay = new[]
                {
                    new
                    {
                        audience = "Kitchen & Catering",
                        instruction = "Operate food service from the Peacock Lounge and hand over to the evening bar lead at 20:30. Event-specific note: Keep the allergy list beside the bain-marie."
                    },
                    new
                    {
                        audience = "Golf Operations",
                        instruction = "Collect scores at the first-tee desk by 18:15 and send the result to the presentation lead."
                    }
                },
                afterwards = Array.Empty<object>(),
                keyContacts = Array.Empty<string>(),
                importantNotes = Array.Empty<string>()
            }
        });
        var body = JsonSerializer.Serialize(new
        {
            choices = new[] { new { message = new { content = generated } } }
        });
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
    }

    private sealed class TestHttpClientFactory(HttpResponseMessage? response) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(
            new StaticResponseHandler(response ?? throw new InvalidOperationException("No HTTP response was configured.")),
            disposeHandler: true)
        {
            BaseAddress = new Uri("https://api.openai.test/v1/")
        };
    }

    private sealed class StaticResponseHandler(HttpResponseMessage response) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) => Task.FromResult(response);
    }
}
