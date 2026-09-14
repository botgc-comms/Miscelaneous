using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using BOTGC.EventPlaybook.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class RetrospectiveAnalysisServiceTests
{
    [Fact]
    public async Task AnalyseAsync_MapsBainMarieSelfServiceLessonToServiceArrangementQuestion()
    {
        var result = await AnalyseAsync(
            "Using the bain-marie as self-service meant children were expected to help themselves to hot food, so the service arrangement must be agreed explicitly next time.",
            CateringPlanningItems());

        var proposal = Assert.Single(result.Proposals);
        Assert.Equal("food-service-arrangement", proposal.TargetItemId);
        Assert.Equal("catering", proposal.TargetModuleId);
    }

    [Fact]
    public async Task AnalyseAsync_MapsMissingJuniorFoodServerToNamedServiceOwnerQuestion()
    {
        var result = await AnalyseAsync(
            "No server was assigned to the hot-food service point, so a named adult must supervise serving food to the juniors next time.",
            CateringPlanningItems());

        var proposal = Assert.Single(result.Proposals);
        Assert.Equal("food-service-owner", proposal.TargetItemId);
        Assert.Equal("catering", proposal.TargetModuleId);
    }

    [Fact]
    public async Task AnalyseAsync_UsesEventDayFoodServiceTaskForLegacyCandidateLists()
    {
        var result = await AnalyseAsync(
            "Nobody served the juniors at the bain-marie and children could not safely help themselves to the hot food.",
            CateringPlanningItems().Where(item => item.Id is not "food-service-arrangement" and not "food-service-owner").ToList());

        var proposal = Assert.Single(result.Proposals);
        Assert.Equal("event-day-food-service-task", proposal.TargetItemId);
    }

    [Theory]
    [InlineData("The scoring app became unusable when the clubhouse Wi‑Fi network was overwhelmed, so the device needs an offline or manual fallback.")]
    [InlineData("We could not record the winners because the online scoring system lost internet connectivity; test the login and keep paper score capture ready.")]
    public async Task AnalyseAsync_PrefersGolfResultsTechnologyReadinessOverGenericResultsTask(string lesson)
    {
        var result = await AnalyseAsync(lesson, GolfResultsPlanningItems());

        var proposal = Assert.Single(result.Proposals);
        Assert.Equal("prepare-golf-results-technology", proposal.TargetItemId);
        Assert.Equal("golf", proposal.TargetModuleId);
    }

    [Fact]
    public async Task AnalyseAsync_DoesNotForceUnrelatedConnectivityLessonOntoGolfResults()
    {
        var result = await AnalyseAsync(
            "The member-email app lost internet connectivity and the communications message had to be delayed.",
            GolfResultsPlanningItems().Where(item => item.ModuleId == "golf").ToList());

        Assert.Empty(result.Proposals);
    }

    [Fact]
    public async Task AnalyseAsync_DoesNotForceNonFoodCloseDownLessonOntoFoodService()
    {
        var result = await AnalyseAsync(
            "The staff reset the room, cleared the bar and returned the furniture after the event.",
            CateringPlanningItems().Where(item => item.ModuleId == "catering").ToList());

        Assert.Empty(result.Proposals);
    }

    private static async Task<RetrospectiveAnalysisResult> AnalyseAsync(
        string retrospectiveText,
        List<RetrospectiveTaskContext> planningItems)
    {
        var service = new RetrospectiveAnalysisService(
            new UnusedHttpClientFactory(),
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions()),
            NullLogger<RetrospectiveAnalysisService>.Instance);

        var result = await service.AnalyseAsync(new RetrospectiveAnalysisRequest
        {
            EventName = "Golf Sixes Final",
            EventDescription = "Junior golf final followed by food and a results presentation.",
            RetrospectiveText = retrospectiveText,
            Tasks = planningItems
        }, CancellationToken.None);

        Assert.Equal("deterministic-fallback", result.Mode);
        return result;
    }

    private static List<RetrospectiveTaskContext> CateringPlanningItems() =>
    [
        PlanningItem(
            "food-service-arrangement",
            "question",
            "How will attendees receive the food?",
            "Choose the principal service arrangement. For a buffet, hot-food station or other service point, state whether it will be staffed rather than assuming guests will serve themselves.",
            "catering",
            "Menu, covers and dietary detail"),
        PlanningItem(
            "food-service-owner",
            "question",
            "Who will operate or supervise the food service on the day?",
            "Choose the named person where possible, or the responsible role. This ownership is required even when the normal rota is sufficient or an external supplier provides the food.",
            "catering",
            "Menu, covers and dietary detail"),
        PlanningItem(
            "food-service-readiness-task",
            "task",
            "Complete the kitchen and food-service setup for the agreed menu and service arrangement",
            "Set up the kitchen and service area for the recorded covers, menu, timing and service method. Confirm that the named service owner has accepted responsibility and that every serving or supervision position is covered.",
            "catering",
            "Menu, covers and dietary detail"),
        PlanningItem(
            "event-day-food-service-task",
            "task",
            "Operate the agreed food service and serve the event menu",
            "The named service owner operates or supervises the recorded service arrangement, keeps every required serving position covered and ensures guests receive the agreed menu safely at the recorded time.",
            "catering",
            "Menu, covers and dietary detail"),
        PlanningItem(
            "additional-food-staff",
            "question",
            "Will we need additional staff to assist with food preparation or serving?",
            "Consider kitchen preparation, service and clearing cover beyond the normal rota.",
            "catering",
            "Food preparation and staffing"),
        PlanningItem(
            "junior-safeguarding-task",
            "task",
            "Confirm safeguarding arrangements for children and junior members",
            "Name the responsible adults and supervision arrangements.",
            "safety",
            "Safeguarding")
    ];

    private static List<RetrospectiveTaskContext> GolfResultsPlanningItems() =>
    [
        PlanningItem(
            "golf-results-technology-dependent",
            "question",
            "Will collecting scores or producing the result depend on an app, device, online service or network connection?",
            "Choose Yes whenever an essential part of score collection, calculation, publication or presentation could be prevented by a device, account, power or connectivity failure.",
            "golf",
            "Competition and scoring arrangements"),
        PlanningItem(
            "golf-results-technology-plan",
            "question",
            "What technology will be used and what is the working fallback if it is unavailable?",
            "Record the app or service, intended device and operator, required login, power arrangements, how connectivity will be tested in the venue under expected load, an alternative connection, offline or paper score capture and a manual calculation or announcement fallback.",
            "golf",
            "Competition and scoring arrangements"),
        PlanningItem(
            "prepare-golf-results-technology",
            "task",
            "Test the golf-results technology and prepare a working fallback",
            "Test the complete scoring and results workflow using the intended device and user account in the venue. Confirm login access, battery or power, connectivity under expected event load, an independent alternative connection, offline or paper score capture and a workable manual calculation and announcement fallback.",
            "golf",
            "Competition and scoring arrangements"),
        PlanningItem(
            "results-task",
            "task",
            "Assign responsibility for collecting scores, calculating results and producing the final result",
            "Confirm who will operate the agreed scoring process on the day and ensure they know when to switch to the recorded offline, paper or manual fallback.",
            "golf",
            "Competition and scoring arrangements"),
        PlanningItem(
            "music-setup-task",
            "task",
            "Test the music and entertainment setup",
            "Confirm the playback device, internet dependency, soundcheck and backup option.",
            "entertainment",
            "Music and sound"),
        PlanningItem(
            "communications-digital-board-task",
            "task",
            "Publish the digital-board artwork",
            "Send the approved artwork to the clubhouse screens.",
            "communications",
            "Digital displays")
    ];

    private static RetrospectiveTaskContext PlanningItem(
        string id,
        string itemType,
        string title,
        string detail,
        string moduleId,
        string sectionTitle) => new()
        {
            Id = id,
            ItemType = itemType,
            Title = title,
            Detail = detail,
            ModuleId = moduleId,
            ModuleTitle = moduleId == "golf" ? "Golf" : moduleId == "catering" ? "Food and drink" : moduleId,
            SectionId = sectionTitle.ToLowerInvariant().Replace(' ', '-'),
            SectionTitle = sectionTitle,
            Completed = true
        };

    private sealed class UnusedHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new InvalidOperationException("The deterministic fallback must not create an HTTP client.");
    }
}
