using BOTGC.EventPlaybook.API.Features;
using BOTGC.EventPlaybook.API.Features.Members;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using HtmlAgilityPack;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BOTGC.EventPlaybook.API.Tests.Features;

public sealed class EventPlannerBookingsTests
{
    [Fact]
    public async Task Handler_ReadsTheExistingTicketAdminPageThroughTheReportClient()
    {
        var reports = new RecordingReportClient();
        var parser = new IntelligentGolfPlannerTicketBookingParser(
            NullLogger<IntelligentGolfPlannerTicketBookingParser>.Instance);
        var handler = new GetPlannerTicketBookingsHandler(reports, parser);

        await handler.Handle(new GetPlannerTicketBookingsQuery(4743, true), CancellationToken.None);

        Assert.Equal("/event.php?eventid=4743&tab=ticket_admin", reports.Path);
        Assert.Equal("event-planner:ticket-bookings:4743", reports.CacheKey);
        Assert.True(reports.Refresh);
    }

    [Fact]
    public async Task Parser_ReadsCurrentMemberBookingAndPlayerIdentityFromTicketAdminTable()
    {
        var document = new HtmlDocument();
        document.LoadHtml("""
            <div id="ticketBookingContainer">
              <div id="ticketBookingPDFContent">
                <table class="table table-striped sortableTable">
                  <thead><tr>
                    <th></th><th>Booker</th><th>Email Address</th><th>Phone</th><th>Tickets</th>
                    <th>Price</th><th>Booked At</th><th>Reference Number</th><th>Type</th><th>Paid</th><th>Notes</th><th></th>
                  </tr></thead>
                  <tbody><tr>
                    <input type="hidden" name="member" value="83642">
                    <td><a data-ajax-data-inline-bookingid="1809"></a></td>
                    <td title="Booking Reference: TK-834222DD">Simon Parsons</td>
                    <td></td><td></td>
                    <td><dl><dt>1 <i>(Member×1)<div>Simon Parsons: </div></i><div class="pdfprintonly"> - Simon Parsons</div></dt></dl></td>
                    <td><i>Free</i></td><td>19 Sep 08:22</td><td>TK-834222DD</td><td>member</td>
                    <td><span title="Not Paid" data-csv-content="Not Paid"></span></td><td></td>
                    <td><a data-ajax-data-inline-ticketbookingid="1809"></a></td>
                  </tr></tbody>
                </table>
              </div>
            </div>
            """);
        var parser = new IntelligentGolfPlannerTicketBookingParser(
            NullLogger<IntelligentGolfPlannerTicketBookingParser>.Instance);

        var booking = Assert.Single(await parser.ParseAsync(document));

        Assert.Equal(1809, booking.BookingId);
        Assert.Equal(83642, booking.BookerIntelligentGolfUserId);
        Assert.Equal("Simon Parsons", booking.BookerName);
        Assert.Equal("TK-834222DD", booking.BookingReference);
        Assert.Equal("member", booking.BookingType);
        Assert.Equal(1, booking.TicketCount);
        Assert.Equal(["Simon Parsons"], booking.TicketHolderNames);
        Assert.Equal("Free", booking.Price);
        Assert.Equal("Not Paid", booking.PaymentStatus);
        Assert.Equal("19 Sep 08:22", booking.BookedAt);
    }

    [Fact]
    public void Enricher_MapsPlayerIdToMemberNumberAndEmailWithoutNameGuessing()
    {
        var booking = new PlannerTicketBookingRecord(
            1809,
            83642,
            "Simon Parsons",
            null,
            null,
            "TK-834222DD",
            "member",
            1,
            ["Simon Parsons"],
            "Free",
            "Not Paid",
            "19 Sep 08:22",
            null);
        var member = new MemberSummary(
            3104,
            83642,
            null,
            "Simon",
            "Parsons",
            "Simon Parsons",
            "simon@example.test",
            "Full Member",
            "R",
            null,
            true);

        var result = PlannerTicketBookingEnricher.Enrich(4743, [booking], [member]);
        var enriched = Assert.Single(result.Bookings);

        Assert.Equal(3104, enriched.BookerMemberNumber);
        Assert.Equal(83642, enriched.BookerIntelligentGolfUserId);
        Assert.True(enriched.IsMember);
        Assert.True(enriched.MemberMatched);
        Assert.True(enriched.IsActiveMember);
        Assert.Equal("simon@example.test", enriched.BookerEmail);
        Assert.Equal(1, result.MemberBookingsWithEmailCount);
    }

    [Fact]
    public async Task Parser_DoesNotReadDeletedBookingsFromSeparateContainer()
    {
        var document = new HtmlDocument();
        document.LoadHtml("""
            <div id="ticketBookingContainer"><table><thead><tr><th>Booker</th><th>Type</th></tr></thead>
              <tbody><tr><input name="member" value="83642"><td>Simon Parsons</td><td>member</td></tr></tbody></table></div>
            <div id="deletedBookingContainer"><table><thead><tr><th>Booker</th><th>Type</th></tr></thead>
              <tbody><tr><input name="member" value="99999"><td>Deleted Booker</td><td>member</td></tr></tbody></table></div>
            """);
        var parser = new IntelligentGolfPlannerTicketBookingParser(
            NullLogger<IntelligentGolfPlannerTicketBookingParser>.Instance);

        var booking = Assert.Single(await parser.ParseAsync(document));

        Assert.Equal("Simon Parsons", booking.BookerName);
        Assert.Equal(83642, booking.BookerIntelligentGolfUserId);
    }

    private sealed class RecordingReportClient : IIntelligentGolfReportClient
    {
        public string? Path { get; private set; }
        public string? CacheKey { get; private set; }
        public bool Refresh { get; private set; }

        public Task<IReadOnlyList<T>> GetAsync<T>(
            string path,
            IIntelligentGolfReportParser<T> parser,
            string cacheKey,
            TimeSpan cacheTtl,
            bool refresh = false,
            CancellationToken cancellationToken = default)
        {
            Path = path;
            CacheKey = cacheKey;
            Refresh = refresh;
            return Task.FromResult<IReadOnlyList<T>>([]);
        }

        public Task<IReadOnlyList<T>> PostAsync<T>(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            IIntelligentGolfReportParser<T> parser,
            string cacheKey,
            TimeSpan cacheTtl,
            bool refresh = false,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
