using System.Text.Encodings.Web;
using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

internal static class MemberCommunicationsFallbackHtml
{
    internal sealed record PlanningSection(string Html, bool BookingUrlRendered);

    internal static string? ResolvePrice(
        string? explicitPrice,
        CommunicationsPlanningContext? planningContext) =>
        FirstValue(explicitPrice, planningContext?.TicketPriceDetails);

    internal static string? SafeBookingUrl(string? value)
    {
        var candidate = EmptyAsNull(value);
        if (candidate is null ||
            !Uri.TryCreate(candidate, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
        {
            return null;
        }

        return candidate;
    }

    internal static PlanningSection BuildPlanningSection(
        CommunicationsPlanningContext? context,
        string? bookingUrl = null)
    {
        if (context is null) return new PlanningSection(string.Empty, false);

        var fields = new (string Label, string? Value)[]
        {
            ("Registration", context.RegistrationMode),
            ("Free entry", context.FreeEntry),
            ("Free attendee categories", context.FreeEntryCategories),
            ("Payment", context.PaymentTiming),
            ("Maximum places", context.MaximumPlaces),
            ("How to book", context.BookingRoutes),
            ("Table booking", context.GuestTableBooking),
            ("Booking opens", context.BookingOpens),
            ("Booking closes", context.BookingCloses),
            ("Booking information", context.PublicBookingInstructions)
        };
        var items = new List<string>();
        var bookingUrlRendered = false;
        foreach (var (label, rawValue) in fields)
        {
            var value = EmptyAsNull(rawValue);
            if (value is null) continue;

            var encodedValue = EncodeWithOptionalBookingLink(value, bookingUrl, out var usedBookingUrl);
            bookingUrlRendered |= usedBookingUrl;
            items.Add($"<li style=\"margin:0 0 6px\"><strong>{HtmlEncoder.Default.Encode(label)}:</strong> {encodedValue}</li>");
        }

        if (items.Count == 0) return new PlanningSection(string.Empty, false);

        return new PlanningSection(
            $"<div style=\"margin:20px 0;padding:16px;border:1px solid #d7e0dc;border-radius:8px;background:#f5f8f6\"><h2 style=\"margin:0 0 10px;font-size:20px;color:#07384a\">Booking and admission</h2><ul style=\"margin:0;padding-left:20px\">{string.Concat(items)}</ul></div>",
            bookingUrlRendered);
    }

    private static string EncodeWithOptionalBookingLink(
        string value,
        string? bookingUrl,
        out bool bookingUrlRendered)
    {
        bookingUrlRendered = false;
        if (string.IsNullOrWhiteSpace(bookingUrl))
        {
            return EncodeMultiline(value);
        }

        var index = value.IndexOf(bookingUrl, StringComparison.OrdinalIgnoreCase);
        if (index < 0)
        {
            return EncodeMultiline(value);
        }

        bookingUrlRendered = true;
        var before = EncodeMultiline(value[..index]);
        var link = HtmlEncoder.Default.Encode(bookingUrl);
        var after = EncodeMultiline(value[(index + bookingUrl.Length)..]);
        return $"{before}<a href=\"{link}\">Book online</a>{after}";
    }

    private static string EncodeMultiline(string value) =>
        HtmlEncoder.Default.Encode(value)
            .Replace("\r\n", "<br>", StringComparison.Ordinal)
            .Replace("\n", "<br>", StringComparison.Ordinal);

    private static string? FirstValue(params string?[] values) =>
        values.Select(EmptyAsNull).FirstOrDefault(value => value is not null);

    private static string? EmptyAsNull(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
