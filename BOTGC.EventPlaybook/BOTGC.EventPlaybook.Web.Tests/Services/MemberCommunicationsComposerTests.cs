using System.Net;
using System.Text;
using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class MemberCommunicationsComposerTests
{
    private const string ArtworkUrl = "https://events.example.test/artwork/event.png";
    private const string BookingUrl = "https://booking.example.test/event/123";

    [Fact]
    public async Task EmailFallbackWithoutOpenAiIncludesEncodedPlanningFactsOnce()
    {
        var composer = CreateEmailComposer(new ThrowingHttpClientFactory(), apiKey: string.Empty);

        var result = await composer.ComposeAsync(
            EmailRequest(price: "Adults £30 & children £15"),
            ArtworkUrl,
            CancellationToken.None);

        Assert.Equal("fallback", result.Mode);
        Assert.Contains("Free registration to estimate attendance", result.BodyHtml, StringComparison.Ordinal);
        Assert.Contains("Thursday 1 October 2026", result.BodyHtml, StringComparison.Ordinal);
        Assert.Contains("Friday 30 October 2026", result.BodyHtml, StringComparison.Ordinal);
        Assert.Contains("Members&#x27; app &amp; the pro shop", result.BodyHtml, StringComparison.Ordinal);
        Assert.Contains("Table booking", result.BodyHtml, StringComparison.Ordinal);
        Assert.Contains("Adults &#xA3;30 &amp; children &#xA3;15", result.BodyHtml, StringComparison.Ordinal);
        Assert.Equal(1, Count(result.BodyHtml, "Adults &#xA3;30 &amp; children &#xA3;15"));
        Assert.Contains("&lt;script&gt;alert(1)&lt;/script&gt;", result.BodyHtml, StringComparison.Ordinal);
        Assert.DoesNotContain("<script>alert(1)</script>", result.BodyHtml, StringComparison.Ordinal);
    }

    [Fact]
    public async Task EmailInvalidOpenAiResponseUsesPlanningAwareFallback()
    {
        var composer = CreateEmailComposer(
            new StaticHttpClientFactory(HttpStatusCode.OK, "not valid JSON"),
            apiKey: "test-key");

        var result = await composer.ComposeAsync(
            EmailRequest(price: null),
            ArtworkUrl,
            CancellationToken.None);

        Assert.Equal("fallback", result.Mode);
        Assert.Contains("Adults &#xA3;30 &amp; children &#xA3;15", result.BodyHtml, StringComparison.Ordinal);
        Assert.Contains("Maximum places", result.BodyHtml, StringComparison.Ordinal);
        Assert.Contains("120", result.BodyHtml, StringComparison.Ordinal);
    }

    [Fact]
    public async Task EmailOpenAiDraftDoesNotDuplicateAnHtmlEncodedArtworkUrl()
    {
        const string artworkUrl = "https://events.example.test/artwork?key=event-1&outputId=social&version=2";
        var encodedArtworkUrl = "https://events.example.test/artwork?key=event-1&amp;outputId=social&amp;version=2";
        var response = OpenAiResponse(
            "Autumn Supper",
            $"<div><img src=\"{encodedArtworkUrl}\" alt=\"Autumn Supper poster\"><p>Please join us.</p></div>");
        var composer = CreateEmailComposer(
            new StaticHttpClientFactory(HttpStatusCode.OK, response),
            apiKey: "test-key");

        var result = await composer.ComposeAsync(EmailRequest(price: null), artworkUrl, CancellationToken.None);

        Assert.Equal("openai", result.Mode);
        Assert.Equal(1, Count(result.BodyHtml, "<img"));
        Assert.Equal(1, Count(result.BodyHtml, encodedArtworkUrl));
    }

    [Fact]
    public async Task CancellationEmailFallbackUsesAuthoritativeMemberUpdateAndNeverInvitesAttendance()
    {
        var composer = CreateEmailComposer(new ThrowingHttpClientFactory(), apiKey: string.Empty);

        var result = await composer.ComposeCancellationAsync(
            CancellationRequest(
                reason: "The supplier cancelled at short notice.",
                memberUpdate: "Tonight's supper is cancelled. <script>alert('unsafe')</script> Please do not travel to the club."),
            artworkUrl: null,
            CancellationToken.None);

        Assert.Equal("fallback", result.Mode);
        Assert.Equal("CANCELLED: Autumn Supper — Saturday 31 October 2026", result.Subject);
        Assert.Contains("EVENT CANCELLED", result.BodyHtml, StringComparison.Ordinal);
        Assert.Contains("Tonight&#x27;s supper is cancelled.", result.BodyHtml, StringComparison.Ordinal);
        Assert.Contains("&lt;script&gt;alert(&#x27;unsafe&#x27;)&lt;/script&gt;", result.BodyHtml, StringComparison.Ordinal);
        Assert.DoesNotContain("The supplier cancelled", result.BodyHtml, StringComparison.Ordinal);
        Assert.DoesNotContain("join us", result.BodyHtml, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("book now", result.BodyHtml, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(string.Empty, result.ArtworkUrl);
    }

    [Fact]
    public async Task CancellationEmailFallbackUsesEncodedReasonWhenMemberUpdateIsAbsent()
    {
        var composer = CreateEmailComposer(new ThrowingHttpClientFactory(), apiKey: string.Empty);

        var result = await composer.ComposeCancellationAsync(
            CancellationRequest("Unsafe weather & a waterlogged course <today>.", memberUpdate: null),
            ArtworkUrl,
            CancellationToken.None);

        Assert.Equal("fallback", result.Mode);
        Assert.Contains("Unsafe weather &amp; a waterlogged course &lt;today&gt;.", result.BodyHtml, StringComparison.Ordinal);
        Assert.Contains($"src=\"{ArtworkUrl}\"", result.BodyHtml, StringComparison.Ordinal);
        Assert.Equal(1, Count(result.BodyHtml, ArtworkUrl));
    }

    [Fact]
    public async Task CancellationEmailUsesSafeOpenAiDraftWhenConfigured()
    {
        const string update = "The supper is cancelled. Please disregard the earlier booking message.";
        var response = OpenAiResponse(
            "CANCELLED: Autumn Supper",
            $"<div><h1>Event cancelled</h1><p>{update}</p></div>");
        var composer = CreateEmailComposer(
            new StaticHttpClientFactory(HttpStatusCode.OK, response),
            apiKey: "test-key");

        var result = await composer.ComposeCancellationAsync(
            CancellationRequest("The supplier is unavailable.", update),
            ArtworkUrl,
            CancellationToken.None);

        Assert.Equal("openai", result.Mode);
        Assert.Equal("test-model", result.Model);
        Assert.Equal("CANCELLED: Autumn Supper", result.Subject);
        Assert.Contains(update, result.BodyHtml, StringComparison.Ordinal);
        Assert.Contains($"src=\"{ArtworkUrl}\"", result.BodyHtml, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CancellationEmailRejectsInvitingOpenAiCopyAndUsesSafeFallback()
    {
        const string update = "The supper is cancelled.";
        var response = OpenAiResponse(
            "CANCELLED: Autumn Supper",
            $"<div><p>{update}</p><p>Please join us and book now.</p></div>");
        var composer = CreateEmailComposer(
            new StaticHttpClientFactory(HttpStatusCode.OK, response),
            apiKey: "test-key");

        var result = await composer.ComposeCancellationAsync(
            CancellationRequest("The supplier is unavailable.", update),
            artworkUrl: null,
            CancellationToken.None);

        Assert.Equal("fallback", result.Mode);
        Assert.DoesNotContain("join us", result.BodyHtml, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("book now", result.BodyHtml, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task DiaryFailedOpenAiRequestUsesPlanningAwareFallbackAndDoesNotDuplicateBookingLink()
    {
        var composer = CreateDiaryComposer(
            new StaticHttpClientFactory(HttpStatusCode.BadGateway, "upstream unavailable"),
            apiKey: "test-key");

        var result = await composer.ComposeAsync(
            DiaryRequest(),
            ArtworkUrl,
            CancellationToken.None);

        Assert.Equal("fallback", result.Mode);
        Assert.Contains("Booking and admission", result.BodyHtml, StringComparison.Ordinal);
        Assert.Contains("Book online", result.BodyHtml, StringComparison.Ordinal);
        Assert.Equal(1, Count(result.BodyHtml, $"href=\"{BookingUrl}\""));
        Assert.DoesNotContain("Book or find out more", result.BodyHtml, StringComparison.Ordinal);
        Assert.Contains("Please state dietary needs &amp; accessibility requirements.", result.BodyHtml, StringComparison.Ordinal);
    }

    [Fact]
    public async Task DiaryFallbackRejectsAnUnsafeStandaloneBookingUrl()
    {
        var composer = CreateDiaryComposer(new ThrowingHttpClientFactory(), apiKey: string.Empty);
        var request = new MemberDiaryDraftRequest
        {
            EventId = "event-123",
            EventName = "Autumn Supper",
            EventDate = "2026-10-31",
            Description = "An evening at the club.",
            BookingUrl = "javascript:alert(1)",
            PlanningContext = new CommunicationsPlanningContext
            {
                RegistrationMode = "Registration required"
            },
            Artwork = Artwork()
        };

        var result = await composer.ComposeAsync(request, ArtworkUrl, CancellationToken.None);

        Assert.Equal("fallback", result.Mode);
        Assert.DoesNotContain("javascript:", result.BodyHtml, StringComparison.OrdinalIgnoreCase);
    }

    private static MemberEmailComposer CreateEmailComposer(IHttpClientFactory factory, string apiKey) =>
        new(
            factory,
            new TestClubBrandingStore(),
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions { ApiKey = apiKey, PromptModel = "test-model" }),
            NullLogger<MemberEmailComposer>.Instance);

    private static MemberDiaryComposer CreateDiaryComposer(IHttpClientFactory factory, string apiKey) =>
        new(
            factory,
            new TestClubBrandingStore(),
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions { ApiKey = apiKey, PromptModel = "test-model" }),
            NullLogger<MemberDiaryComposer>.Instance);

    private static MemberEmailDraftRequest EmailRequest(string? price) => new()
    {
        EventId = "event-123",
        EventName = "Autumn Supper",
        EventDate = "2026-10-31",
        Description = "An evening at the club.",
        Price = price,
        PlanningContext = PlanningContext(includeBookingUrl: false),
        Artwork = Artwork()
    };

    private static MemberCancellationEmailDraftRequest CancellationRequest(
        string reason,
        string? memberUpdate) => new()
    {
        EventId = "event-123",
        EventName = "Autumn Supper",
        EventDate = "2026-10-31",
        Reason = reason,
        MemberUpdate = memberUpdate
    };

    private static MemberDiaryDraftRequest DiaryRequest() => new()
    {
        EventId = "event-123",
        EventName = "Autumn Supper",
        EventDate = "2026-10-31",
        Description = "An evening at the club.",
        BookingUrl = BookingUrl,
        PlanningContext = PlanningContext(includeBookingUrl: true),
        Artwork = Artwork()
    };

    private static CommunicationsPlanningContext PlanningContext(bool includeBookingUrl) => new()
    {
        RegistrationMode = "Free registration to estimate attendance",
        FreeEntry = "Yes",
        FreeEntryCategories = "Members, children",
        TicketPriceDetails = "Adults £30 & children £15",
        PaymentTiming = "Pay when booking",
        MaximumPlaces = "120",
        BookingRoutes = includeBookingUrl
            ? $"Online at {BookingUrl}"
            : "Members' app & the pro shop",
        GuestTableBooking = "Yes",
        BookingOpens = "Thursday 1 October 2026",
        BookingCloses = "Friday 30 October 2026",
        PublicBookingInstructions = includeBookingUrl
            ? "Please state dietary needs & accessibility requirements."
            : "Bring confirmation <script>alert(1)</script> to the event."
    };

    private static PublishAsset Artwork() => new()
    {
        OutputId = "member-email",
        Name = "Artwork",
        DataUrl = "data:image/png;base64,AA=="
    };

    private static int Count(string value, string candidate)
    {
        var count = 0;
        var index = 0;
        while ((index = value.IndexOf(candidate, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += candidate.Length;
        }

        return count;
    }

    private static string OpenAiResponse(string subject, string bodyHtml) =>
        JsonSerializer.Serialize(new
        {
            choices = new[]
            {
                new
                {
                    message = new
                    {
                        content = JsonSerializer.Serialize(new { subject, bodyHtml })
                    }
                }
            }
        });

    private sealed class TestClubBrandingStore : IClubBrandingStore
    {
        public Task<ClubBrandingOverview> GetOverviewAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new ClubBrandingOverview
            {
                ClubName = "Test Golf Club",
                CrestUrl = "/crest.png"
            });

        public Task<ClubCrestAsset?> GetCrestAsync(CancellationToken cancellationToken) =>
            Task.FromResult<ClubCrestAsset?>(null);

        public Task<ClubBrandingOverview> SaveAsync(
            string? clubName,
            IFormFile? crest,
            bool removeCustomCrest,
            CancellationToken cancellationToken) => throw new NotSupportedException();
    }

    private sealed class ThrowingHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) =>
            throw new InvalidOperationException("The fallback must not create an HTTP client without an API key.");
    }

    private sealed class StaticHttpClientFactory(HttpStatusCode statusCode, string content) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new StaticHandler(statusCode, content))
        {
            BaseAddress = new Uri("https://openai.example.test/")
        };
    }

    private sealed class StaticHandler(HttpStatusCode statusCode, string content) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(statusCode)
            {
                Content = new StringContent(content, Encoding.UTF8, "application/json")
            });
    }
}
