namespace BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;

/// <summary>
/// Serialises work performed through the single authenticated Intelligent Golf
/// PHP session. Nested calls made by one operation remain re-entrant so a
/// multi-request browser workflow can hold the session for its full duration.
/// </summary>
public sealed class IntelligentGolfSessionOperationGate
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly AsyncLocal<int> _operationDepth = new();

    public async Task ExecuteAsync(
        Func<CancellationToken, Task> operation,
        CancellationToken cancellationToken = default)
    {
        await ExecuteAsync(
            async operationToken =>
            {
                await operation(operationToken);
                return true;
            },
            cancellationToken);
    }

    public async Task<T> ExecuteAsync<T>(
        Func<CancellationToken, Task<T>> operation,
        CancellationToken cancellationToken = default)
    {
        if (_operationDepth.Value > 0)
        {
            return await operation(cancellationToken);
        }

        await _gate.WaitAsync(cancellationToken);
        _operationDepth.Value = 1;
        try
        {
            return await operation(cancellationToken);
        }
        finally
        {
            _operationDepth.Value = 0;
            _gate.Release();
        }
    }
}
