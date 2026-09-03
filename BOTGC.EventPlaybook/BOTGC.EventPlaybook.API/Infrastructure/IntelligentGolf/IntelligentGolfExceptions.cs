namespace BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;

public sealed class IntelligentGolfAuthenticationException(string message) : Exception(message);

public sealed class IntelligentGolfFeatureNotConfiguredException(string feature)
    : Exception($"The Intelligent Golf {feature} endpoint has not been configured.");

public sealed class IntelligentGolfEmailSenderNotConfiguredException()
    : Exception("The Intelligent Golf member email sender identity has not been configured in Plugin administration.");

public sealed class IntelligentGolfMutationException(
    string stage,
    string message,
    int? intelligentGolfEventId = null,
    string? responseDetail = null,
    Exception? innerException = null) : Exception(message, innerException)
{
    public string Stage { get; } = stage;
    public int? IntelligentGolfEventId { get; } = intelligentGolfEventId;
    public string? ResponseDetail { get; } = responseDetail;
}
