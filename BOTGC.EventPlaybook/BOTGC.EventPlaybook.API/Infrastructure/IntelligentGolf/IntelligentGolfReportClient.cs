namespace BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;

public sealed class IntelligentGolfReportClient(
    IIntelligentGolfTransport transport,
    ICacheService cache,
    IDistributedLockManager lockManager,
    ILogger<IntelligentGolfReportClient> logger) : IIntelligentGolfReportClient
{
    public async Task<IReadOnlyList<T>> GetAsync<T>(
        string path,
        IIntelligentGolfReportParser<T> parser,
        string cacheKey,
        TimeSpan cacheTtl,
        bool refresh = false,
        CancellationToken cancellationToken = default)
    {
        if (!refresh)
        {
            var cached = await cache.GetAsync<List<T>>(cacheKey, cancellationToken);
            if (cached is not null)
            {
                logger.LogDebug("Using cached Intelligent Golf report {CacheKey}.", cacheKey);
                return cached;
            }
        }

        await using var reportLock = await lockManager.AcquireAsync(
            $"ig-report:{cacheKey}",
            cancellationToken);

        if (!reportLock.IsAcquired)
        {
            throw new TimeoutException($"A cache lock could not be acquired for '{cacheKey}'.");
        }

        if (!refresh)
        {
            var cachedAfterLock = await cache.GetAsync<List<T>>(cacheKey, cancellationToken);
            if (cachedAfterLock is not null)
            {
                return cachedAfterLock;
            }
        }

        var document = await transport.GetDocumentAsync(path, cancellationToken);
        var parsed = await parser.ParseAsync(document, cancellationToken);
        var result = parsed.ToList();

        await cache.SetAsync(cacheKey, result, cacheTtl, cancellationToken);
        logger.LogInformation(
            "Fetched and cached {Count} records from Intelligent Golf for {CacheKey}.",
            result.Count,
            cacheKey);

        return result;
    }

    public Task<IReadOnlyList<T>> PostAsync<T>(
        string path,
        IReadOnlyCollection<KeyValuePair<string, string>> fields,
        IIntelligentGolfReportParser<T> parser,
        string cacheKey,
        TimeSpan cacheTtl,
        bool refresh = false,
        CancellationToken cancellationToken = default) =>
        GetOrCreateAsync(
            () => transport.PostFormDocumentAsync(path, fields, cancellationToken),
            parser,
            cacheKey,
            cacheTtl,
            refresh,
            cancellationToken);

    private async Task<IReadOnlyList<T>> GetOrCreateAsync<T>(
        Func<Task<HtmlAgilityPack.HtmlDocument>> documentFactory,
        IIntelligentGolfReportParser<T> parser,
        string cacheKey,
        TimeSpan cacheTtl,
        bool refresh,
        CancellationToken cancellationToken)
    {
        if (!refresh)
        {
            var cached = await cache.GetAsync<List<T>>(cacheKey, cancellationToken);
            if (cached is not null) return cached;
        }

        await using var reportLock = await lockManager.AcquireAsync($"ig-report:{cacheKey}", cancellationToken);
        if (!reportLock.IsAcquired)
        {
            throw new TimeoutException($"A cache lock could not be acquired for '{cacheKey}'.");
        }

        if (!refresh)
        {
            var cachedAfterLock = await cache.GetAsync<List<T>>(cacheKey, cancellationToken);
            if (cachedAfterLock is not null) return cachedAfterLock;
        }

        var parsed = await parser.ParseAsync(await documentFactory(), cancellationToken);
        var result = parsed.ToList();
        await cache.SetAsync(cacheKey, result, cacheTtl, cancellationToken);
        logger.LogInformation("Fetched and cached {Count} records from Intelligent Golf for {CacheKey}.", result.Count, cacheKey);
        return result;
    }
}
