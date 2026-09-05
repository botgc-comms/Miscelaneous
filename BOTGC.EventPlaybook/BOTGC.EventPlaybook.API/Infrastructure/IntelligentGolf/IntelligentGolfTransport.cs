using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using HtmlAgilityPack;

namespace BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;

public sealed class IntelligentGolfTransport(
    IHttpClientFactory httpClientFactory,
    IIntelligentGolfSession session,
    ILogger<IntelligentGolfTransport> logger) : IIntelligentGolfTransport
{
    public Task<IntelligentGolfTransportResponse> GetResponseAsync(
        string path,
        CancellationToken cancellationToken = default) =>
        SendResponseAsync(
            () => new HttpRequestMessage(HttpMethod.Get, path),
            cancellationToken);

    public Task<IntelligentGolfTransportResponse> GetResponseFollowingRedirectsAsync(
        string path,
        string referrerPath,
        CancellationToken cancellationToken = default) =>
        SendRedirectAwareGetResponseAsync(path, referrerPath, cancellationToken);

    public async Task<HtmlDocument> GetDocumentAsync(
        string path,
        CancellationToken cancellationToken = default)
    {
        var response = await GetResponseAsync(path, cancellationToken);
        return ParseDocument(response.Body);
    }

    public async Task<HtmlDocument> PostFormDocumentAsync(
        string path,
        IReadOnlyCollection<KeyValuePair<string, string>> fields,
        CancellationToken cancellationToken = default) =>
        ParseDocument(await PostFormAsync(path, fields, cancellationToken));

    public Task<IntelligentGolfTransportResponse> PostFormResponseAsync(
        string path,
        IReadOnlyCollection<KeyValuePair<string, string>> fields,
        CancellationToken cancellationToken = default) =>
        SendResponseAsync(
            () => CreateFormRequest(path, fields),
            cancellationToken);

    public Task<string> PostFormAsync(
        string path,
        IReadOnlyCollection<KeyValuePair<string, string>> fields,
        CancellationToken cancellationToken = default) =>
        PostFormBodyAsync(path, fields, cancellationToken);

    private async Task<string> PostFormBodyAsync(
        string path,
        IReadOnlyCollection<KeyValuePair<string, string>> fields,
        CancellationToken cancellationToken) =>
        (await PostFormResponseAsync(path, fields, cancellationToken)).Body;

    private static HttpRequestMessage CreateFormRequest(
        string path,
        IReadOnlyCollection<KeyValuePair<string, string>> fields)
    {
        var content = new FormUrlEncodedContent(fields);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/x-www-form-urlencoded")
        {
            CharSet = "UTF-8"
        };
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = content
        };
        if (path.Contains("requestType=ajax", StringComparison.OrdinalIgnoreCase) ||
            path.Contains("ajaxaction=", StringComparison.OrdinalIgnoreCase))
        {
            request.Headers.TryAddWithoutValidation("X-Requested-With", "XMLHttpRequest");
        }

        return request;
    }

    private async Task<IntelligentGolfTransportResponse> SendRedirectAwareGetResponseAsync(
        string path,
        string referrerPath,
        CancellationToken cancellationToken)
    {
        await session.EnsureAuthenticatedAsync(cancellationToken: cancellationToken);

        var firstResponse = await SendRedirectAwareGetOnceAsync(path, referrerPath, cancellationToken);
        if (!firstResponse.RequiresLogin)
        {
            return new IntelligentGolfTransportResponse(
                firstResponse.Body,
                firstResponse.FinalUri,
                firstResponse.RedirectUris);
        }

        logger.LogWarning("Intelligent Golf requested a new login; refreshing the shared session and retrying once.");
        await session.EnsureAuthenticatedAsync(forceRefresh: true, cancellationToken);

        var retryResponse = await SendRedirectAwareGetOnceAsync(path, referrerPath, cancellationToken);
        if (retryResponse.RequiresLogin)
        {
            throw new IntelligentGolfAuthenticationException(
                "Intelligent Golf still requires login after the shared session was refreshed.");
        }

        return new IntelligentGolfTransportResponse(
            retryResponse.Body,
            retryResponse.FinalUri,
            retryResponse.RedirectUris);
    }

    private async Task<RedirectAwareTransportResponse> SendRedirectAwareGetOnceAsync(
        string path,
        string referrerPath,
        CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient(
            IntelligentGolfServiceCollectionExtensions.NoRedirectHttpClientName);
        var baseUri = new Uri(session.BaseUrl.TrimEnd('/') + "/", UriKind.Absolute);
        var currentUri = ResolveUri(baseUri, path);
        var referrerUri = ResolveUri(baseUri, referrerPath);
        var redirectUris = new List<Uri>();

        for (var redirectCount = 0; redirectCount <= 10; redirectCount++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, currentUri);
            request.Headers.Referrer = referrerUri;
            using var response = await client.SendAsync(request, cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);

            if (IsRedirect(response.StatusCode) && response.Headers.Location is not null)
            {
                if (redirectCount == 10)
                    throw new HttpRequestException("Intelligent Golf returned too many redirects.");

                var nextUri = response.Headers.Location.IsAbsoluteUri
                    ? response.Headers.Location
                    : new Uri(currentUri, response.Headers.Location);
                redirectUris.Add(nextUri);
                referrerUri = currentUri;
                currentUri = nextUri;
                continue;
            }

            var finalPath = currentUri.AbsolutePath;
            var requiresLogin = finalPath.EndsWith("/login.php", StringComparison.OrdinalIgnoreCase) ||
                                IntelligentGolfLoginService.RequiresMemberLogin(body) ||
                                body.Contains("Login Required", StringComparison.OrdinalIgnoreCase);
            if (!response.IsSuccessStatusCode && !requiresLogin)
            {
                var detail = SummariseFailure(body);
                var message = $"Intelligent Golf returned HTTP {(int)response.StatusCode} ({response.StatusCode}).";
                if (!string.IsNullOrWhiteSpace(detail)) message = $"{message} {detail}";
                throw new HttpRequestException(message, null, response.StatusCode);
            }

            return new RedirectAwareTransportResponse(body, currentUri, requiresLogin, redirectUris);
        }

        throw new HttpRequestException("Intelligent Golf redirect handling ended unexpectedly.");
    }

    private static Uri ResolveUri(Uri baseUri, string path) =>
        Uri.TryCreate(path, UriKind.Absolute, out var absoluteUri)
            ? absoluteUri
            : new Uri(baseUri, path.TrimStart('/'));

    private static bool IsRedirect(HttpStatusCode statusCode) => statusCode is
        HttpStatusCode.MovedPermanently or
        HttpStatusCode.Redirect or
        HttpStatusCode.RedirectMethod or
        HttpStatusCode.TemporaryRedirect or
        HttpStatusCode.PermanentRedirect;

    private async Task<IntelligentGolfTransportResponse> SendResponseAsync(
        Func<HttpRequestMessage> requestFactory,
        CancellationToken cancellationToken)
    {
        await session.EnsureAuthenticatedAsync(cancellationToken: cancellationToken);

        var firstResponse = await SendOnceAsync(requestFactory, cancellationToken);
        if (!firstResponse.RequiresLogin)
        {
            return new IntelligentGolfTransportResponse(firstResponse.Body, firstResponse.FinalUri);
        }

        logger.LogWarning("Intelligent Golf requested a new login; refreshing the shared session and retrying once.");
        await session.EnsureAuthenticatedAsync(forceRefresh: true, cancellationToken);

        var retryResponse = await SendOnceAsync(requestFactory, cancellationToken);
        if (retryResponse.RequiresLogin)
        {
            throw new IntelligentGolfAuthenticationException(
                "Intelligent Golf still requires login after the shared session was refreshed.");
        }

        return new IntelligentGolfTransportResponse(retryResponse.Body, retryResponse.FinalUri);
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
        AddAjaxHeaders(request);
        using var response = await client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        var finalUri = response.RequestMessage?.RequestUri;
        var finalPath = finalUri?.AbsolutePath ?? string.Empty;
        var requiresLogin = finalPath.EndsWith("/login.php", StringComparison.OrdinalIgnoreCase) ||
                            IntelligentGolfLoginService.RequiresMemberLogin(body) ||
                            body.Contains("Login Required", StringComparison.OrdinalIgnoreCase);

        if (!response.IsSuccessStatusCode && !requiresLogin)
        {
            var detail = SummariseFailure(body);
            var message = $"Intelligent Golf returned HTTP {(int)response.StatusCode} ({response.StatusCode}).";
            if (!string.IsNullOrWhiteSpace(detail)) message = $"{message} {detail}";
            throw new HttpRequestException(message, null, response.StatusCode);
        }

        return new TransportResponse(body, finalUri, requiresLogin);
    }

    private static string? SummariseFailure(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        try
        {
            using var json = JsonDocument.Parse(raw);
            if (json.RootElement.ValueKind == JsonValueKind.Object)
            {
                foreach (var name in new[] { "message", "error", "detail", "reason" })
                {
                    if (!json.RootElement.TryGetProperty(name, out var value)) continue;
                    var text = value.ValueKind == JsonValueKind.String ? value.GetString() : value.GetRawText();
                    if (!string.IsNullOrWhiteSpace(text)) return Truncate(text.Trim());
                }
            }
        }
        catch (JsonException)
        {
            // Legacy endpoints commonly return HTML.
        }

        var document = new HtmlDocument();
        document.LoadHtml(raw);
        var error = document.DocumentNode.SelectSingleNode(
            "//*[contains(@class,'alert-danger') or contains(@class,'user-message-error') or contains(@class,'error')]");
        var summary = System.Net.WebUtility.HtmlDecode(error?.InnerText ?? document.DocumentNode.InnerText);
        summary = System.Text.RegularExpressions.Regex.Replace(summary, @"\s+", " ").Trim();
        return string.IsNullOrWhiteSpace(summary) ? null : Truncate(summary);
    }

    private static string Truncate(string value) =>
        value.Length <= 500 ? value : $"{value[..500]}…";

    private static void AddAjaxHeaders(HttpRequestMessage request)
    {
        if (request.RequestUri is null ||
            !request.Headers.Contains("X-Requested-With"))
        {
            return;
        }

        // IG's browser endpoints are not a public API. Reproduce the headers its own
        // JavaScript sends so POST requests pass the same origin/referer checks.
        request.Headers.Accept.Clear();
        request.Headers.TryAddWithoutValidation("Accept", "*/*");
        request.Headers.TryAddWithoutValidation(
            "Origin",
            request.RequestUri.GetLeftPart(UriPartial.Authority));
        request.Headers.Referrer = BuildAjaxReferrer(request.RequestUri);
    }

    private static Uri BuildAjaxReferrer(Uri requestUri)
    {
        var builder = new UriBuilder(requestUri)
        {
            Query = string.Empty,
            Fragment = string.Empty
        };

        if (requestUri.AbsolutePath.EndsWith("/event.php", StringComparison.OrdinalIgnoreCase))
        {
            var eventId = System.Text.RegularExpressions.Regex.Match(
                requestUri.Query,
                @"(?:^|[?&])eventid=(\d+)(?:&|$)",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (eventId.Success)
            {
                builder.Query = $"eventid={eventId.Groups[1].Value}";
            }
        }

        return builder.Uri;
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

    private sealed record TransportResponse(string Body, Uri? FinalUri, bool RequiresLogin);

    private sealed record RedirectAwareTransportResponse(
        string Body,
        Uri FinalUri,
        bool RequiresLogin,
        IReadOnlyList<Uri> RedirectUris);
}
