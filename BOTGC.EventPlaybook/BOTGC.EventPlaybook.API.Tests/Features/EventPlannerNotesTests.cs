using System.Text.Json;
using BOTGC.EventPlaybook.API.Features;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BOTGC.EventPlaybook.API.Tests.Features;

public sealed class EventPlannerNotesTests
{
    private const string NotesPath = "/event.php?eventid=4743&tab=notes";
    private const string SavePath = NotesPath + "&requestType=ajax&ajaxaction=savenote";

    [Fact]
    public async Task SynchroniseNote_ReproducesTheObservedNonActionNotePostAndThenUpdatesIt()
    {
        var savedNote = string.Empty;
        var transport = new RecordingTransport(call =>
        {
            if (call.Method == HttpMethod.Post && call.Path == SavePath)
            {
                savedNote = Assert.Single(call.Fields!, field => field.Key == "note").Value;
                return Response("{\"actions\":[{\"type\":\"message\",\"data\":\"Note saved\"}]}");
            }
            if (call.Method == HttpMethod.Get && call.Path.StartsWith(NotesPath, StringComparison.Ordinal))
            {
                return Response(string.IsNullOrWhiteSpace(savedNote)
                    ? "<main>No notes</main>"
                    : $"<form><input name='noteid' value='912'><textarea>{System.Net.WebUtility.HtmlEncode(savedNote)}</textarea></form>");
            }
            throw new Xunit.Sdk.XunitException($"Unexpected Intelligent Golf request: {call.Method} {call.Path}");
        });
        var cache = new JsonCache();
        var handler = CreateHandler(transport, cache);

        var created = await handler.Handle(
            new SynchronisePlannerNoteCommand(new SynchronisePlannerNoteRequest(
                "event-123",
                4743,
                "EVENT PLAYBOOK — OPERATIONAL PLANNING SUMMARY\nRooms/areas: Peacock Lounge")),
            CancellationToken.None);

        Assert.True(created.Created);
        Assert.Equal(912, created.IntelligentGolfNoteId);
        var createPost = Assert.Single(transport.Calls, call => call.Method == HttpMethod.Post);
        Assert.Equal(
            [
                new KeyValuePair<string, string>("noteid", string.Empty),
                new KeyValuePair<string, string>("member_id", string.Empty),
                new KeyValuePair<string, string>("eventid", "4743"),
                new KeyValuePair<string, string>("actiontype", "0"),
                new KeyValuePair<string, string>("followupdate", string.Empty),
                new KeyValuePair<string, string>("assigned_userid", "83642")
            ],
            createPost.Fields!.Where(field => field.Key != "note"));
        Assert.Contains("Rooms/areas: Peacock Lounge", savedNote, StringComparison.Ordinal);
        Assert.Contains("Managed by Event Playbook · event event-123 · revision", savedNote, StringComparison.Ordinal);

        transport.Calls.Clear();
        var updated = await handler.Handle(
            new SynchronisePlannerNoteCommand(new SynchronisePlannerNoteRequest(
                "event-123",
                4743,
                "EVENT PLAYBOOK — OPERATIONAL PLANNING SUMMARY\nRooms/areas: Peacock Lounge, Spike Bar")),
            CancellationToken.None);

        Assert.False(updated.Created);
        var updatePost = Assert.Single(transport.Calls, call => call.Method == HttpMethod.Post);
        Assert.Equal("912", Assert.Single(updatePost.Fields!, field => field.Key == "noteid").Value);
        Assert.Contains("Spike Bar", savedNote, StringComparison.Ordinal);
    }

    [Fact]
    public void FindManagedNoteId_ReadsTheNoteContainingTheStableEventMarker()
    {
        const string html = "<form><input value='912' name='noteid'><textarea>[Managed by Event Playbook · event event-123 · revision ABC]</textarea></form>";

        Assert.Equal(912, SynchronisePlannerNoteHandler.FindManagedNoteId(
            html,
            "Managed by Event Playbook · event event-123"));
    }

