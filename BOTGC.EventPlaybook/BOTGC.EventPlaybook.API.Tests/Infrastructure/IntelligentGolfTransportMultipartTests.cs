using System.Net;
using System.Text;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BOTGC.EventPlaybook.API.Tests.Infrastructure;

public sealed class IntelligentGolfTransportMultipartTests
{
    [Fact]
    public async Task PostMultipart_ReproducesTheIntelligentGolfAjaxUploadRequest()
    {
        var handler = new RecordingHandler();
        var client = new HttpClient(handler);
        var transport = new IntelligentGolfTransport(
            new SingleClientFactory(client),
            new AuthenticatedSession("https://www.botgc.co.uk/"),
            new IntelligentGolfSessionOperationGate(),
            NullLogger<IntelligentGolfTransport>.Instance);
        byte[] png = [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3];

        await transport.PostMultipartResponseAsync(
            "/event.php?eventid=4743&requestType=ajax&ajaxaction=eventimageupload",
            [new("name", "the-2027-forum-social.png"), new("undefined", "undefined")],
            new IntelligentGolfMultipartFile(
                "file",
                "the-2027-forum-social.png",
                "image/png",
                png),
            CancellationToken.None);

        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal(
            "https://www.botgc.co.uk/event.php?eventid=4743&requestType=ajax&ajaxaction=eventimageupload",
            request.Uri.ToString());
        Assert.Equal("XMLHttpRequest", Assert.Single(request.RequestedWith));
        Assert.Equal("*/*", Assert.Single(request.Accept));
        Assert.Equal("https://www.botgc.co.uk", request.Origin);
        Assert.Equal("https://www.botgc.co.uk/event.php?eventid=4743", request.Referrer?.ToString());
        Assert.StartsWith("multipart/form-data; boundary=", request.ContentType, StringComparison.OrdinalIgnoreCase);

        var body = Encoding.GetEncoding(28591).GetString(request.Body);
        var nameIndex = FindDisposition(body, "name");
        var undefinedIndex = FindDisposition(body, "undefined");
        var fileIndex = FindDisposition(body, "file");
        Assert.True(nameIndex >= 0);
        Assert.True(undefinedIndex > nameIndex);
        Assert.True(fileIndex > undefinedIndex);
        Assert.Contains("the-2027-forum-social.png", body, StringComparison.Ordinal);
        Assert.Contains("Content-Type: image/png", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Content-Type: text/plain", body, StringComparison.OrdinalIgnoreCase);
        Assert.True(request.Body.AsSpan().IndexOf(png) >= 0);
    }

    [Fact]
    public async Task PostForm_ReproducesTheIntelligentGolfEventDetailsSaveRequest()
    {
        var handler = new RecordingHandler();
        var client = new HttpClient(handler);
        var transport = new IntelligentGolfTransport(
            new SingleClientFactory(client),
            new AuthenticatedSession("https://www.botgc.co.uk/"),
            new IntelligentGolfSessionOperationGate(),
            NullLogger<IntelligentGolfTransport>.Instance);

        await transport.PostFormResponseAsync(
            "/event.php?eventid=4743&requestType=ajax&ajaxaction=eventdetailssave",
            [new("description", string.Empty)],
            CancellationToken.None);

        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal(
            "https://www.botgc.co.uk/event.php?eventid=4743&requestType=ajax&ajaxaction=eventdetailssave",
            request.Uri.ToString());
        Assert.Equal("XMLHttpRequest", Assert.Single(request.RequestedWith));
        Assert.Equal("*/*", Assert.Single(request.Accept));
        Assert.Equal("https://www.botgc.co.uk", request.Origin);
        Assert.Equal("https://www.botgc.co.uk/event.php?eventid=4743", request.Referrer?.ToString());
        Assert.StartsWith(
            "application/x-www-form-urlencoded",
            request.ContentType,
            StringComparison.OrdinalIgnoreCase);
        Assert.Equal("description=", Encoding.UTF8.GetString(request.Body));
    }

    private static int FindDisposition(string body, string fieldName)
    {
        var quoted = body.IndexOf($"name=\"{fieldName}\"", StringComparison.Ordinal);
        return quoted >= 0
            ? quoted
            : body.IndexOf($"name={fieldName}", StringComparison.Ordinal);
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public List<RecordedRequest> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Requests.Add(new RecordedRequest(
                request.Method,
                request.RequestUri!,
                request.Headers.TryGetValues("X-Requested-With", out var requestedWith)
                    ? requestedWith.ToArray()
                    : [],
                request.Headers.Accept.Select(value => value.ToString()).ToArray(),
                request.Headers.TryGetValues("Origin", out var origins) ? origins.SingleOrDefault() : null,
                request.Headers.Referrer,
                request.Content?.Headers.ContentType?.ToString() ?? string.Empty,
                request.Content is null
                    ? []
                    : await request.Content.ReadAsByteArrayAsync(cancellationToken)));

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(string.Empty)
            };
        }
    }

    private sealed class SingleClientFactory(HttpClient client) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => client;
    }

    private sealed class AuthenticatedSession(string baseUrl) : IIntelligentGolfSession
    {
        public IntelligentGolfSessionStatus Status { get; } = new(true, null, DateTimeOffset.UtcNow, null);
        public string BaseUrl { get; } = baseUrl;
        public string? MemberId => "test-member";
        public IntelligentGolfEmailSenderIdentity EmailSender { get; } = new(null, null, null);

        public Task<IntelligentGolfSessionGrant> AuthenticateAsync(
            IntelligentGolfCredentials credentials,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task EnsureAuthenticatedAsync(
            bool forceRefresh = false,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public bool IsSessionTokenValid(string? token) => true;
    }

    private sealed record RecordedRequest(
        HttpMethod Method,
        Uri Uri,
        IReadOnlyList<string> RequestedWith,
        IReadOnlyList<string> Accept,
        string? Origin,
        Uri? Referrer,
        string ContentType,
        byte[] Body);
}
