using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface IReferenceRelevanceService
{
    Task<ReferenceRelevanceProfile> CompileProfileAsync(
        CompileReferenceProfileRequest request,
        CancellationToken cancellationToken);

    Task<ReferenceSelectionResult> SelectAsync(
        SelectReferenceImagesRequest request,
        CancellationToken cancellationToken);
}
