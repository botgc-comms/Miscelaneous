using BOTGC.EventPlaybook.API.Features;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BOTGC.EventPlaybook.API.Tests.Features;

public sealed class EventPlannerTicketingTests
{
    private const string TicketAdminPath = "/event.php?eventid=4743&tab=ticket_admin";

    [Fact]
    public async Task SynchroniseTickets_ReproducesTheObservedSettingsAndTicketTypePosts()
    {
        var transport = CreateTransport(verificationHtml: "<main>100 tickets (Max 4 tickets per member, 0 per visitor) Member Adult visitor</main>");
        var handler = CreateHandler(transport);

        var result = await handler.Handle(
            new SynchronisePlannerTicketsCommand(CreateRequest()),
            CancellationToken.None);

        Assert.Equal(4743, result.IntelligentGolfEventId);
        Assert.Equal(2, result.TicketTypeCount);

        var settings = Assert.Single(transport.Calls, call =>
            call.Path.EndsWith("ajaxaction=editsettingsconfirm", StringComparison.Ordinal));
        Assert.Equal(HttpMethod.Post, settings.Method);
        Assert.Equal(
            [
                new KeyValuePair<string, string>("max_tickets", "100"),
                new KeyValuePair<string, string>("show_for_members", "on"),
                new KeyValuePair<string, string>("max_tickets_member", "4"),
                new KeyValuePair<string, string>("require_member_guest_details", "on"),
                new KeyValuePair<string, string>("max_tickets_visitor", "")
            ],
            settings.Fields);

        var ticketTypes = Assert.Single(transport.Calls, call =>
            call.Path.EndsWith("ajaxaction=edittickettypesconfirm", StringComparison.Ordinal));
        Assert.Equal(HttpMethod.Post, ticketTypes.Method);
        Assert.Equal(
            [
                new KeyValuePair<string, string>("name[]", "Member"),
                new KeyValuePair<string, string>("price[]", "0"),
                new KeyValuePair<string, string>("id[]", "81"),
                new KeyValuePair<string, string>("status[]", "Active"),
                new KeyValuePair<string, string>("name[]", "Adult visitor"),
                new KeyValuePair<string, string>("price[]", "30"),
                new KeyValuePair<string, string>("id[]", ""),
                new KeyValuePair<string, string>("status[]", "Active")
            ],
            ticketTypes.Fields);
    }

    [Fact]
    public async Task SynchroniseTickets_PostsEnabledVisitorAndOptionalSettingsUsingReturnedFieldNames()
    {
        var transport = CreateTransport(verificationHtml: "<main>100 tickets (Max 4 tickets per member, 2 per visitor) Member Adult visitor</main>");
        var request = CreateRequest() with
        {
            MembersPaymentDueOnEntry = true,
            AllowVisitorsOnline = true,
            MaximumTicketsPerVisitor = 2,
            AddOptions = true
        };

        await CreateHandler(transport).Handle(
            new SynchronisePlannerTicketsCommand(request),
            CancellationToken.None);

        var settings = Assert.Single(transport.Calls, call =>
            call.Path.EndsWith("ajaxaction=editsettingsconfirm", StringComparison.Ordinal));
        var fields = Assert.IsAssignableFrom<IReadOnlyCollection<KeyValuePair<string, string>>>(settings.Fields);
        Assert.Contains(new KeyValuePair<string, string>("members_payment_due_on_entry", "on"), fields);
        Assert.Contains(new KeyValuePair<string, string>("show_for_visitors", "on"), fields);
        Assert.Contains(new KeyValuePair<string, string>("max_tickets_visitor", "2"), fields);
        Assert.Contains(new KeyValuePair<string, string>("add_options", "on"), fields);
    }

    [Fact]
    public async Task SynchroniseTickets_DoesNotReportSuccessWhenIntelligentGolfDoesNotReturnTheSavedType()
    {
        var transport = CreateTransport(verificationHtml: "<main>100 tickets (Max 4 tickets per member, 0 per visitor) Member</main>");

        var exception = await Assert.ThrowsAsync<IntelligentGolfMutationException>(() =>
            CreateHandler(transport).Handle(
                new SynchronisePlannerTicketsCommand(CreateRequest()),
                CancellationToken.None));

        Assert.Equal("planner-ticket-verification", exception.Stage);
        Assert.Contains("Adult visitor", exception.ResponseDetail);
    }

