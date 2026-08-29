using RedLockNet;
using RedLockNet.SERedis;

namespace BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;

public sealed class RedisDistributedLockManager(RedLockFactory factory) : IDistributedLockManager
{
    public async Task<IDistributedLock> AcquireAsync(
        string resource,
        CancellationToken cancellationToken = default)
    {
        var redLock = await factory.CreateLockAsync(
            resource,
            expiryTime: TimeSpan.FromMinutes(2),
            waitTime: TimeSpan.FromSeconds(10),
            retryTime: TimeSpan.FromMilliseconds(250),
            cancellationToken: cancellationToken);

        return new RedisDistributedLock(redLock);
    }

    private sealed class RedisDistributedLock(IRedLock redLock) : IDistributedLock
    {
        public bool IsAcquired => redLock.IsAcquired;

        public ValueTask DisposeAsync() => redLock.DisposeAsync();
    }
}

public sealed class LocalDistributedLockManager : IDistributedLockManager
{
    private readonly Dictionary<string, SemaphoreSlim> _locks = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public async Task<IDistributedLock> AcquireAsync(
        string resource,
        CancellationToken cancellationToken = default)
    {
        SemaphoreSlim semaphore;
        lock (_gate)
        {
            if (!_locks.TryGetValue(resource, out semaphore!))
            {
                semaphore = new SemaphoreSlim(1, 1);
                _locks[resource] = semaphore;
            }
        }

        await semaphore.WaitAsync(cancellationToken);
        return new LocalDistributedLock(semaphore);
    }

    private sealed class LocalDistributedLock(SemaphoreSlim semaphore) : IDistributedLock
    {
        private bool _disposed;

        public bool IsAcquired => !_disposed;

        public ValueTask DisposeAsync()
        {
            if (!_disposed)
            {
                _disposed = true;
                semaphore.Release();
            }

            return ValueTask.CompletedTask;
        }
    }
}
