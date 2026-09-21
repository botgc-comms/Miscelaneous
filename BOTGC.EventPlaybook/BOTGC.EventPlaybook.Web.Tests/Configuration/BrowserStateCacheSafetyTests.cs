using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Configuration;

public sealed class BrowserStateCacheSafetyTests
{
    [Fact]
    public void BrowserCacheQuotaFailureFallsBackWithoutAbortingTheApplication()
    {
        var script = File.ReadAllText(Path.Combine(
            FindSolutionRoot(),
            "BOTGC.EventPlaybook.Web",
            "wwwroot",
            "playbook-app.js"));

        Assert.Contains("function cacheBrowserState()", script, StringComparison.Ordinal);
        Assert.Contains("const attempts = browserStateCacheMode === 'compact' ? [true] : [false, true]", script, StringComparison.Ordinal);
        Assert.Contains("browserStateCacheMode = 'disabled';", script, StringComparison.Ordinal);
        Assert.Contains("Continuing with shared server storage and without a local fallback cache.", script, StringComparison.Ordinal);
        Assert.Contains("/^data:(?:image|audio|video|application\\/pdf)\\//i.test(value)", script, StringComparison.Ordinal);
        Assert.DoesNotContain("localStorage.setItem(STORAGE_STATE, JSON.stringify(browserState));", script, StringComparison.Ordinal);
    }

    [Fact]
    public void ServerBackedTemplateCachingIsAlsoNonFatal()
    {
        var script = File.ReadAllText(Path.Combine(
            FindSolutionRoot(),
            "BOTGC.EventPlaybook.Web",
            "wwwroot",
            "playbook-app.js"));

        Assert.Contains("function cachePlaybookTemplate(template)", script, StringComparison.Ordinal);
        Assert.Contains("cachePlaybookTemplate(serverTemplate);", script, StringComparison.Ordinal);
        Assert.Contains("cachePlaybookTemplate(playbook);", script, StringComparison.Ordinal);
    }

    private static string FindSolutionRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "BOTGC.EventPlaybook.sln")))
            {
                return directory.FullName;
            }
            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate the Event Playbook solution root.");
    }
}
