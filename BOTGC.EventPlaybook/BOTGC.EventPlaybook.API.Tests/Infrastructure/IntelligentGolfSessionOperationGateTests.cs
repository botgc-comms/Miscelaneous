using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using Xunit;

namespace BOTGC.EventPlaybook.API.Tests.Infrastructure;

public sealed class IntelligentGolfSessionOperationGateTests
{
    [Fact]
    public async Task ExclusiveOperation_AllowsNestedTransportCallsAndBlocksUnrelatedWork()
    {
        var gate = new IntelligentGolfSessionOperationGate();
        var outerEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseOuter = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var nestedCompleted = false;
        var competingEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var outer = gate.ExecuteAsync(async cancellationToken =>
        {
            await gate.ExecuteAsync(
                _ =>
                {
                    nestedCompleted = true;
                    return Task.CompletedTask;
                },
                cancellationToken);
            outerEntered.SetResult();
            await releaseOuter.Task.WaitAsync(cancellationToken);
        });

        await outerEntered.Task;
        var competing = gate.ExecuteAsync(
            _ =>
            {
                competingEntered.SetResult();
                return Task.CompletedTask;
            });

        var prematureEntry = await Task.WhenAny(competingEntered.Task, Task.Delay(100));
        Assert.NotSame(competingEntered.Task, prematureEntry);
        Assert.True(nestedCompleted);

        releaseOuter.SetResult();
        await Task.WhenAll(outer, competing);
        Assert.True(competingEntered.Task.IsCompletedSuccessfully);
    }
}
