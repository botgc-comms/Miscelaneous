using System.Net.Http.Json;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.Services;

public interface IIntelligentGolfMemberCommunicationsClient
{
    Task<IReadOnlyList<MemberDirectoryEntry>> GetMembersAsync(bool refresh, CancellationToken cancellationToken);
    Task SendTestAsync(MemberEmailTestRequest request, CancellationToken cancellationToken);
    Task<MemberCampaignEmailResult> SendCampaignAsync(MemberCampaignEmailRequest request, CancellationToken cancellationToken);
}

public sealed class IntelligentGolfMemberCommunicationsClient(
    IHttpClientFactory httpClientFactory,
    IIntelligentGolfApiSessionClient sessionClient,
    IPluginSettingsStore pluginSettingsStore,
    IOptions<EventPlaybookApiOptions> options) : IIntelligentGolfMemberCommunicationsClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<IReadOnlyList<MemberDirectoryEntry>> GetMembersAsync(
        bool refresh,
        CancellationToken cancellationToken)
    {
        using var request = CreateRequest(HttpMethod.Get, $"api/members?refresh={refresh.ToString().ToLowerInvariant()}");
        using var response = await SendAsync(request, cancellationToken);
        var result = await response.Content.ReadFromJsonAsync<List<MemberDirectoryEntry>>(JsonOptions, cancellationToken);
        return result ?? [];
    }

    public async Task SendTestAsync(MemberEmailTestRequest request, CancellationToken cancellationToken)
    {
        using var message = CreateRequest(HttpMethod.Post, "api/members/emails/test");
        message.Content = JsonContent.Create(new
        {
            recipientEmails = new[] { request.RecipientEmail },
            request.Subject,
            request.BodyHtml
        });
        using var response = await SendAsync(message, cancellationToken);
    }

    public async Task<MemberCampaignEmailResult> SendCampaignAsync(
        MemberCampaignEmailRequest request,
        CancellationToken cancellationToken)
    {
        using var message = CreateRequest(HttpMethod.Post, "api/members/emails/campaign");
        message.Content = JsonContent.Create(request);
        using var response = await SendAsync(message, cancellationToken);
        return await response.Content.ReadFromJsonAsync<MemberCampaignEmailResult>(JsonOptions, cancellationToken)
            ?? throw new InvalidOperationException("The Event Playbook API did not return an email delivery result.");
    }

    private HttpRequestMessage CreateRequest(HttpMethod method, string relativePath)
    {
        var settings = options.Value;
        if (!Uri.TryCreate(settings.BaseUrl?.TrimEnd('/') + "/", UriKind.Absolute, out var baseUri) ||
            string.IsNullOrWhiteSpace(settings.ApiKey))
        {
            throw new InvalidOperationException("The Event Playbook API connection is not configured.");
        }

        return new HttpRequestMessage(method, new Uri(baseUri, relativePath));
    }

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var plugins = await pluginSettingsStore.GetOverviewAsync(cancellationToken);
        if (!plugins.IntelligentGolf.Enabled || !plugins.IntelligentGolf.Configured)
        {
            throw new InvalidOperationException("The Intelligent Golf plugin must be configured and switched on before emailing members.");
        }

        await sessionClient.AuthorizeAsync(request, cancellationToken);
        var client = httpClientFactory.CreateClient(IntelligentGolfApiSessionClient.HttpClientName);
        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request, cancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new InvalidOperationException("The Event Playbook API did not respond in time.");
        }
        catch (HttpRequestException exception)
        {
            throw new InvalidOperationException("The Event Playbook API could not be reached.", exception);
        }

        if (response.IsSuccessStatusCode) return response;
        var statusCode = (int)response.StatusCode;
        var raw = await response.Content.ReadAsStringAsync(cancellationToken);
        response.Dispose();
        throw new InvalidOperationException(ExtractError(raw) ?? $"The member communications request failed ({statusCode}).");
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
            // Prefer the concise status-code fallback to an upstream HTML response.
        }
        return null;
    }
}
