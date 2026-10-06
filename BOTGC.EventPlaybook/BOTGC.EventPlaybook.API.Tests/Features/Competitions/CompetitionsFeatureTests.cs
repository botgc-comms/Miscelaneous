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

    [Fact]
    public async Task AdvertisingHandler_PreservesCompetitionSettingsAndChangesOnlyCommentsAndImage()
    {
        const string description = "<p><strong>Member-facing event information</strong></p>";
        var transport = new CompetitionSettingsTransport(description, "halloween-night-golf-social.png");
        var handler = new UpdateCompetitionAdvertisingHandler(
            transport,
            new ImmediateLockManager(),
            NullLogger<UpdateCompetitionAdvertisingHandler>.Instance);
        byte[] png = [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3];

        var result = await handler.Handle(
            new UpdateCompetitionAdvertisingCommand(
                8541,
                new UpdateCompetitionAdvertisingRequest(
                    "event-123",
                    description,
                    new CompetitionAdvertisingArtwork(
                        "halloween-night-golf-social.png",
                        "image/png",
                        Convert.ToBase64String(png)))),
            CancellationToken.None);

        Assert.Equal(8541, result.IntelligentGolfCompetitionId);
        Assert.True(result.DescriptionUpdated);
        Assert.True(result.ImageAttached);
        Assert.Equal("halloween-night-golf-social.png", result.ImageFileName);
        Assert.Equal("10", Assert.Single(transport.SavedFields, field => field.Key == "comptype").Value);
        Assert.Equal("2", Assert.Single(transport.SavedFields, field => field.Key == "tees[]").Value);
        Assert.Contains(transport.SavedFields, field => field.Key == "usepi" && field.Value == "1");
        Assert.DoesNotContain(transport.SavedFields, field => field.Key == "unchecked-setting");
        Assert.Equal(description, Assert.Single(transport.SavedFields, field => field.Key == "comments").Value);
        Assert.Equal("halloween-night-golf-social.png", Assert.Single(transport.SavedFields, field => field.Key == "image").Value);
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

    private sealed class CompetitionSettingsTransport(
        string verifiedDescription,
        string verifiedImageFileName) : IIntelligentGolfTransport
    {
        private int _settingsReads;
        public IReadOnlyCollection<KeyValuePair<string, string>> SavedFields { get; private set; } = [];

        public Task<T> ExecuteExclusiveAsync<T>(
            Func<CancellationToken, Task<T>> operation,
            CancellationToken cancellationToken = default) => operation(cancellationToken);

        public Task<IntelligentGolfTransportResponse> GetResponseAsync(
            string path,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<HtmlDocument> GetDocumentAsync(
            string path,
            CancellationToken cancellationToken = default)
        {
            _settingsReads++;
            var comments = _settingsReads > 1 ? verifiedDescription : "<p>Old description</p>";
            var image = _settingsReads > 1 ? verifiedImageFileName : "old-image.png";
            var document = new HtmlDocument();
            document.LoadHtml($$"""
                <form id="compform">
                  <input name="compname" value="Halloween Night Golf 2026">
                  <input name="compdate" value="31-10-2026">
                  <textarea name="comments">{{comments}}</textarea>
                  <textarea name="rules"><p>Pairs Greensomes</p></textarea>
                  <input type="hidden" name="image" value="{{image}}">
                  <select name="comptype"><option value="9">Other</option><option value="10" selected>Greensomes</option></select>
                  <select name="tees[]"><option value="2" selected>Yellow</option></select>
                  <input type="checkbox" name="usepi" value="1" checked>
                  <input type="checkbox" name="unchecked-setting" value="1">
                </form>
                """);
            return Task.FromResult(document);
        }

        public Task<HtmlDocument> PostFormDocumentAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<IntelligentGolfTransportResponse> PostFormResponseAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            CancellationToken cancellationToken = default)
        {
            SavedFields = fields;
            return Task.FromResult(new IntelligentGolfTransportResponse(
                "{\"actions\":[{\"type\":\"redirect\",\"data\":\"/compadmin3.php?compid=8541&tab=settings\"}]}",
                null));
        }

        public Task<IntelligentGolfTransportResponse> PostMultipartResponseAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            IntelligentGolfMultipartFile file,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new IntelligentGolfTransportResponse(
                "{\"actions\":[{\"type\":\"message\",\"data\":\"Image uploaded\"},{\"type\":\"setvalue\",\"value\":\"halloween-night-golf-social.png\",\"selector\":\"#compImageInput\"}]}",
                null));

        public Task<string> PostFormAsync(
            string path,
            IReadOnlyCollection<KeyValuePair<string, string>> fields,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class ImmediateLockManager : IDistributedLockManager
    {
        public Task<IDistributedLock> AcquireAsync(
            string resource,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IDistributedLock>(new ImmediateLock());
    }

    private sealed class ImmediateLock : IDistributedLock
    {
        public bool IsAcquired => true;
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
