using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface IMemberEmailCampaignQueue
{
    Task<MemberEmailCampaignProgress> EnqueueAsync(
        MemberCampaignEmailRequest request,
        CancellationToken cancellationToken);

    Task<MemberEmailCampaignProgress?> GetAsync(
        string campaignId,
        CancellationToken cancellationToken);
}

public sealed class MemberEmailCampaignProgress
{
    public required string CampaignId { get; init; }
    public required string Status { get; init; }
    public int Requested { get; init; }
    public int Sent { get; init; }
    public int Pending { get; init; }
    public int Uncertain { get; init; }
    public int Failed { get; init; }
    public bool Reused { get; init; }
    public string? Message { get; init; }
}

public sealed class MemberEmailCampaignQueue(
    IWebHostEnvironment environment,
    IIntelligentGolfMemberCommunicationsClient communications,
    IIntegrationActivityStore activityStore,
    TimeProvider timeProvider,
    ILogger<MemberEmailCampaignQueue> logger) : BackgroundService, IMemberEmailCampaignQueue
{
    private const int RetentionDays = 90;
    private readonly string _path = Path.Combine(environment.ContentRootPath, "App_Data", "member-email-campaign-queue.json");
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Channel<bool> _wakeUp = Channel.CreateUnbounded<bool>(new UnboundedChannelOptions
    {
        SingleReader = true,
        SingleWriter = false
    });
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public async Task<MemberEmailCampaignProgress> EnqueueAsync(
        MemberCampaignEmailRequest request,
        CancellationToken cancellationToken)
    {
        var memberNumbers = request.MemberNumbers
            .Where(number => number > 0)
            .Distinct()
            .Order()
            .ToArray();
        if (memberNumbers.Length == 0)
            throw new ArgumentException("Choose at least one active member to receive the email.");
        if (string.IsNullOrWhiteSpace(request.Subject))
            throw new ArgumentException("An email subject is required.");
        if (string.IsNullOrWhiteSpace(request.BodyHtml))
            throw new ArgumentException("An HTML email body is required.");

        var fingerprint = ComputeFingerprint(request, memberNumbers);
        MemberEmailCampaign campaign;
        var reused = false;
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            RemoveExpiredCampaigns(document);
            campaign = document.Campaigns.FirstOrDefault(item =>
                string.Equals(item.Fingerprint, fingerprint, StringComparison.Ordinal))
                ?? new MemberEmailCampaign
                {
                    Id = $"email-{fingerprint[..24]}",
                    Fingerprint = fingerprint,
                    Subject = request.Subject.Trim(),
                    BodyHtml = request.BodyHtml,
                    EventId = Clean(request.EventId),
                    EventName = Clean(request.EventName),
                    Operation = Clean(request.Operation),
                    CreatedAtUtc = timeProvider.GetUtcNow(),
                    Recipients = memberNumbers.Select(number => new MemberEmailCampaignRecipient
                    {
                        MemberNumber = number,
                        Status = RecipientStatuses.Pending
                    }).ToList()
                };
            if (document.Campaigns.All(item => item.Id != campaign.Id))
                document.Campaigns.Add(campaign);
            else
                reused = true;
            await SaveAsync(document, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }

        _wakeUp.Writer.TryWrite(true);
        return ToProgress(campaign, reused);
    }

    public async Task<MemberEmailCampaignProgress?> GetAsync(
        string campaignId,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            var campaign = document.Campaigns.FirstOrDefault(item =>
                string.Equals(item.Id, campaignId, StringComparison.OrdinalIgnoreCase));
            return campaign is null ? null : ToProgress(campaign, false);
        }
        finally
        {
            _gate.Release();
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        await RecoverInterruptedRecipientsAsync(stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            while (await ProcessNextRecipientAsync(stoppingToken))
            {
                // Drain all queued recipients before waiting for another signal.
            }

            await _wakeUp.Reader.ReadAsync(stoppingToken);
        }
    }

    internal async Task<bool> ProcessNextRecipientAsync(CancellationToken cancellationToken)
    {
        MemberEmailCampaign? claimedCampaign = null;
        MemberEmailCampaignRecipient? claimedRecipient = null;
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            claimedCampaign = document.Campaigns
                .OrderBy(item => item.CreatedAtUtc)
                .FirstOrDefault(item => item.Recipients.Any(recipient => recipient.Status == RecipientStatuses.Pending));
            claimedRecipient = claimedCampaign?.Recipients.FirstOrDefault(recipient =>
                recipient.Status == RecipientStatuses.Pending);
            if (claimedCampaign is null || claimedRecipient is null) return false;

            claimedRecipient.Status = RecipientStatuses.Sending;
            claimedRecipient.AttemptedAtUtc = timeProvider.GetUtcNow();
            claimedRecipient.Error = null;
            await SaveAsync(document, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }

        try
        {
            var result = await communications.SendCampaignAsync(new MemberCampaignEmailRequest
            {
                MemberNumbers = [claimedRecipient.MemberNumber],
                Subject = claimedCampaign.Subject,
                BodyHtml = claimedCampaign.BodyHtml,
                EventId = claimedCampaign.EventId,
                EventName = claimedCampaign.EventName,
                Operation = claimedCampaign.Operation
            }, cancellationToken);
            if (result.Requested != 1 || result.Sent != 1)
                throw new InvalidOperationException("The member email request did not return one confirmed acceptance.");

            await CompleteRecipientAsync(
                claimedCampaign.Id,
                claimedRecipient.MemberNumber,
                RecipientStatuses.Sent,
                null,
                cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Deliberately leave this recipient as Sending. On restart it becomes
            // Uncertain and is never sent again automatically, preventing duplicates.
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Member email campaign {CampaignId} has an uncertain result for member {MemberNumber}; it will not be retried automatically.",
                claimedCampaign.Id,
                claimedRecipient.MemberNumber);
            await CompleteRecipientAsync(
                claimedCampaign.Id,
                claimedRecipient.MemberNumber,
                RecipientStatuses.Uncertain,
                "Delivery could not be confirmed. This recipient was not retried to avoid a duplicate email.",
                CancellationToken.None);
        }

        await RecordFinishedCampaignIfRequiredAsync(claimedCampaign.Id, CancellationToken.None);
        return true;
    }

    private async Task CompleteRecipientAsync(
        string campaignId,
        int memberNumber,
        string status,
        string? error,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            var campaign = document.Campaigns.Single(item => item.Id == campaignId);
            var recipient = campaign.Recipients.Single(item => item.MemberNumber == memberNumber);
            if (recipient.Status != RecipientStatuses.Sending) return;
            recipient.Status = status;
            recipient.Error = error;
            recipient.CompletedAtUtc = timeProvider.GetUtcNow();
            if (campaign.Recipients.All(item => item.Status is not RecipientStatuses.Pending and not RecipientStatuses.Sending))
                campaign.CompletedAtUtc = timeProvider.GetUtcNow();
            await SaveAsync(document, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task RecoverInterruptedRecipientsAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            var changed = false;
            foreach (var campaign in document.Campaigns)
            {
                foreach (var recipient in campaign.Recipients.Where(item => item.Status == RecipientStatuses.Sending))
                {
                    recipient.Status = RecipientStatuses.Uncertain;
                    recipient.Error = "The service restarted while delivery was in progress. It was not retried to avoid a duplicate email.";
                    recipient.CompletedAtUtc = timeProvider.GetUtcNow();
                    changed = true;
                }
                if (changed && campaign.Recipients.All(item => item.Status is not RecipientStatuses.Pending and not RecipientStatuses.Sending))
                    campaign.CompletedAtUtc = timeProvider.GetUtcNow();
            }
            if (changed) await SaveAsync(document, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task RecordFinishedCampaignIfRequiredAsync(string campaignId, CancellationToken cancellationToken)
    {
        MemberEmailCampaign? campaign = null;
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var document = await LoadAsync(cancellationToken);
            campaign = document.Campaigns.Single(item => item.Id == campaignId);
            if (campaign.ActivityRecorded || campaign.CompletedAtUtc is null) return;
            campaign.ActivityRecorded = true;
            await SaveAsync(document, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }

        var progress = ToProgress(campaign, false);
        try
        {
            await activityStore.RecordAsync(new IntegrationActivityWrite
            {
                Integration = "Member communications",
                Operation = string.Equals(campaign.Operation, "cancellation", StringComparison.OrdinalIgnoreCase)
                    ? "Send cancellation member email"
                    : "Send member email",
                Outcome = progress.Uncertain == 0 && progress.Failed == 0 ? "succeeded" : "action-required",
                EventPlaybookEventId = campaign.EventId,
                EventName = campaign.EventName,
                Stage = "member-email-queue",
                Message = progress.Message ?? $"Campaign {campaign.Id} finished."
            }, cancellationToken);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Could not record integration activity for member email campaign {CampaignId}.", campaignId);
        }
    }

    private async Task<CampaignDocument> LoadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path)) return new CampaignDocument();
        await using var stream = File.OpenRead(_path);
        return await JsonSerializer.DeserializeAsync<CampaignDocument>(stream, _jsonOptions, cancellationToken)
            ?? new CampaignDocument();
    }

    private async Task SaveAsync(CampaignDocument document, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var temporaryPath = $"{_path}.{Guid.NewGuid():N}.tmp";
        try
        {
            await using (var stream = new FileStream(
                             temporaryPath,
                             FileMode.CreateNew,
                             FileAccess.Write,
                             FileShare.None,
                             65536,
                             FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, document, _jsonOptions, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }
            File.Move(temporaryPath, _path, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private void RemoveExpiredCampaigns(CampaignDocument document)
    {
        var cutoff = timeProvider.GetUtcNow().AddDays(-RetentionDays);
        document.Campaigns.RemoveAll(item => item.CompletedAtUtc < cutoff);
    }

    private static string ComputeFingerprint(MemberCampaignEmailRequest request, IReadOnlyCollection<int> memberNumbers)
    {
        var canonical = JsonSerializer.Serialize(new
        {
            memberNumbers,
            subject = request.Subject.Trim(),
            request.BodyHtml,
            eventId = Clean(request.EventId),
            operation = Clean(request.Operation)
        });
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();
    }

    private static MemberEmailCampaignProgress ToProgress(MemberEmailCampaign campaign, bool reused)
    {
        var sent = campaign.Recipients.Count(item => item.Status == RecipientStatuses.Sent);
        var pending = campaign.Recipients.Count(item => item.Status == RecipientStatuses.Pending);
        var sending = campaign.Recipients.Count(item => item.Status == RecipientStatuses.Sending);
        var uncertain = campaign.Recipients.Count(item => item.Status == RecipientStatuses.Uncertain);
        var failed = campaign.Recipients.Count(item => item.Status == RecipientStatuses.Failed);
        var status = pending > 0 || sending > 0
            ? sent == 0 && sending == 0 ? "queued" : "processing"
            : uncertain > 0 || failed > 0 ? "action-required" : "completed";
        var message = status switch
        {
            "completed" => $"Sent to {sent} member{(sent == 1 ? string.Empty : "s")}. Every recipient was checkpointed.",
            "action-required" => $"Sent to {sent} member{(sent == 1 ? string.Empty : "s")}. {uncertain + failed} recipient result{(uncertain + failed == 1 ? " is" : "s are")} unresolved and will not be retried automatically.",
            "processing" => $"Sending in the background: {sent} of {campaign.Recipients.Count} confirmed.",
            _ => $"Queued for {campaign.Recipients.Count} member{(campaign.Recipients.Count == 1 ? string.Empty : "s")} and safe to close."
        };
        return new MemberEmailCampaignProgress
        {
            CampaignId = campaign.Id,
            Status = status,
            Requested = campaign.Recipients.Count,
            Sent = sent,
            Pending = pending + sending,
            Uncertain = uncertain,
            Failed = failed,
            Reused = reused,
            Message = message
        };
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private sealed class CampaignDocument
    {
        public int Version { get; init; } = 1;
        public List<MemberEmailCampaign> Campaigns { get; init; } = [];
    }

    private sealed class MemberEmailCampaign
    {
        public required string Id { get; init; }
        public required string Fingerprint { get; init; }
        public required string Subject { get; init; }
        public required string BodyHtml { get; init; }
        public string? EventId { get; init; }
        public string? EventName { get; init; }
        public string? Operation { get; init; }
        public DateTimeOffset CreatedAtUtc { get; init; }
        public DateTimeOffset? CompletedAtUtc { get; set; }
        public bool ActivityRecorded { get; set; }
        public List<MemberEmailCampaignRecipient> Recipients { get; init; } = [];
    }

    private sealed class MemberEmailCampaignRecipient
    {
        public int MemberNumber { get; init; }
        public required string Status { get; set; }
        public DateTimeOffset? AttemptedAtUtc { get; set; }
        public DateTimeOffset? CompletedAtUtc { get; set; }
        public string? Error { get; set; }
    }

    private static class RecipientStatuses
    {
        public const string Pending = "pending";
        public const string Sending = "sending";
        public const string Sent = "sent";
        public const string Uncertain = "uncertain";
        public const string Failed = "failed";
    }
}
