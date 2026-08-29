using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface IPosterConfigurationService
{
    PosterConfiguration Get();

    EventDefinition GetEvent(string eventId);

    PosterStyleDefinition GetStyle(string styleId);

    PosterOutputDefinition GetOutput(string outputId);
}
