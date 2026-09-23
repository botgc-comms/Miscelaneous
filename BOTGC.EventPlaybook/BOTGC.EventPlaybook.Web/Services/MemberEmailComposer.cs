using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.Services;

public interface IMemberEmailComposer
{
    Task<MemberEmailDraftResult> ComposeAsync(
        MemberEmailDraftRequest request,
        string artworkUrl,
        CancellationToken cancellationToken);

    Task<MemberEmailDraftResult> ComposeCancellationAsync(
        MemberCancellationEmailDraftRequest request,
        string? artworkUrl,
        CancellationToken cancellationToken);
}

public sealed class MemberEmailComposer(
    IHttpClientFactory httpClientFactory,
    IClubBrandingStore clubBrandingStore,
    IOptions<OpenAiOptions> options,
    ILogger<MemberEmailComposer> logger) : IMemberEmailComposer
{
    private readonly OpenAiOptions _options = options.Value;

    public async Task<MemberEmailDraftResult> ComposeAsync(
        MemberEmailDraftRequest request,
        string artworkUrl,
        CancellationToken cancellationToken)
    {
        var branding = await clubBrandingStore.GetOverviewAsync(cancellationToken);
        var fallback = BuildFallback(request, artworkUrl, branding.ClubName);
        if (string.IsNullOrWhiteSpace(_options.ApiKey)) return fallback;

        var eventDate = DateOnly.TryParseExact(request.EventDate, "yyyy-MM-dd", out var parsedDate)
            ? parsedDate.ToDateTime(TimeOnly.MinValue).ToString("dddd d MMMM yyyy", CultureInfo.GetCultureInfo("en-GB"))
            : request.EventDate;
        var brief = new
        {
            task = "Write a polished HTML marketing email inviting golf-club members to this event.",
            clubName = branding.ClubName,
            eventName = request.EventName.Trim(),
            eventDate,
            eventDescription = request.Description.Trim(),
            additionalCreativeInstructions = string.IsNullOrWhiteSpace(request.AdditionalInstructions) ? null : request.AdditionalInstructions.Trim(),
            price = string.IsNullOrWhiteSpace(request.Price) ? null : request.Price.Trim(),
            planningContext = request.PlanningContext,
            artworkUrl,
            requirements = new[]
            {
                "Return a JSON object with exactly two string properties: subject and bodyHtml.",
                "Use only facts present in the supplied event information. Do not invent booking arrangements, times, prices or benefits.",
                "Use relevant admission-planning facts when explaining how members register, reserve or pay. Preserve the supplied prices, dates, capacity, table-booking requirement and public booking instructions exactly; omit facts that are absent or not relevant.",
                "Use friendly British English and a concise, engaging subject line.",
                "The bodyHtml must be an email-safe HTML fragment with inline CSS only; no scripts, forms, iframes, external stylesheets or tracking markup.",
                "Place the supplied artwork near the top as a responsive image using its exact URL and meaningful alt text.",
                "Use a restrained branded layout that remains readable on mobile devices.",
                "End with the club name. Do not include an unsubscribe statement because Intelligent Golf applies the club email wrapper."
            }
        };

        try
        {
            using var message = new HttpRequestMessage(HttpMethod.Post, "chat/completions");
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
            message.Content = JsonContent.Create(new
            {
                model = _options.PromptModel,
                response_format = new { type = "json_object" },
                messages = new object[]
                {
                    new
                    {
                        role = "system",
                        content = "You are the communications editor for a British golf club. Produce accurate, inviting member emails as strict JSON."
                    },
                    new { role = "user", content = JsonSerializer.Serialize(brief) }
                }
            });

            using var client = httpClientFactory.CreateClient("OpenAI");
            using var response = await client.SendAsync(message, cancellationToken);
            var raw = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("OpenAI member email drafting failed with {StatusCode}; using fallback copy.", response.StatusCode);
                return fallback;
            }

            var generated = Parse(raw);
            if (generated is null) return fallback;
            var body = Sanitise(generated.BodyHtml);
            var encodedArtworkUrl = HtmlEncoder.Default.Encode(artworkUrl);
            if (!body.Contains(artworkUrl, StringComparison.OrdinalIgnoreCase) &&
                !body.Contains(encodedArtworkUrl, StringComparison.OrdinalIgnoreCase))
            {
                body = $"<p style=\"margin:0 0 24px\"><img src=\"{encodedArtworkUrl}\" alt=\"{HtmlEncoder.Default.Encode(request.EventName)} poster\" style=\"display:block;width:100%;max-width:640px;height:auto;margin:0 auto\"></p>{body}";
            }

            return new MemberEmailDraftResult
            {
                Subject = generated.Subject.Trim(),
                BodyHtml = body,
                ArtworkUrl = artworkUrl,
                Mode = "openai",
                Model = _options.PromptModel
            };
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "OpenAI member email drafting failed; using fallback copy.");
            return fallback;
        }
    }

    public async Task<MemberEmailDraftResult> ComposeCancellationAsync(
        MemberCancellationEmailDraftRequest request,
        string? artworkUrl,
        CancellationToken cancellationToken)
    {
        var branding = await clubBrandingStore.GetOverviewAsync(cancellationToken);
        var fallback = BuildCancellationFallback(request, artworkUrl, branding.ClubName);
        if (string.IsNullOrWhiteSpace(_options.ApiKey)) return fallback;

        var eventDate = DateOnly.TryParseExact(request.EventDate, "yyyy-MM-dd", out var parsedDate)
            ? parsedDate.ToDateTime(TimeOnly.MinValue).ToString("dddd d MMMM yyyy", CultureInfo.GetCultureInfo("en-GB"))
            : request.EventDate;
        var authoritativeMemberUpdate = string.IsNullOrWhiteSpace(request.MemberUpdate)
            ? null
            : request.MemberUpdate.Trim();
        var brief = new
        {
            task = "Write a clear HTML email telling golf-club members that this event has been cancelled.",
            clubName = branding.ClubName,
            eventName = request.EventName.Trim(),
            eventDate,
            cancellationReason = request.Reason.Trim(),
            authoritativeMemberUpdate,
            artworkUrl = string.IsNullOrWhiteSpace(artworkUrl) ? null : artworkUrl,
            requirements = new[]
            {
                "Return a JSON object with exactly two string properties: subject and bodyHtml.",
                "The subject must begin with 'CANCELLED:' and name the event.",
                "State prominently and unambiguously near the start that the event has been cancelled.",
                "If authoritativeMemberUpdate is supplied, reproduce it faithfully as the member-facing message. Do not contradict, embellish or omit it. Treat cancellationReason as internal context and do not expose details absent from the member update.",
                "If authoritativeMemberUpdate is absent, use the cancellation reason to give members a concise factual explanation.",
                "Never invite members to attend, register, reserve, book or buy tickets, and never imply that the event is still proceeding.",
                "Do not invent refund, rebooking, replacement-event or contact arrangements.",
                "Use British English and a calm, apologetic tone without minimising the cancellation.",
                "The bodyHtml must be an email-safe HTML fragment with inline CSS only; no scripts, forms, iframes, external stylesheets or tracking markup.",
                "If artworkUrl is supplied, place that exact image URL near the top. Do not invent an image URL.",
                "End with the club name. Do not include an unsubscribe statement because Intelligent Golf applies the club email wrapper."
            }
        };

        try
        {
            using var message = new HttpRequestMessage(HttpMethod.Post, "chat/completions");
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
            message.Content = JsonContent.Create(new
            {
                model = _options.PromptModel,
                response_format = new { type = "json_object" },
                messages = new object[]
                {
                    new
                    {
                        role = "system",
                        content = "You are the communications editor for a British golf club. Produce accurate cancellation notices as strict JSON. Never write promotional or inviting copy for a cancelled event."
                    },
                    new { role = "user", content = JsonSerializer.Serialize(brief) }
                }
            });

            using var client = httpClientFactory.CreateClient("OpenAI");
            using var response = await client.SendAsync(message, cancellationToken);
            var raw = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("OpenAI cancellation email drafting failed with {StatusCode}; using fallback copy.", response.StatusCode);
                return fallback;
            }

            var generated = Parse(raw);
            if (generated is null) return fallback;
            var body = Sanitise(generated.BodyHtml);
            if (!IsSafeCancellationDraft(generated.Subject, body, request))
            {
                logger.LogWarning("OpenAI cancellation email drafting returned unsafe or incomplete copy; using fallback copy.");
                return fallback;
            }

            if (!string.IsNullOrWhiteSpace(artworkUrl) &&
                !body.Contains(artworkUrl, StringComparison.OrdinalIgnoreCase))
            {
                body = $"<p style=\"margin:0 0 24px\"><img src=\"{HtmlEncoder.Default.Encode(artworkUrl)}\" alt=\"Cancelled: {HtmlEncoder.Default.Encode(request.EventName)}\" style=\"display:block;width:100%;max-width:640px;height:auto;margin:0 auto\"></p>{body}";
            }

            return new MemberEmailDraftResult
            {
                Subject = generated.Subject.Trim(),
                BodyHtml = body,
                ArtworkUrl = artworkUrl ?? string.Empty,
                Mode = "openai",
                Model = _options.PromptModel
            };
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "OpenAI cancellation email drafting failed; using fallback copy.");
            return fallback;
        }
    }

    private static MemberEmailDraftResult? Parse(string raw)
    {
        using var document = JsonDocument.Parse(raw);
        var content = document.RootElement.GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString();
        if (string.IsNullOrWhiteSpace(content)) return null;
        var draft = JsonSerializer.Deserialize<GeneratedDraft>(content, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        return string.IsNullOrWhiteSpace(draft?.Subject) || string.IsNullOrWhiteSpace(draft.BodyHtml)
            ? null
            : new MemberEmailDraftResult
            {
                Subject = draft.Subject,
                BodyHtml = draft.BodyHtml,
                ArtworkUrl = string.Empty,
                Mode = "openai",
                Model = string.Empty
            };
    }

    private static MemberEmailDraftResult BuildFallback(
        MemberEmailDraftRequest request,
        string artworkUrl,
        string clubName)
    {
        var name = HtmlEncoder.Default.Encode(request.EventName.Trim());
        var description = HtmlEncoder.Default.Encode(request.Description.Trim()).Replace("\r\n", "<br>").Replace("\n", "<br>");
        var date = DateOnly.TryParseExact(request.EventDate, "yyyy-MM-dd", out var parsedDate)
            ? parsedDate.ToDateTime(TimeOnly.MinValue).ToString("dddd d MMMM yyyy", CultureInfo.GetCultureInfo("en-GB"))
            : request.EventDate;
        var displayPrice = MemberCommunicationsFallbackHtml.ResolvePrice(request.Price, request.PlanningContext);
        var price = string.IsNullOrWhiteSpace(displayPrice)
            ? string.Empty
            : $"<p style=\"margin:0 0 18px;font-size:18px;font-weight:700;color:#0b4254\">{HtmlEncoder.Default.Encode(displayPrice)}</p>";
        var planning = MemberCommunicationsFallbackHtml.BuildPlanningSection(request.PlanningContext);
        var body = $"""
            <div style="max-width:640px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#173844;line-height:1.55">
              <img src="{HtmlEncoder.Default.Encode(artworkUrl)}" alt="{name} poster" style="display:block;width:100%;height:auto;margin:0 0 24px;border-radius:8px">
              <h1 style="margin:0 0 10px;color:#07384a;font-family:Georgia,serif;font-size:30px;line-height:1.15">{name}</h1>
              <p style="margin:0 0 18px;font-size:17px;font-weight:700;color:#a97b20">{HtmlEncoder.Default.Encode(date)}</p>
              {price}
              <p style="margin:0 0 20px;font-size:16px">{description}</p>
              {planning.Html}
              <p style="margin:24px 0 0">We hope you can join us.</p>
              <p style="margin:8px 0 0;font-weight:700">{HtmlEncoder.Default.Encode(clubName)}</p>
            </div>
            """;
        return new MemberEmailDraftResult
        {
            Subject = $"{request.EventName.Trim()} — {date}",
            BodyHtml = body,
            ArtworkUrl = artworkUrl,
            Mode = "fallback",
            Model = "deterministic-fallback"
        };
    }

    private static MemberEmailDraftResult BuildCancellationFallback(
        MemberCancellationEmailDraftRequest request,
        string? artworkUrl,
        string clubName)
    {
        var eventName = request.EventName.Trim();
        var encodedName = HtmlEncoder.Default.Encode(eventName);
        var date = DateOnly.TryParseExact(request.EventDate, "yyyy-MM-dd", out var parsedDate)
            ? parsedDate.ToDateTime(TimeOnly.MinValue).ToString("dddd d MMMM yyyy", CultureInfo.GetCultureInfo("en-GB"))
            : request.EventDate;
        var memberMessage = string.IsNullOrWhiteSpace(request.MemberUpdate)
            ? request.Reason.Trim()
            : request.MemberUpdate.Trim();
        var encodedMessage = EncodeWithLineBreaks(memberMessage);
        var image = string.IsNullOrWhiteSpace(artworkUrl)
            ? string.Empty
            : $"<img src=\"{HtmlEncoder.Default.Encode(artworkUrl)}\" alt=\"Cancelled: {encodedName}\" style=\"display:block;width:100%;height:auto;margin:0 0 24px;border-radius:8px\">";
        var body = $"""
            <div style="max-width:640px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#173844;line-height:1.55">
              {image}
              <div style="margin:0 0 24px;padding:16px 20px;background:#a83f34;color:#ffffff;font-size:24px;font-weight:800;letter-spacing:.04em;text-align:center">EVENT CANCELLED</div>
              <h1 style="margin:0 0 10px;color:#07384a;font-family:Georgia,serif;font-size:30px;line-height:1.15">{encodedName}</h1>
              <p style="margin:0 0 18px;font-size:17px;font-weight:700;color:#a97b20">{HtmlEncoder.Default.Encode(date)}</p>
              <p style="margin:0 0 16px;font-size:18px;font-weight:700">This event has been cancelled.</p>
              <p style="margin:0 0 20px;font-size:16px">{encodedMessage}</p>
              <p style="margin:24px 0 0">We apologise for any inconvenience.</p>
              <p style="margin:8px 0 0;font-weight:700">{HtmlEncoder.Default.Encode(clubName)}</p>
            </div>
            """;
        return new MemberEmailDraftResult
        {
            Subject = $"CANCELLED: {eventName} — {date}",
            BodyHtml = body,
            ArtworkUrl = artworkUrl ?? string.Empty,
            Mode = "fallback",
            Model = "deterministic-fallback"
        };
    }

    private static bool IsSafeCancellationDraft(
        string subject,
        string bodyHtml,
        MemberCancellationEmailDraftRequest request)
    {
        var plainBody = NormaliseText(Regex.Replace(bodyHtml, "<[^>]+>", " "));
        var normalisedSubject = NormaliseText(subject);
        if (!normalisedSubject.Contains("cancel", StringComparison.OrdinalIgnoreCase) ||
            !plainBody.Contains("cancel", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var combined = $"{normalisedSubject} {plainBody}";
        if (Regex.IsMatch(
                combined,
                @"\b(join us|book now|reserve your|register now|tickets? (?:are )?(?:available|on sale)|look forward to (?:seeing|welcoming))\b",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
        {
            return false;
        }

        var authoritativeMessage = string.IsNullOrWhiteSpace(request.MemberUpdate)
            ? request.Reason
            : request.MemberUpdate;
        return plainBody.Contains(NormaliseText(authoritativeMessage), StringComparison.OrdinalIgnoreCase);
    }

    private static string EncodeWithLineBreaks(string value) =>
        HtmlEncoder.Default.Encode(value)
            .Replace("\r\n", "<br>", StringComparison.Ordinal)
            .Replace("\n", "<br>", StringComparison.Ordinal);

    private static string NormaliseText(string value) =>
        Regex.Replace(System.Net.WebUtility.HtmlDecode(value), @"\s+", " ").Trim();

    private static string Sanitise(string html)
    {
        var value = Regex.Replace(html, @"<(script|iframe|object|embed|form)\b[^>]*>.*?</\1\s*>", string.Empty, RegexOptions.IgnoreCase | RegexOptions.Singleline);
        value = Regex.Replace(value, @"\s+on[a-z]+\s*=\s*([""']).*?\1", string.Empty, RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return Regex.Replace(value, @"javascript\s*:", string.Empty, RegexOptions.IgnoreCase).Trim();
    }

    private sealed class GeneratedDraft
    {
        public string Subject { get; init; } = string.Empty;
        public string BodyHtml { get; init; } = string.Empty;
    }
}
