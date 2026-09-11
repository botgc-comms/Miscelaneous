using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using BOTGC.EventPlaybook.Services;
using Microsoft.Extensions.Options;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class IntelligentGolfMemberCommunicationsClientTests
{
    [Fact]
    public async Task SendToAddressesAsync_PostsOneAddressDeliveryRequestToThePrivateApi()
    {
        var requests = new List<CapturedRequest>();
        var handler = new RecordingHandler(async (request, cancellationToken) =>
        {
            requests.Add(await CaptureAsync(request, cancellationToken));
            return Json(HttpStatusCode.OK, new
            {
                requested = 2,
                sent = 2,
                deliveries = new[]
                {
                    new { recipientEmail = "alex@example.com", sent = true, error = (string?)null },
                    new { recipientEmail = "sam@example.com", sent = true, error = (string?)null }
                }
            });
        });
        var factory = new RecordingHttpClientFactory(handler);
        var session = new RecordingSessionClient();
        var plugins = new StubPluginSettingsStore(emailConfigured: true);
        var client = CreateClient(factory, session, plugins);

        var result = await client.SendToAddressesAsync(
            ["alex@example.com", "sam@example.com"],
            "Tasks requiring attention",
            "<p>Please review your tasks.</p>",
            CancellationToken.None);

        var request = Assert.Single(requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://private-api.example/api/members/emails", request.Uri.AbsoluteUri);
        Assert.Equal("application/json", request.ContentType);
        Assert.Equal("session-1", request.SessionToken);
        using var body = JsonDocument.Parse(request.Body);
        Assert.Equal(
            ["alex@example.com", "sam@example.com"],
            body.RootElement.GetProperty("recipientEmails").EnumerateArray().Select(item => item.GetString()!).ToArray());
        Assert.Equal("Tasks requiring attention", body.RootElement.GetProperty("subject").GetString());
        Assert.Equal("<p>Please review your tasks.</p>", body.RootElement.GetProperty("bodyHtml").GetString());
        Assert.Equal(2, result.Requested);
        Assert.Equal(2, result.Sent);
        Assert.Equal(2, result.Deliveries.Count);
        Assert.Equal(IntelligentGolfApiSessionClient.HttpClientName, Assert.Single(factory.ClientNames));
        Assert.Equal(1, session.AuthorizeCalls);
        Assert.Equal(0, session.ClearCalls);
        Assert.Equal(1, plugins.OverviewCalls);
    }

    [Fact]
    public async Task SendToAddressesAsync_RebuildsAndReauthorizesTheRequestOnceAfterUnauthorized()
    {
        var requests = new List<CapturedRequest>();
        var requestInstances = new List<HttpRequestMessage>();
        var handler = new RecordingHandler(async (request, cancellationToken) =>
        {
            requestInstances.Add(request);
            requests.Add(await CaptureAsync(request, cancellationToken));
            return requests.Count == 1
                ? Json(HttpStatusCode.Unauthorized, new { title = "A valid Intelligent Golf session is required." })
                : Json(HttpStatusCode.OK, new
                {
                    requested = 1,
                    sent = 1,
                    deliveries = new[]
                    {
                        new { recipientEmail = "alex@example.com", sent = true, error = (string?)null }
                    }
                });
        });
        var factory = new RecordingHttpClientFactory(handler);
        var session = new RecordingSessionClient();
        var client = CreateClient(factory, session, new StubPluginSettingsStore(emailConfigured: true));

        var result = await client.SendToAddressesAsync(
            ["alex@example.com"],
            "Task reminder",
            "<p>One task is due.</p>",
            CancellationToken.None);

        Assert.Equal(2, requests.Count);
        Assert.NotSame(requestInstances[0], requestInstances[1]);
        Assert.Equal(requests[0].Uri, requests[1].Uri);
        Assert.Equal(requests[0].Body, requests[1].Body);
        Assert.Equal("session-1", requests[0].SessionToken);
        Assert.Equal("session-2", requests[1].SessionToken);
        Assert.Equal(2, session.AuthorizeCalls);
        Assert.Equal(1, session.ClearCalls);
        Assert.Equal(1, result.Sent);
    }

    [Fact]
    public async Task SendToAddressesAsync_ReturnsPartialDeliveryDetails()
    {
        var handler = new RecordingHandler((_, _) => Task.FromResult(Json(HttpStatusCode.BadGateway, new
        {
            requested = 2,
            sent = 1,
            deliveries = new[]
            {
                new { recipientEmail = "alex@example.com", sent = true, error = (string?)null },
                new { recipientEmail = "sam@example.com", sent = false, error = (string?)"Intelligent Golf did not accept the email request." }
            }
        })));
        var client = CreateClient(
            new RecordingHttpClientFactory(handler),
            new RecordingSessionClient(),
            new StubPluginSettingsStore(emailConfigured: true));

        var result = await client.SendToAddressesAsync(
            ["alex@example.com", "sam@example.com"],
            "Task reminder",
            "<p>Tasks</p>",
            CancellationToken.None);

        Assert.Equal(2, result.Requested);
        Assert.Equal(1, result.Sent);
        Assert.False(result.Deliveries.Single(item => item.RecipientEmail == "sam@example.com").Sent);
    }

    [Fact]
    public async Task SendToAddressesAsync_RejectsMissingEmailSenderConfigurationBeforeAuthorizing()
    {
        var handler = new RecordingHandler((_, _) =>
            throw new Xunit.Sdk.XunitException("The private API must not be called."));
        var session = new RecordingSessionClient();
        var client = CreateClient(
            new RecordingHttpClientFactory(handler),
            session,
            new StubPluginSettingsStore(emailConfigured: false));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => client.SendToAddressesAsync(
            ["alex@example.com"],
            "Task reminder",
            "<p>Tasks</p>",
            CancellationToken.None));

        Assert.Equal("The Intelligent Golf email sender must be configured before emailing members.", exception.Message);
        Assert.Equal(0, session.AuthorizeCalls);
    }

    private static IntelligentGolfMemberCommunicationsClient CreateClient(
        IHttpClientFactory factory,
        IIntelligentGolfApiSessionClient session,
        IPluginSettingsStore plugins) =>
        new(
            factory,
            session,
            plugins,
            Microsoft.Extensions.Options.Options.Create(new EventPlaybookApiOptions
            {
                BaseUrl = "https://private-api.example",
                ApiKey = "private-api-key"
            }));

    private static async Task<CapturedRequest> CaptureAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var body = request.Content is null
            ? string.Empty
            : await request.Content.ReadAsStringAsync(cancellationToken);
        var sessionToken = request.Headers.TryGetValues(IntelligentGolfApiSessionClient.SessionHeaderName, out var values)
            ? values.Single()
            : null;
        return new CapturedRequest(
            request.Method,
            request.RequestUri!,
            request.Content?.Headers.ContentType?.MediaType,
            sessionToken,
            body);
    }

    private static HttpResponseMessage Json(HttpStatusCode statusCode, object value) =>
        new(statusCode) { Content = JsonContent.Create(value) };

    private sealed record CapturedRequest(
        HttpMethod Method,
        Uri Uri,
        string? ContentType,
        string? SessionToken,
        string Body);

    private sealed class RecordingHandler(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> responder) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            responder(request, cancellationToken);
    }

    private sealed class RecordingHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public List<string> ClientNames { get; } = [];

        public HttpClient CreateClient(string name)
        {
            ClientNames.Add(name);
            return new HttpClient(handler, disposeHandler: false);
        }
    }

    private sealed class RecordingSessionClient : IIntelligentGolfApiSessionClient
    {
        public int AuthorizeCalls { get; private set; }
        public int ClearCalls { get; private set; }

        public Task ConnectAsync(
            IntelligentGolfPluginCredentials credentials,
            CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public Task AuthorizeAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            AuthorizeCalls++;
            request.Headers.Add(IntelligentGolfApiSessionClient.SessionHeaderName, $"session-{AuthorizeCalls}");
            return Task.CompletedTask;
        }

        public void Clear() => ClearCalls++;
    }

    private sealed class StubPluginSettingsStore(bool emailConfigured) : IPluginSettingsStore
    {
        public int OverviewCalls { get; private set; }

        public Task<PluginSettingsOverview> GetOverviewAsync(CancellationToken cancellationToken)
        {
            OverviewCalls++;
            return Task.FromResult(new PluginSettingsOverview
            {
                IntelligentGolf = new IntelligentGolfPluginSummary
                {
                    Enabled = true,
                    Configured = true,
                    EmailConfigured = emailConfigured
                },
                Monday = new MondayPluginSummary()
            });
        }

        public Task<IntelligentGolfPluginSummary> SaveIntelligentGolfAsync(
            SaveIntelligentGolfPluginRequest request,
            CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<IntelligentGolfPluginCredentials> ResolveIntelligentGolfCredentialsAsync(
            SaveIntelligentGolfPluginRequest request,
            CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<IntelligentGolfPluginCredentials?> GetIntelligentGolfCredentialsAsync(
            CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<MondayPluginSummary> SaveMondayAsync(
            SaveMondayPluginRequest request,
            CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<PluginSettingsOverview> SetEnabledAsync(
            string pluginId,
            bool enabled,
            CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<PluginSettingsOverview> DisconnectAsync(
            string pluginId,
            CancellationToken cancellationToken) => throw new NotSupportedException();
    }
}
