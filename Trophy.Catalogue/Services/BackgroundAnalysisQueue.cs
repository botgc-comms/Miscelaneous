using System.Collections.Concurrent;
using System.Threading.Channels;
using Trophy.Catalogue.Domain;

namespace Trophy.Catalogue.Services;

public sealed record AnalysisJobSnapshot(
    string Status,
    string Message,
    DateTimeOffset UpdatedAt,
    int EvidenceCount);

internal sealed record AnalysisQueueRequest(
    string TrophyId,
    DateTimeOffset DueAt,
    long Generation);

public sealed class BackgroundAnalysisQueue(
    CatalogueStore store,
    OpenAiEngravingReader reader,
    IConfiguration configuration,
    ILogger<BackgroundAnalysisQueue> logger) : BackgroundService
{
    private readonly Channel<AnalysisQueueRequest> queue = Channel.CreateUnbounded<AnalysisQueueRequest>(new UnboundedChannelOptions
    {
        SingleReader = true,
        SingleWriter = false
    });
    private readonly ConcurrentDictionary<string, AnalysisJobSnapshot> jobs = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, long> generations = new(StringComparer.OrdinalIgnoreCase);
    private readonly TimeSpan debounce = TimeSpan.FromSeconds(
        Math.Clamp(configuration.GetValue("ANALYSIS_DEBOUNCE_SECONDS", 20), 2, 60));

    public AnalysisJobSnapshot Enqueue(string trophyId, int evidenceCount) => Schedule(
        trophyId,
        evidenceCount,
        DateTimeOffset.UtcNow.Add(debounce),
        "Photos saved. Waiting briefly for any more before reading the full set…");

    public AnalysisJobSnapshot EnqueueNow(string trophyId, int evidenceCount) => Schedule(
        trophyId,
        evidenceCount,
        DateTimeOffset.UtcNow,
        "Reading has been queued…");

    public AnalysisJobSnapshot GetStatus(string trophyId) => jobs.TryGetValue(trophyId, out var status)
        ? status
        : new AnalysisJobSnapshot("idle", "No reading is queued.", DateTimeOffset.UtcNow, 0);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RequeueInterruptedWorkAsync(stoppingToken);
        var pending = new Dictionary<string, AnalysisQueueRequest>(StringComparer.OrdinalIgnoreCase);

        while (!stoppingToken.IsCancellationRequested)
        {
            while (queue.Reader.TryRead(out var request))
            {
                if (!pending.TryGetValue(request.TrophyId, out var existing) || request.Generation >= existing.Generation)
                    pending[request.TrophyId] = request;
            }

            var due = pending.Values
                .Where(item => item.DueAt <= DateTimeOffset.UtcNow)
                .OrderBy(item => item.DueAt)
                .ToList();

            foreach (var request in due)
            {
                pending.Remove(request.TrophyId);
                await ProcessAsync(request, stoppingToken);
            }

            if (pending.Count == 0)
            {
                await queue.Reader.WaitToReadAsync(stoppingToken);
                continue;
            }

            var nextDue = pending.Values.Min(item => item.DueAt);
            var delay = nextDue - DateTimeOffset.UtcNow;
            if (delay < TimeSpan.Zero) delay = TimeSpan.Zero;
            var readTask = queue.Reader.WaitToReadAsync(stoppingToken).AsTask();
            var delayTask = Task.Delay(delay, stoppingToken);
            await Task.WhenAny(readTask, delayTask);
        }
    }

    private AnalysisJobSnapshot Schedule(
        string trophyId,
        int evidenceCount,
        DateTimeOffset dueAt,
        string message)
    {
        var generation = generations.AddOrUpdate(trophyId, 1, (_, current) => current + 1);
        var snapshot = new AnalysisJobSnapshot("queued", message, DateTimeOffset.UtcNow, evidenceCount);
        jobs[trophyId] = snapshot;
        queue.Writer.TryWrite(new AnalysisQueueRequest(trophyId, dueAt, generation));
        return snapshot;
    }

    private async Task ProcessAsync(AnalysisQueueRequest request, CancellationToken cancellationToken)
    {
        if (HasNewerRequest(request)) return;

        var trophy = await store.GetTrophyAsync(request.TrophyId, cancellationToken);
        var evidenceFiles = await store.GetEvidenceFilesAsync(request.TrophyId, cancellationToken);
        if (trophy is null || evidenceFiles.Count == 0)
        {
            jobs[request.TrophyId] = new AnalysisJobSnapshot(
                "idle",
                "No images are available to read.",
                DateTimeOffset.UtcNow,
                0);
            return;
        }

        var pendingEvidenceIds = evidenceFiles
            .Where(item => item.Evidence.ProcessingState is ProcessingStates.Pending or "queued" or "processing" or ProcessingStates.Failed)
            .Select(item => item.Evidence.Id)
            .ToList();
        jobs[request.TrophyId] = new AnalysisJobSnapshot(
            "processing",
            $"Comparing all {evidenceFiles.Count} images…",
            DateTimeOffset.UtcNow,
            evidenceFiles.Count);

        foreach (var evidenceId in pendingEvidenceIds)
        {
            await store.SetEvidenceProcessingAsync(
                request.TrophyId,
                evidenceId,
                "processing",
                "Comparing this with all saved images",
                cancellationToken);
        }

        try
        {
            var extraction = await reader.ReadAsync(trophy, evidenceFiles, cancellationToken);
            await store.MergeAiExtractionAsync(
                request.TrophyId,
                extraction,
                evidenceFiles.Select(item => item.Evidence.Id).ToList(),
                cancellationToken);

            var readingMessage = extraction.Entries.Count == 1
                ? $"1 winner reading found across {evidenceFiles.Count} images"
                : $"{extraction.Entries.Count} winner readings found across {evidenceFiles.Count} images";
            foreach (var evidenceId in pendingEvidenceIds)
            {
                await store.SetEvidenceProcessingAsync(
                    request.TrophyId,
                    evidenceId,
                    ProcessingStates.Complete,
                    readingMessage,
                    cancellationToken);
            }

            if (!HasNewerRequest(request))
            {
                jobs[request.TrophyId] = new AnalysisJobSnapshot(
                    "complete",
                    readingMessage,
                    DateTimeOffset.UtcNow,
                    evidenceFiles.Count);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is OpenAiUnavailableException or HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning(exception, "Background engraving analysis failed for trophy {TrophyId}", request.TrophyId);
            foreach (var evidenceId in pendingEvidenceIds)
            {
                await store.SetEvidenceProcessingAsync(
                    request.TrophyId,
                    evidenceId,
                    ProcessingStates.Failed,
                    exception.Message,
                    cancellationToken);
            }

            if (!HasNewerRequest(request))
            {
                jobs[request.TrophyId] = new AnalysisJobSnapshot(
                    "failed",
                    exception.Message,
                    DateTimeOffset.UtcNow,
                    evidenceFiles.Count);
            }
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Unexpected background engraving analysis failure for trophy {TrophyId}", request.TrophyId);
            const string message = "The background reader failed unexpectedly. Try again.";
            foreach (var evidenceId in pendingEvidenceIds)
            {
                await store.SetEvidenceProcessingAsync(
                    request.TrophyId,
                    evidenceId,
                    ProcessingStates.Failed,
                    message,
                    cancellationToken);
            }

            if (!HasNewerRequest(request))
            {
                jobs[request.TrophyId] = new AnalysisJobSnapshot(
                    "failed",
                    message,
                    DateTimeOffset.UtcNow,
                    evidenceFiles.Count);
            }
        }
    }

    private bool HasNewerRequest(AnalysisQueueRequest request) =>
        generations.TryGetValue(request.TrophyId, out var current) && current > request.Generation;

    private async Task RequeueInterruptedWorkAsync(CancellationToken cancellationToken)
    {
        var summaries = await store.GetSummariesAsync(cancellationToken);
        foreach (var summary in summaries)
        {
            var trophy = await store.GetTrophyAsync(summary.Id, cancellationToken);
            if (trophy?.Evidence.Any(item => item.ProcessingState is ProcessingStates.Pending or "queued" or "processing") == true)
                Enqueue(trophy.Id, trophy.Evidence.Count);
        }
    }
}
