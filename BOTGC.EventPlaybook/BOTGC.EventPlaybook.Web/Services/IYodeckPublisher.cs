using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface IYodeckPublisher
{
    bool IsConfigured { get; }

    Task<YodeckPublishResult> PublishAsync(
        YodeckPublishCommand command,
        CancellationToken cancellationToken);
}
