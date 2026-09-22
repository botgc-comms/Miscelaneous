using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class TaskCompletionRegistryRecoveryTests : IDisposable
{
    private readonly string _contentRoot = Path.Combine(
        Path.GetTempPath(),
        $"event-playbook-completion-recovery-tests-{Guid.NewGuid():N}");

    [Fact]
    public async Task TruncatedRegistryRecoversCompletePrefixAndRewritesValidJson()
    {
        var dataDirectory = Path.Combine(_contentRoot, "App_Data");
        Directory.CreateDirectory(dataDirectory);
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true };
        var records = new[]
        {
            Record("token-one", "First task"),
            Record("token-two", "Second task")
        };
        var json = JsonSerializer.Serialize(records, options);
        var truncateAt = json.IndexOf("Second task", StringComparison.Ordinal) + 6;
        await File.WriteAllTextAsync(Path.Combine(dataDirectory, "task-completions.json"), json[..truncateAt]);

        var registry = new TaskCompletionRegistry(new TestWebHostEnvironment(_contentRoot));
        var recovered = await registry.GetAsync("token-one", CancellationToken.None);

        Assert.NotNull(recovered);
        Assert.Equal("First task", recovered.TaskTitle);
        var rewritten = JsonSerializer.Deserialize<List<TaskCompletionRecord>>(
            await File.ReadAllTextAsync(Path.Combine(dataDirectory, "task-completions.json")),
            options);
        Assert.Single(rewritten!);
        Assert.Equal("token-one", rewritten![0].Token);
    }

    public void Dispose()
    {
        if (!Directory.Exists(_contentRoot)) return;
        var resolved = Path.GetFullPath(_contentRoot);
        if (!resolved.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(resolved).StartsWith("event-playbook-completion-recovery-tests-", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Unexpected test cleanup path: {resolved}");
        }
        Directory.Delete(resolved, recursive: true);
    }

    private static TaskCompletionRecord Record(string token, string title) => new()
    {
        Token = token,
        EventId = "event-1",
        EventName = "Test event",
        TaskId = $"task-{token}",
        TaskTitle = title,
        RegisteredAtUtc = DateTimeOffset.UtcNow
    };

    private sealed class TestWebHostEnvironment(string contentRootPath) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "BOTGC.EventPlaybook.Web.Tests";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = Path.Combine(contentRootPath, "wwwroot");
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = contentRootPath;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
