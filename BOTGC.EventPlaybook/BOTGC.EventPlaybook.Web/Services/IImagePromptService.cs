using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface IImagePromptService
{
    Task<ImagePromptResult> BuildPrimaryPromptAsync(
        GeneratePosterRequest request,
        EventDefinition eventDefinition,
        PosterStyleDefinition style,
        PosterOutputDefinition output,
        CancellationToken cancellationToken);

    Task<ImagePromptResult> BuildVariantPromptAsync(
        GenerateVariantRequest request,
        EventDefinition eventDefinition,
        PosterStyleDefinition style,
        PosterOutputDefinition output,
        CancellationToken cancellationToken);
}
