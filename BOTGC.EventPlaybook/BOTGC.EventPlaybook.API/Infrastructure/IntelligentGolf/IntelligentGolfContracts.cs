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

    Task<IReadOnlyList<T>> PostAsync<T>(
        string path,
        IReadOnlyCollection<KeyValuePair<string, string>> fields,
        IIntelligentGolfReportParser<T> parser,
        string cacheKey,
        TimeSpan cacheTtl,
        bool refresh = false,
        CancellationToken cancellationToken = default);
}

public interface IIntelligentGolfTransport
{
    Task<IntelligentGolfTransportResponse> GetResponseAsync(
        string path,
        CancellationToken cancellationToken = default);

    Task<HtmlDocument> GetDocumentAsync(
        string path,
        CancellationToken cancellationToken = default);

    Task<HtmlDocument> PostFormDocumentAsync(
        string path,
        IReadOnlyCollection<KeyValuePair<string, string>> fields,
        CancellationToken cancellationToken = default);

    Task<IntelligentGolfTransportResponse> PostFormResponseAsync(
        string path,
        IReadOnlyCollection<KeyValuePair<string, string>> fields,
        CancellationToken cancellationToken = default);

    Task<string> PostFormAsync(
        string path,
        IReadOnlyCollection<KeyValuePair<string, string>> fields,
        CancellationToken cancellationToken = default);
}

public sealed record IntelligentGolfTransportResponse(string Body, Uri? FinalUri);

public interface IIntelligentGolfSession
{
    IntelligentGolfSessionStatus Status { get; }
    string BaseUrl { get; }
    string? MemberId { get; }
    IntelligentGolfEmailSenderIdentity EmailSender { get; }

    Task<IntelligentGolfSessionGrant> AuthenticateAsync(
        IntelligentGolfCredentials credentials,
        CancellationToken cancellationToken = default);

    Task EnsureAuthenticatedAsync(
        bool forceRefresh = false,
        CancellationToken cancellationToken = default);

    bool IsSessionTokenValid(string? token);
}

public sealed record IntelligentGolfCredentials(
    string BaseUrl,
    string MemberId,
    string MemberPassword,
    string AdminPassword,
    int? EmailSenderMemberNumber = null,
    string? EmailFromName = null,
    string? EmailFromAddress = null);

public sealed record IntelligentGolfEmailSenderIdentity(
    int? MemberNumber,
    string? FromName,
    string? FromAddress);

public sealed record IntelligentGolfSessionGrant(
    string SessionToken,
    DateTimeOffset ExpiresAtUtc);

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
