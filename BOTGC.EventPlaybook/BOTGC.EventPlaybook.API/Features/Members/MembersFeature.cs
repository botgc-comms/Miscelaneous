using System.Globalization;
using System.Text.RegularExpressions;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using BOTGC.EventPlaybook.API.Options;
using HtmlAgilityPack;
using MediatR;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.API.Features.Members;

public sealed record MemberSummary(
    int MemberNumber,
    string? Title,
    string? FirstName,
    string? LastName,
    string? FullName,
    string? Email,
    string? MembershipCategory,
    string? MembershipStatus,
    DateTime? LeaveDate,
    bool IsActive);

public sealed record GetMembersQuery(bool Refresh) : IRequest<IReadOnlyList<MemberSummary>>;

public sealed class GetMembersHandler(
    IOptions<IntelligentGolfOptions> intelligentGolfOptions,
    IOptions<CacheOptions> cacheOptions,
    IIntelligentGolfReportClient reports,
    IIntelligentGolfReportParser<MemberSummary> parser)
    : IRequestHandler<GetMembersQuery, IReadOnlyList<MemberSummary>>
{
    public async Task<IReadOnlyList<MemberSummary>> Handle(
        GetMembersQuery request,
        CancellationToken cancellationToken)
    {
        var path = intelligentGolfOptions.Value.Endpoints.MembersReportPath;
        if (string.IsNullOrWhiteSpace(path))
        {
            throw new IntelligentGolfFeatureNotConfiguredException("member report");
        }

        var members = await reports.GetAsync(
            path,
            parser,
            "event-planner:members",
            TimeSpan.FromMinutes(cacheOptions.Value.MemberTtlMinutes),
            request.Refresh,
            cancellationToken);

        var today = DateTime.Today;
        return members
            .Where(member => member.IsActive &&
                             (!member.LeaveDate.HasValue || member.LeaveDate.Value.Date >= today))
            .OrderBy(member => member.LastName)
            .ThenBy(member => member.FirstName)
            .ToList();
    }
}

public sealed class IntelligentGolfMemberReportParser(
    ILogger<IntelligentGolfMemberReportParser> logger)
    : IIntelligentGolfReportParser<MemberSummary>
{
    public Task<IReadOnlyList<MemberSummary>> ParseAsync(
        HtmlDocument document,
        CancellationToken cancellationToken = default)
    {
        var rows = document.DocumentNode.SelectNodes("//tr");
        if (rows is null || rows.Count < 2)
        {
            return Task.FromResult<IReadOnlyList<MemberSummary>>([]);
        }

        var headerRow = rows.FirstOrDefault(row => row.SelectNodes(".//th")?.Count > 0);
        var headers = headerRow?.SelectNodes(".//th")?
            .Select(node => Clean(node.InnerText))
            .ToArray();

        if (headerRow is null || headers is null || headers.Length == 0)
        {
            logger.LogWarning("The Intelligent Golf member report did not contain a header row.");
            return Task.FromResult<IReadOnlyList<MemberSummary>>([]);
        }

        var columns = BuildColumnMap(headers);
        var members = new List<MemberSummary>();

        foreach (var row in rows.SkipWhile(row => row != headerRow).Skip(1))
        {
            cancellationToken.ThrowIfCancellationRequested();

            var cells = row.SelectNodes(".//td")?
                .Select(node => Clean(node.InnerText))
                .ToArray();
            if (cells is null || cells.Length == 0)
            {
                continue;
            }

            var numberText = Value(cells, columns, "MemberNumber");
            if (!int.TryParse(numberText, out var memberNumber) || memberNumber <= 0)
            {
                continue;
            }

            var firstName = Value(cells, columns, "FirstName");
            var lastName = Value(cells, columns, "LastName");
            var fullName = Value(cells, columns, "FullName");
            var status = Value(cells, columns, "MembershipStatus");

            members.Add(new MemberSummary(
                memberNumber,
                Value(cells, columns, "Title"),
                firstName,
                lastName,
                string.IsNullOrWhiteSpace(fullName)
                    ? string.Join(' ', new[] { firstName, lastName }.Where(value => !string.IsNullOrWhiteSpace(value)))
                    : fullName,
                Value(cells, columns, "Email"),
                Value(cells, columns, "MembershipCategory"),
                status,
                ParseDate(Value(cells, columns, "LeaveDate")),
                string.Equals(status, "R", StringComparison.OrdinalIgnoreCase)));
        }

        logger.LogInformation("Parsed {Count} members from Intelligent Golf.", members.Count);
        return Task.FromResult<IReadOnlyList<MemberSummary>>(members);
    }

    private static Dictionary<string, int> BuildColumnMap(IReadOnlyList<string> headers)
    {
        var patterns = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["^(?:Member|Account)\\s*.*?Number$"] = "MemberNumber",
            ["^Title$"] = "Title",
            ["^Forename$"] = "FirstName",
            ["^Surname$"] = "LastName",
            ["^Full\\s*Name$"] = "FullName",
            ["^Email$"] = "Email",
            ["^Current\\s*Category$"] = "MembershipCategory",
            ["^Membership\\s*Status$"] = "MembershipStatus",
            ["^Leave\\s*Date$"] = "LeaveDate"
        };

        var result = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < headers.Count; index++)
        {
            foreach (var pattern in patterns)
            {
                if (Regex.IsMatch(headers[index], pattern.Key, RegexOptions.IgnoreCase))
                {
                    result[pattern.Value] = index;
                    break;
                }
            }
        }

        return result;
    }

    private static string? Value(
        IReadOnlyList<string> cells,
        IReadOnlyDictionary<string, int> columns,
        string name) =>
        columns.TryGetValue(name, out var index) && index < cells.Count
            ? cells[index]
            : null;

    private static string Clean(string value) =>
        HtmlEntity.DeEntitize(value).Trim();

    private static DateTime? ParseDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var formats = new[]
        {
            "dd/MM/yyyy", "d/M/yyyy", "dd/MM/yy", "d/M/yy",
            "yyyy-MM-dd", "yyyy-M-d"
        };

        return DateTime.TryParseExact(
            value,
            formats,
            CultureInfo.GetCultureInfo("en-GB"),
            DateTimeStyles.None,
            out var result)
            ? result
            : null;
    }
}

public static class MemberEndpoints
{
    public static IEndpointRouteBuilder MapMemberEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet(
                "/api/members",
                async (bool? refresh, IMediator mediator, CancellationToken cancellationToken) =>
                    Results.Ok(await mediator.Send(new GetMembersQuery(refresh ?? false), cancellationToken)))
            .WithName("GetMembers")
            .WithTags("Members")
            .Produces<IReadOnlyList<MemberSummary>>();

        return endpoints;
    }
}
