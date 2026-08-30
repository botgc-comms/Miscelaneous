using System.Text.Json;
using HtmlAgilityPack;

namespace BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;

public sealed class IntelligentGolfTransport(
    IHttpClientFactory httpClientFactory,
    IIntelligentGolfSession session,
    ILogger<IntelligentGolfTransport> logger) : IIntelligentGolfTransport
{
    public async Task<HtmlDocument> GetDocumentAsync(
        string path,
        CancellationToken cancellationToken = default)
    {
        var html = await SendAsync(
            () => new HttpRequestMessage(HttpMethod.Get, path),
            cancellationToken);
        return ParseDocument(html);
    }

    public async Task<HtmlDocument> PostFormDocumentAsync(
        string path,
        IReadOnlyDictionary<string, string> fields,
        CancellationToken cancellationToken = default) =>
        ParseDocument(await PostFormAsync(path, fields, cancellationToken));

    public Task<string> PostFormAsync(
        string path,
        IReadOnlyDictionary<string, string> fields,
        CancellationToken cancellationToken = default) =>
        SendAsync(
            () => new HttpRequestMessage(HttpMethod.Post, path)
            {
                Content = new FormUrlEncodedContent(fields)
            },
            cancellationToken);

    private async Task<string> SendAsync(
        Func<HttpRequestMessage> requestFactory,
        CancellationToken cancellationToken)
    {
        await session.EnsureAuthenticatedAsync(cancellationToken: cancellationToken);

        var firstResponse = await SendOnceAsync(requestFactory, cancellationToken);
        if (!firstResponse.RequiresLogin)
        {
            return firstResponse.Body;
        }

        logger.LogWarning("Intelligent Golf requested a new login; refreshing the shared session and retrying once.");
        await session.EnsureAuthenticatedAsync(forceRefresh: true, cancellationToken);

        var retryResponse = await SendOnceAsync(requestFactory, cancellationToken);
        if (retryResponse.RequiresLogin)
        {
            throw new IntelligentGolfAuthenticationException(
                "Intelligent Golf still requires login after the shared session was refreshed.");
        }

        return retryResponse.Body;
    }

    private async Task<TransportResponse> SendOnceAsync(
        Func<HttpRequestMessage> requestFactory,
        CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient(IntelligentGolfServiceCollectionExtensions.HttpClientName);
        using var request = requestFactory();
        if (request.RequestUri is null || !request.RequestUri.IsAbsoluteUri)
        {
            request.RequestUri = new Uri(
                new Uri(session.BaseUrl, UriKind.Absolute),
                request.RequestUri?.ToString().TrimStart('/') ?? string.Empty);
        }
        using var response = await client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Intelligent Golf returned HTTP {(int)response.StatusCode} ({response.StatusCode}).",
                null,
                response.StatusCode);
        }

        var finalPath = response.RequestMessage?.RequestUri?.AbsolutePath ?? string.Empty;
        var requiresLogin = finalPath.EndsWith("/login.php", StringComparison.OrdinalIgnoreCase) ||
                            IntelligentGolfLoginService.RequiresMemberLogin(body) ||
                            body.Contains("Login Required", StringComparison.OrdinalIgnoreCase);

        return new TransportResponse(body, requiresLogin);
    }

    private static HtmlDocument ParseDocument(string raw)
    {
        var html = ExtractHtmlFromJson(raw) ?? raw;
        var document = new HtmlDocument();
        document.LoadHtml(html);
        return document;
    }

    private static string? ExtractHtmlFromJson(string raw)
    {
        var trimmed = raw.TrimStart();
        if (!trimmed.StartsWith('{') && !trimmed.StartsWith('['))
        {
            return null;
        }

        try
        {
            using var json = JsonDocument.Parse(raw);
            if (json.RootElement.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            if (json.RootElement.TryGetProperty("html", out var html))
            {
                return html.GetString();
            }

            if (!json.RootElement.TryGetProperty("actions", out var actions) ||
                actions.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            foreach (var action in actions.EnumerateArray())
            {
                if (action.TryGetProperty("html", out var actionHtml))
                {
                    return actionHtml.GetString();
                }
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private sealed record TransportResponse(string Body, bool RequiresLogin);
}
