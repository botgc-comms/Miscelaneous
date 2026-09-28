using BOTGC.EventPlaybook.API.Features.MemberEmail;
using BOTGC.EventPlaybook.API.Features.Members;
using Xunit;

namespace BOTGC.EventPlaybook.API.Tests.Features;

public sealed class MemberCampaignEmailRecipientsTests
{
    [Fact]
    public void Resolve_UsesMemberEmailAddressesAndDeduplicatesThem()
    {
        var members = new Dictionary<int, MemberSummary>
        {
            [3104] = Member(3104, " simon@example.test "),
            [3105] = Member(3105, "SIMON@example.test")
        };

        var recipients = MemberCampaignEmailRecipients.Resolve([3104, 3105], members);

        Assert.Equal(["simon@example.test"], recipients);
    }

    [Fact]
    public void Resolve_RejectsAMemberWithoutAnEmailAddress()
    {
        var members = new Dictionary<int, MemberSummary>
        {
            [3104] = Member(3104, null)
        };

        var exception = Assert.Throws<InvalidOperationException>(() =>
            MemberCampaignEmailRecipients.Resolve([3104], members));

        Assert.Contains("did not return an email address", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    private static MemberSummary Member(int memberNumber, string? email) =>
        new(
            memberNumber,
            IntelligentGolfUserId: 83642,
            Title: null,
            FirstName: "Simon",
            LastName: "Parsons",
            FullName: "Simon Parsons",
            Email: email,
            MembershipCategory: "Member",
            MembershipStatus: "Active",
            LeaveDate: null,
            IsActive: true);
}
