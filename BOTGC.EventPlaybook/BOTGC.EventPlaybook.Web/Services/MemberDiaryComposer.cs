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

public interface IMemberDiaryComposer
{
    Task<MemberDiaryDraftResult> ComposeAsync(
        MemberDiaryDraftRequest request,
        string artworkUrl,
        CancellationToken cancellationToken);
}

public sealed class MemberDiaryComposer(
    IHttpClientFactory httpClientFactory,
    IClubBrandingStore clubBrandingStore,
    IOptions<OpenAiOptions> options,
    ILogger<MemberDiaryComposer> logger) : IMemberDiaryComposer
{
    private readonly OpenAiOptions _options = options.Value;

    public async Task<MemberDiaryDraftResult> ComposeAsync(
        MemberDiaryDraftRequest request,
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
            task = "Write a concise HTML member-diary entry advertising this golf-club event.",
            clubName = branding.ClubName,
            eventName = request.EventName.Trim(),
            eventDate,
            startTime = EmptyAsNull(request.StartTime),
            endTime = EmptyAsNull(request.EndTime),
            eventDescription = request.Description.Trim(),
            additionalCreativeInstructions = EmptyAsNull(request.AdditionalInstructions),
            price = EmptyAsNull(request.Price),
            bookingUrl = EmptyAsNull(request.BookingUrl),
            artworkUrl,
            requirements = new[]
            {
                "Return a JSON object with exactly two string properties: title and bodyHtml.",
                "Use only supplied facts; do not invent times, prices, booking arrangements or benefits.",
                "Use friendly British English suitable for the club member diary.",
                "Make the title clear and concise; do not prefix it with the word Event.",
                "The bodyHtml must be a self-contained HTML fragment using simple headings, paragraphs, strong text, lists, links and the supplied image only.",
                "Place the supplied artwork near the top as a responsive image using its exact URL.",
                "Use inline CSS only and never include scripts, forms, iframes, tracking markup or an entire HTML document."
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
                        content = "You are the member-diary editor for a British golf club. Produce accurate, inviting diary copy as strict JSON."
                    },
                    new { role = "user", content = JsonSerializer.Serialize(brief) }
                }
            });

            using var client = httpClientFactory.CreateClient("OpenAI");
            using var response = await client.SendAsync(message, cancellationToken);
            var raw = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("OpenAI member diary drafting failed with {StatusCode}; using fallback copy.", response.StatusCode);
                return fallback;
            }

            var generated = Parse(raw);
            if (generated is null) return fallback;
            var body = Sanitise(generated.BodyHtml);
            if (!body.Contains(artworkUrl, StringComparison.OrdinalIgnoreCase))
            {
                body = $"<p><img src=\"{HtmlEncoder.Default.Encode(artworkUrl)}\" alt=\"{HtmlEncoder.Default.Encode(request.EventName)} poster\" style=\"display:block;width:100%;max-width:640px;height:auto;margin:0 auto 20px\"></p>{body}";
            }

            return new MemberDiaryDraftResult
            {
                Title = generated.Title.Trim(),
                BodyHtml = body,
                ArtworkUrl = artworkUrl,
                Mode = "openai",
                Model = _options.PromptModel
            };
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "OpenAI member diary drafting failed; using fallback copy.");
            return fallback;
        }
    }

    private static MemberDiaryDraftResult? Parse(string raw)
    {
        using var document = JsonDocument.Parse(raw);
        var content = document.RootElement.GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString();
        if (string.IsNullOrWhiteSpace(content)) return null;
        var draft = JsonSerializer.Deserialize<GeneratedDraft>(content, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        return string.IsNullOrWhiteSpace(draft?.Title) || string.IsNullOrWhiteSpace(draft.BodyHtml)
            ? null
            : new MemberDiaryDraftResult
            {
                Title = draft.Title,
                BodyHtml = draft.BodyHtml,
                ArtworkUrl = string.Empty,
                Mode = "openai",
                Model = string.Empty
            };
    }

    private static MemberDiaryDraftResult BuildFallback(
        MemberDiaryDraftRequest request,
        string artworkUrl,
        string clubName)
    {
        var name = HtmlEncoder.Default.Encode(request.EventName.Trim());
        var description = HtmlEncoder.Default.Encode(request.Description.Trim())
            .Replace("\r\n", "<br>", StringComparison.Ordinal)
            .Replace("\n", "<br>", StringComparison.Ordinal);
        var date = DateOnly.TryParseExact(request.EventDate, "yyyy-MM-dd", out var parsedDate)
            ? parsedDate.ToDateTime(TimeOnly.MinValue).ToString("dddd d MMMM yyyy", CultureInfo.GetCultureInfo("en-GB"))
            : request.EventDate;
        var time = string.IsNullOrWhiteSpace(request.StartTime)
            ? string.Empty
            : string.IsNullOrWhiteSpace(request.EndTime)
                ? $" from {request.StartTime.Trim()}"
                : $" from {request.StartTime.Trim()} to {request.EndTime.Trim()}";
        var price = string.IsNullOrWhiteSpace(request.Price)
            ? string.Empty
            : $"<p><strong>{HtmlEncoder.Default.Encode(request.Price.Trim())}</strong></p>";
        var booking = string.IsNullOrWhiteSpace(request.BookingUrl)
            ? string.Empty
            : $"<p><a href=\"{HtmlEncoder.Default.Encode(request.BookingUrl.Trim())}\">Book or find out more</a></p>";
        return new MemberDiaryDraftResult
        {
            Title = request.EventName.Trim(),
            BodyHtml = $"""
                <div style="max-width:640px;margin:0 auto;color:#173844;line-height:1.55">
                  <p><img src="{HtmlEncoder.Default.Encode(artworkUrl)}" alt="{name} poster" style="display:block;width:100%;height:auto;margin:0 0 20px"></p>
                  <h2>{name}</h2>
                  <p><strong>{HtmlEncoder.Default.Encode(date + time)}</strong></p>
                  {price}
                  <p>{description}</p>
                  {booking}
                  <p>{HtmlEncoder.Default.Encode(clubName)}</p>
                </div>
                """,
            ArtworkUrl = artworkUrl,
            Mode = "fallback",
            Model = "deterministic-fallback"
        };
    }

    private static string Sanitise(string html)
    {
        var value = Regex.Replace(html, @"<(script|iframe|object|embed|form)\b[^>]*>.*?</\1\s*>", string.Empty, RegexOptions.IgnoreCase | RegexOptions.Singleline);
        value = Regex.Replace(value, @"\s+on[a-z]+\s*=\s*([""']).*?\1", string.Empty, RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return Regex.Replace(value, @"javascript\s*:", string.Empty, RegexOptions.IgnoreCase).Trim();
    }

    private static string? EmptyAsNull(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private sealed class GeneratedDraft
    {
        public string Title { get; init; } = string.Empty;
        public string BodyHtml { get; init; } = string.Empty;
    }
}
