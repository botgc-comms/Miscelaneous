using System.Text.Json;

namespace BOTGC.EventPlaybook.Models;

public sealed class SharedPlaybookStateDocument
{
    public long Revision { get; set; }
    public DateTimeOffset? UpdatedAtUtc { get; set; }
    public JsonElement? State { get; set; }
}

public sealed class SaveSharedPlaybookStateRequest
{
    public long Revision { get; set; }
    public JsonElement State { get; set; }
}

public sealed class PosterSessionDocument
{
    public required string Key { get; set; }
    public long Revision { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
    public JsonElement Session { get; set; }
}

public sealed class SavePosterSessionRequest
{
    public JsonElement Session { get; set; }
}
