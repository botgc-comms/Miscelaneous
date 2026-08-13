using System.Text.Json;
using BOTGC.EventPlaybook.PosterStudio.Models;

namespace BOTGC.EventPlaybook.PosterStudio.Services;

public sealed class PosterConfigurationService : IPosterConfigurationService
{
    private readonly PosterConfiguration _configuration;

    public PosterConfigurationService(IWebHostEnvironment environment)
    {
        var path = Path.Combine(environment.ContentRootPath, "Data", "poster-config.json");
        var json = File.ReadAllText(path);

        _configuration = JsonSerializer.Deserialize<PosterConfiguration>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? throw new InvalidOperationException("Unable to load poster configuration.");
    }

    public PosterConfiguration Get() => _configuration;

    public EventDefinition GetEvent(string eventId) =>
        _configuration.Events.SingleOrDefault(x => string.Equals(x.Id, eventId, StringComparison.OrdinalIgnoreCase))
        ?? throw new KeyNotFoundException($"Unknown event '{eventId}'.");

    public PosterStyleDefinition GetStyle(string styleId) =>
        _configuration.Styles.SingleOrDefault(x => string.Equals(x.Id, styleId, StringComparison.OrdinalIgnoreCase))
        ?? throw new KeyNotFoundException($"Unknown poster style '{styleId}'.");

    public PosterOutputDefinition GetOutput(string outputId) =>
        _configuration.Outputs.SingleOrDefault(x => string.Equals(x.Id, outputId, StringComparison.OrdinalIgnoreCase))
        ?? throw new KeyNotFoundException($"Unknown poster output '{outputId}'.");
}
