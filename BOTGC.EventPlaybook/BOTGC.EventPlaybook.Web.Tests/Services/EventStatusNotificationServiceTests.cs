using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class EventStatusNotificationServiceTests : IDisposable
{
    private readonly string _contentRoot = Path.Combine(
        Path.GetTempPath(),
        $"event-status-notification-tests-{Guid.NewGuid():N}");

    [Fact]
    public async Task SendAsync_SendsOneCommonMessageAndDeduplicatesRecipients()
    {
        var communications = new RecordingCommunicationsClient();
        var activity = new RecordingActivityStore();
        var service = CreateService(communications, activity);
        var request = Request(
            new EventStatusNotificationRecipient
            {
                Name = "Paul",
                Email = "PAUL@example.com",
                Areas = ["Food & Beverage"]
            },
            new EventStatusNotificationRecipient
            {
                Name = "Paul",
                Email = "paul@example.com",
                Areas = ["Clubhouse"]
            },
            new EventStatusNotificationRecipient
            {
                Name = "Alex",
                Email = "alex@example.com",
                Areas = ["Golf Operations"]
            });

        var result = await service.SendAsync(request, new Uri("https://events.example/"), CancellationToken.None);

        var attempt = Assert.Single(communications.Attempts);
        Assert.Equal(["alex@example.com", "paul@example.com"], attempt.Recipients);
        Assert.Equal("Event confirmed: Junior Final", attempt.Subject);
        Assert.Contains("Food &amp; Beverage", attempt.BodyHtml);
        Assert.Contains("Clubhouse", attempt.BodyHtml);
        Assert.Contains("Golf Operations", attempt.BodyHtml);
        Assert.Contains("Decision &lt;approved&gt;", attempt.BodyHtml);
        Assert.Contains("https://events.example/?view=tasks&amp;event=event-1", attempt.BodyHtml);
        Assert.Equal(2, result.RequestedRecipientCount);
        Assert.Equal(2, result.SentRecipientCount);
        Assert.Equal(0, result.PendingRecipientCount);
        var activityEntry = Assert.Single(activity.Entries);
        Assert.Equal("Send operational event status", activityEntry.Operation);
        Assert.Equal("succeeded", activityEntry.Outcome);
        Assert.Equal("event-status-notification", activityEntry.Stage);
        Assert.Equal("event-1", activityEntry.EventPlaybookEventId);
    }

    [Fact]
    public async Task SendAsync_RetryDoesNotResendRecipientsAlreadyDeliveredForTheDecision()
    {
        var firstClient = new RecordingCommunicationsClient(email => email != "bob@example.com");
        var firstActivity = new RecordingActivityStore();
        var request = Request(
            new EventStatusNotificationRecipient { Name = "Alice", Email = "alice@example.com", Areas = ["Clubhouse"] },
            new EventStatusNotificationRecipient { Name = "Bob", Email = "bob@example.com", Areas = ["Golf Operations"] });
        var first = await CreateService(firstClient, firstActivity).SendAsync(request, new Uri("https://events.example/"), CancellationToken.None);

        Assert.Equal(1, first.SentRecipientCount);
        Assert.Equal(1, first.PendingRecipientCount);
        Assert.Equal("action-required", Assert.Single(firstActivity.Entries).Outcome);

        var retryClient = new RecordingCommunicationsClient();
        var retryRequest = request with { NotificationId = Guid.NewGuid().ToString("D") };
        var retry = await CreateService(retryClient).SendAsync(retryRequest, new Uri("https://events.example/"), CancellationToken.None);

        var retryAttempt = Assert.Single(retryClient.Attempts);
        Assert.Equal(["bob@example.com"], retryAttempt.Recipients);
        Assert.Equal(1, retry.AlreadySentRecipientCount);
        Assert.Equal(1, retry.SentRecipientCount);
        Assert.Equal(0, retry.PendingRecipientCount);

        var finalClient = new RecordingCommunicationsClient();
        var final = await CreateService(finalClient).SendAsync(request, new Uri("https://events.example/"), CancellationToken.None);
        Assert.Empty(finalClient.Attempts);
        Assert.Equal(2, final.AlreadySentRecipientCount);
    }

    [Fact]
    public async Task SendAsync_RejectsUnsupportedStatusesBeforeCallingTheEmailService()
    {
        var communications = new RecordingCommunicationsClient();
        var request = Request(
            new EventStatusNotificationRecipient { Name = "Alice", Email = "alice@example.com", Areas = ["Clubhouse"] })
            with { Status = "completed" };

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            CreateService(communications).SendAsync(request, new Uri("https://events.example/"), CancellationToken.None));

        Assert.Contains("Confirmed, At risk, Postponed or Cancelled", exception.Message);
        Assert.Empty(communications.Attempts);
    }

    [Fact]
    public async Task SendAsync_RecordsInvalidRecipientWithoutCopyingTheAddressIntoActivity()
    {
        var communications = new RecordingCommunicationsClient();
        var activity = new RecordingActivityStore();
        var request = Request(
            new EventStatusNotificationRecipient
            {
                Name = "Alice",
                Email = "not-an-email",
                Areas = ["Clubhouse"]
            });

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            CreateService(communications, activity).SendAsync(
                request,
                new Uri("https://events.example/"),
                CancellationToken.None));

        Assert.Contains("not-an-email", exception.Message);
        Assert.Empty(communications.Attempts);
        var entry = Assert.Single(activity.Entries);
        Assert.Equal("failed", entry.Outcome);
        Assert.Equal("event-status-notification", entry.Stage);
        Assert.Contains("email address is invalid", entry.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("not-an-email", entry.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SendAsync_RecordsConfigurationCauseWithoutCredentialsOrRequestContent()
    {
        const string configurationError =
            "The Intelligent Golf email sender must be configured before emailing members. password=secret-value request body: private-content";
        var communications = new ThrowingCommunicationsClient(new InvalidOperationException(configurationError));
        var activity = new RecordingActivityStore();
        var logger = new RecordingLogger<EventStatusNotificationService>();

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(communications, activity, logger).SendAsync(
                Request(new EventStatusNotificationRecipient
                {
                    Name = "Alice",
                    Email = "alice@example.com",
                    Areas = ["Clubhouse"]
                }),
                new Uri("https://events.example/"),
                CancellationToken.None));

        Assert.Equal(configurationError, exception.Message);
        var entry = Assert.Single(activity.Entries);
        Assert.Equal("failed", entry.Outcome);
        Assert.Contains("email sender is not configured", entry.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("secret-value", entry.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("private-content", entry.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("request body", entry.Message, StringComparison.OrdinalIgnoreCase);
        var logEntry = Assert.Single(logger.Entries);
        Assert.Null(logEntry.Exception);
        Assert.Contains("email sender is not configured", logEntry.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("secret-value", logEntry.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("private-content", logEntry.Message, StringComparison.Ordinal);
    }

    private EventStatusNotificationService CreateService(
        IIntelligentGolfMemberCommunicationsClient communications,
        RecordingActivityStore? activity = null,
        ILogger<EventStatusNotificationService>? logger = null) =>
        new(
            communications,
            activity ?? new RecordingActivityStore(),
            new TestWebHostEnvironment(_contentRoot),
            logger ?? NullLogger<EventStatusNotificationService>.Instance);

    private static EventStatusNotificationRequest Request(params EventStatusNotificationRecipient[] recipients) =>
        new()
        {
            NotificationId = Guid.NewGuid().ToString("D"),
            EventId = "event-1",
            EventName = "Junior Final",
            EventDate = "2026-09-20",
            Status = "confirmed",
            StatusChangedAtUtc = new DateTimeOffset(2026, 9, 15, 8, 0, 0, TimeSpan.Zero),
            DecisionOwner = "Simon",
            Reason = "Decision <approved>",
            Recipients = recipients
        };

    public void Dispose()
    {
        if (Directory.Exists(_contentRoot)) Directory.Delete(_contentRoot, true);
    }

    private sealed class RecordingCommunicationsClient(Func<string, bool>? send = null)
        : IIntelligentGolfMemberCommunicationsClient
    {
        private readonly Func<string, bool> _send = send ?? (_ => true);
        public List<Attempt> Attempts { get; } = [];

        public Task<AddressEmailDeliveryResult> SendToAddressesAsync(
            IReadOnlyCollection<string> recipientEmails,
            string subject,
            string bodyHtml,
            CancellationToken cancellationToken)
        {
            var recipients = recipientEmails.ToArray();
            Attempts.Add(new Attempt(recipients, subject, bodyHtml));
            var deliveries = recipients.Select(email =>
            {
                var sent = _send(email);
                return new AddressEmailDelivery
                {
                    RecipientEmail = email,
                    Sent = sent,
                    Error = sent ? null : "Simulated rejection."
                };
            }).ToArray();
            return Task.FromResult(new AddressEmailDeliveryResult
            {
                Requested = recipients.Length,
                Sent = deliveries.Count(delivery => delivery.Sent),
                Deliveries = deliveries
            });
        }

        public Task<IReadOnlyList<MemberDirectoryEntry>> GetMembersAsync(bool refresh, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task SendTestAsync(MemberEmailTestRequest request, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<MemberCampaignEmailResult> SendCampaignAsync(MemberCampaignEmailRequest request, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }

    private sealed record Attempt(string[] Recipients, string Subject, string BodyHtml);

    private sealed class ThrowingCommunicationsClient(Exception exception)
        : IIntelligentGolfMemberCommunicationsClient
    {
        public Task<AddressEmailDeliveryResult> SendToAddressesAsync(
            IReadOnlyCollection<string> recipientEmails,
            string subject,
            string bodyHtml,
            CancellationToken cancellationToken) =>
            Task.FromException<AddressEmailDeliveryResult>(exception);

        public Task<IReadOnlyList<MemberDirectoryEntry>> GetMembersAsync(bool refresh, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task SendTestAsync(MemberEmailTestRequest request, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<MemberCampaignEmailResult> SendCampaignAsync(MemberCampaignEmailRequest request, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
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

    private sealed class RecordingLogger<T> : ILogger<T>
    {
        public List<(string Message, Exception? Exception)> Entries { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter) =>
            Entries.Add((formatter(state, exception), exception));
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
