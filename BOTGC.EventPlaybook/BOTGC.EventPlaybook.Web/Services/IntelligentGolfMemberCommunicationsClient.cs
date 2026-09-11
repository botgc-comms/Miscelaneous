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
    Task<AddressEmailDeliveryResult> SendToAddressesAsync(
        IReadOnlyCollection<string> recipientEmails,
        string subject,
        string bodyHtml,
        CancellationToken cancellationToken);
    Task<MemberCampaignEmailResult> SendCampaignAsync(MemberCampaignEmailRequest request, CancellationToken cancellationToken);
}

public sealed class AddressEmailDeliveryResult
{
    public int Requested { get; init; }
    public int Sent { get; init; }
    public IReadOnlyList<AddressEmailDelivery> Deliveries { get; init; } = [];
}

public sealed class AddressEmailDelivery
{
    public required string RecipientEmail { get; init; }
    public bool Sent { get; init; }
    public string? Error { get; init; }
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
        using var response = await SendAsync(
            () => CreateRequest(HttpMethod.Get, $"api/members?refresh={refresh.ToString().ToLowerInvariant()}"),
            requireEmailConfiguration: false,
            returnDeliveryFailureResponse: false,
            cancellationToken);
        var result = await response.Content.ReadFromJsonAsync<List<MemberDirectoryEntry>>(JsonOptions, cancellationToken);
        return result ?? [];
    }

    public async Task SendTestAsync(MemberEmailTestRequest request, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(
            () => CreateJsonRequest(
                "api/members/emails/test",
                new
                {
                    recipientEmails = new[] { request.RecipientEmail },
                    request.Subject,
                    request.BodyHtml
                }),
            requireEmailConfiguration: true,
            returnDeliveryFailureResponse: false,
            cancellationToken);
    }

    public async Task<AddressEmailDeliveryResult> SendToAddressesAsync(
        IReadOnlyCollection<string> recipientEmails,
        string subject,
        string bodyHtml,
        CancellationToken cancellationToken)
    {
        using var response = await SendAsync(
            () => CreateJsonRequest(
                "api/members/emails",
                new
                {
                    recipientEmails,
                    subject,
                    bodyHtml
                }),
            requireEmailConfiguration: true,
            returnDeliveryFailureResponse: true,
            cancellationToken);

        return await response.Content.ReadFromJsonAsync<AddressEmailDeliveryResult>(JsonOptions, cancellationToken)
            ?? throw new InvalidOperationException("The Event Playbook API did not return an email delivery result.");
    }

    public async Task<MemberCampaignEmailResult> SendCampaignAsync(
        MemberCampaignEmailRequest request,
        CancellationToken cancellationToken)
    {
        using var response = await SendAsync(
            () => CreateJsonRequest("api/members/emails/campaign", request),
            requireEmailConfiguration: true,
            returnDeliveryFailureResponse: false,
            cancellationToken);
        return await response.Content.ReadFromJsonAsync<MemberCampaignEmailResult>(JsonOptions, cancellationToken)
            ?? throw new InvalidOperationException("The Event Playbook API did not return an email delivery result.");
    }

    private HttpRequestMessage CreateJsonRequest<T>(string relativePath, T value)
    {
        var request = CreateRequest(HttpMethod.Post, relativePath);
        request.Content = JsonContent.Create(value);
        return request;
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

    private async Task<HttpResponseMessage> SendAsync(
        Func<HttpRequestMessage> requestFactory,
        bool requireEmailConfiguration,
        bool returnDeliveryFailureResponse,
        CancellationToken cancellationToken)
    {
        var plugins = await pluginSettingsStore.GetOverviewAsync(cancellationToken);
        if (!plugins.IntelligentGolf.Enabled || !plugins.IntelligentGolf.Configured)
        {
            throw new InvalidOperationException("The Intelligent Golf plugin must be configured and switched on before emailing members.");
        }
        if (requireEmailConfiguration && !plugins.IntelligentGolf.EmailConfigured)
        {
            throw new InvalidOperationException("The Intelligent Golf email sender must be configured before emailing members.");
        }

        var client = httpClientFactory.CreateClient(IntelligentGolfApiSessionClient.HttpClientName);
        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var request = requestFactory();
            await sessionClient.AuthorizeAsync(request, cancellationToken);
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

            if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized && attempt == 0)
            {
                response.Dispose();
                sessionClient.Clear();
                continue;
            }

            if (response.IsSuccessStatusCode ||
                (returnDeliveryFailureResponse && response.StatusCode == System.Net.HttpStatusCode.BadGateway))
            {
                return response;
            }

            var statusCode = (int)response.StatusCode;
            var raw = await response.Content.ReadAsStringAsync(cancellationToken);
            response.Dispose();
            throw new InvalidOperationException(ExtractError(raw) ?? $"The member communications request failed ({statusCode}).");
        }

        throw new InvalidOperationException("The member communications request could not be authorised.");
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
