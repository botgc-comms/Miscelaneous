using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface IIntelligentGolfDiaryPublisher
{
    bool IsConfigured { get; }

    Task<MemberDiaryPublishResult> UpsertAsync(
        MemberDiaryPublishCommand command,
        CancellationToken cancellationToken);
}
