using System.Globalization;
using System.Text.RegularExpressions;
using BOTGC.EventPlaybook.API.Features.Members;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using HtmlAgilityPack;
using MediatR;

namespace BOTGC.EventPlaybook.API.Features;

public sealed record PlannerTicketBookingRecord(
    int BookingId,
    int? BookerIntelligentGolfUserId,
    string BookerName,
    string? BookerEmail,
    string? BookerPhone,
    string BookingReference,
    string BookingType,
    int TicketCount,
    IReadOnlyList<string> TicketHolderNames,
    string Price,
    string PaymentStatus,
    string BookedAt,
    string? Notes);

public sealed record PlannerTicketBooking(
    int BookingId,
    int? BookerIntelligentGolfUserId,
    int? BookerMemberNumber,
    string BookerName,
    string? BookerEmail,
    string? BookerPhone,
    bool IsMember,
    bool MemberMatched,
    bool IsActiveMember,
    string? MembershipCategory,
    string BookingReference,
    string BookingType,
    int TicketCount,
    IReadOnlyList<string> TicketHolderNames,
    string Price,
    string PaymentStatus,
    string BookedAt,
    string? Notes);

public sealed record PlannerTicketBookingList(
    int IntelligentGolfEventId,
    int BookingCount,
    int TicketCount,
    int MemberBookingCount,
    int MemberBookingsWithEmailCount,
    IReadOnlyList<PlannerTicketBooking> Bookings);

public sealed record GetPlannerTicketBookingsQuery(
    int IntelligentGolfEventId,
    bool Refresh) : IRequest<IReadOnlyList<PlannerTicketBookingRecord>>;

public sealed class GetPlannerTicketBookingsHandler(
    IIntelligentGolfReportClient reports,
    IIntelligentGolfReportParser<PlannerTicketBookingRecord> parser)
    : IRequestHandler<GetPlannerTicketBookingsQuery, IReadOnlyList<PlannerTicketBookingRecord>>
{
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromMinutes(2);

    public Task<IReadOnlyList<PlannerTicketBookingRecord>> Handle(
        GetPlannerTicketBookingsQuery request,
        CancellationToken cancellationToken)
    {
        if (request.IntelligentGolfEventId <= 0)
            throw new ArgumentException("A valid Intelligent Golf planner entry ID is required.");

        return reports.GetAsync(
            $"/event.php?eventid={request.IntelligentGolfEventId}&tab=ticket_admin",
            parser,
            $"event-planner:ticket-bookings:{request.IntelligentGolfEventId}",
            CacheLifetime,
            request.Refresh,
            cancellationToken);
    }
}

