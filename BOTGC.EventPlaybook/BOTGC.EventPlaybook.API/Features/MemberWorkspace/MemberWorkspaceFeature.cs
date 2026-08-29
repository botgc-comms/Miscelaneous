using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using BOTGC.EventPlaybook.API.Options;
using HtmlAgilityPack;
using MediatR;
using Microsoft.Extensions.Options;

namespace BOTGC.EventPlaybook.API.Features.MemberWorkspace;

public enum MemberWorkspaceKind
{
    Diary,
    Planner
}

public sealed record MemberWorkspaceDocument(
    int MemberNumber,
    MemberWorkspaceKind Kind,
    string? Title,
    IReadOnlyDictionary<string, string?> Fields,
    string Html);

public sealed record UpdateMemberWorkspaceRequest(IReadOnlyDictionary<string, string> Fields);

public sealed record GetMemberWorkspaceQuery(
    int MemberNumber,
    MemberWorkspaceKind Kind,
    bool Refresh) : IRequest<MemberWorkspaceDocument>;

public sealed record UpdateMemberWorkspaceCommand(
    int MemberNumber,
    MemberWorkspaceKind Kind,
    IReadOnlyDictionary<string, string> Fields) : IRequest<MemberWorkspaceDocument>;

public sealed class MemberWorkspaceHandler(
    IOptions<IntelligentGolfOptions> intelligentGolfOptions,
    IOptions<CacheOptions> cacheOptions,
    IIntelligentGolfTransport transport,
    ICacheService cache)
    : IRequestHandler<GetMemberWorkspaceQuery, MemberWorkspaceDocument>,
      IRequestHandler<UpdateMemberWorkspaceCommand, MemberWorkspaceDocument>
{
    public async Task<MemberWorkspaceDocument> Handle(
        GetMemberWorkspaceQuery request,
        CancellationToken cancellationToken)
    {
        ValidateMemberNumber(request.MemberNumber);
        var cacheKey = BuildCacheKey(request.MemberNumber, request.Kind);

        if (!request.Refresh)
        {
            var cached = await cache.GetAsync<MemberWorkspaceDocument>(cacheKey, cancellationToken);
            if (cached is not null)
            {
                return cached;
            }
        }

        var path = ResolvePath(request.Kind, isUpdate: false, request.MemberNumber);
        var document = await transport.GetDocumentAsync(path, cancellationToken);
        var result = ParseDocument(document, request.MemberNumber, request.Kind);

        await cache.SetAsync(
            cacheKey,
            result,
            TimeSpan.FromMinutes(cacheOptions.Value.WorkspaceTtlMinutes),
            cancellationToken);

        return result;
    }

    public async Task<MemberWorkspaceDocument> Handle(
        UpdateMemberWorkspaceCommand request,
        CancellationToken cancellationToken)
    {
        ValidateMemberNumber(request.MemberNumber);
        if (request.Fields is null || request.Fields.Count == 0)
        {
            throw new ArgumentException("At least one diary or planner field is required.");
        }

        var path = ResolvePath(request.Kind, isUpdate: true, request.MemberNumber);
        var document = await transport.PostFormDocumentAsync(path, request.Fields, cancellationToken);
        var result = ParseDocument(document, request.MemberNumber, request.Kind);

        await cache.RemoveAsync(BuildCacheKey(request.MemberNumber, request.Kind), cancellationToken);
        return result;
    }

    private string ResolvePath(MemberWorkspaceKind kind, bool isUpdate, int memberNumber)
    {
        var endpoints = intelligentGolfOptions.Value.Endpoints;
        var template = (kind, isUpdate) switch
        {
            (MemberWorkspaceKind.Diary, false) => endpoints.DiaryReadPathTemplate,
            (MemberWorkspaceKind.Diary, true) => endpoints.DiaryUpdatePathTemplate,
            (MemberWorkspaceKind.Planner, false) => endpoints.PlannerReadPathTemplate,
            (MemberWorkspaceKind.Planner, true) => endpoints.PlannerUpdatePathTemplate,
            _ => string.Empty
        };

        if (string.IsNullOrWhiteSpace(template))
        {
            throw new IntelligentGolfFeatureNotConfiguredException(
                $"member {kind.ToString().ToLowerInvariant()} {(isUpdate ? "update" : "read")}");
        }

        return template.Replace(
            "{memberNumber}",
            memberNumber.ToString(),
            StringComparison.OrdinalIgnoreCase);
    }

    private static MemberWorkspaceDocument ParseDocument(
        HtmlDocument document,
        int memberNumber,
        MemberWorkspaceKind kind)
    {
        var fields = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);

        foreach (var input in document.DocumentNode.SelectNodes("//input[@name]") ?? Enumerable.Empty<HtmlNode>())
        {
            var name = input.GetAttributeValue("name", string.Empty);
            if (!string.IsNullOrWhiteSpace(name))
            {
                fields[name] = input.GetAttributeValue("value", null);
            }
        }

        foreach (var textArea in document.DocumentNode.SelectNodes("//textarea[@name]") ?? Enumerable.Empty<HtmlNode>())
        {
            var name = textArea.GetAttributeValue("name", string.Empty);
            if (!string.IsNullOrWhiteSpace(name))
            {
                fields[name] = HtmlEntity.DeEntitize(textArea.InnerText);
            }
        }

        foreach (var select in document.DocumentNode.SelectNodes("//select[@name]") ?? Enumerable.Empty<HtmlNode>())
        {
            var name = select.GetAttributeValue("name", string.Empty);
            var selected = select.SelectSingleNode(".//option[@selected]") ??
                           select.SelectSingleNode(".//option[1]");
            if (!string.IsNullOrWhiteSpace(name))
            {
                fields[name] = selected is null
                    ? null
                    : selected.GetAttributeValue("value", selected.InnerText);
            }
        }

        var title = HtmlEntity.DeEntitize(
            document.DocumentNode.SelectSingleNode("//title")?.InnerText ?? string.Empty).Trim();

        return new MemberWorkspaceDocument(
            memberNumber,
            kind,
            string.IsNullOrWhiteSpace(title) ? null : title,
            fields,
            document.DocumentNode.OuterHtml);
    }

    private static string BuildCacheKey(int memberNumber, MemberWorkspaceKind kind) =>
        $"event-planner:member:{memberNumber}:{kind.ToString().ToLowerInvariant()}";

    private static void ValidateMemberNumber(int memberNumber)
    {
        if (memberNumber <= 0)
        {
            throw new ArgumentException("The member number must be greater than zero.");
        }
    }
}

