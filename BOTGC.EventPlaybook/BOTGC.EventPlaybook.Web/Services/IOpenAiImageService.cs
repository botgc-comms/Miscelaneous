using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface IOpenAiImageService
{
    Task<GeneratedArtworkResponse> GenerateConceptAsync(GeneratePosterRequest request, CancellationToken cancellationToken);

    Task<GeneratedArtworkResponse> GeneratePrimaryAsync(GeneratePosterRequest request, CancellationToken cancellationToken);

    Task<GeneratedArtworkResponse> GenerateVariantAsync(GenerateVariantRequest request, CancellationToken cancellationToken);
}
