using System.Net;
using System.Net.Mail;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using Microsoft.AspNetCore.WebUtilities;

namespace BOTGC.EventPlaybook.Services;

public interface IEventStatusNotificationService
{
    Task<EventStatusNotificationResult> SendAsync(
        EventStatusNotificationRequest request,
        Uri publicBaseUri,
        CancellationToken cancellationToken);
}

public sealed class EventStatusNotificationService : IEventStatusNotificationService
{
    private static readonly IReadOnlyDictionary<string, string> StatusLabels =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["confirmed"] = "Confirmed",
            ["at-risk"] = "At risk",
            ["postponed"] = "Postponed",
            ["cancelled"] = "Cancelled"
        };

    private readonly IIntelligentGolfMemberCommunicationsClient _communications;
    private readonly ILogger<EventStatusNotificationService> _logger;
    private readonly string _ledgerPath;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public EventStatusNotificationService(
        IIntelligentGolfMemberCommunicationsClient communications,
        IWebHostEnvironment environment,
        ILogger<EventStatusNotificationService> logger)
    {
        _communications = communications;
        _logger = logger;
        var directory = Path.Combine(environment.ContentRootPath, "App_Data");
        Directory.CreateDirectory(directory);
        _ledgerPath = Path.Combine(directory, "event-status-notification-deliveries.json");
    }

    public async Task<EventStatusNotificationResult> SendAsync(
        EventStatusNotificationRequest request,
        Uri publicBaseUri,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(publicBaseUri);
        if (!publicBaseUri.IsAbsoluteUri) throw new ArgumentException("The public base address must be absolute.", nameof(publicBaseUri));

        var notificationId = Required(request.NotificationId, "notification id", 200);
        var eventId = Required(request.EventId, "event id", 200);
        var eventName = Required(request.EventName, "event name", 300);
        var status = Required(request.Status, "event status", 50).ToLowerInvariant();
        if (!StatusLabels.TryGetValue(status, out var statusLabel))
        {
            throw new ArgumentException("Only Confirmed, At risk, Postponed or Cancelled decisions can notify operational leads.", nameof(request));
        }

        var recipients = NormaliseRecipients(request.Recipients);
        if (recipients.Count == 0)
        {
            return new EventStatusNotificationResult
            {
                NotificationId = notificationId,
                RequestedRecipientCount = 0
            };
        }

        var decisionKey = $"{eventId.ToLowerInvariant()}|{status}|{request.StatusChangedAtUtc:O}";
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var ledger = await LoadLedgerAsync(cancellationToken);
            var alreadySent = recipients
                .Where(recipient => ledger.Deliveries.Any(delivery =>
                    string.Equals(delivery.DecisionKey, decisionKey, StringComparison.Ordinal) &&
                    string.Equals(delivery.RecipientEmail, recipient.Email, StringComparison.OrdinalIgnoreCase)))
                .ToArray();
            var pending = recipients.ExceptBy(
                alreadySent.Select(recipient => recipient.Email),
                recipient => recipient.Email,
                StringComparer.OrdinalIgnoreCase).ToArray();

            var deliveryResults = alreadySent.Select(recipient => new EventStatusNotificationDelivery
            {
                RecipientEmail = recipient.Email,
                Status = "already-sent"
            }).ToList();

            if (pending.Length > 0)
            {
                var eventUrl = BuildEventUrl(publicBaseUri, eventId);
                var subject = $"Event {statusLabel.ToLowerInvariant()}: {eventName}";
                var bodyHtml = ComposeBody(request, eventName, statusLabel, eventUrl, recipients);
                var result = await _communications.SendToAddressesAsync(
                    pending.Select(recipient => recipient.Email).ToArray(),
                    subject,
                    bodyHtml,
                    cancellationToken);
                var returned = result.Deliveries
                    .Where(delivery => !string.IsNullOrWhiteSpace(delivery.RecipientEmail))
                    .GroupBy(delivery => delivery.RecipientEmail.Trim(), StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(group => group.Key, group => group.Last(), StringComparer.OrdinalIgnoreCase);

                var ledgerChanged = false;
                foreach (var recipient in pending)
                {
                    if (returned.TryGetValue(recipient.Email, out var delivery) && delivery.Sent)
                    {
                        ledger.Deliveries.Add(new DeliveryRecord
                        {
                            DecisionKey = decisionKey,
                            NotificationId = notificationId,
                            EventId = eventId,
                            Status = status,
                            RecipientEmail = recipient.Email,
                            SentAtUtc = DateTimeOffset.UtcNow
                        });
                        ledgerChanged = true;
                        deliveryResults.Add(new EventStatusNotificationDelivery
                        {
                            RecipientEmail = recipient.Email,
                            Status = "sent"
                        });
                    }
                    else
                    {
                        var error = returned.GetValueOrDefault(recipient.Email)?.Error;
                        deliveryResults.Add(new EventStatusNotificationDelivery
                        {
                            RecipientEmail = recipient.Email,
                            Status = "pending",
                            Error = string.IsNullOrWhiteSpace(error)
                                ? "The email service did not confirm delivery."
                                : Limit(error, 500)
                        });
                    }
                }

                if (ledgerChanged) await SaveLedgerAsync(ledger, cancellationToken);
            }

            return new EventStatusNotificationResult
            {
                NotificationId = notificationId,
                RequestedRecipientCount = recipients.Count,
                SentRecipientCount = deliveryResults.Count(delivery => delivery.Status == "sent"),
                AlreadySentRecipientCount = deliveryResults.Count(delivery => delivery.Status == "already-sent"),
                PendingRecipientCount = deliveryResults.Count(delivery => delivery.Status == "pending"),
                Deliveries = deliveryResults
            };
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogWarning(
                exception,
                "The {Status} notification for Event Playbook event {EventId} remains pending.",
                status,
                eventId);
            throw;
        }
        finally
        {
            _gate.Release();
        }
    }

    private static List<NormalisedRecipient> NormaliseRecipients(
        IReadOnlyList<EventStatusNotificationRecipient>? recipients)
    {
        var result = new Dictionary<string, NormalisedRecipient>(StringComparer.OrdinalIgnoreCase);
        foreach (var candidate in recipients ?? [])
        {
            var email = candidate.Email?.Trim() ?? string.Empty;
            if (!MailAddress.TryCreate(email, out var parsed) ||
                !string.Equals(parsed.Address, email, StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException($"'{Limit(email, 100)}' is not a valid operational lead email address.", nameof(recipients));
            }

            var normalisedEmail = parsed.Address.ToLowerInvariant();
            if (!result.TryGetValue(normalisedEmail, out var recipient))
            {
                recipient = new NormalisedRecipient
                {
                    Email = normalisedEmail,
                    Name = Limit(candidate.Name?.Trim(), 200)
                };
                result.Add(normalisedEmail, recipient);
            }

            if (string.IsNullOrWhiteSpace(recipient.Name)) recipient.Name = Limit(candidate.Name?.Trim(), 200);
            foreach (var area in candidate.Areas ?? [])
            {
                var cleaned = Limit(area?.Trim(), 120);
                if (!string.IsNullOrWhiteSpace(cleaned) && !recipient.Areas.Contains(cleaned, StringComparer.OrdinalIgnoreCase))
                {
                    recipient.Areas.Add(cleaned);
                }
            }
        }

        return result.Values.OrderBy(recipient => recipient.Email, StringComparer.Ordinal).ToList();
    }

    private static string ComposeBody(
        EventStatusNotificationRequest request,
        string eventName,
        string statusLabel,
        Uri eventUrl,
        IReadOnlyList<NormalisedRecipient> recipients)
    {
        var context = recipients
            .SelectMany(recipient => recipient.Areas.Select(area => new { recipient.Name, Area = area }))
            .Distinct()
            .OrderBy(item => item.Area, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .Select(item => $"<li><strong>{Encode(item.Area)}</strong>{(string.IsNullOrWhiteSpace(item.Name) ? string.Empty : $" — {Encode(item.Name)}")}</li>")
            .ToArray();
        var reason = string.IsNullOrWhiteSpace(request.Reason)
            ? string.Empty
            : $"<p><strong>Reason or decision note:</strong> {Encode(Limit(request.Reason.Trim(), 2000))}</p>";
        var eventDate = string.IsNullOrWhiteSpace(request.EventDate)
            ? string.Empty
            : $"<p><strong>Event date:</strong> {Encode(Limit(request.EventDate.Trim(), 40))}</p>";

        return $"""
            <h1>Event status: {Encode(statusLabel)}</h1>
            <p><strong>{Encode(eventName)}</strong> has been marked <strong>{Encode(statusLabel)}</strong> in Event Playbook.</p>
            {eventDate}
            <p><strong>Decision recorded by:</strong> {Encode(Limit(request.DecisionOwner?.Trim(), 200) ?? "Not recorded")}</p>
            {reason}
            <h2>Operational leads included in this update</h2>
            {(context.Length == 0 ? "<p>No team context was supplied.</p>" : $"<ul>{string.Join(string.Empty, context)}</ul>")}
            <p>Use this recorded status as the single go/no-go instruction before making or changing event-specific commitments.</p>
            <p><a href="{Encode(eventUrl.AbsoluteUri)}">Open the event in Event Playbook</a></p>
            """;
    }

    private static Uri BuildEventUrl(Uri publicBaseUri, string eventId)
    {
        var path = QueryHelpers.AddQueryString("", new Dictionary<string, string?>
        {
            ["view"] = "tasks",
            ["event"] = eventId
        });
        return new Uri(publicBaseUri, path);
    }

    private async Task<DeliveryLedger> LoadLedgerAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_ledgerPath)) return new DeliveryLedger();
        await using var stream = File.OpenRead(_ledgerPath);
        return await JsonSerializer.DeserializeAsync<DeliveryLedger>(stream, _jsonOptions, cancellationToken)
               ?? new DeliveryLedger();
    }

    private async Task SaveLedgerAsync(DeliveryLedger ledger, CancellationToken cancellationToken)
    {
        var temporaryPath = _ledgerPath + ".tmp";
        await using (var stream = new FileStream(temporaryPath, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            await JsonSerializer.SerializeAsync(stream, ledger, _jsonOptions, cancellationToken);
        }
        File.Move(temporaryPath, _ledgerPath, true);
    }

    private static string Required(string? value, string name, int maximumLength)
    {
        var cleaned = value?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(cleaned)) throw new ArgumentException($"The {name} is required.");
        if (cleaned.Length > maximumLength) throw new ArgumentException($"The {name} is too long.");
        return cleaned;
    }

    private static string? Limit(string? value, int maximumLength) =>
        value is null || value.Length <= maximumLength ? value : value[..maximumLength];

    private static string Encode(string? value) => WebUtility.HtmlEncode(value ?? string.Empty);

    private sealed class DeliveryLedger
    {
        public List<DeliveryRecord> Deliveries { get; init; } = [];
    }

    private sealed class DeliveryRecord
    {
        public required string DecisionKey { get; init; }
        public required string NotificationId { get; init; }
        public required string EventId { get; init; }
        public required string Status { get; init; }
        public required string RecipientEmail { get; init; }
        public DateTimeOffset SentAtUtc { get; init; }
    }

    private sealed class NormalisedRecipient
    {
        public required string Email { get; init; }
        public string? Name { get; set; }
        public List<string> Areas { get; } = [];
    }
}
