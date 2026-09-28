using BOTGC.EventPlaybook.API.Features.MemberEmail;
using BOTGC.EventPlaybook.API.Infrastructure;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using System.Text.Json;
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
    public void EnsureSendPrepared_AcceptsNewEmailWithoutDraftId()
    {
        const string response = """
            {"actions":[{"type":"opendialog","id":"confirm-send","html":"<p>Send this email now?</p>"}]}
            """;

        IntelligentGolfBulkEmailResponse.EnsureSendPrepared(response);
        Assert.Null(IntelligentGolfBulkEmailResponse.ExtractDraftId(response));
    }

    [Fact]
    public void ThrowIfFailure_RejectsHttp200ValidationActions()
    {
        const string response = """
            {"actions":[{"type":"showerrors","errors":[{"selector":"#id","text":"The draft could not be found"}]}]}
            """;

        var exception = Assert.Throws<IntelligentGolfEmailDeliveryException>(() =>
            IntelligentGolfBulkEmailResponse.ThrowIfFailure(response, "send"));

        Assert.Contains("rejected", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("draft could not be found", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void EnsureSendConfirmed_RequiresAnExplicitSuccessAction()
    {
        const string response = """{"actions":[{"type":"closedialog","id":"confirm"}]}""";

        Assert.Throws<IntelligentGolfEmailDeliveryException>(() =>
            IntelligentGolfBulkEmailResponse.EnsureSendConfirmed(response));
    }

    [Theory]
    [InlineData("{\"actions\":[{\"type\":\"redirect\",\"data\":\"/membership_communications3.php?tab=sentemails\"}]}")]
    [InlineData("{\"actions\":[{\"type\":\"message\",\"data\":\"Email sent successfully\"}]}")]
    public void EnsureSendConfirmed_AcceptsExplicitSuccess(string response)
    {
        IntelligentGolfBulkEmailResponse.EnsureSendConfirmed(response);
    }

    [Fact]
    public async Task DeliveryFailure_IsReturnedAsUsefulBadGatewayProblem()
    {
        var exception = new IntelligentGolfEmailDeliveryException(
            "Intelligent Golf did not return the send-confirmation step. No member email was sent.");
        await using var services = new ServiceCollection()
            .AddLogging()
            .AddProblemDetails()
            .BuildServiceProvider();
        var context = new DefaultHttpContext { RequestServices = services };
        context.Response.Body = new MemoryStream();
        context.Features.Set<IExceptionHandlerFeature>(new ExceptionHandlerFeature { Error = exception });

        await ApiExceptionResponse.WriteAsync(context);

        Assert.Equal(StatusCodes.Status502BadGateway, context.Response.StatusCode);
        context.Response.Body.Position = 0;
        using var problem = await JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal(exception.Message, problem.RootElement.GetProperty("title").GetString());
    }
}
