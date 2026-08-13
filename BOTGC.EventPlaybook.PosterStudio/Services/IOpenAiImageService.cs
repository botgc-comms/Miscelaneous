using BOTGC.EventPlaybook.PosterStudio.Models;

namespace BOTGC.EventPlaybook.PosterStudio.Services;

public interface IOpenAiImageService
{
    Task<GeneratedArtworkResponse> GeneratePrimaryAsync(GeneratePosterRequest request, CancellationToken cancellationToken);

    Task<GeneratedArtworkResponse> GenerateVariantAsync(GenerateVariantRequest request, CancellationToken cancellationToken);
}
