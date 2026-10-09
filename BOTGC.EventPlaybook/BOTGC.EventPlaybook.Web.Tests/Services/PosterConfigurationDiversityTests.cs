using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class PosterConfigurationDiversityTests
{
    [Fact]
    public void ActiveStyleLibraryExposesFamiliesPaletteTonesAndMixedMedia()
    {
        var contentRoot = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..", "..",
            "BOTGC.EventPlaybook.Web"));
        var service = new PosterConfigurationService(new TestEnvironment(contentRoot));

        var childrensBook = service.GetStyle("childrens-book");
        Assert.Equal(16, childrensBook.Variations.Count);
        Assert.Equal(8, childrensBook.Variations.Count(variation => variation.IsMixedMedia));
        Assert.Equal(4, childrensBook.Variations.Count(variation =>
            string.Equals(variation.DiversityFamily, "Dr. Seuss", StringComparison.OrdinalIgnoreCase)));

        var moviePosters = service.GetStyle("movie-posters");
        Assert.Equal(3, moviePosters.Variations.Count(variation =>
            string.Equals(variation.DiversityFamily, "Drew Struzan", StringComparison.OrdinalIgnoreCase)));
        Assert.Contains(moviePosters.Variations, variation => variation.PaletteTone == "dark");
        Assert.Contains(moviePosters.Variations, variation => variation.PaletteTone != "dark");
    }

    private sealed class TestEnvironment(string contentRoot) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "BOTGC.EventPlaybook.Web.Tests";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = Path.Combine(contentRoot, "wwwroot");
        public string EnvironmentName { get; set; } = "Testing";
        public string ContentRootPath { get; set; } = contentRoot;
        public IFileProvider ContentRootFileProvider { get; set; } = new PhysicalFileProvider(contentRoot);
    }
}
