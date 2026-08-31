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
    int? IntelligentGolfUserId,
    string? Title,
    string? FirstName,
    string? LastName,
    string? FullName,
    string? Email,
    string? MembershipCategory,
    string? MembershipStatus,
    DateTime? LeaveDate,
    bool IsActive);

public sealed record MemberContact(
    int MemberNumber,
    string? FirstName,
    string? LastName,
    string? Email,
    string? MembershipCategory,
    string? MembershipStatus);

public sealed record MemberIdentity(
    int MemberNumber,
    int IntelligentGolfUserId,
    string? FirstName,
    string? LastName);

public sealed record GetMembersQuery(bool Refresh) : IRequest<IReadOnlyList<MemberSummary>>;

public sealed class GetMembersHandler(
    IOptions<IntelligentGolfOptions> intelligentGolfOptions,
    IOptions<CacheOptions> cacheOptions,
    IIntelligentGolfReportClient reports,
    IIntelligentGolfReportParser<MemberSummary> parser,
    IIntelligentGolfReportParser<MemberContact> contactParser,
    IIntelligentGolfReportParser<MemberIdentity> identityParser)
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

        var settings = intelligentGolfOptions.Value;
        if (string.IsNullOrWhiteSpace(settings.Endpoints.MemberContactReportPath) ||
            string.IsNullOrWhiteSpace(settings.Endpoints.PlayerIdLookupReportPath))
        {
            throw new IntelligentGolfFeatureNotConfiguredException("member contact directory");
        }

        var ttl = TimeSpan.FromMinutes(cacheOptions.Value.MemberTtlMinutes);
        var membersTask = reports.GetAsync(
            path,
            parser,
            "event-planner:members",
            ttl,
            request.Refresh,
            cancellationToken);
        var contactsTask = reports.GetAsync(
            settings.Endpoints.MemberContactReportPath,
            contactParser,
            "event-planner:member-contacts",
            ttl,
            request.Refresh,
            cancellationToken);
        var identitiesTask = reports.PostAsync(
            settings.Endpoints.PlayerIdLookupReportPath,
            new Dictionary<string, string> { ["type"] = "R" },
            identityParser,
            "event-planner:member-identities:active",
            ttl,
            request.Refresh,
            cancellationToken);

        await Task.WhenAll(membersTask, contactsTask, identitiesTask);
        var members = await membersTask;
        var contacts = (await contactsTask)
            .GroupBy(contact => contact.MemberNumber)
            .ToDictionary(group => group.Key, group => group.First());
        var identities = (await identitiesTask)
            .Where(identity => identity.MemberNumber > 0 && identity.IntelligentGolfUserId > 0)
            .GroupBy(identity => identity.MemberNumber)
            .ToDictionary(group => group.Key, group => group.First());

        var today = DateTime.Today;
        return members
            .Where(member => member.IsActive &&
                             (!member.LeaveDate.HasValue || member.LeaveDate.Value.Date >= today))
            .Select(member => Enrich(member, contacts, identities))
            .OrderBy(member => member.LastName)
            .ThenBy(member => member.FirstName)
            .ToList();
    }

    private static MemberSummary Enrich(
        MemberSummary member,
        IReadOnlyDictionary<int, MemberContact> contacts,
        IReadOnlyDictionary<int, MemberIdentity> identities)
    {
        contacts.TryGetValue(member.MemberNumber, out var contact);
        identities.TryGetValue(member.MemberNumber, out var identity);
        var firstName = FirstValue(contact?.FirstName, identity?.FirstName, member.FirstName);
        var lastName = FirstValue(contact?.LastName, identity?.LastName, member.LastName);
        var fullName = FirstValue(
            member.FullName,
            string.Join(' ', new[] { firstName, lastName }.Where(value => !string.IsNullOrWhiteSpace(value))));

        return member with
        {
            IntelligentGolfUserId = identity?.IntelligentGolfUserId,
            FirstName = firstName,
            LastName = lastName,
            FullName = fullName,
            Email = FirstValue(contact?.Email, member.Email),
            MembershipCategory = FirstValue(contact?.MembershipCategory, member.MembershipCategory),
            MembershipStatus = FirstValue(contact?.MembershipStatus, member.MembershipStatus)
        };
    }

    private static string? FirstValue(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();
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
                null,
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

public sealed class IntelligentGolfMemberContactReportParser(
    ILogger<IntelligentGolfMemberContactReportParser> logger)
    : IIntelligentGolfReportParser<MemberContact>
{
    public Task<IReadOnlyList<MemberContact>> ParseAsync(
        HtmlDocument document,
        CancellationToken cancellationToken = default)
    {
        var rows = document.DocumentNode.SelectNodes("//tr");
        var headerRow = rows?.FirstOrDefault(row => row.SelectNodes(".//th")?.Count > 0);
        var headers = headerRow?.SelectNodes(".//th")?
            .Select(node => Clean(node.InnerText))
            .ToArray();
        if (rows is null || headerRow is null || headers is null)
        {
            logger.LogWarning("The Intelligent Golf member contact report did not contain a usable table.");
            return Task.FromResult<IReadOnlyList<MemberContact>>([]);
        }

        var columns = MapColumns(headers, new Dictionary<string, string>
        {
            ["^(?:Member|Account)\\s*\\(?.*?\\)?\\s*number$"] = "MemberNumber",
            ["^Forename$"] = "FirstName",
            ["^Surname$"] = "LastName",
            ["^Email$"] = "Email",
            ["^Current\\s*Category$"] = "MembershipCategory",
            ["^Membership\\s*Status$"] = "MembershipStatus"
        });
        var result = new List<MemberContact>();
        foreach (var row in rows.SkipWhile(row => row != headerRow).Skip(1))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var cells = row.SelectNodes(".//td")?.Select(node => Clean(node.InnerText)).ToArray();
            if (cells is null || !int.TryParse(Value(cells, columns, "MemberNumber"), out var memberNumber) || memberNumber <= 0)
            {
                continue;
            }

            result.Add(new MemberContact(
                memberNumber,
                Value(cells, columns, "FirstName"),
                Value(cells, columns, "LastName"),
                Value(cells, columns, "Email"),
                Value(cells, columns, "MembershipCategory"),
                Value(cells, columns, "MembershipStatus")));
        }

        logger.LogInformation("Parsed {Count} member contact records from Intelligent Golf.", result.Count);
        return Task.FromResult<IReadOnlyList<MemberContact>>(result);
    }

    private static string Clean(string value) => HtmlEntity.DeEntitize(value).Trim();
    private static string? Value(IReadOnlyList<string> cells, IReadOnlyDictionary<string, int> columns, string name) =>
        columns.TryGetValue(name, out var index) && index < cells.Count ? cells[index] : null;
    private static Dictionary<string, int> MapColumns(IReadOnlyList<string> headers, IReadOnlyDictionary<string, string> patterns)
    {
        var result = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < headers.Count; index++)
        {
            foreach (var pattern in patterns)
            {
                if (!Regex.IsMatch(headers[index], pattern.Key, RegexOptions.IgnoreCase)) continue;
                result[pattern.Value] = index;
                break;
            }
        }
        return result;
    }
}

