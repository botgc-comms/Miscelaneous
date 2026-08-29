using HtmlAgilityPack;

namespace BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;

public interface IIntelligentGolfReportParser<T>
{
    Task<IReadOnlyList<T>> ParseAsync(
        HtmlDocument document,
        CancellationToken cancellationToken = default);
}

public interface IIntelligentGolfReportClient
{
    Task<IReadOnlyList<T>> GetAsync<T>(
        string path,
        IIntelligentGolfReportParser<T> parser,
        string cacheKey,
        TimeSpan cacheTtl,
        bool refresh = false,
        CancellationToken cancellationToken = default);
}

public interface IIntelligentGolfTransport
{
    Task<HtmlDocument> GetDocumentAsync(
        string path,
        CancellationToken cancellationToken = default);

    Task<HtmlDocument> PostFormDocumentAsync(
        string path,
        IReadOnlyDictionary<string, string> fields,
        CancellationToken cancellationToken = default);

    Task<string> PostFormAsync(
        string path,
        IReadOnlyDictionary<string, string> fields,
        CancellationToken cancellationToken = default);
}

public interface IIntelligentGolfSession
{
    IntelligentGolfSessionStatus Status { get; }

    Task EnsureAuthenticatedAsync(
        bool forceRefresh = false,
        CancellationToken cancellationToken = default);
}

public sealed record IntelligentGolfSessionStatus(
    bool IsAuthenticated,
    DateTimeOffset? LastAttemptUtc,
    DateTimeOffset? LastAuthenticatedUtc,
    string? LastFailure);

public interface ICacheService
{
    Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken = default)
        where T : class;

    Task SetAsync<T>(
        string key,
        T value,
        TimeSpan expiration,
        CancellationToken cancellationToken = default)
        where T : class;

    Task RemoveAsync(string key, CancellationToken cancellationToken = default);
}

public interface IDistributedLock : IAsyncDisposable
{
    bool IsAcquired { get; }
}

public interface IDistributedLockManager
{
    Task<IDistributedLock> AcquireAsync(
        string resource,
        CancellationToken cancellationToken = default);
}
