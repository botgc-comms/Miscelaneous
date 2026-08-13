using TrophyCabinetDemo.Models;

namespace TrophyCabinetDemo.Services;

public sealed class TrophyCabinetLayoutService
{
    public TrophyCabinetViewModel Build(IReadOnlyList<TrophyMetadata> trophies)
    {
        ArgumentNullException.ThrowIfNull(trophies);

        var shelves = new List<TrophyShelfViewModel>();
        var currentRow = new List<TrophyPlacementViewModel>();
        var occupiedCells = 0;
        var rowIndex = 0;

        foreach (var trophy in trophies)
        {
            if (trophy.CellSpan == 2 && occupiedCells > 0)
            {
                shelves.Add(new TrophyShelfViewModel(rowIndex++, currentRow.ToArray()));
                currentRow = [];
                occupiedCells = 0;
            }

            if (occupiedCells + trophy.CellSpan > 2)
            {
                shelves.Add(new TrophyShelfViewModel(rowIndex++, currentRow.ToArray()));
                currentRow = [];
                occupiedCells = 0;
            }

            currentRow.Add(new TrophyPlacementViewModel(
                trophy.Name,
                $"/images/trophies/{trophy.ImageFile}",
                trophy.RelativeHeight,
                trophy.CellSpan,
                occupiedCells));

            occupiedCells += trophy.CellSpan;

            if (occupiedCells == 2)
            {
                shelves.Add(new TrophyShelfViewModel(rowIndex++, currentRow.ToArray()));
                currentRow = [];
                occupiedCells = 0;
            }
        }

        if (currentRow.Count > 0)
        {
            shelves.Add(new TrophyShelfViewModel(rowIndex, currentRow.ToArray()));
        }

        return new TrophyCabinetViewModel(shelves);
    }
}
