using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public sealed class YodeckUnavailableException(string message) : InvalidOperationException(message);

public interface IYodeckPublisher
{
    Task<YodeckPublishResult> PublishAsync(
        YodeckPublishCommand command,
        CancellationToken cancellationToken);

    Task<YodeckTakeDownResult> TakeDownAsync(
        YodeckTakeDownCommand command,
        CancellationToken cancellationToken);
}