public sealed class IntelligentGolfMemberIdentityReportParser(
    ILogger<IntelligentGolfMemberIdentityReportParser> logger)
    : IIntelligentGolfReportParser<MemberIdentity>
{
    public Task<IReadOnlyList<MemberIdentity>> ParseAsync(
        HtmlDocument document,
        CancellationToken cancellationToken = default)
    {
        var fieldset = document.DocumentNode.SelectSingleNode("//fieldset[@id='memberlist']");
        var headers = fieldset?.SelectNodes(".//thead//th")?
            .Select(node => HtmlEntity.DeEntitize(node.InnerText).Trim())
            .ToArray();
        if (fieldset is null || headers is null)
        {
            logger.LogWarning("The Intelligent Golf player lookup did not contain the member list.");
            return Task.FromResult<IReadOnlyList<MemberIdentity>>([]);
        }

        var memberIndex = Array.FindIndex(headers, header => Regex.IsMatch(header, "^Member\\s*ID$", RegexOptions.IgnoreCase));
        var firstNameIndex = Array.FindIndex(headers, header => Regex.IsMatch(header, "^Forename$", RegexOptions.IgnoreCase));
        var lastNameIndex = Array.FindIndex(headers, header => Regex.IsMatch(header, "^Surname$", RegexOptions.IgnoreCase));
        var result = new List<MemberIdentity>();
        var rows = fieldset.SelectNodes(".//tbody/tr");
        if (rows is null)
        {
            return Task.FromResult<IReadOnlyList<MemberIdentity>>([]);
        }

        foreach (var row in rows)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var cells = row.SelectNodes("./td")?.ToArray();
            if (cells is null || memberIndex < 0 || memberIndex >= cells.Length ||
                !int.TryParse(HtmlEntity.DeEntitize(cells[memberIndex].InnerText).Trim(), out var memberNumber))
            {
                continue;
            }

            var userId = ExtractUserId(cells, firstNameIndex) ?? ExtractUserId(cells, lastNameIndex);
            if (memberNumber <= 0 || !userId.HasValue || userId.Value <= 0) continue;
            result.Add(new MemberIdentity(
                memberNumber,
                userId.Value,
                CellText(cells, firstNameIndex),
                CellText(cells, lastNameIndex)));
        }

        logger.LogInformation("Parsed {Count} active Intelligent Golf member identities.", result.Count);
        return Task.FromResult<IReadOnlyList<MemberIdentity>>(result);
    }

    private static string? CellText(IReadOnlyList<HtmlNode> cells, int index) =>
        index >= 0 && index < cells.Count ? HtmlEntity.DeEntitize(cells[index].InnerText).Trim() : null;

    private static int? ExtractUserId(IReadOnlyList<HtmlNode> cells, int index)
    {
        if (index < 0 || index >= cells.Count) return null;
        var match = Regex.Match(cells[index].InnerHtml, @"member\.php\?memberid=(\d+)", RegexOptions.IgnoreCase);
        return match.Success && int.TryParse(match.Groups[1].Value, out var value) ? value : null;
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