    private static SynchronisePlannerTicketsHandler CreateHandler(IIntelligentGolfTransport transport) =>
        new(transport, new AlwaysAcquiredLockManager(), NullLogger<SynchronisePlannerTicketsHandler>.Instance);

    private static SynchronisePlannerTicketsRequest CreateRequest() =>
        new(
            "event-123",
            4743,
            100,
            AllowMembersOnline: true,
            MaximumTicketsPerMember: 4,
            RequireMemberGuestDetails: true,
            MembersPaymentDueOnEntry: false,
            AllowVisitorsOnline: false,
            MaximumTicketsPerVisitor: null,
            AddOptions: false,
            TicketTypes:
            [
                new PlannerTicketTypeRequest("Member", 0),
                new PlannerTicketTypeRequest("Adult visitor", 30)
            ]);

    private static RecordingTransport CreateTransport(string verificationHtml)
    {
        var verificationCount = 0;
        return new RecordingTransport(call => call.Path switch
        {
            TicketAdminPath => Response("<main>Ticket administration</main>"),
            TicketAdminPath + "&requestType=ajax&ajaxaction=editsettings" => Response(SettingsFormResponse),
            TicketAdminPath + "&requestType=ajax&ajaxaction=edittickettypes" => Response(TicketTypesFormResponse),
            TicketAdminPath + "&requestType=ajax&ajaxaction=editsettingsconfirm" => Response(SavedResponse),
            TicketAdminPath + "&requestType=ajax&ajaxaction=edittickettypesconfirm" => Response(SavedResponse),
            _ when call.Path.StartsWith(TicketAdminPath + "&eventPlaybookVerify=", StringComparison.Ordinal) =>
                Response(++verificationCount > 0 ? verificationHtml : string.Empty),
            _ => throw new Xunit.Sdk.XunitException($"Unexpected Intelligent Golf request: {call.Method} {call.Path}")
        });
    }

    private static IntelligentGolfTransportResponse Response(string body) => new(body, null, false);

    private const string SettingsFormResponse =
        "{\"actions\":[{\"type\":\"replacecontent\",\"html\":\"<form><input type='checkbox' name='require_member_guest_details'><input type='checkbox' name='members_payment_due_on_entry'><input type='checkbox' name='add_options'></form>\"}]}";

    private const string TicketTypesFormResponse =
        "{\"actions\":[{\"type\":\"replacecontent\",\"html\":\"<form><input name='name[]' value='Member'><input name='id[]' value='81'></form>\"}]}";

    private const string SavedResponse =
        "{\"actions\":[{\"type\":\"message\",\"data\":\"Ticket settings saved\"}]}";

    private sealed class RecordingTransport(
        Func<TransportCall, IntelligentGolfTransportResponse> responder) : IIntelligentGolfTransport
    {
        public List<TransportCall> Calls { get; } = [];

        public Task<T> ExecuteExclusiveAsync<T>(
            Func<CancellationToken, Task<T>> operation,
            CancellationToken cancellationToken = default) => operation(cancellationToken);

        public Task<IntelligentGolfTransportResponse> GetResponseAsync(
            string path,
            CancellationToken cancellationToken = default) => Record(HttpMethod.Get, path, null);

        public Task<IntelligentGolfTransportResponse> PostFormResponseAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            CancellationToken cancellationToken = default) => Record(HttpMethod.Post, path, fields.ToArray());

        public Task<IntelligentGolfTransportResponse> PostMultipartResponseAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            IntelligentGolfMultipartFile file,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<HtmlAgilityPack.HtmlDocument> GetDocumentAsync(
            string path,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<HtmlAgilityPack.HtmlDocument> PostFormDocumentAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<string> PostFormAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        private Task<IntelligentGolfTransportResponse> Record(
            HttpMethod method,
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>>? fields)
        {
            var call = new TransportCall(method, path, fields);
            Calls.Add(call);
            return Task.FromResult(responder(call));
        }
    }

    private sealed class AlwaysAcquiredLockManager : IDistributedLockManager
    {
        public Task<IDistributedLock> AcquireAsync(
            string resource,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IDistributedLock>(new AcquiredLock());

        private sealed class AcquiredLock : IDistributedLock
        {
            public bool IsAcquired => true;
            public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }

    private sealed record TransportCall(
        HttpMethod Method,
        string Path,
        IReadOnlyCollection<KeyValuePair<string, string>>? Fields);
}
