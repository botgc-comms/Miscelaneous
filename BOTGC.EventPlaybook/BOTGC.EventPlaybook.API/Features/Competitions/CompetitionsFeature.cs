using System.Globalization;
using System.Text.RegularExpressions;
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
    bool Refresh) : IRequest<IReadOnlyList<AvailableCompetition>>;

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
        var year = request.Year?.ToString(CultureInfo.InvariantCulture) ?? "all";
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
        return resultSets
            .SelectMany(result => result)
            .GroupBy(competition => competition.Id)
            .Select(group => group.First())
            .Where(competition => !competition.Date.HasValue ||
                                  competition.Date.Value.Date >= DateTime.Today)
            .OrderBy(competition => competition.Date)
            .ThenBy(competition => competition.Name)
            .ToList();

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
                    bool? refresh,
                    IMediator mediator,
                    CancellationToken cancellationToken) =>
                    Results.Ok(await mediator.Send(
                        new GetAvailableCompetitionsQuery(
                            includeActive ?? true,
                            includeUpcoming ?? true,
                            year,
                            refresh ?? false),
                        cancellationToken)))
            .WithName("GetAvailableCompetitions")
            .WithTags("Competitions")
            .Produces<IReadOnlyList<AvailableCompetition>>();

        return endpoints;
    }
}
