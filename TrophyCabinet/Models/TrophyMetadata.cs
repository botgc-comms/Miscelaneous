namespace TrophyCabinetDemo.Models;

public sealed record TrophyMetadata(
    string Name,
    string ImageFile,
    int RelativeHeight,
    int CellSpan)
{
    public void Validate(string metadataFile)
    {
        if (string.IsNullOrWhiteSpace(Name))
        {
            throw new InvalidDataException($"Metadata file '{metadataFile}' has no trophy name.");
        }

        if (string.IsNullOrWhiteSpace(ImageFile))
        {
            throw new InvalidDataException($"Metadata file '{metadataFile}' has no imageFile value.");
        }

        if (RelativeHeight is < 1 or > 10)
        {
            throw new InvalidDataException(
                $"Metadata file '{metadataFile}' has relativeHeight {RelativeHeight}. It must be between 1 and 10.");
        }

        if (CellSpan is < 1 or > 2)
        {
            throw new InvalidDataException(
                $"Metadata file '{metadataFile}' has cellSpan {CellSpan}. It must be either 1 or 2.");
        }
    }
}
