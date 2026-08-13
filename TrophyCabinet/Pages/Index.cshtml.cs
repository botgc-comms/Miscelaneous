using Microsoft.AspNetCore.Mvc.RazorPages;
using TrophyCabinetDemo.Models;
using TrophyCabinetDemo.Services;

namespace TrophyCabinetDemo.Pages;

public sealed class IndexModel(
    TrophyMetadataLoader metadataLoader,
    TrophyCabinetLayoutService layoutService)
    : PageModel
{
    private readonly TrophyMetadataLoader _metadataLoader =
        metadataLoader ?? throw new ArgumentNullException(nameof(metadataLoader));

    private readonly TrophyCabinetLayoutService _layoutService =
        layoutService ?? throw new ArgumentNullException(nameof(layoutService));

    public TrophyCabinetViewModel Cabinet { get; private set; } =
        new TrophyCabinetViewModel([]);

    public async Task OnGetAsync(CancellationToken cancellationToken)
    {
        var trophies = await _metadataLoader.LoadAsync(cancellationToken);
        Cabinet = _layoutService.Build(trophies);
    }
}
