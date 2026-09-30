using BOTGC.EventPlaybook.API.Features.Competitions;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using BOTGC.EventPlaybook.API.Options;
using HtmlAgilityPack;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace BOTGC.EventPlaybook.API.Tests.Features.Competitions;

public sealed class CompetitionsFeatureTests
{
    [Fact]
    public async Task Parser_ExtractsCompetitionIdentityDateAndDetailsFromIntelligentGolfHtml()
    {
        var document = new HtmlDocument();
        document.LoadHtml("""
            <table><tbody><tr>
              <td><a href="competition.php?compid=6201">Sunday Winter Stableford</a></td>
              <td>Sunday 4th October 2026</td>
              <td></td>
              <td><i class="fa fa-venus-mars"></i> acceptable for handicapping</td>
            </tr></tbody></table>
            """);
        var parser = new IntelligentGolfCompetitionReportParser(
            NullLogger<IntelligentGolfCompetitionReportParser>.Instance);

        var competition = Assert.Single(await parser.ParseAsync(document));

        Assert.Equal(6201, competition.Id);
        Assert.Equal("Sunday Winter Stableford", competition.Name);
        Assert.Equal(new DateTime(2026, 10, 4), competition.Date);
        Assert.Equal(CompetitionGender.Mixed, competition.Gender);
        Assert.True(competition.IsHandicapQualifying);
    }

    [Fact]
    public async Task Handler_WithEventDate_ReturnsOnlyCompetitionsOnThatDateAndUsesThatYear()
    {
        var reportClient = new StubReportClient([
            new AvailableCompetition(6201, "Sunday Winter Stableford", new DateTime(2026, 10, 4), CompetitionGender.Mixed, true, false, false),
            new AvailableCompetition(6202, "October Medal", new DateTime(2026, 10, 11), CompetitionGender.Gents, true, false, false),
            new AvailableCompetition(6203, "Undated competition", null, CompetitionGender.Unknown, false, false, false)
        ]);
        var handler = new GetAvailableCompetitionsHandler(
            Microsoft.Extensions.Options.Options.Create(new IntelligentGolfOptions
            {
                Endpoints = new IntelligentGolfEndpointOptions
                {
                    ActiveCompetitionsPath = "/active?year={year}",
                    UpcomingCompetitionsPath = "/upcoming?year={year}"
                }
            }),
            Microsoft.Extensions.Options.Options.Create(new CacheOptions()),
            reportClient,
            new StubParser());

        var result = await handler.Handle(
            new GetAvailableCompetitionsQuery(true, true, null, new DateOnly(2026, 10, 4), true),
            CancellationToken.None);

        var competition = Assert.Single(result);
        Assert.Equal(6201, competition.Id);
        Assert.Equal(["/active?year=2026", "/upcoming?year=2026"], reportClient.Paths);
        Assert.All(reportClient.RefreshValues, Assert.True);
    }

    private sealed class StubParser : IIntelligentGolfReportParser<AvailableCompetition>
    {
        public Task<IReadOnlyList<AvailableCompetition>> ParseAsync(
            HtmlDocument document,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<AvailableCompetition>>([]);
    }

    private sealed class StubReportClient(IReadOnlyList<AvailableCompetition> competitions)
        : IIntelligentGolfReportClient
    {
        public List<string> Paths { get; } = [];
        public List<bool> RefreshValues { get; } = [];

        public Task<IReadOnlyList<T>> GetAsync<T>(
            string path,
            IIntelligentGolfReportParser<T> parser,
            string cacheKey,
            TimeSpan cacheTtl,
            bool refresh = false,
            CancellationToken cancellationToken = default)
        {
            Paths.Add(path);
            RefreshValues.Add(refresh);
            return Task.FromResult<IReadOnlyList<T>>(competitions.Cast<T>().ToArray());
        }

        public Task<IReadOnlyList<T>> PostAsync<T>(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            IIntelligentGolfReportParser<T> parser,
            string cacheKey,
            TimeSpan cacheTtl,
            bool refresh = false,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
