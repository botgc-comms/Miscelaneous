using BOTGC.EventPlaybook.API.Features.MemberEmail;
using Xunit;

namespace BOTGC.EventPlaybook.API.Tests.Features;

public sealed class MemberCampaignEmailResponseTests
{
    [Fact]
    public void ExtractDraftId_IgnoresUnrelatedIdInEmailHtml()
    {
        const string response = """
            {"actions":[{"type":"opendialog","html":"<p><a href='https://example.test/survey?id=2809'>Feedback</a></p>"}]}
            """;

        Assert.Null(IntelligentGolfBulkEmailResponse.ExtractDraftId(response));
    }

    [Fact]
    public void ExtractDraftId_ReadsOnlyTheDraftIdFormField()
    {
        const string response = """
            {"actions":[{"type":"opendialog","html":"<form><input name='id' value='1145904'><a href='?id=2809'>Feedback</a></form>"}]}
            """;

        Assert.Equal("1145904", IntelligentGolfBulkEmailResponse.ExtractDraftId(response));
    }

    [Fact]
    public void ThrowIfFailure_RejectsHttp200ValidationActions()
    {
        const string response = """
            {"actions":[{"type":"showerrors","errors":[{"selector":"#id","text":"The draft could not be found"}]}]}
            """;

        var exception = Assert.Throws<InvalidOperationException>(() =>
            IntelligentGolfBulkEmailResponse.ThrowIfFailure(response, "send"));

        Assert.Contains("rejected", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void EnsureSendConfirmed_RequiresAnExplicitSuccessAction()
    {
        const string response = """{"actions":[{"type":"closedialog","id":"confirm"}]}""";

        Assert.Throws<InvalidOperationException>(() =>
            IntelligentGolfBulkEmailResponse.EnsureSendConfirmed(response));
    }

    [Theory]
    [InlineData("{\"actions\":[{\"type\":\"redirect\",\"data\":\"/membership_communications3.php?tab=sentemails\"}]}")]
    [InlineData("{\"actions\":[{\"type\":\"message\",\"data\":\"Email sent successfully\"}]}")]
    public void EnsureSendConfirmed_AcceptsExplicitSuccess(string response)
    {
        IntelligentGolfBulkEmailResponse.EnsureSendConfirmed(response);
    }
}
