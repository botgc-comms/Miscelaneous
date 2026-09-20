using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class PlaybookAssistantServiceTests : IDisposable
{
    private readonly string _contentRoot = Path.Combine(
        Path.GetTempPath(),
        $"event-playbook-assistant-tests-{Guid.NewGuid():N}");

    [Fact]
    public async Task ProposeAsync_ReturnsPreviewWithoutPersistingAndSendsProtectedContext()
    {
        var store = CreateStore();
        var handler = new RecordingHandler(ResponseFor(Change(
            type: "reword_question",
            targetItemId: "event-viability-triggers",
            wording: "What circumstances would make the club reconsider this event?",
            description: "Clarify the event viability question.")));
        var service = CreateService(store, handler);

        var proposal = await service.ProposeAsync(new PlaybookAssistantProposalRequest
        {
            BaseRevision = 0,
            Message = "Make the viability question clearer."
        }, CancellationToken.None);

        Assert.Single(proposal.Changes);
        Assert.Equal(
            "What circumstances would make the club reconsider this event?",
            FindItem(proposal.PreviewTemplate, "event-viability-triggers").GetProperty("label").GetString());
        Assert.Equal(0, (await store.GetAsync(CancellationToken.None)).Revision);
        Assert.Contains("Make the viability question clearer.", handler.RequestBody);
        Assert.Contains("golf-involved", handler.RequestBody);
        Assert.Contains("protectedPrimaryQuestionIds", handler.RequestBody);
        Assert.Equal("/v1/responses", handler.RequestUri?.AbsolutePath);
    }

    [Fact]
    public async Task ProposeAsync_HydratesTargetedChangesWithCurrentValuesForReview()
    {
        var store = CreateStore();
        var reword = Change(
            type: "reword_question",
            targetItemId: "golf-results-technology-dependent",
            wording: "Will producing the result rely on technology?",
            detail: "Include devices, accounts, power and connectivity.",
            example: "A scoring app that requires a working internet connection.",
            description: "Clarify the technology dependency question.");
        var retire = Change(
            type: "set_enabled",
            targetItemId: "results-task",
            enabled: false,
            description: "Retire the existing results task.");
        var service = CreateService(store, new RecordingHandler(ResponseFor(reword, retire)));

        var proposal = await service.ProposeAsync(new PlaybookAssistantProposalRequest
        {
            BaseRevision = 0,
            Message = "Clarify the technology question and retire the results task."
        }, CancellationToken.None);

        var rewordProposal = Assert.Single(proposal.Changes, change => change.Type == "reword_question");
        Assert.Equal("Will collecting scores or producing the result depend on an app, device, online service or network connection?", rewordProposal.CurrentWording);
        Assert.Contains("essential part of score collection", rewordProposal.CurrentDetail);
        Assert.Contains("Using an app to record winners", rewordProposal.CurrentExample);
        Assert.True(rewordProposal.CurrentEnabled);

        var retireProposal = Assert.Single(proposal.Changes, change => change.Type == "set_enabled");
        Assert.Equal("Assign responsibility for collecting scores, calculating results and producing the final result", retireProposal.CurrentWording);
        Assert.True(retireProposal.CurrentEnabled);
    }

    [Fact]
    public async Task ProposeAsync_RetainsNewestConversationWithinBudgetAndReturnsItChronologically()
    {
        var store = CreateStore();
        var handler = new RecordingHandler(ResponseFor());
        var service = CreateService(store, handler);
        var conversation = Enumerable.Range(1, 10)
            .Select(index => new PlaybookAssistantConversationMessage
            {
                Role = index % 2 == 0 ? "assistant" : "user",
                Text = $"message-{index:00}-".PadRight(2_000, (char)('a' + index))
            })
            .ToArray();

        await service.ProposeAsync(new PlaybookAssistantProposalRequest
        {
            BaseRevision = 0,
            Message = "Continue our discussion.",
            Conversation = conversation
        }, CancellationToken.None);

        using var requestDocument = JsonDocument.Parse(handler.RequestBody);
        var sourceJson = requestDocument.RootElement.GetProperty("input")[1].GetProperty("content").GetString();
        using var sourceDocument = JsonDocument.Parse(sourceJson!);
        var recent = sourceDocument.RootElement.GetProperty("recentConversation").EnumerateArray().ToArray();

        Assert.Equal(6, recent.Length);
        Assert.StartsWith("message-05-", recent[0].GetProperty("text").GetString(), StringComparison.Ordinal);
        Assert.StartsWith("message-10-", recent[^1].GetProperty("text").GetString(), StringComparison.Ordinal);
        Assert.DoesNotContain(recent, item => item.GetProperty("text").GetString()!.StartsWith("message-04-", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ApplyAsync_RevalidatesAndPersistsApprovedProposalWithStableId()
    {
        var store = CreateStore();
        var change = Change(
            type: "reword_question",
            targetItemId: "event-viability-triggers",
            wording: "What circumstances would make the club reconsider this event?",
            description: "Clarify the event viability question.");
        var service = CreateService(store, new RecordingHandler(ResponseFor(change)));
        var proposal = await service.ProposeAsync(new PlaybookAssistantProposalRequest
        {
            BaseRevision = 0,
            Message = "Make the viability question clearer."
        }, CancellationToken.None);

        var applied = await service.ApplyAsync(new ApplyPlaybookAssistantProposalRequest
        {
            BaseRevision = proposal.BaseRevision,
            ProposalId = proposal.ProposalId,
            Changes = proposal.Changes
        }, CancellationToken.None);

        Assert.Equal(1, applied.Document.Revision);
        Assert.Equal("playbook-assistant", applied.Document.Source);
        var item = FindItem(applied.Document.Template, "event-viability-triggers");
        Assert.Equal("event-viability-triggers", item.GetProperty("id").GetString());
        Assert.Equal("What circumstances would make the club reconsider this event?", item.GetProperty("label").GetString());
        Assert.Equal("3.9", applied.Document.Template.GetProperty("schemaVersion").GetString());
    }

    [Fact]
    public async Task ProposeAsync_RejectsAttemptToChangeProtectedPrimaryQuestion()
    {
        var store = CreateStore();
        var service = CreateService(store, new RecordingHandler(ResponseFor(Change(
            type: "reword_question",
            targetItemId: "golf-involved",
            wording: "Should golf be included?",
            description: "Change a primary question."))));

        var exception = await Assert.ThrowsAsync<ArgumentException>(() => service.ProposeAsync(new PlaybookAssistantProposalRequest
        {
            BaseRevision = 0,
            Message = "Change the golf question."
        }, CancellationToken.None));

        Assert.Contains("protected", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, (await store.GetAsync(CancellationToken.None)).Revision);
    }

    [Fact]
    public async Task ApplyAsync_RejectsStaleRevisionAndKeepsNewerConfiguration()
    {
        var store = CreateStore();
        var current = await store.GetAsync(CancellationToken.None);
        var template = JsonNode.Parse(current.Template.GetRawText())!.AsObject();
        FindItemObject(template, "event-viability-triggers")["label"] = "Already changed";
        await store.SaveAsync(new SavePlaybookTemplateRequest
        {
            ExpectedRevision = 0,
            Template = JsonSerializer.SerializeToElement(template)
        }, CancellationToken.None);
        var service = CreateService(store, new RecordingHandler(ResponseFor()));

        var exception = await Assert.ThrowsAsync<PlaybookTemplateConflictException>(() => service.ApplyAsync(new ApplyPlaybookAssistantProposalRequest
        {
            BaseRevision = 0,
            Changes = [Change("set_enabled", targetItemId: "event-viability-triggers", enabled: false)]
        }, CancellationToken.None));

        Assert.Equal(1, exception.Current.Revision);
        var retained = await store.GetAsync(CancellationToken.None);
        Assert.Equal("Already changed", FindItem(retained.Template, "event-viability-triggers").GetProperty("label").GetString());
    }

    [Fact]
    public async Task ProposeAsync_AddsConditionalClubQuestionUsingStableNamespacedId()
    {
        var store = CreateStore();
        var change = Change(
            type: "add_question",
            moduleId: "catering",
            sectionId: "food-preparation",
            newItemId: "club-question-bain-marie-server",
            wording: "Will a named adult serve food from the bain-marie?",
            answerType: "yesNo",
            required: true,
            conditionQuestionId: "catering-involved",
            conditionValue: "true",
            description: "Add a club-specific food service check.");
        var service = CreateService(store, new RecordingHandler(ResponseFor(change)));

        var proposal = await service.ProposeAsync(new PlaybookAssistantProposalRequest
        {
            BaseRevision = 0,
            Message = "Ask who serves at the bain-marie."
        }, CancellationToken.None);

        var item = FindItem(proposal.PreviewTemplate, "club-question-bain-marie-server");
        Assert.Equal("assistant", item.GetProperty("source").GetString());
        Assert.True(item.GetProperty("required").GetBoolean());
        Assert.True(item.GetProperty("showWhen").GetProperty("all")[0].GetProperty("value").GetBoolean());
    }

    [Fact]
    public async Task ProposeAsync_AddsChoiceQuestionWithReviewableOptions()
    {
        var store = CreateStore();
        var change = Change(
            type: "add_question",
            moduleId: "clubhouse",
            sectionId: "seating",
            newItemId: "club-question-room-focus",
            wording: "Where should the room seating be focused?",
            answerType: "singleChoice",
            required: true,
            options:
            [
                new PlaybookAssistantOption { Value = "television", Label = "Towards the television" },
                new PlaybookAssistantOption { Value = "rear", Label = "Towards the rear of the room" }
            ]);
        var service = CreateService(store, new RecordingHandler(ResponseFor(change)));

        var proposal = await service.ProposeAsync(new PlaybookAssistantProposalRequest
        {
            BaseRevision = 0,
            Message = "Add a choice for the direction of the room seating."
        }, CancellationToken.None);

        var item = FindItem(proposal.PreviewTemplate, "club-question-room-focus");
        Assert.Equal("singleChoice", item.GetProperty("answerType").GetString());
        Assert.Collection(
            item.GetProperty("options").EnumerateArray(),
            option =>
            {
                Assert.Equal("television", option.GetProperty("value").GetString());
                Assert.Equal("Towards the television", option.GetProperty("label").GetString());
            },
            option =>
            {
                Assert.Equal("rear", option.GetProperty("value").GetString());
                Assert.Equal("Towards the rear of the room", option.GetProperty("label").GetString());
            });
        Assert.Equal(2, proposal.Changes.Single().Options.Count);
    }

    [Fact]
    public async Task TranscribeAsync_UsesTheAudioEndpointAndReturnsEditableText()
    {
        var store = CreateStore();
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"text\":\"Add a clubhouse setup question.\"}", Encoding.UTF8, "application/json")
        };
        var handler = new RecordingHandler(response);
        var service = CreateService(store, handler);
        var bytes = Encoding.UTF8.GetBytes("test-audio");
        await using var stream = new MemoryStream(bytes);
        var audio = new FormFile(stream, 0, bytes.Length, "audio", "instruction.webm")
        {
            Headers = new HeaderDictionary(),
            ContentType = "audio/webm"
        };

        var transcript = await service.TranscribeAsync(audio, CancellationToken.None);

        Assert.Equal("Add a clubhouse setup question.", transcript);
        Assert.Equal("/v1/audio/transcriptions", handler.RequestUri?.AbsolutePath);
        Assert.Contains("gpt-4o-mini-transcribe", handler.RequestBody);
    }

    public void Dispose()
    {
        if (!Directory.Exists(_contentRoot)) return;
        var resolved = Path.GetFullPath(_contentRoot);
        if (!resolved.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(resolved).StartsWith("event-playbook-assistant-tests-", StringComparison.Ordinal))
            throw new InvalidOperationException($"Unexpected test cleanup path: {resolved}");
        Directory.Delete(resolved, recursive: true);
    }

    private IPlaybookTemplateStore CreateStore()
    {
        var dataDirectory = Path.Combine(_contentRoot, "Data");
        Directory.CreateDirectory(dataDirectory);
        File.Copy(
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "BOTGC.EventPlaybook.Web", "Data", "event-playbook.json"),
            Path.Combine(dataDirectory, "event-playbook.json"),
            overwrite: true);
        return new PlaybookTemplateStore(
            new TestWebHostEnvironment(_contentRoot),
            NullLogger<PlaybookTemplateStore>.Instance);
    }

    private static PlaybookAssistantService CreateService(IPlaybookTemplateStore store, HttpMessageHandler handler) => new(
        new TestHttpClientFactory(handler),
        Microsoft.Extensions.Options.Options.Create(new OpenAiOptions { ApiKey = "test-key", PromptModel = "test-model" }),
        store,
        NullLogger<PlaybookAssistantService>.Instance);

    private static PlaybookAssistantChange Change(
        string type,
        string targetItemId = "",
        string moduleId = "",
        string sectionId = "",
        string newItemId = "",
        string wording = "",
        string detail = "",
        string example = "",
        string description = "Test change",
        string answerType = "text",
        bool required = false,
        string conditionQuestionId = "",
        string conditionValue = "",
        bool enabled = true,
        IReadOnlyList<PlaybookAssistantOption>? options = null) => new()
    {
        Type = type,
        Description = description,
        TargetItemId = targetItemId,
        ModuleId = moduleId,
        SectionId = sectionId,
        NewItemId = newItemId,
        Wording = wording,
        Detail = detail,
        Example = example,
        AnswerType = answerType,
        Required = required,
        ConditionQuestionId = conditionQuestionId,
        ConditionValue = conditionValue,
        DeadlineCode = "",
        OwnerRoleId = "",
        Enabled = enabled,
        Options = options ?? [],
        StaffBriefingPhase = "",
        StaffBriefingAudience = "",
        StaffBriefingInstruction = ""
    };

    private static HttpResponseMessage ResponseFor(params PlaybookAssistantChange[] changes)
    {
        var generated = JsonSerializer.Serialize(new
        {
            reply = changes.Length == 0 ? "I need more detail." : "I have prepared a reviewable proposal.",
            warnings = Array.Empty<string>(),
            changes
        });
        var body = JsonSerializer.Serialize(new
        {
            output = new[]
            {
                new
                {
                    type = "message",
                    content = new[] { new { type = "output_text", text = generated } }
                }
            }
        });
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
    }

    private static JsonElement FindItem(JsonElement template, string id) =>
        template.GetProperty("modules").EnumerateArray()
            .SelectMany(module => module.GetProperty("sections").EnumerateArray())
            .SelectMany(section => section.GetProperty("items").EnumerateArray())
            .Single(item => item.GetProperty("id").GetString() == id);

    private static JsonObject FindItemObject(JsonObject template, string id) =>
        (template["modules"] as JsonArray)!.OfType<JsonObject>()
            .SelectMany(module => (module["sections"] as JsonArray)!.OfType<JsonObject>())
            .SelectMany(section => (section["items"] as JsonArray)!.OfType<JsonObject>())
            .Single(item => item["id"]!.GetValue<string>() == id);

    private sealed class TestHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false)
        {
            BaseAddress = new Uri("https://api.openai.test/v1/")
        };
    }

    private sealed class RecordingHandler(HttpResponseMessage response) : HttpMessageHandler
    {
        public string RequestBody { get; private set; } = string.Empty;
        public Uri? RequestUri { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestUri = request.RequestUri;
            RequestBody = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
            return response;
        }
    }

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