public static class MemberWorkspaceEndpoints
{
    public static IEndpointRouteBuilder MapMemberWorkspaceEndpoints(this IEndpointRouteBuilder endpoints)
    {
        MapWorkspace(MemberWorkspaceKind.Diary, "diary");
        MapWorkspace(MemberWorkspaceKind.Planner, "planner");
        return endpoints;

        void MapWorkspace(MemberWorkspaceKind kind, string segment)
        {
            endpoints.MapGet(
                    $"/api/members/{{memberNumber:int}}/{segment}",
                    async (
                        int memberNumber,
                        bool? refresh,
                        IMediator mediator,
                        CancellationToken cancellationToken) =>
                        Results.Ok(await mediator.Send(
                            new GetMemberWorkspaceQuery(memberNumber, kind, refresh ?? false),
                            cancellationToken)))
                .WithName($"GetMember{kind}")
                .WithTags("Members")
                .Produces<MemberWorkspaceDocument>();

            endpoints.MapPut(
                    $"/api/members/{{memberNumber:int}}/{segment}",
                    async (
                        int memberNumber,
                        UpdateMemberWorkspaceRequest request,
                        IMediator mediator,
                        CancellationToken cancellationToken) =>
                        Results.Ok(await mediator.Send(
                            new UpdateMemberWorkspaceCommand(memberNumber, kind, request.Fields),
                            cancellationToken)))
                .WithName($"UpdateMember{kind}")
                .WithTags("Members")
                .Produces<MemberWorkspaceDocument>();
        }
    }
}