    private static SynchronisePlannerNoteHandler CreateHandler(
        IIntelligentGolfTransport transport,
        ICacheService cache) =>
        new(
            transport,
            new AuthenticatedSession(),
            cache,
            new AlwaysAcquiredLockManager(),
            NullLogger<SynchronisePlannerNoteHandler>.Instance);

    private static IntelligentGolfTransportResponse Response(string body) => new(body, null, false);

    private sealed class RecordingTransport(
        Func<TransportCall, IntelligentGolfTransportResponse> responder) : IIntelligentGolfTransport
    {
        public List<TransportCall> Calls { get; } = [];

        public Task<T> ExecuteExclusiveAsync<T>(Func<CancellationToken, Task<T>> operation, CancellationToken cancellationToken = default) =>
            operation(cancellationToken);

        public Task<IntelligentGolfTransportResponse> GetResponseAsync(string path, CancellationToken cancellationToken = default) =>
            Record(new TransportCall(HttpMethod.Get, path, null));

        public Task<IntelligentGolfTransportResponse> PostFormResponseAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            CancellationToken cancellationToken = default) =>
            Record(new TransportCall(HttpMethod.Post, path, fields.ToArray()));

        public Task<IntelligentGolfTransportResponse> PostMultipartResponseAsync(string path, IReadOnlyCollection<KeyValuePair<string, string>> fields, IntelligentGolfMultipartFile file, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<HtmlAgilityPack.HtmlDocument> GetDocumentAsync(string path, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<HtmlAgilityPack.HtmlDocument> PostFormDocumentAsync(string path, IReadOnlyCollection<KeyValuePair<string, string>> fields, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<string> PostFormAsync(string path, IReadOnlyCollection<KeyValuePair<string, string>> fields, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        private Task<IntelligentGolfTransportResponse> Record(TransportCall call)
        {
            Calls.Add(call);
            return Task.FromResult(responder(call));
        }
    }

    private sealed record TransportCall(
        HttpMethod Method,
        string Path,
        IReadOnlyCollection<KeyValuePair<string, string>>? Fields);

    private sealed class JsonCache : ICacheService
    {
        private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
        private readonly Dictionary<string, string> _values = new(StringComparer.Ordinal);

        public Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken = default) where T : class =>
            Task.FromResult(_values.TryGetValue(key, out var value) ? JsonSerializer.Deserialize<T>(value, Options) : null);

        public Task SetAsync<T>(string key, T value, TimeSpan expiration, CancellationToken cancellationToken = default) where T : class
        {
            _values[key] = JsonSerializer.Serialize(value, Options);
            return Task.CompletedTask;
        }

        public Task RemoveAsync(string key, CancellationToken cancellationToken = default)
        {
            _values.Remove(key);
            return Task.CompletedTask;
        }
    }

    private sealed class AlwaysAcquiredLockManager : IDistributedLockManager
    {
        public Task<IDistributedLock> AcquireAsync(string resource, CancellationToken cancellationToken = default) =>
            Task.FromResult<IDistributedLock>(new AcquiredLock());

        private sealed class AcquiredLock : IDistributedLock
        {
            public bool IsAcquired => true;
            public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }

    private sealed class AuthenticatedSession : IIntelligentGolfSession
    {
        public IntelligentGolfSessionStatus Status { get; } = new(true, null, DateTimeOffset.UtcNow, null);
        public string BaseUrl => "https://www.botgc.co.uk/";
        public string? MemberId => "83642";
        public IntelligentGolfEmailSenderIdentity EmailSender { get; } = new(null, null, null);
        public Task<IntelligentGolfSessionGrant> AuthenticateAsync(IntelligentGolfCredentials credentials, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task EnsureAuthenticatedAsync(bool forceRefresh = false, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public bool IsSessionTokenValid(string? token) => true;
    }
}
