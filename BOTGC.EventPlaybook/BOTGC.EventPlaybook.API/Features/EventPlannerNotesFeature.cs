using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using MediatR;

namespace BOTGC.EventPlaybook.API.Features;

public sealed record SynchronisePlannerNoteRequest(
    string EventPlaybookEventId,
    int IntelligentGolfEventId,
    string Note);

public sealed record SynchronisePlannerNoteResult(
    string EventPlaybookEventId,
    int IntelligentGolfEventId,
    int? IntelligentGolfNoteId,
    bool Created,
    DateTimeOffset SynchronisedAtUtc);

public sealed record SynchronisePlannerNoteCommand(
    SynchronisePlannerNoteRequest Request) : IRequest<SynchronisePlannerNoteResult>;

public sealed class SynchronisePlannerNoteHandler(
    IIntelligentGolfTransport transport,
    IIntelligentGolfSession session,
    ICacheService cache,
    IDistributedLockManager lockManager,
    ILogger<SynchronisePlannerNoteHandler> logger)
    : IRequestHandler<SynchronisePlannerNoteCommand, SynchronisePlannerNoteResult>
{
    private static readonly TimeSpan LinkLifetime = TimeSpan.FromDays(3650);

    public async Task<SynchronisePlannerNoteResult> Handle(
        SynchronisePlannerNoteCommand command,
        CancellationToken cancellationToken)
    {
        var request = command.Request;
        Validate(request);
        var eventPlaybookEventId = request.EventPlaybookEventId.Trim();
        var note = request.Note.Trim();
        var fingerprint = Fingerprint(note);
        var marker = $"Managed by Event Playbook · event {eventPlaybookEventId}";
        var revisionMarker = $"{marker} · revision {fingerprint[..16]}";
        var managedNote = $"{note}\n\n[{revisionMarker}]";
        var cacheKey = $"intelligent-golf:planner-note:{eventPlaybookEventId.ToLowerInvariant()}";

        await using var noteLock = await lockManager.AcquireAsync(
            $"intelligent-golf:planner-note:{request.IntelligentGolfEventId}",
            cancellationToken);
        if (!noteLock.IsAcquired)
            throw new TimeoutException("Another request is currently updating this Intelligent Golf planning note. Try again shortly.");

        var link = await cache.GetAsync<ExternalPlannerNoteLink>(cacheKey, cancellationToken);
        if (link?.IntelligentGolfEventId != request.IntelligentGolfEventId) link = null;
        if (link is { Created: true } && string.Equals(link.Fingerprint, fingerprint, StringComparison.Ordinal))
        {
            return new SynchronisePlannerNoteResult(
                eventPlaybookEventId,
                request.IntelligentGolfEventId,
                link.IntelligentGolfNoteId,
                false,
                DateTimeOffset.UtcNow);
        }

        var notesPath = $"/event.php?eventid={request.IntelligentGolfEventId}&tab=notes";
        var notesPage = await GetAsync(notesPath, "planner-note-page", request, cancellationToken);
        var noteId = link?.IntelligentGolfNoteId ?? FindManagedNoteId(notesPage.Body, marker);
        if (noteId is null && link?.Created == true)
        {
            throw Failure(
                "planner-note-identity",
                request,
                "Event Playbook previously created the managed note, but Intelligent Golf no longer exposes its note ID. No additional note was created.");
        }

        var created = noteId is null;
        var assignedUserId = session.MemberId?.Trim();
        if (string.IsNullOrWhiteSpace(assignedUserId))
            throw Failure("planner-note-contract", request, "The authenticated Intelligent Golf user ID is unavailable.");

        var fields = BuildFields(request.IntelligentGolfEventId, noteId, assignedUserId, managedNote);
        IntelligentGolfTransportResponse saveResponse;
        try
        {
            saveResponse = await transport.PostFormResponseAsync(
                $"{notesPath}&requestType=ajax&ajaxaction=savenote",
                fields,
                cancellationToken);
        }
        catch (IntelligentGolfAuthenticationException) { throw; }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            throw Failure("planner-note-update", request, exception.Message, exception);
        }

        var rejection = IntelligentGolfMutationResponseInspector.FindRejection(saveResponse.Body);
        if (!string.IsNullOrWhiteSpace(rejection))
            throw Failure("planner-note-update", request, rejection);

        noteId ??= FindManagedNoteId(saveResponse.Body, marker);
        await cache.SetAsync(
            cacheKey,
            new ExternalPlannerNoteLink(request.IntelligentGolfEventId, noteId, true, fingerprint),
            LinkLifetime,
            cancellationToken);

        var verification = await GetAsync(
            $"{notesPath}&eventPlaybookVerify={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}",
            "planner-note-verification",
            request,
            cancellationToken);
        if (!IntelligentGolfMutationResponseInspector.ContainsText(verification.Body, revisionMarker))
        {
            throw Failure(
                "planner-note-verification",
                request,
                "Intelligent Golf did not return the managed note revision after saving it.");
        }

        noteId ??= FindManagedNoteId(verification.Body, marker);
        await cache.SetAsync(
            cacheKey,
            new ExternalPlannerNoteLink(request.IntelligentGolfEventId, noteId, true, fingerprint),
            LinkLifetime,
            cancellationToken);

        var synchronisedAt = DateTimeOffset.UtcNow;
        logger.LogInformation(
            "{Operation} managed Event Playbook note {IntelligentGolfNoteId} on Intelligent Golf planner entry {IntelligentGolfEventId}.",
            created ? "Created" : "Updated",
            noteId,
            request.IntelligentGolfEventId);
        return new SynchronisePlannerNoteResult(
            eventPlaybookEventId,
            request.IntelligentGolfEventId,
            noteId,
            created,
            synchronisedAt);
    }

    internal static IReadOnlyList<KeyValuePair<string, string>> BuildFields(
        int intelligentGolfEventId,
        int? noteId,
        string assignedUserId,
        string note) =>
        [
            new("noteid", noteId?.ToString(CultureInfo.InvariantCulture) ?? string.Empty),
            new("member_id", string.Empty),
            new("eventid", intelligentGolfEventId.ToString(CultureInfo.InvariantCulture)),
            new("actiontype", "0"),
            new("followupdate", string.Empty),
            new("assigned_userid", assignedUserId.Trim()),
            new("note", note)
        ];

    internal static int? FindManagedNoteId(string html, string marker)
    {
        if (string.IsNullOrWhiteSpace(html) || string.IsNullOrWhiteSpace(marker)) return null;
        var decoded = WebUtility.HtmlDecode(html);
        foreach (Match form in Regex.Matches(decoded, @"<form\b[^>]*>.*?</form\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline))
        {
            if (!form.Value.Contains(marker, StringComparison.OrdinalIgnoreCase)) continue;
            var id = ReadNoteId(form.Value);
            if (id is > 0) return id;
        }

        var markerIndex = decoded.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (markerIndex < 0) return null;
        var start = Math.Max(0, markerIndex - 5000);
        var length = Math.Min(decoded.Length - start, marker.Length + 10000);
        return ReadNoteId(decoded.Substring(start, length));
    }

    private static int? ReadNoteId(string value)
    {
        foreach (Match input in Regex.Matches(value, @"<input\b(?<attributes>[^>]*)>", RegexOptions.IgnoreCase | RegexOptions.Singleline))
        {
            var attributes = input.Groups["attributes"].Value;
            if (!string.Equals(ReadAttribute(attributes, "name"), "noteid", StringComparison.OrdinalIgnoreCase)) continue;
            if (int.TryParse(ReadAttribute(attributes, "value"), out var inputId) && inputId > 0) return inputId;
        }
        var inlineId = Regex.Match(
            value,
            """(?:data-note-id|data-noteid|noteid)\s*=\s*['"]?(?<id>\d+)""",
            RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return inlineId.Success && int.TryParse(inlineId.Groups["id"].Value, out var id) && id > 0 ? id : null;
    }

    private static string? ReadAttribute(string attributes, string name)
    {
        var match = Regex.Match(
            attributes,
            $"""(?:^|\s){Regex.Escape(name)}\s*=\s*(?:["'](?<quoted>.*?)["']|(?<plain>[^\s>]+))""",
            RegexOptions.IgnoreCase | RegexOptions.Singleline);
        if (!match.Success) return null;
        return WebUtility.HtmlDecode(match.Groups["quoted"].Success
            ? match.Groups["quoted"].Value
            : match.Groups["plain"].Value);
    }

    private async Task<IntelligentGolfTransportResponse> GetAsync(
        string path,
        string stage,
        SynchronisePlannerNoteRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            return await transport.GetResponseAsync(path, cancellationToken);
        }
        catch (IntelligentGolfAuthenticationException) { throw; }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            throw Failure(stage, request, exception.Message, exception);
        }
    }

    private static IntelligentGolfMutationException Failure(
        string stage,
        SynchronisePlannerNoteRequest request,
        string detail,
        Exception? innerException = null) =>
        new(
            stage,
            $"Intelligent Golf planner entry {request.IntelligentGolfEventId} could not save its Event Playbook planning note.",
            request.IntelligentGolfEventId,
            responseDetail: detail,
            innerException: innerException);

    private static string Fingerprint(string note) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(note)));

    private static void Validate(SynchronisePlannerNoteRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.EventPlaybookEventId))
            throw new ArgumentException("The Event Playbook event ID is required.");
        if (request.IntelligentGolfEventId <= 0)
            throw new ArgumentException("A linked Intelligent Golf planner entry is required.");
        if (string.IsNullOrWhiteSpace(request.Note))
            throw new ArgumentException("The Intelligent Golf planning note is empty.");
        if (request.Note.Trim().Length > 7000)
            throw new ArgumentException("The Intelligent Golf planning note cannot exceed 7,000 characters.");
    }

    private sealed record ExternalPlannerNoteLink(
        int IntelligentGolfEventId,
        int? IntelligentGolfNoteId,
        bool Created,
        string Fingerprint);
}
