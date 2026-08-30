using System.Security.Cryptography;
using System.Text;
using BOTGC.EventPlaybook.API.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;

public sealed class IntelligentGolfSession(
    IntelligentGolfLoginService loginService,
    IOptions<IntelligentGolfOptions> options,
    ILogger<IntelligentGolfSession> logger) : BackgroundService, IIntelligentGolfSession
{
    private readonly SemaphoreSlim _loginGate = new(1, 1);
    private readonly object _stateGate = new();
    private readonly TimeSpan _refreshInterval = TimeSpan.FromMinutes(
        Math.Max(1, options.Value.LoginRefreshMinutes));
    private readonly TimeSpan _grantLifetime = TimeSpan.FromHours(4);

    private volatile bool _isAuthenticated;
    private IntelligentGolfCredentials? _runtimeCredentials;
    private string? _sessionToken;
    private DateTimeOffset? _sessionTokenExpiresAtUtc;
    private DateTimeOffset? _lastAttemptUtc;
    private DateTimeOffset? _lastAuthenticatedUtc;
    private string? _lastFailure;

    public IntelligentGolfSessionStatus Status => new(
        _isAuthenticated,
        _lastAttemptUtc,
        _lastAuthenticatedUtc,
        _lastFailure);

    public string BaseUrl => (_runtimeCredentials?.BaseUrl ?? options.Value.BaseUrl).TrimEnd('/') + "/";

    public async Task<IntelligentGolfSessionGrant> AuthenticateAsync(
        IntelligentGolfCredentials credentials,
        CancellationToken cancellationToken = default)
    {
        var normalised = NormaliseCredentials(credentials);
        await _loginGate.WaitAsync(cancellationToken);
        try
        {
            _lastAttemptUtc = DateTimeOffset.UtcNow;
            var authenticated = await loginService.LoginAsync(normalised, cancellationToken);
            if (!authenticated)
            {
                _lastFailure = "Intelligent Golf rejected the supplied member or administrator credentials.";
                throw new IntelligentGolfAuthenticationException(_lastFailure);
            }

            var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
            var expiresAtUtc = DateTimeOffset.UtcNow.Add(_grantLifetime);
            lock (_stateGate)
            {
                _runtimeCredentials = normalised;
                _sessionToken = token;
                _sessionTokenExpiresAtUtc = expiresAtUtc;
            }

            _isAuthenticated = true;
            _lastAuthenticatedUtc = DateTimeOffset.UtcNow;
            _lastFailure = null;
            logger.LogInformation("The Intelligent Golf session was authenticated from Playbook plugin settings.");
            return new IntelligentGolfSessionGrant(token, expiresAtUtc);
        }
        finally
        {
            _loginGate.Release();
        }
    }

    public async Task EnsureAuthenticatedAsync(
        bool forceRefresh = false,
        CancellationToken cancellationToken = default)
    {
        if (!forceRefresh && HasFreshSession())
        {
            return;
        }

        await _loginGate.WaitAsync(cancellationToken);
        try
        {
            if (!forceRefresh && HasFreshSession())
            {
                return;
            }

            var credentials = _runtimeCredentials ?? FallbackCredentials();
            if (credentials is null)
            {
                throw new IntelligentGolfAuthenticationException(
                    "Intelligent Golf credentials have not been supplied by the Playbook service.");
            }

            _lastAttemptUtc = DateTimeOffset.UtcNow;
            var authenticated = await loginService.LoginAsync(credentials, cancellationToken);
            _isAuthenticated = authenticated;

            if (!authenticated)
            {
                _lastFailure = "Intelligent Golf rejected the configured credentials or session.";
                throw new IntelligentGolfAuthenticationException(_lastFailure);
            }

            _lastAuthenticatedUtc = DateTimeOffset.UtcNow;
            _lastFailure = null;
            logger.LogInformation("The background Intelligent Golf session is authenticated.");
        }
        finally
        {
            _loginGate.Release();
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (_runtimeCredentials is not null || FallbackCredentials() is not null)
                {
                    await EnsureAuthenticatedAsync(cancellationToken: stoppingToken);
                }
            }
            catch (IntelligentGolfAuthenticationException exception)
            {
                logger.LogWarning("Background Intelligent Golf login failed: {Message}", exception.Message);
            }

            try
            {
                await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private bool HasFreshSession() =>
        _isAuthenticated &&
        _lastAuthenticatedUtc.HasValue &&
        DateTimeOffset.UtcNow - _lastAuthenticatedUtc.Value < _refreshInterval;

    public bool IsSessionTokenValid(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return false;
        string? configuredToken;
        DateTimeOffset? expiresAtUtc;
        lock (_stateGate)
        {
            configuredToken = _sessionToken;
            expiresAtUtc = _sessionTokenExpiresAtUtc;
        }

        if (string.IsNullOrWhiteSpace(configuredToken) ||
            !expiresAtUtc.HasValue ||
            expiresAtUtc.Value <= DateTimeOffset.UtcNow)
        {
            return false;
        }

        var suppliedBytes = Encoding.UTF8.GetBytes(token);
        var configuredBytes = Encoding.UTF8.GetBytes(configuredToken);
        return suppliedBytes.Length == configuredBytes.Length &&
               CryptographicOperations.FixedTimeEquals(suppliedBytes, configuredBytes);
    }

    private IntelligentGolfCredentials? FallbackCredentials()
    {
        var settings = options.Value;
        return string.IsNullOrWhiteSpace(settings.MemberId) ||
               string.IsNullOrWhiteSpace(settings.MemberPassword) ||
               string.IsNullOrWhiteSpace(settings.AdminPassword)
            ? null
            : new IntelligentGolfCredentials(
                settings.BaseUrl,
                settings.MemberId,
                settings.MemberPassword,
                settings.AdminPassword);
    }

    private static IntelligentGolfCredentials NormaliseCredentials(IntelligentGolfCredentials credentials)
    {
        var baseUrl = credentials.BaseUrl?.Trim().TrimEnd('/');
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
        {
            throw new ArgumentException("The Intelligent Golf site URL must be a complete https URL.");
        }

        var memberId = credentials.MemberId?.Trim();
        if (string.IsNullOrWhiteSpace(memberId) ||
            string.IsNullOrWhiteSpace(credentials.MemberPassword) ||
            string.IsNullOrWhiteSpace(credentials.AdminPassword))
        {
            throw new ArgumentException("Member ID, member PIN/password and administrator password are required.");
        }

        return new IntelligentGolfCredentials(
            baseUrl,
            memberId,
            credentials.MemberPassword,
            credentials.AdminPassword);
    }
}
