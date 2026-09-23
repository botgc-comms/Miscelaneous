using System.Net;
using System.Text;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class PosterPromptVibrancyTests
{
    private const string ExpectedDirection = "Apply a restrained vibrancy pass";

    [Fact]
    public async Task GeneratedCreativeDirectorPromptAlwaysReceivesRestrainedVibrancyFinish()
    {
        var service = CreateService(
            "api-key",
            new StaticHttpClientFactory("""
                {"choices":[{"message":{"content":"Create an elegant finished event poster."}}]}
                """));

        var result = await service.BuildPrimaryPromptAsync(
            Request(),
            Event(),
            Style(),
            Output(),
            CancellationToken.None);

        Assert.Contains("Create an elegant finished event poster.", result.Prompt, StringComparison.Ordinal);
        Assert.Contains(ExpectedDirection, result.Prompt, StringComparison.Ordinal);
        Assert.Contains("avoid neon colour", result.Prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task DeterministicFallbackAlsoReceivesRestrainedVibrancyFinish()
    {
        var service = CreateService(string.Empty, new ThrowingHttpClientFactory());

        var result = await service.BuildPrimaryPromptAsync(
            Request(),
            Event(),
            Style(),
            Output(),
            CancellationToken.None);

        Assert.Equal("deterministic-fallback", result.Model);
        Assert.Contains(ExpectedDirection, result.Prompt, StringComparison.Ordinal);
    }

    private static OpenAiPromptService CreateService(string apiKey, IHttpClientFactory httpClientFactory) =>
        new(
            httpClientFactory,
            new TestPosterConfigurationService(Configuration()),
            new TestClubBrandingStore(),
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions { ApiKey = apiKey, PromptModel = "prompt-model" }),
            NullLogger<OpenAiPromptService>.Instance);

    private static GeneratePosterRequest Request() => new()
    {
        EventId = "event",
        StyleId = "style",
        EventDate = "2026-10-17",
        Description = "A cheese and wine evening.",
        IncludeDate = true,
        IncludePrice = true,
        Price = "£30",
        IsConceptPreview = true
    };

    private static EventDefinition Event() => new()
    {
        Id = "event",
        Name = "Cheese and Wine evening",
        Description = "A cheese and wine evening.",
        DefaultDate = "2026-10-17",
        DefaultPrice = "£30",
        SceneRecipe = new EventSceneRecipe
        {
            CentralIdea = "Wine and cheese",
            PrimaryScene = "A welcoming table",
            MustShow = [],
            SupportingDetails = [],
            MoodAndHumour = [],
            Avoid = []
        }
    };

    private static PosterStyleDefinition Style() => new()
    {
        Id = "style",
        Name = "Fine Art",
        Summary = "Painterly",
        StyleDirection = "Use an elegant painterly treatment.",
        ColourDirection = "Use a warm, balanced palette.",
        VisualLanguage = [],
        Mood = [],
        Avoid = []
    };

    private static PosterOutputDefinition Output() => new()
    {
        Id = "screen",
        Name = "Digital Screen",
        Width = 1080,
        Height = 1920,
        OpenAiSize = "1024x1536",
        Purpose = "Club screen",
        CompositionGuidance = "Use a clear portrait composition.",
        ReservedOverlayZones = [],
        IsPrimary = true
    };

    private static PosterConfiguration Configuration() => new()
    {
        Brand = new ClubBrand { Name = "Test Golf Club", ShortName = "TGC", Strapline = "Events" },
        Prompting = new PromptingConfiguration
        {
            CreativeDirectorInstruction = "Write an image prompt for {clubName}.",
            ColourQualityDirection = "Use clear colour and tonal separation.",
            GlobalImageRules = [],
            GlobalExclusions = []
        },
        ReferenceSelection = new ReferenceSelectionConfiguration
        {
            ProfileInstruction = "Profile references.",
            ScoringInstruction = "Score references."
        },
        Events = [Event()],
        Styles = [Style()],
        Outputs = [Output()]
    };

    private sealed class TestPosterConfigurationService(PosterConfiguration configuration) : IPosterConfigurationService
    {
        public PosterConfiguration Get() => configuration;
        public EventDefinition GetEvent(string eventId) => configuration.Events.Single(x => x.Id == eventId);
        public PosterStyleDefinition GetStyle(string styleId) => configuration.Styles.Single(x => x.Id == styleId);
        public PosterOutputDefinition GetOutput(string outputId) => configuration.Outputs.Single(x => x.Id == outputId);
    }

    private sealed class TestClubBrandingStore : IClubBrandingStore
    {
        public Task<ClubBrandingOverview> GetOverviewAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new ClubBrandingOverview { ClubName = "Test Golf Club", CrestUrl = "/crest.png" });

        public Task<ClubCrestAsset?> GetCrestAsync(CancellationToken cancellationToken) =>
            Task.FromResult<ClubCrestAsset?>(null);

        public Task<ClubBrandingOverview> SaveAsync(
            string? clubName,
            IFormFile? crest,
            bool removeCustomCrest,
            CancellationToken cancellationToken) => throw new NotSupportedException();
    }

    private sealed class StaticHttpClientFactory(string responseBody) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new StaticHandler(responseBody))
        {
            BaseAddress = new Uri("https://api.openai.test/v1/")
        };
    }

    private sealed class StaticHandler(string responseBody) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(responseBody, Encoding.UTF8, "application/json")
            });
    }

    private sealed class ThrowingHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new InvalidOperationException("HTTP should not be used without an API key.");
    }
}
