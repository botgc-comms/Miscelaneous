using BOTGC.EventPlaybook.PosterStudio.Models;

namespace BOTGC.EventPlaybook.PosterStudio.Services;

public interface IPosterConfigurationService
{
    PosterConfiguration Get();

    EventDefinition GetEvent(string eventId);

    PosterStyleDefinition GetStyle(string styleId);

    PosterOutputDefinition GetOutput(string outputId);
}
