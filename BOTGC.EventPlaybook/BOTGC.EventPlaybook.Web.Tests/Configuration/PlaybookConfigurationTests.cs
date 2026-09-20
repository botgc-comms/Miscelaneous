using System.Text.Json;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Configuration;

public sealed class PlaybookConfigurationTests
{
    [Fact]
    public void StaffingBuildsOneOwnedDutyPlanAndAlwaysProducesABriefing()
    {
        var solutionRoot = FindSolutionRoot();
        var dataPath = Path.Combine(solutionRoot, "BOTGC.EventPlaybook.Web", "Data", "event-playbook.json");
        var publicPath = Path.Combine(solutionRoot, "BOTGC.EventPlaybook.Web", "wwwroot", "event-playbook.json");
        var dataJson = File.ReadAllText(dataPath);

        Assert.Equal(dataJson, File.ReadAllText(publicPath));

        using var document = JsonDocument.Parse(dataJson);
        var root = document.RootElement;
        var additionalDuties = FindItem(root, "specific-jobs-required");
        Assert.Contains("additional", additionalDuties.GetProperty("label").GetString(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains(
            additionalDuties.GetProperty("planningContext").GetProperty("fields").EnumerateArray(),
            field => field.GetProperty("questionId").GetString() == "seating-layout");

        var allocations = FindItem(root, "event-day-duty-allocations");
        Assert.Equal("textarea", allocations.GetProperty("answerType").GetString());
        Assert.True(allocations.GetProperty("required").GetBoolean());

        var dutyTask = FindItem(root, "roles-task");
        Assert.False(dutyTask.TryGetProperty("showWhen", out _));
        Assert.Equal("staffing-coordinator", dutyTask.GetProperty("ownerFromQuestionId").GetString());
        Assert.Equal("module:staffing", dutyTask.GetProperty("actionView").GetString());
        Assert.Equal("briefing", dutyTask.GetProperty("secondaryActionView").GetString());
        Assert.Contains(
            dutyTask.GetProperty("reviewSummary").GetProperty("fields").EnumerateArray(),
            field => field.GetProperty("questionId").GetString() == "event-day-duty-allocations");

        Assert.False(ContainsItem(root, "staff-briefing-required"));
        var briefingComments = FindItem(root, "staff-briefing-comments");
        Assert.Equal("textarea", briefingComments.GetProperty("answerType").GetString());
        Assert.False(briefingComments.GetProperty("required").GetBoolean());

        var briefingTask = FindItem(root, "staff-briefing-task");
        Assert.False(briefingTask.TryGetProperty("showWhen", out _));
        Assert.Equal("staffing-coordinator", briefingTask.GetProperty("ownerFromQuestionId").GetString());
        Assert.Equal("briefing", briefingTask.GetProperty("actionView").GetString());

        foreach (var taskId in new[]
                 {
                     "event-lead-task", "roles-task", "staff-briefing-task", "arrange-additional-event-staff",
                     "confirm-event-rotas", "resolve-event-cover-gaps", "resolve-staffing-contingency",
                     "arrange-event-opening-cover", "arrange-event-lock-up-cover"
                 })
        {
            Assert.Equal("staffing-coordinator", FindItem(root, taskId).GetProperty("ownerFromQuestionId").GetString());
        }

        var lockUp = FindItem(root, "event-lock-up-arrangement");
        Assert.Contains(
            lockUp.GetProperty("options").EnumerateArray(),
            option => option.GetProperty("value").GetString() == "handover-to-duty-closer"
                      && option.GetProperty("label").GetString()!.Contains("Front of House", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void CloseDownPlanSurfacesPriorSetupAndAcceptsPersonOrDutyTeamOwnership()
    {
        var solutionRoot = FindSolutionRoot();
        var dataPath = Path.Combine(solutionRoot, "BOTGC.EventPlaybook.Web", "Data", "event-playbook.json");
        var publicPath = Path.Combine(solutionRoot, "BOTGC.EventPlaybook.Web", "wwwroot", "event-playbook.json");
        var dataJson = File.ReadAllText(dataPath);
        var publicJson = File.ReadAllText(publicPath);

        Assert.Equal(dataJson, publicJson);

        using var document = JsonDocument.Parse(dataJson);
        var root = document.RootElement;
        Assert.Equal("3.8", root.GetProperty("schemaVersion").GetString());

        var closeDownQuestion = FindItem(root, "general-close-down-required");
        var context = closeDownQuestion.GetProperty("planningContext");
        Assert.Contains(
            context.GetProperty("fields").EnumerateArray(),
            field => field.GetProperty("questionId").GetString() == "seating-layout");
        Assert.Contains(
            context.GetProperty("fields").EnumerateArray(),
            field => field.GetProperty("questionId").GetString() == "event-lock-up-person");

        var scope = FindItem(root, "close-down-actions");
        Assert.Equal("multiChoice", scope.GetProperty("answerType").GetString());
        Assert.True(scope.GetProperty("required").GetBoolean());

        var lead = FindItem(root, "close-down-lead");
        Assert.Equal("assignment", lead.GetProperty("answerType").GetString());
        Assert.Equal("personOrRole", lead.GetProperty("assignmentMode").GetString());
        Assert.Contains("Clubhouse / House Team", lead.GetProperty("helpText").GetString());
        Assert.True(lead.GetProperty("required").GetBoolean());

        var task = FindItem(root, "general-close-down-task");
        Assert.Equal("DT", task.GetProperty("deadlineCode").GetString());
        Assert.Equal("close-down-lead", task.GetProperty("ownerFromQuestionId").GetString());
        Assert.Contains(
            task.GetProperty("reviewSummary").GetProperty("fields").EnumerateArray(),
            field => field.GetProperty("questionId").GetString() == "close-down-actions");
        Assert.Contains(
            task.GetProperty("reviewSummary").GetProperty("fields").EnumerateArray(),
            field => field.GetProperty("questionId").GetString() == "close-down-lead");

        var roomResetTask = FindItem(root, "remove-seating-task");
        Assert.True(ReferencesQuestion(roomResetTask.GetProperty("showWhen"), "prize-table-required"));

        Assert.False(ContainsItem(root, "post-event-review"));
        Assert.False(ContainsItem(root, "review-task"));
        Assert.False(ContainsItem(root, "review-attendee-feedback"));

        var retrospectiveTask = FindItem(root, "complete-retrospective");
        Assert.Equal("A2", retrospectiveTask.GetProperty("deadlineCode").GetString());
        Assert.Equal("retrospective", retrospectiveTask.GetProperty("actionView").GetString());
        Assert.Contains("attendee feedback", retrospectiveTask.GetProperty("detail").GetString(), StringComparison.OrdinalIgnoreCase);
        Assert.False(retrospectiveTask.TryGetProperty("showWhen", out _));
    }

    [Fact]
    public void AdmissionDistinguishesAttendanceEstimatesLimitedPlacesAndPaidEntry()
    {
        var solutionRoot = FindSolutionRoot();
        var dataPath = Path.Combine(solutionRoot, "BOTGC.EventPlaybook.Web", "Data", "event-playbook.json");
        using var document = JsonDocument.Parse(File.ReadAllText(dataPath));
        var root = document.RootElement;

        var gateway = FindItem(root, "entry-charge");
        Assert.Equal(
            "Will attendees need to book to come to the event and/or will they be charged?",
            gateway.GetProperty("label").GetString());
        Assert.Equal(
            "decide-booking-or-entry-charge",
            gateway.GetProperty("dontKnowTask").GetProperty("id").GetString());

        var admission = FindModule(root, "admission");
        Assert.Equal("Bookings, tickets and admission payments", admission.GetProperty("title").GetString());
        Assert.True(ContainsCondition(admission.GetProperty("activation"), "entry-charge", "equals", true));

        var arrangements = FindItem(root, "admission-arrangements");
        Assert.Equal("singleChoice", arrangements.GetProperty("answerType").GetString());
        var arrangementValues = arrangements.GetProperty("options")
            .EnumerateArray()
            .Select(option => option.GetProperty("value").GetString())
            .ToArray();
        Assert.Equal(
            new[] { "attendance-registration", "limited-place-booking", "paid-entry" },
            arrangementValues);
        Assert.Contains("head-count estimate", arrangements.GetProperty("helpText").GetString(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("does not reserve", arrangements.GetProperty("helpText").GetString(), StringComparison.OrdinalIgnoreCase);

        var freeEntry = FindItem(root, "admission-free-entry");
        Assert.Equal("yesNo", freeEntry.GetProperty("answerType").GetString());
        Assert.Equal("Is entry free for certain attendee categories?", freeEntry.GetProperty("label").GetString());
        Assert.True(ContainsCondition(freeEntry.GetProperty("showWhen"), "admission-arrangements", "equals", "paid-entry"));

        var freeCategories = FindItem(root, "admission-free-categories");
        Assert.Equal("multiChoice", freeCategories.GetProperty("answerType").GetString());
        Assert.True(ContainsCondition(freeCategories.GetProperty("showWhen"), "admission-free-entry", "equals", true));
        var freeCategoryValues = freeCategories.GetProperty("options")
            .EnumerateArray()
            .Select(option => option.GetProperty("value").GetString())
            .ToArray();
        Assert.Equal(new[] { "children", "members", "visitors" }, freeCategoryValues);

        var prices = FindItem(root, "admission-price-details");
        Assert.Equal("question", prices.GetProperty("type").GetString());
        Assert.Equal("text", prices.GetProperty("answerType").GetString());
        Assert.True(prices.GetProperty("required").GetBoolean());
        Assert.True(ContainsCondition(prices.GetProperty("showWhen"), "admission-arrangements", "equals", "paid-entry"));
        Assert.True(ContainsCondition(prices.GetProperty("showWhen"), "admission-free-entry", "equals", false));
        Assert.True(ContainsNegatedAllValues(prices.GetProperty("showWhen"), "admission-free-categories", freeCategoryValues!));
        Assert.Contains("Communications Centre AI", prices.GetProperty("helpText").GetString(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Adults £30", prices.GetProperty("example").GetString(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("children £15", prices.GetProperty("example").GetString(), StringComparison.OrdinalIgnoreCase);

        var admissionCapacity = FindItem(root, "admission-capacity");
        Assert.Equal("What is the maximum number of places available?", admissionCapacity.GetProperty("label").GetString());
        Assert.True(ContainsCondition(admissionCapacity.GetProperty("showWhen"), "admission-arrangements", "equals", "limited-place-booking"));
        Assert.True(ContainsCondition(admissionCapacity.GetProperty("showWhen"), "admission-arrangements", "equals", "paid-entry"));
        Assert.False(ContainsCondition(admissionCapacity.GetProperty("showWhen"), "admission-arrangements", "equals", "attendance-registration"));
        Assert.True(admissionCapacity.GetProperty("required").GetBoolean());
        Assert.Contains("not asked", admissionCapacity.GetProperty("helpText").GetString(), StringComparison.OrdinalIgnoreCase);

        var admissionOffer = admission.GetProperty("sections")
            .EnumerateArray()
            .Single(section => section.GetProperty("id").GetString() == "admission-offer");
        var admissionOfferIds = admissionOffer.GetProperty("items")
            .EnumerateArray()
            .Select(item => item.GetProperty("id").GetString())
            .ToList();
        Assert.True(admissionOfferIds.IndexOf("admission-free-entry") < admissionOfferIds.IndexOf("admission-free-categories"));
        Assert.True(admissionOfferIds.IndexOf("admission-free-categories") < admissionOfferIds.IndexOf("admission-price-details"));
        Assert.True(admissionOfferIds.IndexOf("admission-price-details") < admissionOfferIds.IndexOf("admission-capacity"));

        var tableBooking = FindItem(root, "guest-table-booking");
        Assert.Equal("yesNo", tableBooking.GetProperty("answerType").GetString());
        Assert.True(tableBooking.GetProperty("required").GetBoolean());
        Assert.True(ContainsOperator(tableBooking.GetProperty("showWhen"), "admission-arrangements", "answered"));

        foreach (var paidItemId in new[] { "admission-price-details", "admission-refund-policy", "admission-payment-timing", "admission-payment-methods", "reconcile-admission-income-task" })
        {
            var paidCondition = FindItem(root, paidItemId).GetProperty("showWhen");
            Assert.True(ContainsCondition(paidCondition, "admission-arrangements", "equals", "paid-entry"));
            Assert.True(ContainsOperator(paidCondition, "admission-free-entry", "answered"));
            Assert.True(ContainsNegatedAllValues(paidCondition, "admission-free-categories", freeCategoryValues!));
        }

        var refundAfterChange = FindItem(root, "resolve-admission-refunds-after-event-change").GetProperty("showWhen");
        Assert.True(ContainsCondition(refundAfterChange, "entry-charge", "equals", true));
        Assert.True(ContainsCondition(refundAfterChange, "admission-arrangements", "equals", "paid-entry"));
        Assert.True(ContainsNegatedAllValues(refundAfterChange, "admission-free-categories", freeCategoryValues!));

        var salesOpenCondition = FindItem(root, "ticket-sales-open-date").GetProperty("showWhen");
        Assert.True(ContainsCondition(salesOpenCondition, "admission-arrangements", "equals", "attendance-registration"));
        Assert.True(ContainsCondition(salesOpenCondition, "admission-arrangements", "equals", "limited-place-booking"));
        Assert.True(ContainsCondition(salesOpenCondition, "admission-arrangements", "equals", "paid-entry"));
        Assert.True(ContainsCondition(salesOpenCondition, "admission-payment-timing", "contains", "advance"));

        var salesCloseCondition = FindItem(root, "ticket-sales-close-date").GetProperty("showWhen");
        Assert.True(ContainsCondition(salesCloseCondition, "admission-arrangements", "equals", "attendance-registration"));
        Assert.True(ContainsCondition(salesCloseCondition, "admission-arrangements", "equals", "limited-place-booking"));
        Assert.True(ContainsCondition(salesCloseCondition, "admission-arrangements", "equals", "paid-entry"));
        Assert.True(ContainsCondition(salesCloseCondition, "admission-payment-timing", "contains", "advance"));

        var configureRouteCondition = FindItem(root, "configure-ticket-sales-task").GetProperty("showWhen");
        Assert.True(ContainsCondition(configureRouteCondition, "admission-arrangements", "equals", "attendance-registration"));
        Assert.True(ContainsCondition(configureRouteCondition, "admission-arrangements", "equals", "limited-place-booking"));
        Assert.True(ContainsCondition(configureRouteCondition, "admission-arrangements", "equals", "paid-entry"));
        Assert.True(ContainsCondition(configureRouteCondition, "admission-payment-timing", "contains", "advance"));
        Assert.False(ContainsCondition(FindItem(root, "door-admission-process").GetProperty("showWhen"), "admission-arrangements", "equals", "attendance-registration"));

        Assert.False(ContainsItem(root, "booking-registration-instructions"));
        Assert.False(ContainsItem(root, "booking-confirmation-process"));
        Assert.False(ContainsItem(root, "set-admission-prices-task"));
        Assert.False(ContainsItem(root, "approve-admission-offer-task"));
        var publicInstructions = FindItem(root, "admission-public-instructions");
        Assert.Equal(
            "What booking instructions should be included in communications?",
            publicInstructions.GetProperty("label").GetString());
        Assert.Contains(
            "exact wording members need in order to book or register",
            publicInstructions.GetProperty("helpText").GetString());
        Assert.False(ContainsItem(root, "booking-required"));
        Assert.False(ContainsItem(root, "booking-details-task"));
        Assert.False(ContainsItem(root, "admission-tickets-required"));
        Assert.True(ContainsItem(root, "admission-price-details"));
        Assert.False(ContainsItem(root, "complimentary-admission"));
        Assert.False(ContainsItem(root, "complimentary-admission-details"));
    }

    [Fact]
    public void FoodServiceAndGolfResultsCaptureOperationalOwnershipAndResilience()
    {
        var solutionRoot = FindSolutionRoot();
        var dataPath = Path.Combine(solutionRoot, "BOTGC.EventPlaybook.Web", "Data", "event-playbook.json");
        var publicPath = Path.Combine(solutionRoot, "BOTGC.EventPlaybook.Web", "wwwroot", "event-playbook.json");
        var dataJson = File.ReadAllText(dataPath);

        Assert.Equal(dataJson, File.ReadAllText(publicPath));

        using var document = JsonDocument.Parse(dataJson);
        var root = document.RootElement;

        var serviceArrangement = FindItem(root, "food-service-arrangement");
        Assert.Equal("singleChoice", serviceArrangement.GetProperty("answerType").GetString());
        Assert.True(serviceArrangement.GetProperty("required").GetBoolean());
        Assert.True(ContainsCondition(serviceArrangement.GetProperty("showWhen"), "food-prepared", "equals", true));
        var serviceOptions = serviceArrangement.GetProperty("options")
            .EnumerateArray()
            .Select(option => option.GetProperty("value").GetString())
            .ToArray();
        Assert.Contains("staffed-service-point", serviceOptions);
        Assert.Contains("self-service", serviceOptions);
        Assert.Contains("table-service", serviceOptions);

        var otherArrangement = FindItem(root, "food-service-arrangement-other");
        Assert.Equal("text", otherArrangement.GetProperty("answerType").GetString());
        Assert.True(otherArrangement.GetProperty("required").GetBoolean());
        Assert.True(ContainsCondition(otherArrangement.GetProperty("showWhen"), "food-service-arrangement", "equals", "other"));

        var selfServiceRisk = FindItem(root, "food-service-self-service-risk");
        Assert.Equal("yesNo", selfServiceRisk.GetProperty("answerType").GetString());
        Assert.True(selfServiceRisk.GetProperty("required").GetBoolean());
        Assert.True(ContainsCondition(selfServiceRisk.GetProperty("showWhen"), "food-service-arrangement", "equals", "self-service"));
        Assert.Contains("juniors", selfServiceRisk.GetProperty("label").GetString(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("hot-holding", selfServiceRisk.GetProperty("label").GetString(), StringComparison.OrdinalIgnoreCase);

        var selfServiceSupervisor = FindItem(root, "food-service-self-service-supervisor");
        Assert.Equal("assignment", selfServiceSupervisor.GetProperty("answerType").GetString());
        Assert.Equal("person", selfServiceSupervisor.GetProperty("assignmentMode").GetString());
        Assert.True(selfServiceSupervisor.GetProperty("required").GetBoolean());
        Assert.True(ContainsCondition(selfServiceSupervisor.GetProperty("showWhen"), "food-service-self-service-risk", "equals", true));

        var serviceOwner = FindItem(root, "food-service-owner");
        Assert.Equal("assignment", serviceOwner.GetProperty("answerType").GetString());
        Assert.Equal("personOrRole", serviceOwner.GetProperty("assignmentMode").GetString());
        Assert.True(serviceOwner.GetProperty("required").GetBoolean());
        Assert.True(ContainsCondition(serviceOwner.GetProperty("showWhen"), "food-prepared", "equals", true));

        var additionalCover = FindItem(root, "additional-food-staff");
        Assert.Contains("normal rota", additionalCover.GetProperty("label").GetString());
        Assert.Contains("serve or supervise", additionalCover.GetProperty("label").GetString());

        var cateringModule = FindModule(root, "catering");
        var menuItems = cateringModule.GetProperty("sections")
            .EnumerateArray()
            .Single(section => section.GetProperty("id").GetString() == "menu")
            .GetProperty("items")
            .EnumerateArray()
            .Select(item => item.GetProperty("id").GetString())
            .ToList();
        Assert.Equal(menuItems.IndexOf("food-service-arrangement") + 1, menuItems.IndexOf("food-service-arrangement-other"));
        Assert.True(menuItems.IndexOf("food-service-self-service-risk") < menuItems.IndexOf("food-service-self-service-supervisor"));
        Assert.True(menuItems.IndexOf("food-service-self-service-supervisor") < menuItems.IndexOf("food-service-owner"));
        Assert.True(menuItems.IndexOf("food-service-owner") < menuItems.IndexOf("additional-food-staff"));
        Assert.True(menuItems.IndexOf("additional-food-staff") < menuItems.IndexOf("food-staff-task"));

        var commonFoodReviewFields = new[]
        {
            "catering-covers",
            "agreed-menu-choices",
            "meal-service-time",
            "dietary-requirements-summary",
            "food-service-arrangement",
            "food-service-arrangement-other",
            "food-service-owner",
            "food-service-self-service-risk",
            "food-service-self-service-supervisor"
        };
        foreach (var taskId in new[]
        {
            "external-food-service-liaison-task",
            "food-service-readiness-task",
            "event-day-food-service-task"
        })
        {
            var task = FindItem(root, taskId);
            var visibility = task.GetProperty("showWhen");
            Assert.True(ReferencesQuestion(visibility, "food-prepared"));
            Assert.True(ReferencesQuestion(visibility, "catering-covers"));
            Assert.True(ReferencesQuestion(visibility, "agreed-menu-choices"));
            Assert.True(ReferencesQuestion(visibility, "meal-service-time"));
            foreach (var newQuestionId in new[]
            {
                "food-service-arrangement",
                "food-service-arrangement-other",
                "food-service-owner",
                "food-service-self-service-risk",
                "food-service-self-service-supervisor"
            })
            {
                Assert.False(ReferencesQuestion(visibility, newQuestionId));
            }

            var reviewFieldIds = task.GetProperty("reviewSummary").GetProperty("fields")
                .EnumerateArray()
                .Select(field => field.GetProperty("questionId").GetString())
                .ToArray();
            foreach (var fieldId in commonFoodReviewFields)
            {
                Assert.Contains(fieldId, reviewFieldIds);
            }
            Assert.Contains("named food-service owner", task.GetProperty("staffBriefing").GetProperty("instruction").GetString(), StringComparison.OrdinalIgnoreCase);
        }

        Assert.Equal("food-service-owner", FindItem(root, "external-food-service-liaison-task").GetProperty("ownerFromQuestionId").GetString());
        Assert.False(FindItem(root, "food-service-readiness-task").TryGetProperty("ownerFromQuestionId", out _));
        Assert.Equal("food-service-owner", FindItem(root, "event-day-food-service-task").GetProperty("ownerFromQuestionId").GetString());

        var foodStaffTask = FindItem(root, "food-staff-task");
        Assert.False(foodStaffTask.TryGetProperty("ownerFromQuestionId", out _));
        var staffReviewFields = foodStaffTask.GetProperty("reviewSummary").GetProperty("fields")
            .EnumerateArray()
            .Select(field => field.GetProperty("questionId").GetString())
            .ToArray();
        foreach (var fieldId in new[]
        {
            "food-service-arrangement",
            "food-service-arrangement-other",
            "food-service-owner",
            "food-service-self-service-risk",
            "food-service-self-service-supervisor",
            "additional-food-staff"
        })
        {
            Assert.Contains(fieldId, staffReviewFields);
        }

        var technologyDependency = FindItem(root, "golf-results-technology-dependent");
        Assert.Equal("yesNo", technologyDependency.GetProperty("answerType").GetString());
        Assert.True(technologyDependency.GetProperty("required").GetBoolean());
        Assert.True(ContainsCondition(technologyDependency.GetProperty("showWhen"), "golf-results-required", "equals", true));

        var technologyPlan = FindItem(root, "golf-results-technology-plan");
        Assert.Equal("text", technologyPlan.GetProperty("answerType").GetString());
        Assert.True(technologyPlan.GetProperty("required").GetBoolean());
        Assert.True(ContainsCondition(technologyPlan.GetProperty("showWhen"), "golf-results-technology-dependent", "equals", true));

        var readinessTask = FindItem(root, "prepare-golf-results-technology");
        Assert.Equal("B2", readinessTask.GetProperty("deadlineCode").GetString());
        Assert.True(ContainsCondition(readinessTask.GetProperty("showWhen"), "golf-results-required", "equals", true));
        Assert.True(ContainsCondition(readinessTask.GetProperty("showWhen"), "golf-results-technology-dependent", "equals", true));
        var readinessDetail = readinessTask.GetProperty("detail").GetString();
        foreach (var requirement in new[] { "login", "power", "expected event load", "alternative connection", "paper", "manual calculation" })
        {
            Assert.Contains(requirement, readinessDetail, StringComparison.OrdinalIgnoreCase);
        }
        Assert.Contains(
            readinessTask.GetProperty("reviewSummary").GetProperty("fields").EnumerateArray(),
            field => field.GetProperty("questionId").GetString() == "golf-results-technology-plan");

        var resultsTask = FindItem(root, "results-task");
        Assert.Equal("B1", resultsTask.GetProperty("deadlineCode").GetString());
        Assert.False(resultsTask.TryGetProperty("reviewSummary", out _));
    }

    [Fact]
    public void EventControlUsesOneActionableGoAheadInsteadOfPassiveDepartmentDuplicates()
    {
        var solutionRoot = FindSolutionRoot();
        var dataPath = Path.Combine(solutionRoot, "BOTGC.EventPlaybook.Web", "Data", "event-playbook.json");
        var publicPath = Path.Combine(solutionRoot, "BOTGC.EventPlaybook.Web", "wwwroot", "event-playbook.json");
        var dataJson = File.ReadAllText(dataPath);

        Assert.Equal(dataJson, File.ReadAllText(publicPath));

        using var document = JsonDocument.Parse(dataJson);
        var root = document.RootElement;
        Assert.Equal("3.8", root.GetProperty("schemaVersion").GetString());

        foreach (var retiredId in new[]
        {
            "additional-operational-commitments",
            "decide-operational-commitments",
            "member-communications-sent",
            "check-event-communications-already-sent",
            "confirm-fb-before-commitment",
            "confirm-communications-before-promotion",
            "final-event-go-no-go"
        })
        {
            Assert.DoesNotContain($"\"id\": \"{retiredId}\"", dataJson, StringComparison.Ordinal);
        }

        var commitmentTasks = FindModule(root, "event-control").GetProperty("sections")
            .EnumerateArray()
            .Single(section => section.GetProperty("id").GetString() == "viability-control")
            .GetProperty("items")
            .EnumerateArray()
            .Where(item => item.GetProperty("type").GetString() == "task" &&
                item.TryGetProperty("deadlineCode", out var deadline) && deadline.GetString() == "CD")
            .Select(item => item.GetProperty("id").GetString())
            .ToArray();
        Assert.Equal(new[] { "confirm-event-before-commitments" }, commitmentTasks);

        var triggers = FindItem(root, "event-viability-triggers");
        Assert.False(triggers.GetProperty("required").GetBoolean());
        Assert.Contains("Leave this blank", triggers.GetProperty("helpText").GetString(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("normal judgement", triggers.GetProperty("helpText").GetString(), StringComparison.OrdinalIgnoreCase);

        var communicationsOwner = FindItem(root, "event-communications-owner");
        Assert.True(communicationsOwner.GetProperty("required").GetBoolean());
        Assert.Equal("personOrRole", communicationsOwner.GetProperty("assignmentMode").GetString());
        Assert.Contains("All communications tasks", communicationsOwner.GetProperty("helpText").GetString(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(
            "event-communications-owner",
            FindModule(root, "communications").GetProperty("sections").EnumerateArray()
                .Single(section => section.GetProperty("id").GetString() == "communications-plan")
                .GetProperty("items").EnumerateArray().First().GetProperty("id").GetString());

        var communicationsTasks = root.GetProperty("modules").EnumerateArray()
            .SelectMany(module => module.GetProperty("sections").EnumerateArray())
            .SelectMany(section => section.GetProperty("items").EnumerateArray())
            .SelectMany(item => item.GetProperty("type").GetString() == "task"
                ? new[] { item }
                : item.TryGetProperty("dontKnowTask", out var dontKnowTask)
                    ? new[] { dontKnowTask }
                    : Array.Empty<JsonElement>())
            .Where(task =>
                task.TryGetProperty("responsibleArea", out var area) && area.GetString() == "Communications" ||
                task.TryGetProperty("defaultOwnerRoleId", out var defaultOwner) && defaultOwner.GetString() == "communications")
            .ToArray();
        Assert.NotEmpty(communicationsTasks);
        Assert.All(communicationsTasks, task =>
            Assert.Equal("event-communications-owner", task.GetProperty("ownerFromQuestionId").GetString()));
        Assert.Contains(communicationsTasks, task => task.GetProperty("id").GetString() == "digital-signage-task");
        Assert.Contains(communicationsTasks, task => task.GetProperty("id").GetString() == "member-email-task");
        Assert.Contains(communicationsTasks, task => task.GetProperty("id").GetString() == "member-diary-task");
        Assert.Contains(communicationsTasks, task => task.GetProperty("id").GetString() == "issue-authoritative-event-change-message");
        Assert.False(ContainsItem(root, "prepare-communication-prerequisites-task"));

        var recipients = FindItem(root, "event-affected-areas");
        Assert.False(recipients.GetProperty("required").GetBoolean());
        Assert.Contains("receive the event go-ahead", recipients.GetProperty("label").GetString(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("named people", recipients.GetProperty("helpText").GetString(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(
            new[] { "food-beverage", "clubhouse", "golf", "communications", "suppliers", "entertainment", "admission", "staffing" },
            recipients.GetProperty("options").EnumerateArray().Select(option => option.GetProperty("value").GetString()).ToArray());

        var acceptance = FindItem(root, "agree-event-viability-control");
        Assert.Contains("accept", acceptance.GetProperty("title").GetString(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal("event-decision-owner", acceptance.GetProperty("ownerFromQuestionId").GetString());
        Assert.Equal("DT", acceptance.GetProperty("expiresAfterDeadlineCode").GetString());
        Assert.Equal("Accept decision responsibility", acceptance.GetProperty("reviewSummary").GetProperty("confirmLabel").GetString());
        var acceptanceFieldIds = acceptance.GetProperty("reviewSummary").GetProperty("fields")
            .EnumerateArray()
            .Select(field => field.GetProperty("questionId").GetString())
            .ToArray();
        Assert.Contains("event-decision-owner", acceptanceFieldIds);
        Assert.Contains("event-communications-owner", acceptanceFieldIds);
        Assert.Contains("event-viability-triggers", acceptanceFieldIds);
        Assert.Contains("event-minimum-attendance", acceptanceFieldIds);
        Assert.Contains("event-affected-areas", acceptanceFieldIds);
        Assert.DoesNotContain("additional-operational-commitments", acceptanceFieldIds);
        Assert.DoesNotContain("member-communications-sent", acceptanceFieldIds);

        var goAhead = FindItem(root, "confirm-event-before-commitments");
        Assert.Equal("event-decision-owner", goAhead.GetProperty("ownerFromQuestionId").GetString());
        Assert.Equal("event-status-decision", goAhead.GetProperty("completionMode").GetString());
        Assert.False(goAhead.GetProperty("canCompleteFromLink").GetBoolean());
        Assert.Equal("event-status", goAhead.GetProperty("actionView").GetString());
        Assert.Equal("confirmed", goAhead.GetProperty("actionStatus").GetString());
        Assert.Equal("DT", goAhead.GetProperty("expiresAfterDeadlineCode").GetString());
        Assert.True(ContainsEventFieldCondition(goAhead.GetProperty("showWhen"), "lifecycle.status", "in", new[] { "provisional", "confirmed" }));
        Assert.True(ContainsEventFieldCondition(goAhead.GetProperty("showWhen"), "lifecycle.resolvedFromAtRisk", "notEquals", true));

        var atRisk = FindItem(root, "resolve-at-risk-event");
        Assert.Equal("event-decision-owner", atRisk.GetProperty("ownerFromQuestionId").GetString());
        Assert.Equal("event-status-decision", atRisk.GetProperty("completionMode").GetString());
        Assert.False(atRisk.GetProperty("canCompleteFromLink").GetBoolean());
        Assert.Equal("event-status", atRisk.GetProperty("actionView").GetString());
        Assert.Equal("confirmed", atRisk.GetProperty("actionStatus").GetString());
        Assert.Equal("DT", atRisk.GetProperty("expiresAfterDeadlineCode").GetString());
        Assert.True(ContainsEventFieldCondition(atRisk.GetProperty("showWhen"), "lifecycle.status", "in", new[] { "at-risk", "postponed", "cancelled" }));
        Assert.True(ContainsEventFieldCondition(atRisk.GetProperty("showWhen"), "lifecycle.status", "equals", "confirmed"));
        Assert.True(ContainsEventFieldCondition(atRisk.GetProperty("showWhen"), "lifecycle.resolvedFromAtRisk", "equals", true));
    }

    private static bool ContainsItem(JsonElement root, string itemId)
    {
        foreach (var module in root.GetProperty("modules").EnumerateArray())
        {
            foreach (var section in module.GetProperty("sections").EnumerateArray())
            {
                if (section.GetProperty("items").EnumerateArray().Any(item => item.GetProperty("id").GetString() == itemId))
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static JsonElement FindItem(JsonElement root, string itemId)
    {
        foreach (var module in root.GetProperty("modules").EnumerateArray())
        {
            foreach (var section in module.GetProperty("sections").EnumerateArray())
            {
                foreach (var item in section.GetProperty("items").EnumerateArray())
                {
                    if (item.GetProperty("id").GetString() == itemId)
                    {
                        return item;
                    }
                }
            }
        }

        throw new InvalidOperationException($"Playbook item '{itemId}' was not found.");
    }

    private static JsonElement FindModule(JsonElement root, string moduleId)
    {
        foreach (var module in root.GetProperty("modules").EnumerateArray())
        {
            if (module.GetProperty("id").GetString() == moduleId)
            {
                return module;
            }
        }

        throw new InvalidOperationException($"Playbook module '{moduleId}' was not found.");
    }

    private static bool ContainsCondition(JsonElement condition, string questionId, string operation, object expectedValue)
    {
        if (condition.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (condition.TryGetProperty("questionId", out var question) &&
            question.GetString() == questionId &&
            condition.TryGetProperty("operator", out var candidateOperation) &&
            candidateOperation.GetString() == operation &&
            condition.TryGetProperty("value", out var value))
        {
            return expectedValue switch
            {
                bool boolean => value.ValueKind is JsonValueKind.True or JsonValueKind.False && value.GetBoolean() == boolean,
                string text => value.ValueKind == JsonValueKind.String && value.GetString() == text,
                _ => false
            };
        }

        foreach (var propertyName in new[] { "all", "any" })
        {
            if (condition.TryGetProperty(propertyName, out var collection) &&
                collection.EnumerateArray().Any(candidate => ContainsCondition(candidate, questionId, operation, expectedValue)))
            {
                return true;
            }
        }

        return condition.TryGetProperty("not", out var negated) &&
            ContainsCondition(negated, questionId, operation, expectedValue);
    }

    private static bool ReferencesQuestion(JsonElement condition, string questionId)
    {
        if (condition.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (condition.TryGetProperty("questionId", out var question) && question.GetString() == questionId)
        {
            return true;
        }

        foreach (var propertyName in new[] { "all", "any" })
        {
            if (condition.TryGetProperty(propertyName, out var collection) &&
                collection.EnumerateArray().Any(candidate => ReferencesQuestion(candidate, questionId)))
            {
                return true;
            }
        }

        return condition.TryGetProperty("not", out var negated) && ReferencesQuestion(negated, questionId);
    }

    private static bool ContainsOperator(JsonElement condition, string questionId, string operation)
    {
        if (condition.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (condition.TryGetProperty("questionId", out var question) && question.GetString() == questionId &&
            condition.TryGetProperty("operator", out var candidateOperation) && candidateOperation.GetString() == operation)
        {
            return true;
        }

        foreach (var propertyName in new[] { "all", "any" })
        {
            if (condition.TryGetProperty(propertyName, out var collection) &&
                collection.EnumerateArray().Any(candidate => ContainsOperator(candidate, questionId, operation)))
            {
                return true;
            }
        }

        return condition.TryGetProperty("not", out var negated) && ContainsOperator(negated, questionId, operation);
    }

    private static bool ContainsEventFieldCondition(
        JsonElement condition,
        string eventField,
        string operation,
        string expectedValue)
    {
        if (condition.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (condition.TryGetProperty("eventField", out var field) &&
            field.GetString() == eventField &&
            condition.TryGetProperty("operator", out var candidateOperation) &&
            candidateOperation.GetString() == operation &&
            condition.TryGetProperty("value", out var value) &&
            value.ValueKind == JsonValueKind.String &&
            value.GetString() == expectedValue)
        {
            return true;
        }

        foreach (var propertyName in new[] { "all", "any" })
        {
            if (condition.TryGetProperty(propertyName, out var collection) &&
                collection.EnumerateArray().Any(candidate =>
                    ContainsEventFieldCondition(candidate, eventField, operation, expectedValue)))
            {
                return true;
            }
        }

        return condition.TryGetProperty("not", out var negated) &&
            ContainsEventFieldCondition(negated, eventField, operation, expectedValue);
    }

    private static bool ContainsEventFieldCondition(
        JsonElement condition,
        string eventField,
        string operation,
        bool expectedValue)
    {
        if (condition.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (condition.TryGetProperty("eventField", out var field) &&
            field.GetString() == eventField &&
            condition.TryGetProperty("operator", out var candidateOperation) &&
            candidateOperation.GetString() == operation &&
            condition.TryGetProperty("value", out var value) &&
            value.ValueKind is JsonValueKind.True or JsonValueKind.False &&
            value.GetBoolean() == expectedValue)
        {
            return true;
        }

        foreach (var propertyName in new[] { "all", "any" })
        {
            if (condition.TryGetProperty(propertyName, out var collection) &&
                collection.EnumerateArray().Any(candidate =>
                    ContainsEventFieldCondition(candidate, eventField, operation, expectedValue)))
            {
                return true;
            }
        }

        return condition.TryGetProperty("not", out var negated) &&
            ContainsEventFieldCondition(negated, eventField, operation, expectedValue);
    }

    private static bool ContainsEventFieldCondition(
        JsonElement condition,
        string eventField,
        string operation,
        IReadOnlyCollection<string> expectedValues)
    {
        if (condition.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (condition.TryGetProperty("eventField", out var field) &&
            field.GetString() == eventField &&
            condition.TryGetProperty("operator", out var candidateOperation) &&
            candidateOperation.GetString() == operation &&
            condition.TryGetProperty("value", out var value) &&
            value.ValueKind == JsonValueKind.Array)
        {
            var actualValues = value.EnumerateArray().Select(candidate => candidate.GetString()).ToArray();
            if (actualValues.OrderBy(candidate => candidate).SequenceEqual(expectedValues.OrderBy(candidate => candidate)))
            {
                return true;
            }
        }

        foreach (var propertyName in new[] { "all", "any" })
        {
            if (condition.TryGetProperty(propertyName, out var collection) &&
                collection.EnumerateArray().Any(candidate =>
                    ContainsEventFieldCondition(candidate, eventField, operation, expectedValues)))
            {
                return true;
            }
        }

        return condition.TryGetProperty("not", out var negated) &&
            ContainsEventFieldCondition(negated, eventField, operation, expectedValues);
    }

    private static bool ContainsNegatedAllValues(JsonElement condition, string questionId, IEnumerable<string?> expectedValues)
    {
        if (condition.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (condition.TryGetProperty("not", out var negated) &&
            negated.TryGetProperty("all", out var all))
        {
            var actualValues = all.EnumerateArray()
                .Where(candidate =>
                    candidate.TryGetProperty("questionId", out var question) && question.GetString() == questionId &&
                    candidate.TryGetProperty("operator", out var operation) && operation.GetString() == "contains" &&
                    candidate.TryGetProperty("value", out var value) && value.ValueKind == JsonValueKind.String)
                .Select(candidate => candidate.GetProperty("value").GetString())
                .ToArray();
            if (actualValues.OrderBy(value => value).SequenceEqual(expectedValues.OrderBy(value => value)))
            {
                return true;
            }
        }

        foreach (var propertyName in new[] { "all", "any" })
        {
            if (condition.TryGetProperty(propertyName, out var collection) &&
                collection.EnumerateArray().Any(candidate => ContainsNegatedAllValues(candidate, questionId, expectedValues)))
            {
                return true;
            }
        }

        return false;
    }

    private static string FindSolutionRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "BOTGC.EventPlaybook.sln")))
            {
                return directory.FullName;
            }
        }

        throw new DirectoryNotFoundException("Could not locate the Event Playbook solution root.");
    }
}
