using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using BOTGC.EventPlaybook.API.Features.MemberEmail;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using BOTGC.EventPlaybook.API.Options;
using HtmlAgilityPack;
using MediatR;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.API.Features.Competitions;

public enum CompetitionGender
{
    Unknown,
    Ladies,
    Juniors,
    Gents,
    Mixed
}

public sealed record AvailableCompetition(
    int Id,
    string Name,
    DateTime? Date,
    CompetitionGender Gender,
    bool IsHandicapQualifying,
    bool IsMultiday,
    bool IsAlternateDay);

public sealed record GetAvailableCompetitionsQuery(
    bool IncludeActive,
    bool IncludeUpcoming,
    int? Year,
    DateOnly? Date,
    bool Refresh) : IRequest<IReadOnlyList<AvailableCompetition>>;

public sealed record CompetitionAdvertisingArtwork(
    string FileName,
    string ContentType,
    string Base64Data);

public sealed record UpdateCompetitionAdvertisingRequest(
    string EventPlaybookEventId,
    string DescriptionHtml,
    CompetitionAdvertisingArtwork Artwork);

public sealed record UpdateCompetitionAdvertisingResult(
    string EventPlaybookEventId,
    int IntelligentGolfCompetitionId,
    string ImageFileName,
    bool DescriptionUpdated,
    bool ImageAttached,
    DateTimeOffset UpdatedAtUtc);

public sealed record UpdateCompetitionAdvertisingCommand(
    int IntelligentGolfCompetitionId,
    UpdateCompetitionAdvertisingRequest Request) : IRequest<UpdateCompetitionAdvertisingResult>;

public sealed class GetAvailableCompetitionsHandler(
    IOptions<IntelligentGolfOptions> intelligentGolfOptions,
    IOptions<CacheOptions> cacheOptions,
    IIntelligentGolfReportClient reports,
    IIntelligentGolfReportParser<AvailableCompetition> parser)
    : IRequestHandler<GetAvailableCompetitionsQuery, IReadOnlyList<AvailableCompetition>>
{
    public async Task<IReadOnlyList<AvailableCompetition>> Handle(
        GetAvailableCompetitionsQuery request,
        CancellationToken cancellationToken)
    {
        if (!request.IncludeActive && !request.IncludeUpcoming)
        {
            return [];
        }

        var settings = intelligentGolfOptions.Value.Endpoints;
        var ttl = TimeSpan.FromMinutes(cacheOptions.Value.CompetitionTtlMinutes);
        var year = (request.Date?.Year ?? request.Year)?.ToString(CultureInfo.InvariantCulture) ?? "all";
        var fetches = new List<Task<IReadOnlyList<AvailableCompetition>>>();

        if (request.IncludeActive)
        {
            fetches.Add(FetchAsync(settings.ActiveCompetitionsPath, "active"));
        }

        if (request.IncludeUpcoming)
        {
            fetches.Add(FetchAsync(settings.UpcomingCompetitionsPath, "upcoming"));
        }

        var resultSets = await Task.WhenAll(fetches);
        var competitions = resultSets
            .SelectMany(result => result)
            .GroupBy(competition => competition.Id)
            .Select(group => group.First())
            .Where(competition => request.Date.HasValue
                ? competition.Date.HasValue && DateOnly.FromDateTime(competition.Date.Value) == request.Date.Value
                : !competition.Date.HasValue || competition.Date.Value.Date >= DateTime.Today)
            .OrderBy(competition => competition.Date)
            .ThenBy(competition => competition.Name)
            .ToList();
        return competitions;

        Task<IReadOnlyList<AvailableCompetition>> FetchAsync(string path, string status)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new IntelligentGolfFeatureNotConfiguredException($"{status} competitions");
            }

            return reports.GetAsync(
                path.Replace("{year}", year, StringComparison.OrdinalIgnoreCase),
                parser,
                $"event-planner:competitions:{status}:{year}",
                ttl,
                request.Refresh,
                cancellationToken);
        }
    }
}

