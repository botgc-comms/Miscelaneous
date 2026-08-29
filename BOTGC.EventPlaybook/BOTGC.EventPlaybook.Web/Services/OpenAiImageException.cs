using System.Net;

namespace BOTGC.EventPlaybook.Services;

public sealed class OpenAiImageException(
    string message,
    HttpStatusCode upstreamStatusCode,
    bool retryable,
    string? requestId = null,
    string? errorCode = null,
    bool isSafetyRefusal = false) : InvalidOperationException(message)
{
    public HttpStatusCode UpstreamStatusCode { get; } = upstreamStatusCode;

    public bool Retryable { get; } = retryable;

    public string? RequestId { get; } = requestId;

    public string? ErrorCode { get; } = errorCode;

    public bool IsSafetyRefusal { get; } = isSafetyRefusal;
}