public sealed class IntelligentGolfPlannerTicketBookingParser(
    ILogger<IntelligentGolfPlannerTicketBookingParser> logger)
    : IIntelligentGolfReportParser<PlannerTicketBookingRecord>
{
    public Task<IReadOnlyList<PlannerTicketBookingRecord>> ParseAsync(
        HtmlDocument document,
        CancellationToken cancellationToken = default)
    {
        var table = document.DocumentNode.SelectSingleNode(
            "//*[@id='ticketBookingContainer']//*[@id='ticketBookingPDFContent']//table[.//th]")
            ?? document.DocumentNode.SelectSingleNode(
                "//*[@id='ticketBookingContainer']//table[.//th]");
        if (table is null)
        {
            logger.LogWarning("The Intelligent Golf ticket page did not contain the current ticket-booking table.");
            return Task.FromResult<IReadOnlyList<PlannerTicketBookingRecord>>([]);
        }

        var headers = table.SelectNodes(".//thead//th")?
            .Select(header => Clean(header.InnerText))
            .ToArray() ?? [];
        var columns = BuildColumnMap(headers);
        var bookings = new List<PlannerTicketBookingRecord>();

        foreach (var row in table.SelectNodes(".//tbody/tr") ?? Enumerable.Empty<HtmlNode>())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var cells = row.SelectNodes("./td")?.ToArray();
            if (cells is null || cells.Length == 0) continue;

            var bookerName = CellText(cells, columns, "Booker");
            var bookingReference = CellText(cells, columns, "ReferenceNumber");
            if (string.IsNullOrWhiteSpace(bookingReference))
                bookingReference = ExtractBookingReference(Cell(cells, columns, "Booker"));

            var bookingId = ExtractPositiveInt(row, "data-ajax-data-inline-bookingid")
                ?? ExtractPositiveInt(row, "data-ajax-data-inline-ticketbookingid")
                ?? 0;
            var userId = ExtractMemberUserId(row);
            if (bookingId <= 0 && userId is null && string.IsNullOrWhiteSpace(bookerName)) continue;

            var ticketCell = Cell(cells, columns, "Tickets");
            var ticketHolderNames = ExtractTicketHolderNames(ticketCell);
            bookings.Add(new PlannerTicketBookingRecord(
                bookingId,
                userId,
                bookerName,
                EmptyAsNull(CellText(cells, columns, "EmailAddress")),
                EmptyAsNull(CellText(cells, columns, "Phone")),
                bookingReference,
                CellText(cells, columns, "Type"),
                ExtractTicketCount(ticketCell),
                ticketHolderNames,
                CellText(cells, columns, "Price"),
                ExtractPaymentStatus(Cell(cells, columns, "Paid")),
                CellText(cells, columns, "BookedAt"),
                EmptyAsNull(CellText(cells, columns, "Notes"))));
        }

        logger.LogInformation("Parsed {Count} current ticket bookings from Intelligent Golf.", bookings.Count);
        return Task.FromResult<IReadOnlyList<PlannerTicketBookingRecord>>(bookings);
    }

    private static Dictionary<string, int> BuildColumnMap(IReadOnlyList<string> headers)
    {
        var result = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < headers.Count; index++)
        {
            var key = Regex.Replace(headers[index], @"\s+", string.Empty).ToLowerInvariant();
            var name = key switch
            {
                "booker" => "Booker",
                "emailaddress" => "EmailAddress",
                "phone" => "Phone",
                "tickets" => "Tickets",
                "price" => "Price",
                "bookedat" => "BookedAt",
                "referencenumber" => "ReferenceNumber",
                "type" => "Type",
                "paid" => "Paid",
                "notes" => "Notes",
                _ => null
            };
            if (name is not null) result[name] = index;
        }
        return result;
    }

    private static HtmlNode? Cell(IReadOnlyList<HtmlNode> cells, IReadOnlyDictionary<string, int> columns, string name) =>
        columns.TryGetValue(name, out var index) && index >= 0 && index < cells.Count ? cells[index] : null;

    private static string CellText(IReadOnlyList<HtmlNode> cells, IReadOnlyDictionary<string, int> columns, string name) =>
        Clean(Cell(cells, columns, name)?.InnerText);

    private static int? ExtractMemberUserId(HtmlNode row)
    {
        var input = row.SelectSingleNode(".//input[translate(@name, 'MEMBER', 'member')='member']");
        return int.TryParse(input?.GetAttributeValue("value", null), NumberStyles.Integer, CultureInfo.InvariantCulture, out var id) && id > 0
            ? id
            : null;
    }

    private static int? ExtractPositiveInt(HtmlNode row, string attributeName)
    {
        var value = row.SelectSingleNode($".//*[@{attributeName}]")?.GetAttributeValue(attributeName, null);
        return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id) && id > 0 ? id : null;
    }

    private static int ExtractTicketCount(HtmlNode? ticketCell)
    {
        var total = 0;
        foreach (var ticket in ticketCell?.SelectNodes(".//dt") ?? Enumerable.Empty<HtmlNode>())
        {
            var match = Regex.Match(Clean(ticket.InnerText), @"^(?<count>\d+)");
            if (match.Success && int.TryParse(match.Groups["count"].Value, out var count)) total += count;
        }
        if (total > 0) return total;
        var fallback = Regex.Match(Clean(ticketCell?.InnerText), @"^(?<count>\d+)");
        return fallback.Success && int.TryParse(fallback.Groups["count"].Value, out var value) ? value : 0;
    }

    private static IReadOnlyList<string> ExtractTicketHolderNames(HtmlNode? ticketCell) =>
        (ticketCell?.SelectNodes(".//dt//div[not(contains(concat(' ', normalize-space(@class), ' '), ' pdfprintonly '))]")
            ?? Enumerable.Empty<HtmlNode>())
        .Select(node => Clean(node.InnerText).TrimEnd(':').Trim())
        .Where(value => !string.IsNullOrWhiteSpace(value))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToList();

    private static string ExtractBookingReference(HtmlNode? bookerCell)
    {
        var title = bookerCell?.GetAttributeValue("title", string.Empty) ?? string.Empty;
        var match = Regex.Match(title, @"Booking\s+Reference\s*:\s*(?<reference>.+)$", RegexOptions.IgnoreCase);
        return match.Success ? Clean(match.Groups["reference"].Value) : string.Empty;
    }

    private static string ExtractPaymentStatus(HtmlNode? paidCell)
    {
        var csvValue = paidCell?.SelectSingleNode(".//*[@data-csv-content]")?.GetAttributeValue("data-csv-content", null);
        var title = paidCell?.SelectSingleNode(".//*[@title]")?.GetAttributeValue("title", null);
        return Clean(csvValue ?? title ?? paidCell?.InnerText);
    }

    private static string Clean(string? value) =>
        Regex.Replace(HtmlEntity.DeEntitize(value ?? string.Empty), @"\s+", " ").Trim();

    private static string? EmptyAsNull(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

public static class PlannerTicketBookingEnricher
{
    public static PlannerTicketBookingList Enrich(
        int intelligentGolfEventId,
        IReadOnlyCollection<PlannerTicketBookingRecord> records,
        IReadOnlyCollection<MemberSummary> members)
    {
        var membersByUserId = members
            .Where(member => member.IntelligentGolfUserId is > 0)
            .GroupBy(member => member.IntelligentGolfUserId!.Value)
            .ToDictionary(group => group.Key, group => group.First());
        var bookings = records.Select(record =>
        {
            membersByUserId.TryGetValue(record.BookerIntelligentGolfUserId ?? 0, out var member);
            var isMember = member is not null || string.Equals(record.BookingType.Trim(), "member", StringComparison.OrdinalIgnoreCase);
            return new PlannerTicketBooking(
                record.BookingId,
                record.BookerIntelligentGolfUserId,
                member?.MemberNumber,
                FirstValue(record.BookerName, member?.FullName, JoinName(member)) ?? "Unknown booker",
                FirstValue(record.BookerEmail, member?.Email),
                record.BookerPhone,
                isMember,
                member is not null,
                member?.IsActive == true,
                member?.MembershipCategory,
                record.BookingReference,
                record.BookingType,
                record.TicketCount,
                record.TicketHolderNames,
                record.Price,
                record.PaymentStatus,
                record.BookedAt,
                record.Notes);
        }).ToList();

        return new PlannerTicketBookingList(
            intelligentGolfEventId,
            bookings.Count,
            bookings.Sum(booking => booking.TicketCount),
            bookings.Count(booking => booking.IsMember),
            bookings.Count(booking => booking.IsMember && booking.IsActiveMember && !string.IsNullOrWhiteSpace(booking.BookerEmail)),
            bookings);
    }

    private static string? JoinName(MemberSummary? member) =>
        member is null
            ? null
            : string.Join(' ', new[] { member.FirstName, member.LastName }.Where(value => !string.IsNullOrWhiteSpace(value)));

    private static string? FirstValue(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();
}
