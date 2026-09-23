using System.Text.Json;
using BOTGC.EventPlaybook.Models;
using BOTGC.EventPlaybook.Services;
using Xunit;

namespace BOTGC.EventPlaybook.Web.Tests.Services;

public sealed class PlaybookEventTicketConfigurationTests
{
    [Fact]
    public void ReadEvents_MapsCompleteTicketAnswersToAValidatedConfiguration()
    {
        using var document = JsonDocument.Parse(StateJson);

        var snapshot = Assert.Single(PlaybookEventChangePipeline.ReadEvents(document.RootElement)).Value;

        Assert.True(snapshot.IntelligentGolfTicketsRequested);
        Assert.Equal("EVENT PLAYBOOK — OPERATIONAL PLANNING SUMMARY", snapshot.PlanningNote);
        Assert.Null(snapshot.IntelligentGolfTicketValidationError);
        var tickets = Assert.IsType<IntelligentGolfTicketConfiguration>(snapshot.IntelligentGolfTickets);
        Assert.Equal(100, tickets.MaximumTickets);
        Assert.True(tickets.AllowMembersOnline);
        Assert.Equal(4, tickets.MaximumTicketsPerMember);
        Assert.True(tickets.RequireMemberGuestDetails);
        Assert.False(tickets.MembersPaymentDueOnEntry);
        Assert.False(tickets.AllowVisitorsOnline);
        Assert.Null(tickets.MaximumTicketsPerVisitor);
        Assert.False(tickets.AddOptions);
        Assert.Collection(
            tickets.TicketTypes,
            ticket => { Assert.Equal("Member", ticket.Name); Assert.Equal(0m, ticket.Price); },
            ticket => { Assert.Equal("Adult visitor", ticket.Name); Assert.Equal(30m, ticket.Price); });
    }

    [Fact]
    public void ReadEvents_DoesNotExposeAPartialConfigurationForPosting()
    {
        using var document = JsonDocument.Parse(StateJson.Replace(
            "\"ig-ticket-allocation\": \"100\",",
            ""));

        var snapshot = Assert.Single(PlaybookEventChangePipeline.ReadEvents(document.RootElement)).Value;

        Assert.True(snapshot.IntelligentGolfTicketsRequested);
        Assert.Null(snapshot.IntelligentGolfTickets);
        Assert.Equal(
            "Enter how many tickets Intelligent Golf should make available.",
            snapshot.IntelligentGolfTicketValidationError);
    }

    [Fact]
    public void ReadEvents_ExcludesIdeasFromIntelligentGolfSynchronisation()
    {
        using var document = JsonDocument.Parse(StateJson.Replace(
            "\"id\": \"event-123\",",
            "\"id\": \"event-123\", \"recordType\": \"idea\","));

        Assert.Empty(PlaybookEventChangePipeline.ReadEvents(document.RootElement));
    }

    private const string StateJson = """
        {
          "events": [
            {
              "id": "event-123",
              "name": "The 2027 Forum",
              "eventDate": "2027-01-12",
              "description": "Member forum",
              "intelligentGolfPlanningNote": "EVENT PLAYBOOK — OPERATIONAL PLANNING SUMMARY",
              "answers": {
                "ig-online-ticketing": true,
                "ig-ticket-allocation": "100",
                "ig-members-online": true,
                "ig-max-tickets-member": "4",
                "ig-require-member-guest-details": true,
                "ig-members-payment-due-on-entry": false,
                "ig-visitors-online": false,
                "ig-add-ticket-options": false,
                "ig-ticket-types": [
                  { "name": "Member", "price": "0" },
                  { "name": "Adult visitor", "price": "30" }
                ]
              }
            }
          ]
        }
        """;
}
