using System.Text.Json;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Configuration;

public sealed class PlaybookConfigurationTests
{
    [Fact]
    public void CloseDownPlanSurfacesPriorSetupAndRequiresNamedOwnership()
    {
        var solutionRoot = FindSolutionRoot();
        var dataPath = Path.Combine(solutionRoot, "BOTGC.EventPlaybook.Web", "Data", "event-playbook.json");
        var publicPath = Path.Combine(solutionRoot, "BOTGC.EventPlaybook.Web", "wwwroot", "event-playbook.json");
        var dataJson = File.ReadAllText(dataPath);
        var publicJson = File.ReadAllText(publicPath);

        Assert.Equal(dataJson, publicJson);

        using var document = JsonDocument.Parse(dataJson);
        var root = document.RootElement;
        Assert.Equal("3.5", root.GetProperty("schemaVersion").GetString());

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
        Assert.Equal("person", lead.GetProperty("assignmentMode").GetString());
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

        var retrospectiveTask = FindItem(root, "complete-retrospective");
        Assert.Equal("A2", retrospectiveTask.GetProperty("deadlineCode").GetString());
        Assert.Equal("retrospective", retrospectiveTask.GetProperty("actionView").GetString());
        Assert.False(retrospectiveTask.TryGetProperty("showWhen", out _));
    }

    [Fact]
    public void BookingAndChargingShareOneGatewayWithoutDuplicatingRegistrationInCommunications()
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
        Assert.Equal("multiChoice", arrangements.GetProperty("answerType").GetString());
        var arrangementValues = arrangements.GetProperty("options")
            .EnumerateArray()
            .Select(option => option.GetProperty("value").GetString())
            .ToArray();
        Assert.Equal(2, arrangementValues.Length);
        Assert.Contains("advance-booking", arrangementValues);
        Assert.Contains("entry-payment", arrangementValues);

        var freeEntry = FindItem(root, "admission-free-entry");
        Assert.Equal("yesNo", freeEntry.GetProperty("answerType").GetString());
        Assert.Equal("Is entry free for certain attendee categories?", freeEntry.GetProperty("label").GetString());
        Assert.True(ContainsCondition(freeEntry.GetProperty("showWhen"), "admission-arrangements", "contains", "entry-payment"));

        var freeCategories = FindItem(root, "admission-free-categories");
        Assert.Equal("multiChoice", freeCategories.GetProperty("answerType").GetString());
        Assert.True(ContainsCondition(freeCategories.GetProperty("showWhen"), "admission-free-entry", "equals", true));
        var freeCategoryValues = freeCategories.GetProperty("options")
            .EnumerateArray()
            .Select(option => option.GetProperty("value").GetString())
            .ToArray();
        Assert.Equal(new[] { "children", "members", "visitors" }, freeCategoryValues);

        var priceTask = FindItem(root, "set-admission-prices-task");
        Assert.Equal("task", priceTask.GetProperty("type").GetString());
        Assert.Equal("Set the entry price for each attendee category that is not free", priceTask.GetProperty("title").GetString());
        Assert.True(ContainsCondition(priceTask.GetProperty("showWhen"), "admission-free-entry", "equals", false));
        Assert.True(ContainsNegatedAllValues(priceTask.GetProperty("showWhen"), "admission-free-categories", freeCategoryValues!));
        var pricingCategoriesField = priceTask.GetProperty("reviewSummary").GetProperty("fields")
            .EnumerateArray()
            .Single(field => field.GetProperty("questionId").GetString() == "admission-free-categories");
        Assert.Equal("Prices required for", pricingCategoriesField.GetProperty("label").GetString());
        Assert.True(pricingCategoriesField.GetProperty("showUnselectedOptions").GetBoolean());

        var admissionCapacity = FindItem(root, "admission-capacity");
        Assert.Equal("What is the maximum number of places available?", admissionCapacity.GetProperty("label").GetString());
        Assert.Contains("both free and paid attendees", admissionCapacity.GetProperty("helpText").GetString());

        var admissionOffer = admission.GetProperty("sections")
            .EnumerateArray()
            .Single(section => section.GetProperty("id").GetString() == "admission-offer");
        var admissionOfferIds = admissionOffer.GetProperty("items")
            .EnumerateArray()
            .Select(item => item.GetProperty("id").GetString())
            .ToList();
        Assert.True(admissionOfferIds.IndexOf("admission-free-entry") < admissionOfferIds.IndexOf("admission-free-categories"));
        Assert.True(admissionOfferIds.IndexOf("admission-free-categories") < admissionOfferIds.IndexOf("set-admission-prices-task"));
        Assert.True(admissionOfferIds.IndexOf("set-admission-prices-task") < admissionOfferIds.IndexOf("admission-capacity"));

        foreach (var paidItemId in new[] { "admission-refund-policy", "admission-payment-timing", "admission-payment-methods", "reconcile-admission-income-task" })
        {
            var paidCondition = FindItem(root, paidItemId).GetProperty("showWhen");
            Assert.True(ContainsCondition(paidCondition, "admission-arrangements", "contains", "entry-payment"));
            Assert.True(ContainsOperator(paidCondition, "admission-free-entry", "answered"));
            Assert.True(ContainsNegatedAllValues(paidCondition, "admission-free-categories", freeCategoryValues!));
        }

        var refundAfterChange = FindItem(root, "resolve-admission-refunds-after-event-change").GetProperty("showWhen");
        Assert.True(ContainsCondition(refundAfterChange, "entry-charge", "equals", true));
        Assert.True(ContainsCondition(refundAfterChange, "admission-arrangements", "contains", "entry-payment"));
        Assert.True(ContainsNegatedAllValues(refundAfterChange, "admission-free-categories", freeCategoryValues!));

        var salesOpenCondition = FindItem(root, "ticket-sales-open-date").GetProperty("showWhen");
        Assert.True(ContainsCondition(salesOpenCondition, "admission-arrangements", "contains", "advance-booking"));
        Assert.True(ContainsCondition(salesOpenCondition, "admission-payment-timing", "contains", "advance"));

        var configureRouteCondition = FindItem(root, "configure-ticket-sales-task").GetProperty("showWhen");
        Assert.True(ContainsCondition(configureRouteCondition, "admission-arrangements", "contains", "advance-booking"));
        Assert.True(ContainsCondition(configureRouteCondition, "admission-payment-timing", "contains", "advance"));
        Assert.True(ContainsCondition(FindItem(root, "door-admission-process").GetProperty("showWhen"), "admission-arrangements", "contains", "advance-booking"));

        Assert.True(ContainsItem(root, "booking-registration-instructions"));
        Assert.True(ContainsItem(root, "booking-confirmation-process"));
        Assert.True(ContainsItem(root, "admission-public-instructions"));
        Assert.False(ContainsItem(root, "booking-required"));
        Assert.False(ContainsItem(root, "booking-details-task"));
        Assert.False(ContainsItem(root, "admission-tickets-required"));
        Assert.False(ContainsItem(root, "admission-price-details"));
        Assert.False(ContainsItem(root, "complimentary-admission"));
        Assert.False(ContainsItem(root, "complimentary-admission-details"));
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
