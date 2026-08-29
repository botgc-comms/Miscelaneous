using BOTGC.EventPlaybook.API.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;

public sealed class IntelligentGolfSession(
    IntelligentGolfLoginService loginService,
    IOptions<IntelligentGolfOptions> options,
    ILogger<IntelligentGolfSession> logger) : BackgroundService, IIntelligentGolfSession
{
    private readonly SemaphoreSlim _loginGate = new(1, 1);
    private readonly TimeSpan _refreshInterval = TimeSpan.FromMinutes(
        Math.Max(1, options.Value.LoginRefreshMinutes));

    private volatile bool _isAuthenticated;
    private DateTimeOffset? _lastAttemptUtc;
    private DateTimeOffset? _lastAuthenticatedUtc;
    private string? _lastFailure;

    public IntelligentGolfSessionStatus Status => new(
        _isAuthenticated,
        _lastAttemptUtc,
        _lastAuthenticatedUtc,
        _lastFailure);

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

            _lastAttemptUtc = DateTimeOffset.UtcNow;
            var authenticated = await loginService.LoginAsync(cancellationToken);
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
                await EnsureAuthenticatedAsync(cancellationToken: stoppingToken);
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
}