public sealed class IntelligentGolfCompetitionReportParser(
    ILogger<IntelligentGolfCompetitionReportParser> logger)
    : IIntelligentGolfReportParser<AvailableCompetition>
{
    public Task<IReadOnlyList<AvailableCompetition>> ParseAsync(
        HtmlDocument document,
        CancellationToken cancellationToken = default)
    {
        var result = new List<AvailableCompetition>();
        var rows = document.DocumentNode.SelectNodes("//tr");
        if (rows is null)
        {
            return Task.FromResult<IReadOnlyList<AvailableCompetition>>(result);
        }

        foreach (var row in rows)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var cells = row.SelectNodes(".//td");
            if (cells is null || cells.Count < 4)
            {
                continue;
            }

            var nameHtml = cells[0].InnerHtml;
            var detailsHtml = cells[3].InnerHtml;
            var idMatch = Regex.Match(nameHtml, @"[?&]compid=(\d+)", RegexOptions.IgnoreCase);
            if (!idMatch.Success || !int.TryParse(idMatch.Groups[1].Value, out var id))
            {
                continue;
            }

            var name = CleanName(nameHtml);
            if (string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            var dateHtml = cells[1].InnerHtml;
            result.Add(new AvailableCompetition(
                id,
                name,
                ParseDate(cells[1].InnerText),
                ParseGender(detailsHtml),
                detailsHtml.Contains("acceptable for handicapping", StringComparison.OrdinalIgnoreCase),
                Regex.IsMatch(HtmlEntity.DeEntitize(cells[1].InnerText), @"\bMultiday\b", RegexOptions.IgnoreCase),
                detailsHtml.Contains("fa-code-fork", StringComparison.OrdinalIgnoreCase) &&
                !dateHtml.Contains("Multiday", StringComparison.OrdinalIgnoreCase)));
        }

        logger.LogInformation("Parsed {Count} available competitions from Intelligent Golf.", result.Count);
        return Task.FromResult<IReadOnlyList<AvailableCompetition>>(result);
    }

    private static string CleanName(string html)
    {
        var name = HtmlEntity.DeEntitize(Regex.Replace(html, "<.*?>", string.Empty)).Trim();
        name = Regex.Replace(name, "H\\s*$", string.Empty).Trim();
        name = Regex.Replace(name, "\\s*-\\s*[^-]*Tees?\\s*$", string.Empty, RegexOptions.IgnoreCase).Trim();
        return Regex.Replace(name, "[(]\\s*[^)]*Tees?\\s*[)]\\s*$", string.Empty, RegexOptions.IgnoreCase).Trim();
    }

    private static CompetitionGender ParseGender(string html)
    {
        if (html.Contains("fa-venus-mars", StringComparison.OrdinalIgnoreCase))
        {
            return CompetitionGender.Mixed;
        }

        if (html.Contains("fa-venus", StringComparison.OrdinalIgnoreCase))
        {
            return CompetitionGender.Ladies;
        }

        return html.Contains("fa-mars", StringComparison.OrdinalIgnoreCase)
            ? CompetitionGender.Gents
            : CompetitionGender.Unknown;
    }

    private static DateTime? ParseDate(string value)
    {
        var text = HtmlEntity.DeEntitize(value);
        text = Regex.Replace(text, @"(\d+)(st|nd|rd|th)", "$1", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\s{2,}", " ").Trim();

        if (!Regex.IsMatch(text, @"\d{4}$"))
        {
            text += $" {DateTime.Today.Year}";
        }

        return DateTime.TryParseExact(
            text,
            "dddd d MMMM yyyy",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out var result)
            ? result
            : null;
    }
}

public sealed class UpdateCompetitionAdvertisingHandler(
    IIntelligentGolfTransport transport,
    IDistributedLockManager lockManager,
    ILogger<UpdateCompetitionAdvertisingHandler> logger)
    : IRequestHandler<UpdateCompetitionAdvertisingCommand, UpdateCompetitionAdvertisingResult>
{
    private const int MaximumArtworkBytes = 20 * 1024 * 1024;

    public async Task<UpdateCompetitionAdvertisingResult> Handle(
        UpdateCompetitionAdvertisingCommand command,
        CancellationToken cancellationToken)
    {
        var competitionId = command.IntelligentGolfCompetitionId;
        var request = command.Request;
        if (competitionId <= 0)
            throw new ArgumentException("The Intelligent Golf competition ID must be greater than zero.");
        if (string.IsNullOrWhiteSpace(request.EventPlaybookEventId))
            throw new ArgumentException("The Event Playbook event ID is required.");

        var descriptionHtml = MemberEmailHtmlSanitizer.Sanitise(request.DescriptionHtml);
        if (string.IsNullOrWhiteSpace(descriptionHtml))
            throw new ArgumentException("The competition description is required.");
        if (descriptionHtml.Length > 200_000)
            throw new ArgumentException("The competition description is too long.");

        var artwork = ResolveArtwork(request.Artwork);
        await using var competitionLock = await lockManager.AcquireAsync(
            $"intelligent-golf:competition-advertising:{competitionId}",
            cancellationToken);
        if (!competitionLock.IsAcquired)
            throw new TimeoutException("Another request is currently updating this Intelligent Golf competition. Try again shortly.");

        var settingsPath = $"/compadmin3.php?compid={competitionId}&tab=settings";
        var uploadPath = $"{settingsPath}&requestType=ajax&ajaxaction=compimageupload";
        var savePath = $"{settingsPath}&requestType=ajax&ajaxaction=savecomp";

        return await transport.ExecuteExclusiveAsync(async operationToken =>
        {
            for (var attempt = 0; attempt < 2; attempt++)
            {
                var settings = await ReadSettingsAsync(settingsPath, competitionId, operationToken);
                IntelligentGolfTransportResponse uploadResponse;
                try
                {
                    uploadResponse = await transport.PostMultipartResponseAsync(
                        uploadPath,
                        [new("name", artwork.FileName), new("undefined", "undefined")],
                        new IntelligentGolfMultipartFile("file", artwork.FileName, "image/png", artwork.Content),
                        operationToken);
                }
                catch (Exception exception) when (exception is not OperationCanceledException || !operationToken.IsCancellationRequested)
                {
                    throw Mutation(
                        "competition-image-upload",
                        competitionId,
                        "The competition artwork could not be uploaded to Intelligent Golf.",
                        exception.Message,
                        exception);
                }

                var uploadRejection = IntelligentGolfMutationResponseInspector.FindRejection(uploadResponse.Body);
                if (!string.IsNullOrWhiteSpace(uploadRejection))
                    throw Mutation(
                        "competition-image-upload",
                        competitionId,
                        "Intelligent Golf rejected the competition artwork upload.",
                        uploadRejection);

                var uploadedFileName = ExtractUploadedFileName(uploadResponse.Body)
                    ?? throw Mutation(
                        "competition-image-upload-response",
                        competitionId,
                        "Intelligent Golf accepted the upload request but did not return the saved competition image name.",
                        IntelligentGolfMutationResponseInspector.Summarise(uploadResponse.Body));

                var fields = PatchAdvertisingFields(settings.Fields, descriptionHtml, uploadedFileName);
                IntelligentGolfTransportResponse saveResponse;
                try
                {
                    saveResponse = await transport.PostFormResponseAsync(savePath, fields, operationToken);
                }
                catch (Exception exception) when (exception is not OperationCanceledException || !operationToken.IsCancellationRequested)
                {
                    throw Mutation(
                        "competition-settings-save",
                        competitionId,
                        "The artwork was uploaded, but Intelligent Golf could not update the competition description and image.",
                        exception.Message,
                        exception);
                }

                // An authentication refresh between upload and save can discard
                // Intelligent Golf's session-scoped upload. Repeat the complete
                // read/upload/save sequence rather than accepting a detached save.
                if (saveResponse.SessionRefreshed) continue;

                var saveRejection = IntelligentGolfMutationResponseInspector.FindRejection(saveResponse.Body);
                if (!string.IsNullOrWhiteSpace(saveRejection) ||
                    !ContainsSaveConfirmation(saveResponse.Body, competitionId))
                {
                    throw Mutation(
                        "competition-settings-save-response",
                        competitionId,
                        "Intelligent Golf did not confirm the competition description and image update.",
                        saveRejection ?? IntelligentGolfMutationResponseInspector.Summarise(saveResponse.Body));
                }

                var verified = await ReadSettingsAsync(settingsPath, competitionId, operationToken);
                var verifiedDescription = FirstValue(verified.Fields, "comments");
                var verifiedImage = FirstValue(verified.Fields, "image");
                if (!string.Equals(verifiedDescription?.Trim(), descriptionHtml.Trim(), StringComparison.Ordinal) ||
                    !string.Equals(verifiedImage, uploadedFileName, StringComparison.OrdinalIgnoreCase))
                {
                    throw Mutation(
                        "competition-settings-verification",
                        competitionId,
                        "Intelligent Golf returned the competition settings page, but the saved description or image did not match the requested update.",
                        $"Expected image '{uploadedFileName}'.");
                }

                var updatedAt = DateTimeOffset.UtcNow;
                logger.LogInformation(
                    "Updated the member-facing description and image on Intelligent Golf competition {CompetitionId} for Event Playbook event {EventId}.",
                    competitionId,
                    request.EventPlaybookEventId);
                return new UpdateCompetitionAdvertisingResult(
                    request.EventPlaybookEventId.Trim(),
                    competitionId,
                    uploadedFileName,
                    true,
                    true,
                    updatedAt);
            }

            throw Mutation(
                "competition-settings-save",
                competitionId,
                "Intelligent Golf refreshed its session while attaching the competition image. Try again.");
        }, cancellationToken);
    }

    private async Task<CompetitionSettings> ReadSettingsAsync(
        string path,
        int competitionId,
        CancellationToken cancellationToken)
    {
        try
        {
            var document = await transport.GetDocumentAsync(path, cancellationToken);
            var form = document.DocumentNode.SelectSingleNode("//*[@id='compform']")
                ?? throw Mutation(
                    "competition-settings-read-response",
                    competitionId,
                    "Event Playbook could not recognise the Intelligent Golf competition settings form, so no settings were changed.");
            var fields = SerialiseSuccessfulControls(form);
            if (string.IsNullOrWhiteSpace(FirstValue(fields, "compname")) ||
                string.IsNullOrWhiteSpace(FirstValue(fields, "compdate")) ||
                !fields.Any(field => field.Key.Equals("comments", StringComparison.OrdinalIgnoreCase)) ||
                !fields.Any(field => field.Key.Equals("image", StringComparison.OrdinalIgnoreCase)))
            {
                throw Mutation(
                    "competition-settings-read-response",
                    competitionId,
                    "The Intelligent Golf competition settings form was incomplete, so no settings were changed.");
            }
            return new CompetitionSettings(fields);
        }
        catch (IntelligentGolfAuthenticationException)
        {
            throw;
        }
        catch (IntelligentGolfMutationException)
        {
            throw;
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            throw Mutation(
                "competition-settings-read",
                competitionId,
                "The Intelligent Golf competition settings could not be loaded, so no settings were changed.",
                exception.Message,
                exception);
        }
    }

    internal static IReadOnlyList<KeyValuePair<string, string>> SerialiseSuccessfulControls(HtmlNode form)
    {
        var fields = new List<KeyValuePair<string, string>>();
        foreach (var control in form.SelectNodes(".//input[@name] | .//select[@name] | .//textarea[@name]") ?? Enumerable.Empty<HtmlNode>())
        {
            if (control.Attributes["disabled"] is not null) continue;
            var name = control.GetAttributeValue("name", string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(name)) continue;

            if (control.Name.Equals("textarea", StringComparison.OrdinalIgnoreCase))
            {
                fields.Add(new(name, HtmlEntity.DeEntitize(control.InnerText)));
                continue;
            }

            if (control.Name.Equals("select", StringComparison.OrdinalIgnoreCase))
            {
                var options = control.SelectNodes(".//option[@selected]")?.ToList() ?? [];
                if (options.Count == 0 && control.Attributes["multiple"] is null)
                {
                    var first = control.SelectSingleNode(".//option[1]");
                    if (first is not null) options.Add(first);
                }
                fields.AddRange(options.Select(option => new KeyValuePair<string, string>(
                    name,
                    HtmlEntity.DeEntitize(option.GetAttributeValue("value", option.InnerText)))));
                continue;
            }

            var type = control.GetAttributeValue("type", "text");
            if (type.Equals("checkbox", StringComparison.OrdinalIgnoreCase) ||
                type.Equals("radio", StringComparison.OrdinalIgnoreCase))
            {
                if (control.Attributes["checked"] is null) continue;
            }
            else if (type.Equals("submit", StringComparison.OrdinalIgnoreCase) ||
                     type.Equals("button", StringComparison.OrdinalIgnoreCase) ||
                     type.Equals("reset", StringComparison.OrdinalIgnoreCase) ||
                     type.Equals("file", StringComparison.OrdinalIgnoreCase) ||
                     type.Equals("image", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            fields.Add(new(name, HtmlEntity.DeEntitize(control.GetAttributeValue("value", string.Empty))));
        }
        return fields;
    }

    private static IReadOnlyList<KeyValuePair<string, string>> PatchAdvertisingFields(
        IReadOnlyList<KeyValuePair<string, string>> fields,
        string descriptionHtml,
        string imageFileName) =>
        fields.Select(field => field.Key.Equals("comments", StringComparison.OrdinalIgnoreCase)
                ? new KeyValuePair<string, string>(field.Key, descriptionHtml)
                : field.Key.Equals("image", StringComparison.OrdinalIgnoreCase)
                    ? new KeyValuePair<string, string>(field.Key, imageFileName)
                    : field)
            .ToArray();

    private static string? FirstValue(
        IReadOnlyList<KeyValuePair<string, string>> fields,
        string name) =>
        fields.FirstOrDefault(field => field.Key.Equals(name, StringComparison.OrdinalIgnoreCase)).Value;

    private static string? ExtractUploadedFileName(string raw)
    {
        try
        {
            using var json = JsonDocument.Parse(raw);
            if (!json.RootElement.TryGetProperty("actions", out var actions) ||
                actions.ValueKind != JsonValueKind.Array) return null;
            foreach (var action in actions.EnumerateArray())
            {
                if (!action.TryGetProperty("type", out var type) ||
                    !string.Equals(type.GetString(), "setvalue", StringComparison.OrdinalIgnoreCase) ||
                    !action.TryGetProperty("selector", out var selector) ||
                    !string.Equals(selector.GetString(), "#compImageInput", StringComparison.OrdinalIgnoreCase) ||
                    !action.TryGetProperty("value", out var value)) continue;
                var fileName = Path.GetFileName(value.GetString()?.Trim());
                return string.IsNullOrWhiteSpace(fileName) ? null : fileName;
            }
        }
        catch (JsonException)
        {
            return null;
        }
        return null;
    }

    private static bool ContainsSaveConfirmation(string raw, int competitionId)
    {
        try
        {
            using var json = JsonDocument.Parse(raw);
            if (!json.RootElement.TryGetProperty("actions", out var actions) ||
                actions.ValueKind != JsonValueKind.Array) return false;
            return actions.EnumerateArray().Any(action =>
                action.TryGetProperty("type", out var type) &&
                string.Equals(type.GetString(), "redirect", StringComparison.OrdinalIgnoreCase) &&
                action.TryGetProperty("data", out var data) &&
                (data.GetString() ?? string.Empty).Contains(
                    $"compadmin3.php?compid={competitionId}&tab=settings",
                    StringComparison.OrdinalIgnoreCase));
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static ResolvedArtwork ResolveArtwork(CompetitionAdvertisingArtwork artwork)
    {
        if (artwork is null) throw new ArgumentException("Competition artwork is required.");
        if (!string.Equals(artwork.ContentType?.Trim(), "image/png", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Competition artwork must be a PNG image.");
        byte[] content;
        try
        {
            content = Convert.FromBase64String(artwork.Base64Data?.Trim() ?? string.Empty);
        }
        catch (FormatException)
        {
            throw new ArgumentException("Competition artwork is not valid base64 data.");
        }
        if (content.Length == 0 || content.Length > MaximumArtworkBytes)
            throw new ArgumentException("Competition artwork is empty or larger than the 20 MB upload limit.");
        byte[] pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (content.Length < pngSignature.Length || !content.AsSpan(0, pngSignature.Length).SequenceEqual(pngSignature))
            throw new ArgumentException("Competition artwork is not a valid PNG image.");
        var fileName = Path.GetFileName(artwork.FileName?.Trim());
        if (string.IsNullOrWhiteSpace(fileName)) fileName = "event-playbook-competition.png";
        if (!fileName.EndsWith(".png", StringComparison.OrdinalIgnoreCase)) fileName += ".png";
        return new ResolvedArtwork(fileName, content);
    }

    private static IntelligentGolfMutationException Mutation(
        string stage,
        int competitionId,
        string message,
        string? detail = null,
        Exception? innerException = null) =>
        new(stage, message, intelligentGolfRecordId: competitionId, responseDetail: detail, innerException: innerException);

    private sealed record CompetitionSettings(IReadOnlyList<KeyValuePair<string, string>> Fields);
    private sealed record ResolvedArtwork(string FileName, byte[] Content);
}

public static class CompetitionEndpoints
{
    public static IEndpointRouteBuilder MapCompetitionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet(
                "/api/competitions/available",
                async (
                    bool? includeActive,
                    bool? includeUpcoming,
                    int? year,
                    DateOnly? date,
                    bool? refresh,
                    IMediator mediator,
                    CancellationToken cancellationToken) =>
                    Results.Ok(await mediator.Send(
                        new GetAvailableCompetitionsQuery(
                            includeActive ?? true,
                            includeUpcoming ?? true,
                            year,
                            date,
                            refresh ?? false),
                        cancellationToken)))
            .WithName("GetAvailableCompetitions")
            .WithTags("Competitions")
            .Produces<IReadOnlyList<AvailableCompetition>>();

        endpoints.MapPut(
                "/api/competitions/{competitionId:int}/member-advertising",
                async (
                    int competitionId,
                    UpdateCompetitionAdvertisingRequest request,
                    IMediator mediator,
                    CancellationToken cancellationToken) =>
                    Results.Ok(await mediator.Send(
                        new UpdateCompetitionAdvertisingCommand(competitionId, request),
                        cancellationToken)))
            .WithName("UpdateCompetitionMemberAdvertising")
            .WithTags("Competitions")
            .Produces<UpdateCompetitionAdvertisingResult>();

        return endpoints;
    }
}
