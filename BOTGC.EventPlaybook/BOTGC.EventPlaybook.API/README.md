# BOTGC Event Playbook API

This is a standalone .NET 9 API for the event-planner integration with Intelligent Golf (IG). It has no project reference to `BOTGC.API` and does not register any of the existing BOTGC controllers, queues, table stores, or feature handlers.

## Included capabilities

- A shared `CookieContainer` and background-maintained IG member/admin session.
- Automatic forced login and one retry when IG returns a login page.
- A generic `IIntelligentGolfReportParser<T>` pattern for HTML reports.
- GET and form POST transport services for authenticated IG pages.
- MediatR commands, queries, and handlers.
- Memory caching for local development or Redis distributed caching in production.
- A distributed report lock when Redis is selected, to prevent several service instances refreshing the same report simultaneously.
- Optional `X-Api-Key` protection for all domain endpoints.
- A credential-validation endpoint that exchanges the Web service's encrypted plugin configuration for a short-lived API session token.

## API surface

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/v1/auth/intelligent-golf/session` | Validate the club site/member/admin credentials and establish the shared IG session. |
| `GET` | `/api/members` | List active members, enriched with names, email addresses, categories and the IG recipient ID. Add `?refresh=true` to bypass the cached reports. |
| `POST` | `/api/members/emails/test` | Send one test copy to an email address through IG. |
| `POST` | `/api/members/emails/campaign` | Send one campaign to selected active members. The request uses club member numbers; the API resolves IG's internal recipient IDs server-side. |
| `POST` | `/api/event-planner/events/synchronise` | Allocate an IG event when necessary and update its core name, date, time, type, attendance and description fields. |
| `PUT` | `/api/event-planner/member-diary` | Create a diary entry when necessary, link it to the IG event, then update its complete HTML body. |
| `GET` | `/api/members/{memberNumber}/diary` | Read the configured member diary page. |
| `PUT` | `/api/members/{memberNumber}/diary` | Submit fields to the configured member diary update page. |
| `GET` | `/api/members/{memberNumber}/planner` | Read the configured member planner page. |
| `PUT` | `/api/members/{memberNumber}/planner` | Submit fields to the configured member planner update page. |
| `GET` | `/api/competitions/available` | List active/upcoming competitions. Supports `year`, `includeActive`, `includeUpcoming`, and `refresh`. |
| `GET` | `/health` | Service liveness. |
| `GET` | `/health/intelligent-golf` | Current background IG session status. |

Swagger is available at `/swagger`.

## Configuration

Never put live IG or Redis credentials in `appsettings.json`. For local development, configure secrets from this project directory:

```powershell
dotnet user-secrets set "IntelligentGolf:MemberId" "<member-number>"
dotnet user-secrets set "IntelligentGolf:MemberPassword" "<member-pin>"
dotnet user-secrets set "IntelligentGolf:AdminPassword" "<admin-password>"
dotnet user-secrets set "IntelligentGolf:EmailSenderMemberNumber" "<sender-member-number>"
dotnet user-secrets set "IntelligentGolf:EmailFromName" "Event Planner"
dotnet user-secrets set "IntelligentGolf:EmailFromAddress" "events@example.com"
dotnet user-secrets set "EventPlaybookApi:ApiKey" "<long-random-value>"
```

The equivalent environment variable names use double underscores, for example `IntelligentGolf__MemberId` and `EventPlaybookApi__ApiKey`.

To use Redis:

```json
{
  "Cache": {
    "Provider": "Redis",
    "Redis": {
      "ConnectionString": "<redis-connection-string>",
      "InstanceName": "BOTGC.EventPlaybook"
    }
  }
}
```

Callers must provide `EventPlaybookApi:ApiKey` in the `X-Api-Key` header. The authentication endpoint accepts the IG credentials only from that trusted server-to-server caller and returns an opaque four-hour token. Domain endpoints also require that token in `X-Intelligent-Golf-Session`. Health and Swagger routes remain accessible without either header. An empty API key is accepted only when `ASPNETCORE_ENVIRONMENT=Development`; in every other environment the authentication and domain endpoints return `503` until a key is configured.

## Member workspace integration point

The generic per-member diary and planner routes below remain configurable adapters. They are separate from the event-planner event and member-diary publishing routes above, whose IG request contracts have now been captured and implemented.

```json
{
  "IntelligentGolf": {
    "Endpoints": {
      "DiaryReadPathTemplate": "/path?memberid={memberNumber}",
      "DiaryUpdatePathTemplate": "/path?memberid={memberNumber}&requestType=ajax&ajaxaction=save",
      "PlannerReadPathTemplate": "/path?memberid={memberNumber}",
      "PlannerUpdatePathTemplate": "/path?memberid={memberNumber}&requestType=ajax&ajaxaction=save"
    }
  }
}
```

The read endpoints return the page HTML plus a dictionary of named input, textarea, and select values. The update endpoints accept a `fields` dictionary and submit it as IG form data. This keeps IG-specific page contracts out of the session and transport infrastructure. Once the exact page structure is known, replace `MemberWorkspaceHandler.ParseDocument` with a typed diary/planner parser without changing the API, session, cache, or MediatR layers.

## Adding another IG report parser

Implement the parser contract in this assembly; it is discovered automatically and registered as a singleton:

```csharp
public sealed class MyReportParser : IIntelligentGolfReportParser<MyRecord>
{
    public Task<IReadOnlyList<MyRecord>> ParseAsync(
        HtmlDocument document,
        CancellationToken cancellationToken = default)
    {
        // Parse only this report's HTML contract.
    }
}
```

Inject `IIntelligentGolfReportParser<MyRecord>` and `IIntelligentGolfReportClient` into a MediatR handler. The report client owns authentication, cache reads/writes, and refresh locking.

## Run

```powershell
dotnet restore
dotnet run
```

For the Playbook deployment, save the IG login and member-email sender identity through the Web application's Plugin administration page. Set the same API key on the Web and private API services. The `IntelligentGolf:MemberId`, `MemberPassword`, `AdminPassword`, `EmailSenderMemberNumber`, `EmailFromName` and `EmailFromAddress` options remain available only as legacy/local fallbacks; configure any Redis connection through the deployment platform's secret/configuration store.
