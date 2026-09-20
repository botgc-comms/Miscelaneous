using System.Text.Json;
using System.Text.Json.Nodes;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class PlaybookTemplateStoreTests : IDisposable
{
    private readonly string _contentRoot = Path.Combine(
        Path.GetTempPath(),
        $"event-playbook-template-tests-{Guid.NewGuid():N}");

    [Fact]
    public async Task GetAsync_ReturnsBundledCoreAndProtectedPrimaryQuestions()
    {
        var store = CreateStore();

        var document = await store.GetAsync(CancellationToken.None);

        Assert.Equal(0, document.Revision);
        Assert.Equal("bundled-core", document.Source);
        Assert.Contains("event-date", document.ProtectedQuestionIds);
        Assert.Contains("communications-involved", document.ProtectedQuestionIds);
        Assert.Equal("3.8", document.Template.GetProperty("schemaVersion").GetString());
    }

    [Fact]
    public async Task SaveAsync_PersistsSecondaryWordingWithStableIdAcrossRestart()
    {
        var store = CreateStore();
        var current = await store.GetAsync(CancellationToken.None);
        var template = JsonNode.Parse(current.Template.GetRawText())!.AsObject();
        var question = FindItem(template, "event-viability-triggers");
        question["label"] = "Has the club agreed the event can proceed?";

        var saved = await store.SaveAsync(new SavePlaybookTemplateRequest
        {
            ExpectedRevision = current.Revision,
            Source = "test",
            Template = JsonSerializer.SerializeToElement(template)
        }, CancellationToken.None);
        var restarted = CreateStore();
        var reloaded = await restarted.GetAsync(CancellationToken.None);

        Assert.Equal(1, saved.Revision);
        Assert.Equal(1, reloaded.Revision);
        Assert.Equal(
            "Has the club agreed the event can proceed?",
            FindItem(JsonNode.Parse(reloaded.Template.GetRawText())!.AsObject(), "event-viability-triggers")["label"]!.GetValue<string>());
        Assert.Equal("event-viability-triggers", question["id"]!.GetValue<string>());
    }

    [Fact]
    public async Task SaveAsync_RejectsProtectedPrimaryQuestionChangeAndKeepsLastGoodTemplate()
    {
        var store = CreateStore();
        var current = await store.GetAsync(CancellationToken.None);
        var template = JsonNode.Parse(current.Template.GetRawText())!.AsObject();
        FindItem(template, "golf-involved")["label"] = "A different primary question";

        var exception = await Assert.ThrowsAsync<ArgumentException>(() => store.SaveAsync(new SavePlaybookTemplateRequest
        {
            ExpectedRevision = current.Revision,
            Template = JsonSerializer.SerializeToElement(template)
        }, CancellationToken.None));

        Assert.Contains("protected primary question golf-involved", exception.Message, StringComparison.OrdinalIgnoreCase);
        var retained = await store.GetAsync(CancellationToken.None);
        Assert.Equal(0, retained.Revision);
        Assert.Equal("Does it involve golf?", FindItem(JsonNode.Parse(retained.Template.GetRawText())!.AsObject(), "golf-involved")["label"]!.GetValue<string>());
    }

    [Fact]
    public async Task SaveAsync_RejectsStaleRevisionWithoutOverwritingCurrentTemplate()
    {
        var store = CreateStore();
        var current = await store.GetAsync(CancellationToken.None);
        var first = JsonNode.Parse(current.Template.GetRawText())!.AsObject();
        FindItem(first, "event-viability-triggers")["label"] = "First saved wording";
        var saved = await store.SaveAsync(new SavePlaybookTemplateRequest
        {
            ExpectedRevision = 0,
            Template = JsonSerializer.SerializeToElement(first)
        }, CancellationToken.None);
        var stale = JsonNode.Parse(current.Template.GetRawText())!.AsObject();
        FindItem(stale, "event-viability-triggers")["label"] = "Stale wording";

        var exception = await Assert.ThrowsAsync<PlaybookTemplateConflictException>(() => store.SaveAsync(new SavePlaybookTemplateRequest
        {
            ExpectedRevision = 0,
            Template = JsonSerializer.SerializeToElement(stale)
        }, CancellationToken.None));

        Assert.Equal(saved.Revision, exception.Current.Revision);
        var retained = await store.GetAsync(CancellationToken.None);
        Assert.Equal("First saved wording", FindItem(JsonNode.Parse(retained.Template.GetRawText())!.AsObject(), "event-viability-triggers")["label"]!.GetValue<string>());
    }

    [Fact]
    public async Task ResetAsync_RestoresBundledCoreWithoutReusingRevision()
    {
        var store = CreateStore();
        var current = await store.GetAsync(CancellationToken.None);
        var template = JsonNode.Parse(current.Template.GetRawText())!.AsObject();
        FindItem(template, "event-viability-triggers")["assistantDisabled"] = true;
        var saved = await store.SaveAsync(new SavePlaybookTemplateRequest
        {
            ExpectedRevision = 0,
            Template = JsonSerializer.SerializeToElement(template)
        }, CancellationToken.None);

        var reset = await store.ResetAsync(saved.Revision, CancellationToken.None);

        Assert.Equal(2, reset.Revision);
        Assert.Equal("bundled-core-reset", reset.Source);
        Assert.Null(FindItem(JsonNode.Parse(reset.Template.GetRawText())!.AsObject(), "event-viability-triggers")["assistantDisabled"]);
    }

    [Fact]
    public async Task GetAsync_RebasesOnlyClubChangesWhenBundledCoreIsUpgraded()
    {
        var store = CreateStore();
        var current = await store.GetAsync(CancellationToken.None);
        var configured = JsonNode.Parse(current.Template.GetRawText())!.AsObject();
        FindItem(configured, "event-viability-triggers")["label"] = "Club-specific viability wording";
        await store.SaveAsync(new SavePlaybookTemplateRequest
        {
            ExpectedRevision = 0,
            Template = JsonSerializer.SerializeToElement(configured),
            Source = "test"
        }, CancellationToken.None);

        var corePath = Path.Combine(_contentRoot, "Data", "event-playbook.json");
        var upgradedCore = JsonNode.Parse(File.ReadAllText(corePath))!.AsObject();
        FindItem(upgradedCore, "golf-involved")["label"] = "Does this event include golf activity?";
        FindItem(upgradedCore, "event-communications-owner")["label"] = "Who will issue the official update if this event changes?";
        File.WriteAllText(corePath, upgradedCore.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));

        var upgradedStore = CreateStore(copyBundledCore: false);
        var rebased = await upgradedStore.GetAsync(CancellationToken.None);

        var template = JsonNode.Parse(rebased.Template.GetRawText())!.AsObject();
        Assert.Equal(1, rebased.Revision);
        Assert.EndsWith("-rebased", rebased.Source, StringComparison.Ordinal);
        Assert.Equal("Does this event include golf activity?", FindItem(template, "golf-involved")["label"]!.GetValue<string>());
        Assert.Equal("Who will issue the official update if this event changes?", FindItem(template, "event-communications-owner")["label"]!.GetValue<string>());
        Assert.Equal("Club-specific viability wording", FindItem(template, "event-viability-triggers")["label"]!.GetValue<string>());

        var secondRestart = CreateStore(copyBundledCore: false);
        var reloaded = await secondRestart.GetAsync(CancellationToken.None);
        Assert.Equal(rebased.Source, reloaded.Source);
    }

    [Theory]
    [InlineData("dont-know-missing", "does not define a decision task")]
    [InlineData("dont-know-duplicate-id", "Duplicate item id")]
    [InlineData("dont-know-invalid-deadline", "unknown deadline code")]
    [InlineData("unknown-expiry-deadline", "unknown expiry deadline code")]
    [InlineData("owner-source-not-assignment", "owner source must reference an assignment question")]
    [InlineData("review-summary-empty", "at least one review summary field")]
    [InlineData("review-summary-missing-question", "review summary references missing question")]
    [InlineData("review-summary-duplicate-question", "review summary repeats question")]
    [InlineData("staff-briefing-phase", "unknown staff briefing phase")]
    [InlineData("staff-briefing-audience", "must name the staff audience")]
    [InlineData("staff-briefing-instruction", "practical staff briefing instruction")]
    [InlineData("planning-context-empty", "planning context must define at least one field")]
    [InlineData("planning-context-missing-question", "planning context references missing question")]
    [InlineData("planning-context-condition-missing-question", "planning context references missing question")]
    [InlineData("advisory-missing-question", "targets missing question")]
    [InlineData("circular-question-visibility", "Circular question visibility rule")]
    public async Task SaveAsync_RejectsInvalidCrossReferencesAndKeepsLastGoodTemplate(
        string invalidCase,
        string expectedMessage)
    {
        var store = CreateStore();
        var current = await store.GetAsync(CancellationToken.None);
        var original = JsonNode.Parse(current.Template.GetRawText())!.AsObject();
        var invalid = original.DeepClone().AsObject();
        ApplyInvalidMutation(invalid, invalidCase);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() => store.SaveAsync(new SavePlaybookTemplateRequest
        {
            ExpectedRevision = current.Revision,
            Source = "invalid-test",
            Template = JsonSerializer.SerializeToElement(invalid)
        }, CancellationToken.None));

        Assert.Contains(expectedMessage, exception.Message, StringComparison.OrdinalIgnoreCase);
        var retained = await store.GetAsync(CancellationToken.None);
        Assert.Equal(current.Revision, retained.Revision);
        Assert.True(JsonNode.DeepEquals(original, JsonNode.Parse(retained.Template.GetRawText())));
    }

    public void Dispose()
    {
        if (!Directory.Exists(_contentRoot)) return;
        var resolved = Path.GetFullPath(_contentRoot);
        if (!resolved.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(resolved).StartsWith("event-playbook-template-tests-", StringComparison.Ordinal))
            throw new InvalidOperationException($"Unexpected test cleanup path: {resolved}");
        Directory.Delete(resolved, recursive: true);
    }

    private IPlaybookTemplateStore CreateStore(bool copyBundledCore = true)
    {
        var dataDirectory = Path.Combine(_contentRoot, "Data");
        Directory.CreateDirectory(dataDirectory);
        if (copyBundledCore)
        {
            File.Copy(
                Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "BOTGC.EventPlaybook.Web", "Data", "event-playbook.json"),
                Path.Combine(dataDirectory, "event-playbook.json"),
                overwrite: true);
        }
        return new PlaybookTemplateStore(
            new TestWebHostEnvironment(_contentRoot),
            NullLogger<PlaybookTemplateStore>.Instance);
    }

    private static JsonObject FindItem(JsonObject template, string id) =>
        (template["modules"] as JsonArray)!
            .OfType<JsonObject>()
            .SelectMany(module => (module["sections"] as JsonArray)!.OfType<JsonObject>())
            .SelectMany(section => (section["items"] as JsonArray)!.OfType<JsonObject>())
            .Single(item => item["id"]!.GetValue<string>() == id);

    private static void ApplyInvalidMutation(JsonObject template, string invalidCase)
    {
        switch (invalidCase)
        {
            case "dont-know-missing":
                FindItem(template, "collect-attendee-feedback").Remove("dontKnowTask");
                break;
            case "dont-know-duplicate-id":
                FindItem(template, "collect-attendee-feedback")["dontKnowTask"]!["id"] = "prepare-attendee-feedback";
                break;
            case "dont-know-invalid-deadline":
                FindItem(template, "collect-attendee-feedback")["dontKnowTask"]!["deadlineCode"] = "NOT-A-DEADLINE";
                break;
            case "unknown-expiry-deadline":
                FindItem(template, "agree-event-viability-control")["expiresAfterDeadlineCode"] = "NOT-A-DEADLINE";
                break;
            case "owner-source-not-assignment":
                FindItem(template, "agree-event-viability-control")["ownerFromQuestionId"] = "collect-attendee-feedback";
                break;
            case "review-summary-empty":
                FindItem(template, "agree-event-viability-control")["reviewSummary"]!["fields"] = new JsonArray();
                break;
            case "review-summary-missing-question":
                FindItem(template, "agree-event-viability-control")["reviewSummary"]!["fields"]![0]!["questionId"] = "missing-question";
                break;
            case "review-summary-duplicate-question":
            {
                var fields = FindItem(template, "agree-event-viability-control")["reviewSummary"]!["fields"]!.AsArray();
                fields.Add(fields[0]!.DeepClone());
                break;
            }
            case "staff-briefing-phase":
                FindItem(template, "results-task")["staffBriefing"]!["phase"] = "during-lunch";
                break;
            case "staff-briefing-audience":
                FindItem(template, "results-task")["staffBriefing"]!["audience"] = " ";
                break;
            case "staff-briefing-instruction":
                FindItem(template, "results-task")["staffBriefing"]!["instruction"] = " ";
                break;
            case "planning-context-empty":
                FindItem(template, "general-close-down-required")["planningContext"]!["fields"] = new JsonArray();
                break;
            case "planning-context-missing-question":
                FindItem(template, "general-close-down-required")["planningContext"]!["fields"]![0]!["questionId"] = "missing-question";
                break;
            case "planning-context-condition-missing-question":
                FindItem(template, "general-close-down-required")["planningContext"]!["fields"]![0]!["showWhen"] =
                    ConditionFor("missing-question");
                break;
            case "advisory-missing-question":
                template["advisoryRules"]!.AsArray().Add(new JsonObject
                {
                    ["id"] = "invalid-advisory",
                    ["targetQuestionId"] = "missing-question"
                });
                break;
            case "circular-question-visibility":
                FindItem(template, "event-viability-triggers")["showWhen"] = ConditionFor("event-decision-owner");
                FindItem(template, "event-decision-owner")["showWhen"] = ConditionFor("event-viability-triggers");
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(invalidCase), invalidCase, "Unknown validation test case.");
        }
    }

    private static JsonObject ConditionFor(string questionId) => new()
    {
        ["all"] = new JsonArray
        {
            new JsonObject
            {
                ["questionId"] = questionId,
                ["operator"] = "equals",
                ["value"] = true
            }
        }
    };

    private sealed class TestWebHostEnvironment(string contentRootPath) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "BOTGC.EventPlaybook.Web.Tests";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = Path.Combine(contentRootPath, "wwwroot");
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ContentRootPath { get; set; } = contentRootPath;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
