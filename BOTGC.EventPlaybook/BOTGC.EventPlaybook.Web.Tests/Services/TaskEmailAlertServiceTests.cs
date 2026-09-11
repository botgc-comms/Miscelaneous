using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class TaskEmailAlertServiceTests : IDisposable
{
    private static readonly DateOnly Today = new(2026, 9, 11);
    private static readonly JsonSerializerOptions WebJsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _contentRoot = Path.Combine(
        Path.GetTempPath(),
        $"event-playbook-task-alert-tests-{Guid.NewGuid():N}");

    [Fact]
    public async Task RunOnceAsync_UsesExactCadenceAndCombinesOwnerAndOrganiserAlerts()
    {
        var schedule = State(
            Alert("due-two", "Due in two days", "2026-09-13", " Alice@Example.com ", "Alice", "alice@example.com"),
            Alert("due-today", "Due today", "2026-09-11", "alice@example.com", "Alice", "alice@example.com"),
            Alert("due-tomorrow", "Not sent tomorrow", "2026-09-12", "alice@example.com", "Alice", "alice@example.com"),
            Alert("overdue-owned", "Bob overdue", "2026-09-10", "bob@example.com", "Bob", "ALICE@example.com"),
            Alert("overdue-unassigned", "Unassigned overdue", "2026-09-09", null, null, "alice@example.com"),
            Alert("overdue-same-person", "Alice overdue", "2026-09-08", "alice@example.com", "Alice", "Alice@example.com"),
            Alert("future", "Not sent later", "2026-09-14", "alice@example.com", "Alice", "alice@example.com"));
        var sender = new RecordingEmailSender();
        var registry = new RecordingCompletionRegistry();
        var dispatcher = CreateDispatcher(schedule, registry, sender);

        var result = await dispatcher.RunOnceAsync(Today, CancellationToken.None);

        Assert.Equal(5, result.CandidateTaskCount);
        Assert.Equal(2, result.RecipientCount);
        Assert.Equal(2, result.SentRecipientCount);
        Assert.Equal(0, result.FailedRecipientCount);
        Assert.Equal(5, registry.RegisteredTokens.Count);

        var alice = Assert.Single(sender.Messages, message => message.RecipientEmail == "alice@example.com");
        Assert.Equal(5, alice.TaskCount);
        Assert.Contains("Due in two days", alice.BodyHtml);
        Assert.Contains("Due today", alice.BodyHtml);
        Assert.Contains("Overdue", alice.BodyHtml);
        Assert.Contains("Unassigned overdue", alice.BodyHtml);
        Assert.Contains("Event organiser alert. This task is currently unassigned.", alice.BodyHtml);
        Assert.Equal(1, Occurrences(alice.BodyHtml, "Alice overdue"));
        Assert.DoesNotContain("Not sent tomorrow", alice.BodyHtml);
        Assert.DoesNotContain("Not sent later", alice.BodyHtml);

        var bob = Assert.Single(sender.Messages, message => message.RecipientEmail == "bob@example.com");
        Assert.Equal(1, bob.TaskCount);
        Assert.Contains("Bob overdue", bob.BodyHtml);
        Assert.DoesNotContain("Unassigned overdue", bob.BodyHtml);
    }

    [Fact]
    public async Task RunOnceAsync_RegistersThenSkipsTaskCompletedThroughItsLink()
    {
        var item = Alert("complete", "Already complete", "2026-09-11", "alice@example.com", "Alice", "organiser@example.com");
        var registry = new RecordingCompletionRegistry();
        registry.CompletedTokens.Add(Token(item));
        var sender = new RecordingEmailSender();
        var dispatcher = CreateDispatcher(State(item), registry, sender);

        var result = await dispatcher.RunOnceAsync(Today, CancellationToken.None);

        Assert.Single(registry.RegisteredTokens);
        Assert.Empty(sender.Messages);
        Assert.Equal(0, result.CandidateTaskCount);
        Assert.Equal(0, result.RecipientCount);
    }

    [Fact]
    public async Task RunOnceAsync_IsIdempotentOnOneDayAndResendsAnOverdueDigestNextDay()
    {
        var ledger = new InMemoryDeliveryLedger();
        var sender = new RecordingEmailSender();
        var dispatcher = CreateDispatcher(
            State(Alert("overdue", "Still overdue", "2026-09-10", "alice@example.com", "Alice", null)),
            new RecordingCompletionRegistry(),
            sender,
            ledger);

        var first = await dispatcher.RunOnceAsync(Today, CancellationToken.None);
        var duplicate = await dispatcher.RunOnceAsync(Today, CancellationToken.None);
        var nextDay = await dispatcher.RunOnceAsync(Today.AddDays(1), CancellationToken.None);

        Assert.Equal(1, first.SentRecipientCount);
        Assert.Equal(1, duplicate.AlreadySentRecipientCount);
        Assert.Equal(0, duplicate.SentRecipientCount);
        Assert.Equal(1, nextDay.SentRecipientCount);
        Assert.Equal(2, sender.Messages.Count);
    }

    [Fact]
    public async Task RunOnceAsync_DoesNotMarkFailureAndRetriesOnTheSameDay()
    {
        var ledger = new InMemoryDeliveryLedger();
        var sender = new RecordingEmailSender { FailuresRemaining = 1 };
        var activity = new RecordingActivityStore();
        var dispatcher = CreateDispatcher(
            State(Alert("today", "Retry me", "2026-09-11", "alice@example.com", "Alice", null)),
            new RecordingCompletionRegistry(),
            sender,
            ledger,
            activity);

        var failed = await dispatcher.RunOnceAsync(Today, CancellationToken.None);
        var retried = await dispatcher.RunOnceAsync(Today, CancellationToken.None);

        Assert.Equal(1, failed.FailedRecipientCount);
        Assert.Equal(0, failed.SentRecipientCount);
        Assert.Equal(1, retried.SentRecipientCount);
        Assert.Equal(2, sender.Attempts);
        Assert.True(await ledger.WasSentAsync(Today, "alice@example.com", CancellationToken.None));
        Assert.Collection(
            activity.Entries,
            entry => Assert.Equal("failed", entry.Outcome),
            entry => Assert.Equal("succeeded", entry.Outcome));
        Assert.All(activity.Entries, entry =>
        {
            Assert.DoesNotContain("alice@example.com", entry.Message, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(Token(Alert("today", "Retry me", "2026-09-11", "alice@example.com", "Alice", null)), entry.Message);
        });
    }

    [Fact]
    public async Task IntelligentGolfSender_RejectsPartialDeliverySoTheLedgerCanRetry()
    {
        var communications = new StubMemberCommunicationsClient(new AddressEmailDeliveryResult
        {
            Requested = 1,
            Sent = 0,
            Deliveries =
            [
                new AddressEmailDelivery
                {
                    RecipientEmail = "alice@example.com",
                    Sent = false,
                    Error = "Upstream delivery failed."
                }
            ]
        });
        var sender = new IntelligentGolfTaskAlertEmailSender(communications);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => sender.SendAsync(
            new TaskAlertEmailMessage
            {
                RecipientEmail = "alice@example.com",
                Subject = "Task alert",
                BodyHtml = "<p>Task</p>",
                TaskCount = 1
            },
            CancellationToken.None));

        Assert.Equal("Upstream delivery failed.", exception.Message);
    }

    [Fact]
    public async Task RunOnceAsync_EncodesContentAndBuildsAnAbsoluteLocalCompletionLink()
    {
        var token = Guid.NewGuid();
        var sender = new RecordingEmailSender();
        var dispatcher = CreateDispatcher(
            StateWithBaseUrl(
                "https://alerts.example.test/ignored/path",
                Alert(
                    "unsafe",
                    "<script>alert(\"task\")</script>",
                    "2026-09-11",
                    "alice@example.com",
                    "Alice",
                    null,
                    eventName: "Club & <Event>",
                    token: token)),
            new RecordingCompletionRegistry(),
            sender);

        await dispatcher.RunOnceAsync(Today, CancellationToken.None);

        var message = Assert.Single(sender.Messages);
        Assert.DoesNotContain("<script>", message.BodyHtml, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Club &amp; &lt;Event&gt;", message.BodyHtml);
        Assert.Contains($"href=\"https://alerts.example.test/complete.html?token={token:D}\"", message.BodyHtml);
    }

    [Fact]
    public async Task RunOnceAsync_ReviewGatedTaskLinksToTheAuthenticatedTaskCardAndCannotBeCompleted()
    {
        Directory.CreateDirectory(_contentRoot);
        var registry = new TaskCompletionRegistry(new TestWebHostEnvironment(_contentRoot));
        var token = Guid.NewGuid();
        var sender = new RecordingEmailSender();
        var dispatcher = CreateDispatcher(
            State(Alert(
                "review-task",
                "Confirm the reviewed plan",
                "2026-09-11",
                "alice@example.com",
                "Alice",
                null,
                token: token,
                canCompleteFromLink: false)),
            registry,
            sender);

        await dispatcher.RunOnceAsync(Today, CancellationToken.None);

        var message = Assert.Single(sender.Messages);
        Assert.Contains("https://events.example.test/?view=tasks&amp;event=event-1&amp;task=review-task", message.BodyHtml);
        Assert.DoesNotContain("/complete.html?token=", message.BodyHtml);
        var record = await registry.GetAsync(token.ToString("D"), CancellationToken.None);
        Assert.NotNull(record);
        Assert.False(record!.CanCompleteFromLink);
        var completionAttempt = await registry.CompleteAsync(token.ToString("D"), null, CancellationToken.None);
        Assert.NotNull(completionAttempt);
        Assert.Null(completionAttempt!.CompletedAtUtc);
    }

    [Fact]
    public async Task RunOnceAsync_PreservesLearningAlreadyRegisteredForTheCompletionPage()
    {
        Directory.CreateDirectory(_contentRoot);
        var registry = new TaskCompletionRegistry(new TestWebHostEnvironment(_contentRoot));
        var token = Guid.NewGuid();
        await registry.RegisterAsync(
            new RegisterCompletionLinkRequest
            {
                Token = token.ToString("D"),
                EventId = "event-1",
                EventName = "Autumn Event",
                TaskId = "learning-task",
                TaskTitle = "Use prior learning",
                DueDate = "2026-09-11",
                LearningInsights =
                [
                    new TaskLearningInsightSnapshot { Summary = "Allow more setup time." }
                ]
            },
            CancellationToken.None);
        var dispatcher = CreateDispatcher(
            State(Alert(
                "learning-task",
                "Use prior learning",
                "2026-09-11",
                "alice@example.com",
                "Alice",
                null,
                token: token)),
            registry,
            new RecordingEmailSender());

        await dispatcher.RunOnceAsync(Today, CancellationToken.None);

        var record = await registry.GetAsync(token.ToString("D"), CancellationToken.None);
        Assert.NotNull(record);
        var insight = Assert.Single(record!.LearningInsights);
        Assert.Equal("Allow more setup time.", insight.Summary);
    }

    [Fact]
    public async Task DeliveryLedger_PersistsSuccessfulDeliveryAcrossInstances()
    {
        Directory.CreateDirectory(_contentRoot);
        var environment = new TestWebHostEnvironment(_contentRoot);
        var clock = new FixedTimeProvider(new DateTimeOffset(2026, 9, 11, 8, 5, 0, TimeSpan.Zero));
        var first = new TaskAlertDeliveryLedger(environment, clock);

        await first.MarkSentAsync(Today, "alice@example.com", 3, CancellationToken.None);

        var reopened = new TaskAlertDeliveryLedger(environment, clock);
        Assert.True(await reopened.WasSentAsync(Today, "ALICE@EXAMPLE.COM", CancellationToken.None));
        Assert.False(await reopened.WasSentAsync(Today.AddDays(1), "alice@example.com", CancellationToken.None));
    }

    [Theory]
    [InlineData("2026-06-01T06:59:00+00:00", false)]
    [InlineData("2026-06-01T07:00:00+00:00", true)]
    [InlineData("2026-12-01T07:59:00+00:00", false)]
    [InlineData("2026-12-01T08:00:00+00:00", true)]
    public void IsAtOrAfterDailySendTime_UsesEightAmInEuropeLondon(string utc, bool expected)
    {
        var clock = new FixedTimeProvider(DateTimeOffset.Parse(utc));

        Assert.Equal(expected, TaskEmailAlertDispatcher.IsAtOrAfterDailySendTime(clock));
    }

    [Fact]
    public void GetLondonDate_UsesTheLocalCalendarDateAcrossTheSummerBoundary()
    {
        var clock = new FixedTimeProvider(new DateTimeOffset(2026, 6, 1, 23, 30, 0, TimeSpan.Zero));

        Assert.Equal(new DateOnly(2026, 6, 2), TaskEmailAlertDispatcher.GetLondonDate(clock));
    }

    [Fact]
    public void DelayUntilNextCheck_WakesAtEightRatherThanThirtyMinutesLate()
    {
        var clock = new FixedTimeProvider(new DateTimeOffset(2026, 6, 1, 6, 50, 0, TimeSpan.Zero));

        Assert.Equal(TimeSpan.FromMinutes(10), TaskEmailAlertDispatcher.DelayUntilNextCheck(clock));
    }

    [Fact]
    public void ScheduleReader_RejectsRemoteOrMalformedCompletionLinks()
    {
        var valid = Alert("valid", "Valid", "2026-09-11", "alice@example.com", "Alice", null);
        var remote = Alert("remote", "Remote", "2026-09-11", "alice@example.com", "Alice", null) with
        {
            CompletionPath = $"//attacker.example/complete.html?token={Guid.NewGuid():D}"
        };
        var malformed = Alert("malformed", "Malformed", "2026-09-11", "alice@example.com", "Alice", null) with
        {
            CompletionPath = "/complete.html?token=not-a-guid"
        };

        var parsed = TaskAlertScheduleReader.Read(State(valid, remote, malformed));

        Assert.NotNull(parsed);
        Assert.Single(parsed.Tasks);
        Assert.Equal("valid", parsed.Tasks[0].TaskId);
    }

    public void Dispose()
    {
        if (!Directory.Exists(_contentRoot)) return;
        var resolvedRoot = Path.GetFullPath(_contentRoot);
        var expectedParent = Path.GetFullPath(Path.GetTempPath());
        if (!resolvedRoot.StartsWith(expectedParent, StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(resolvedRoot).StartsWith("event-playbook-task-alert-tests-", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Unexpected test cleanup path: {resolvedRoot}");
        }
        Directory.Delete(resolvedRoot, recursive: true);
    }

    private static TaskEmailAlertDispatcher CreateDispatcher(
        JsonElement state,
        ITaskCompletionRegistry registry,
        RecordingEmailSender sender,
        ITaskAlertDeliveryLedger? ledger = null,
        RecordingActivityStore? activity = null) =>
        new(
            new StubSharedStateStore(state),
            registry,
            sender,
            ledger ?? new InMemoryDeliveryLedger(),
            activity ?? new RecordingActivityStore(),
            new FixedTimeProvider(new DateTimeOffset(2026, 9, 11, 8, 0, 0, TimeSpan.Zero)),
            NullLogger<TaskEmailAlertDispatcher>.Instance);

    private static JsonElement State(params AlertProjection[] tasks) =>
        StateWithBaseUrl("https://events.example.test", tasks);

    private static JsonElement StateWithBaseUrl(string publicBaseUrl, params AlertProjection[] tasks) =>
        JsonSerializer.SerializeToElement(new
        {
            taskAlertSchedule = new
            {
                generatedAtUtc = "2026-09-11T07:55:00Z",
                publicBaseUrl,
                tasks
            }
        }, WebJsonOptions);

    private static AlertProjection Alert(
        string taskId,
        string title,
        string dueDate,
        string? assigneeEmail,
        string? assigneeName,
        string? organiserEmail,
        string eventName = "Autumn Event",
        Guid? token = null,
        bool canCompleteFromLink = true) =>
        new(
            "event-1",
            eventName,
            "2026-09-20",
            taskId,
            title,
            dueDate,
            assigneeName,
            assigneeEmail,
            "Event Organiser",
            organiserEmail,
            $"/complete.html?token={(token ?? DeterministicToken(taskId)):D}",
            canCompleteFromLink);

    private static Guid DeterministicToken(string value)
    {
        var bytes = new byte[16];
        var source = System.Text.Encoding.UTF8.GetBytes(value);
        for (var index = 0; index < source.Length; index++) bytes[index % bytes.Length] ^= source[index];
        return new Guid(bytes);
    }

    private static string Token(AlertProjection projection) =>
        projection.CompletionPath[(projection.CompletionPath.IndexOf("token=", StringComparison.Ordinal) + 6)..];

    private static int Occurrences(string value, string fragment) =>
        value.Split(fragment, StringSplitOptions.None).Length - 1;

    private sealed record AlertProjection(
        string EventId,
        string EventName,
        string EventDate,
        string TaskId,
        string TaskTitle,
        string DueDate,
        string? AssigneeName,
        string? AssigneeEmail,
        string? OrganiserName,
        string? OrganiserEmail,
        string CompletionPath,
        bool CanCompleteFromLink = true);

    private sealed class StubSharedStateStore(JsonElement state) : ISharedPlaybookStateStore
    {
        public Task<SharedPlaybookStateDocument> GetAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new SharedPlaybookStateDocument { Revision = 1, State = state });

        public Task<(bool Conflict, SharedPlaybookStateDocument Document)> SaveAsync(
            SaveSharedPlaybookStateRequest request,
            CancellationToken cancellationToken) => throw new NotSupportedException();
    }

    private sealed class RecordingEmailSender : ITaskAlertEmailSender
    {
        public List<TaskAlertEmailMessage> Messages { get; } = [];
        public int Attempts { get; private set; }
        public int FailuresRemaining { get; set; }

        public Task SendAsync(TaskAlertEmailMessage message, CancellationToken cancellationToken)
        {
            Attempts++;
            if (FailuresRemaining > 0)
            {
                FailuresRemaining--;
                throw new InvalidOperationException("Simulated delivery failure.");
            }
            Messages.Add(message);
            return Task.CompletedTask;
        }
    }

    private sealed class InMemoryDeliveryLedger : ITaskAlertDeliveryLedger
    {
        private readonly HashSet<string> _deliveries = new(StringComparer.OrdinalIgnoreCase);

        public Task<bool> WasSentAsync(
            DateOnly localDate,
            string normalisedRecipientEmail,
            CancellationToken cancellationToken) =>
            Task.FromResult(_deliveries.Contains(Key(localDate, normalisedRecipientEmail)));

        public Task MarkSentAsync(
            DateOnly localDate,
            string normalisedRecipientEmail,
            int taskCount,
            CancellationToken cancellationToken)
        {
            _deliveries.Add(Key(localDate, normalisedRecipientEmail));
            return Task.CompletedTask;
        }

        private static string Key(DateOnly date, string email) => $"{date:yyyy-MM-dd}|{email}";
    }

    private sealed class RecordingCompletionRegistry : ITaskCompletionRegistry
    {
        public HashSet<string> RegisteredTokens { get; } = new(StringComparer.Ordinal);
        public HashSet<string> CompletedTokens { get; } = new(StringComparer.Ordinal);
        private readonly Dictionary<string, TaskCompletionRecord> _records = new(StringComparer.Ordinal);

        public Task<TaskCompletionRecord> RegisterAsync(
            RegisterCompletionLinkRequest request,
            CancellationToken cancellationToken)
        {
            RegisteredTokens.Add(request.Token);
            if (!_records.TryGetValue(request.Token, out var record))
            {
                record = new TaskCompletionRecord
                {
                    Token = request.Token,
                    EventId = request.EventId,
                    EventName = request.EventName,
                    TaskId = request.TaskId,
                    TaskTitle = request.TaskTitle,
                    Assignee = request.Assignee,
                    AssigneeEmail = request.AssigneeEmail,
                    DueDate = request.DueDate,
                    RegisteredAtUtc = DateTimeOffset.UtcNow,
                    CompletedAtUtc = CompletedTokens.Contains(request.Token) ? DateTimeOffset.UtcNow : null
                };
                _records.Add(request.Token, record);
            }
            return Task.FromResult(record);
        }

        public Task<TaskCompletionRecord?> GetAsync(string token, CancellationToken cancellationToken) =>
            Task.FromResult(_records.GetValueOrDefault(token));

        public Task<TaskCompletionRecord?> CompleteAsync(
            string token,
            string? notes,
            CancellationToken cancellationToken) =>
            Task.FromResult<TaskCompletionRecord?>(_records.GetValueOrDefault(token));

        public Task<IReadOnlyList<TaskCompletionRecord>> GetCompletedForEventAsync(
            string eventId,
            CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<TaskCompletionRecord>>(
                _records.Values.Where(record => record.EventId == eventId && record.CompletedAtUtc is not null).ToArray());
    }

    private sealed class RecordingActivityStore : IIntegrationActivityStore
    {
        public List<IntegrationActivityWrite> Entries { get; } = [];

        public Task RecordAsync(IntegrationActivityWrite activity, CancellationToken cancellationToken)
        {
            Entries.Add(activity);
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<IntegrationActivityEntry>> GetRecentAsync(
            int limit,
            CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<IntegrationActivityEntry>>([]);
    }

    private sealed class StubMemberCommunicationsClient(AddressEmailDeliveryResult result)
        : IIntelligentGolfMemberCommunicationsClient
    {
        public Task<IReadOnlyList<MemberDirectoryEntry>> GetMembersAsync(
            bool refresh,
            CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task SendTestAsync(
            MemberEmailTestRequest request,
            CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<AddressEmailDeliveryResult> SendToAddressesAsync(
            IReadOnlyCollection<string> recipientEmails,
            string subject,
            string bodyHtml,
            CancellationToken cancellationToken) => Task.FromResult(result);

        public Task<MemberCampaignEmailResult> SendCampaignAsync(
            MemberCampaignEmailRequest request,
            CancellationToken cancellationToken) => throw new NotSupportedException();
    }

    private sealed class FixedTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => utcNow;
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
