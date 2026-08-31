using System.Net.Http.Json;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.Services;

public interface IIntelligentGolfApiSessionClient
{
    Task ConnectAsync(IntelligentGolfPluginCredentials credentials, CancellationToken cancellationToken);
    Task AuthorizeAsync(HttpRequestMessage request, CancellationToken cancellationToken);
    void Clear();
}

public sealed class IntelligentGolfApiSessionClient(
    IHttpClientFactory httpClientFactory,
    IPluginSettingsStore pluginSettingsStore,
    IOptions<EventPlaybookApiOptions> options,
    ILogger<IntelligentGolfApiSessionClient> logger) : IIntelligentGolfApiSessionClient
{
    public const string HttpClientName = "EventPlaybookApi";
    public const string ApiKeyHeaderName = "X-Api-Key";
    public const string SessionHeaderName = "X-Intelligent-Golf-Session";

    private readonly object _gate = new();
    private readonly SemaphoreSlim _connectGate = new(1, 1);
    private string? _sessionToken;
    private DateTimeOffset? _expiresAtUtc;

    public async Task ConnectAsync(
        IntelligentGolfPluginCredentials credentials,
        CancellationToken cancellationToken)
    {
        await _connectGate.WaitAsync(cancellationToken);
        try
        {
            await ConnectCoreAsync(credentials, cancellationToken);
        }
        finally
        {
            _connectGate.Release();
        }
    }

    public async Task AuthorizeAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var token = CurrentToken();
        if (string.IsNullOrWhiteSpace(token))
        {
            var credentials = await pluginSettingsStore.GetIntelligentGolfCredentialsAsync(cancellationToken)
                ?? throw new InvalidOperationException("The Intelligent Golf plugin has not been configured.");
            await ConnectAsync(credentials, cancellationToken);
            token = CurrentToken();
        }

        var apiKey = options.Value.ApiKey;
        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(token))
        {
            throw new InvalidOperationException("The Intelligent Golf API session is not available.");
        }
        request.Headers.Remove(ApiKeyHeaderName);
        request.Headers.Remove(SessionHeaderName);
        request.Headers.Add(ApiKeyHeaderName, apiKey);
        request.Headers.Add(SessionHeaderName, token);
    }

    private async Task ConnectCoreAsync(
        IntelligentGolfPluginCredentials credentials,
        CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (!Uri.TryCreate(settings.BaseUrl?.TrimEnd('/') + "/", UriKind.Absolute, out var baseUri) ||
            string.IsNullOrWhiteSpace(settings.ApiKey))
        {
            throw new InvalidOperationException(
                "The Event Playbook API connection is not configured. Add EventPlaybookApi__BaseUrl and EventPlaybookApi__ApiKey to the web service.");
        }

        var client = httpClientFactory.CreateClient(HttpClientName);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri(baseUri, "v1/auth/intelligent-golf/session"));
        request.Headers.Add(ApiKeyHeaderName, settings.ApiKey);
        request.Content = JsonContent.Create(new
        {
            baseUrl = credentials.SiteUrl,
            memberId = credentials.MemberId,
            memberPassword = credentials.MemberPassword,
            adminPassword = credentials.AdminPassword,
            emailSenderMemberNumber = credentials.EmailSenderMemberNumber,
            emailFromName = credentials.EmailFromName,
            emailFromAddress = credentials.EmailFromAddress
        });

        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request, cancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new InvalidOperationException("The Event Playbook API did not respond while validating the Intelligent Golf login.");
        }
        catch (HttpRequestException exception)
        {
            throw new InvalidOperationException(
                "The Event Playbook API could not be reached to validate the Intelligent Golf login.",
                exception);
        }

        using (response)
        {
        var raw = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                ExtractError(raw) ??
                $"The Intelligent Golf API login failed ({(int)response.StatusCode}).");
        }

        var grant = JsonSerializer.Deserialize<SessionGrant>(raw, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        if (grant is null || string.IsNullOrWhiteSpace(grant.SessionToken))
        {
            throw new InvalidOperationException("The Event Playbook API did not return an Intelligent Golf session token.");
        }

        lock (_gate)
        {
            _sessionToken = grant.SessionToken;
            _expiresAtUtc = grant.ExpiresAtUtc;
        }
        logger.LogInformation("The web service established an Intelligent Golf API session valid until {ExpiresAtUtc}.", grant.ExpiresAtUtc);
        }
    }

    private string? CurrentToken()
    {
        lock (_gate)
        {
            if (!_expiresAtUtc.HasValue || _expiresAtUtc.Value <= DateTimeOffset.UtcNow.AddMinutes(5))
            {
                _sessionToken = null;
                _expiresAtUtc = null;
            }
            return _sessionToken;
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            _sessionToken = null;
            _expiresAtUtc = null;
        }
    }

    private static string? ExtractError(string raw)
    {
        try
        {
            using var json = JsonDocument.Parse(raw);
            if (json.RootElement.TryGetProperty("error", out var error)) return error.GetString();
            if (json.RootElement.TryGetProperty("title", out var title)) return title.GetString();
        }
        catch (JsonException)
        {
            // The status code fallback below is clearer than returning an HTML response.
        }
        return null;
    }

    private sealed record SessionGrant(string SessionToken, DateTimeOffset ExpiresAtUtc);
}
