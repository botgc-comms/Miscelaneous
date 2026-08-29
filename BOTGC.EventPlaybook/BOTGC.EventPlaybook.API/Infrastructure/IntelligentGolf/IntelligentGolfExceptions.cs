namespace BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;

public sealed class IntelligentGolfAuthenticationException(string message) : Exception(message);

public sealed class IntelligentGolfFeatureNotConfiguredException(string feature)
    : Exception($"The Intelligent Golf {feature} endpoint has not been configured.");
