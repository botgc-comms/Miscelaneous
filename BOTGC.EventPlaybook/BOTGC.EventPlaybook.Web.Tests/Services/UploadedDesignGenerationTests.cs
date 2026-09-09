using System.Net;
using System.Net.Http.Headers;
using System.Text;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Options;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class UploadedDesignGenerationTests
{
    private static readonly byte[] PngBytes =
    [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
    ];

    [Fact]
    public async Task PromptTreatsUploadedDesignAsSoleAuthorityAndLimitsChanges()
    {
        var service = new OpenAiPromptService(
            new ThrowingHttpClientFactory(),
            new TestPosterConfigurationService(Output()),
            new TestClubBrandingStore("Test Golf Club"),
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions
            {
                ApiKey = "prompt-api-key",
                PromptModel = "prompt-model"
            }),
            NullLogger<OpenAiPromptService>.Instance);

        var result = await service.BuildUploadedDesignPromptAsync(
            Request(refinementInstructions: "Change only the door time to 7pm."),
            Output(),
            CancellationToken.None);

        Assert.Equal("deterministic-uploaded-design-lock", result.Model);
        Assert.Contains("first and only attached image", result.Prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("sole authoritative reference", result.Prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("not a redesign", result.Prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Change only the door time to 7pm.", result.Prompt, StringComparison.Ordinal);
        Assert.Contains("exactly 1080 by 1080 pixels", result.Prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Saturday 12 December 2026", result.Prompt, StringComparison.Ordinal);
        Assert.Contains("£20", result.Prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("style preset", result.Prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("supporting reference", result.Prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ImageServiceEditsWithExactlyOneOriginalAndNoUnsupportedInputFidelity()
    {
        var handler = new CapturingImageHandler();
        var promptService = new RecordingPromptService();
        var service = new OpenAiImageService(
            new TestHttpClientFactory(handler),
            new TestPosterConfigurationService(Output()),
            promptService,
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions
            {
                ApiKey = "image-api-key",
                ImageModel = "gpt-image-2",
                ImageQuality = "high"
            }),
            NullLogger<OpenAiImageService>.Instance);

        var request = Request(refinementInstructions: "Retain everything except the corrected date.");
        var sourceDesign = await CreateRetainedDesignAsync("image/png", PngBytes);
        GeneratedArtworkResponse result;
        try
        {
            result = await service.GenerateFromUploadedDesignAsync(
                request,
                sourceDesign,
                CancellationToken.None);
        }
        finally
        {
            File.Delete(sourceDesign.Path);
        }

        Assert.Same(request, promptService.UploadedDesignRequest);
        Assert.Equal("/v1/images/edits", handler.RequestPath);
        Assert.Equal("gpt-image-2", handler.Fields["model"]);
        Assert.Equal("locked source prompt", handler.Fields["prompt"]);
        Assert.Equal("1024x1024", handler.Fields["size"]);
        Assert.Equal("high", handler.Fields["quality"]);
        Assert.Equal("png", handler.Fields["output_format"]);
        Assert.False(handler.Fields.ContainsKey("input_fidelity"));
        var image = Assert.Single(handler.Images);
        Assert.True(image.WasStreamed);
        Assert.Equal(PngBytes, image.Bytes);
        Assert.Equal("image/png", image.ContentType);
        Assert.Equal("performer-poster.png", image.FileName);
        Assert.Equal($"data:image/png;base64,{Convert.ToBase64String(PngBytes)}", result.DataUrl);
    }

    [Fact]
    public async Task ImageServiceRejectsAFileWhoseDeclaredTypeDoesNotMatchItsBytes()
    {
        var handler = new CapturingImageHandler();
        var service = new OpenAiImageService(
            new TestHttpClientFactory(handler),
            new TestPosterConfigurationService(Output()),
            new RecordingPromptService(),
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions
            {
                ApiKey = "image-api-key",
                ImageModel = "gpt-image-2"
            }),
            NullLogger<OpenAiImageService>.Instance);
        var request = Request();
        var sourceDesign = await CreateRetainedDesignAsync("image/jpeg", PngBytes);

        InvalidDataException exception;
        try
        {
            exception = await Assert.ThrowsAsync<InvalidDataException>(() =>
                service.GenerateFromUploadedDesignAsync(request, sourceDesign, CancellationToken.None));
        }
        finally
        {
            File.Delete(sourceDesign.Path);
        }

        Assert.Contains("not a valid PNG, JPEG or WebP", exception.Message, StringComparison.Ordinal);
        Assert.Null(handler.RequestPath);
    }

    [Fact]
    public async Task ImageServiceExplainsWhenTheRetainedSourceHasGoneMissing()
    {
        var handler = new CapturingImageHandler();
        var service = new OpenAiImageService(
            new TestHttpClientFactory(handler),
            new TestPosterConfigurationService(Output()),
            new RecordingPromptService(),
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions
            {
                ApiKey = "image-api-key",
                ImageModel = "gpt-image-2"
            }),
            NullLogger<OpenAiImageService>.Instance);
        var missingSource = new PosterArtworkFile
        {
            Path = Path.Combine(Path.GetTempPath(), $"missing-source-design-{Guid.NewGuid():N}.image"),
            ContentType = "image/png",
            Version = "missing-version"
        };

        var exception = await Assert.ThrowsAsync<InvalidDataException>(() =>
            service.GenerateFromUploadedDesignAsync(Request(), missingSource, CancellationToken.None));

        Assert.Contains("could not be found", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Upload the design again", exception.Message, StringComparison.Ordinal);
        Assert.Null(handler.RequestPath);
    }

    private static GenerateFromUploadedDesignRequest Request(string? refinementInstructions = null) => new()
    {
        EventId = "event-123",
        EventName = "Entertainer Night",
        OutputId = "social",
        EventDate = "2026-12-12",
        SourceDesignSessionKey = "event-123",
        SourceDesignVersion = "retained-version",
        SourceDesignFileName = "performer poster!!.webp",
        IncludeDate = true,
        IncludePrice = true,
        IncludeClubBranding = false,
        Price = "£20",
        RefinementInstructions = refinementInstructions
    };

    private static async Task<PosterArtworkFile> CreateRetainedDesignAsync(
        string contentType,
        byte[] bytes)
    {
        var path = Path.Combine(Path.GetTempPath(), $"event-playbook-source-design-{Guid.NewGuid():N}.image");
        await File.WriteAllBytesAsync(path, bytes);
        return new PosterArtworkFile
        {
            Path = path,
            ContentType = contentType,
            Version = "retained-version"
        };
    }

    private static PosterOutputDefinition Output() => new()
    {
        Id = "social",
        Name = "Email & Social",
        Width = 1080,
        Height = 1080,
        OpenAiSize = "1024x1024",
        Purpose = "Square campaign artwork",
        CompositionGuidance = "Reflow existing elements deliberately for a square frame.",
        ReservedOverlayZones = ["Keep existing text inside the safe edge."],
        IsPrimary = false
    };

    private sealed class TestPosterConfigurationService(PosterOutputDefinition output) : IPosterConfigurationService
    {
        public PosterOutputDefinition GetOutput(string outputId) =>
            string.Equals(outputId, output.Id, StringComparison.OrdinalIgnoreCase)
                ? output
                : throw new KeyNotFoundException();

        public PosterConfiguration Get() => throw new NotSupportedException();

        public EventDefinition GetEvent(string eventId) => throw new NotSupportedException();

        public PosterStyleDefinition GetStyle(string styleId) => throw new NotSupportedException();
    }

    private sealed class TestClubBrandingStore(string clubName) : IClubBrandingStore
    {
        public Task<ClubBrandingOverview> GetOverviewAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new ClubBrandingOverview
            {
                ClubName = clubName,
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

    private sealed class RecordingPromptService : IImagePromptService
    {
        public GenerateFromUploadedDesignRequest? UploadedDesignRequest { get; private set; }

        public Task<ImagePromptResult> BuildUploadedDesignPromptAsync(
            GenerateFromUploadedDesignRequest request,
            PosterOutputDefinition output,
            CancellationToken cancellationToken)
        {
            UploadedDesignRequest = request;
            return Task.FromResult(new ImagePromptResult
            {
                Prompt = "locked source prompt",
                Model = "test-prompt"
            });
        }

        public Task<ImagePromptResult> BuildPrimaryPromptAsync(
            GeneratePosterRequest request,
            EventDefinition eventDefinition,
            PosterStyleDefinition style,
            PosterOutputDefinition output,
            CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<ImagePromptResult> BuildVariantPromptAsync(
            GenerateVariantRequest request,
            EventDefinition eventDefinition,
            PosterStyleDefinition style,
            PosterOutputDefinition output,
            CancellationToken cancellationToken) => throw new NotSupportedException();
    }

    private sealed class ThrowingHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) =>
            throw new Xunit.Sdk.XunitException("The uploaded-design prompt must remain deterministic.");
    }

    private sealed class TestHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false)
        {
            BaseAddress = new Uri("https://api.openai.test/v1/")
        };
    }

    private sealed class CapturingImageHandler : HttpMessageHandler
    {
        public string? RequestPath { get; private set; }

        public Dictionary<string, string> Fields { get; } = new(StringComparer.Ordinal);

        public List<CapturedImage> Images { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            RequestPath = request.RequestUri?.AbsolutePath;
            var form = Assert.IsType<MultipartFormDataContent>(request.Content);
            foreach (var part in form)
            {
                var disposition = part.Headers.ContentDisposition;
                var name = disposition?.Name?.Trim('"') ?? string.Empty;
                if (string.Equals(name, "image[]", StringComparison.Ordinal))
                {
                    Images.Add(new CapturedImage(
                        disposition?.FileName?.Trim('"') ?? string.Empty,
                        part.Headers.ContentType?.MediaType,
                        part is StreamContent,
                        await part.ReadAsByteArrayAsync(cancellationToken)));
                }
                else
                {
                    Fields[name] = await part.ReadAsStringAsync(cancellationToken);
                }
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    $"{{\"data\":[{{\"b64_json\":\"{Convert.ToBase64String(PngBytes)}\"}}]}}",
                    Encoding.UTF8,
                    "application/json")
            };
        }
    }

    private sealed record CapturedImage(
        string FileName,
        string? ContentType,
        bool WasStreamed,
        byte[] Bytes);
}
