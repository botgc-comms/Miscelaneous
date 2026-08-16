using RuleReady.Web.Models;

namespace RuleReady.Web.ViewModels;

public sealed class CreateOrganisationViewModel
{
    public string Name { get; set; } = string.Empty;
    public OrganisationType Type { get; set; } = OrganisationType.Club;
}
