namespace TrophyCabinetDemo.Models;

public sealed record TrophyCabinetViewModel(
    IReadOnlyList<TrophyShelfViewModel> Shelves)
{
    public int RowCount => Math.Max(2, Shelves.Count);
}

public sealed record TrophyShelfViewModel(
    int RowIndex,
    IReadOnlyList<TrophyPlacementViewModel> Trophies);

public sealed record TrophyPlacementViewModel(
    string Name,
    string ImageUrl,
    int RelativeHeight,
    int CellSpan,
    int StartColumn)
{
    public decimal HeightPercent => 40m + ((RelativeHeight - 1) * (55m / 9m));
}
