# Development deployment

The included Render Blueprint deploys two processes from the same repository:

- `botgc-event-playbook-dev`, the existing public Web service. Its URL, paid plan and 1 GB persistent disk at `/app/App_Data` remain unchanged.
- `botgc-event-playbook-api-dev`, a separate private service for the Intelligent Golf session and integration endpoints. It has no public `onrender.com` address and is reachable only from services on Render's private network.

Keeping the API separate prevents Intelligent Golf credentials and its authenticated session from being exposed to the browser, and lets that integration restart or scale independently. It does create a second billable Render service. The API does not need a persistent disk; its current cache/session is intentionally in memory on one instance.

## Deploy to Render

1. Commit and push the latest `BOTGC.EventPlaybook` changes to the `botgc-comms/Miscelaneous` GitHub repository.
2. Sign in to Render and choose **New → Blueprint**.
3. Connect the `botgc-comms/Miscelaneous` repository.
4. Set **Blueprint Path** to `BOTGC.EventPlaybook/render.yaml` and select the branch you want to deploy.
5. Retain or enter the Web service secret values:
   - `DEMO_PASSWORD`: a strong shared password for approved testers;
   - `ADMIN_PASSWORD`: a different strong password for the people allowed to change Playbook rules and plugin credentials;
   - `OPENAI_API_KEY`: the server-side OpenAI API key, or leave it empty to use mock artwork generation;
   - `YODECK_API_TOKEN`: an API token with Media and Playlists view/change access;
   - `YODECK_PLAYLIST_ID`: the numeric ID of the existing Clubhouse playlist;
   - leave the legacy Intelligent Golf diary variables empty until that member-diary contract is connected to the new API.
6. Deploy or sync the Blueprint. This keeps the existing Web service and creates `botgc-event-playbook-api-dev`.
7. Generate one long random server-to-server key. Set that same value as `EventPlaybookApi__ApiKey` on both `botgc-event-playbook-dev` and `botgc-event-playbook-api-dev`. The Web service also receives the private-service URL `http://botgc-event-playbook-api-dev:10000` from the Blueprint.
8. On `botgc-event-playbook-api-dev`, add the sender identity used for IG member email:
   - `IntelligentGolf__EmailFromName` and `IntelligentGolf__EmailFromAddress` are required;
   - `IntelligentGolf__EmailSenderMemberNumber` is optional when the numeric member ID saved in Plugin administration is the sender record, but can override it when necessary.
9. Redeploy both services after saving their settings, then wait for the Web `/health` endpoint and API port binding to succeed.
10. Open the existing Web `onrender.com` URL, sign in, then use **Plugin administration → Intelligent Golf** to enter the club site, member ID, member PIN/password and administrator password. Enabling the module validates those details against IG and establishes the private API session.

If the Web service already exists, use **Blueprints → Sync** after pushing this version. Render matches it by the unchanged `botgc-event-playbook-dev` name, so it updates the Dockerfile path without replacing the service, URL or disk. Render does not prompt for new `sync: false` secrets when an existing Blueprint is updated, so add the new Web `ADMIN_PASSWORD` and the API secrets manually. The applications can still start without them, but administrator and authenticated API functions remain unavailable until configured.

Render automatically rebuilds and deploys both services whenever a commit reaches the connected branch. Change `autoDeployTrigger` in `render.yaml` to `checksPass` after adding a GitHub Actions build if deployments should wait for CI.

## Web service environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DEMO_PASSWORD` | Recommended for every hosted development deployment | Enables the shared-password screen. Authentication is disabled when absent. |
| `ADMIN_PASSWORD` | Required for administration | Enables the separate administrator sign-in. Playbook and Plugin Administration remain locked when absent. Use a different value from `DEMO_PASSWORD`. |
| `OPENAI_API_KEY` | Only for live generation | Enables OpenAI prompt and image generation. Without it, the server uses mock artwork. |
| `OPENAI_IMAGE_MODEL` | No | Defaults to `gpt-image-2`. |
| `OPENAI_IMAGE_QUALITY` | No | Defaults to `high`. |
| `OPENAI_PROMPT_MODEL` | No | Defaults to `gpt-5.6`. |
| `YODECK_API_TOKEN` | For Yodeck publishing | Server-side token created under Yodeck **Account Settings → Advanced Settings → API Tokens**. |
| `YODECK_PLAYLIST_ID` | For Yodeck publishing | Numeric ID of the existing Clubhouse playlist in which each event's artwork is created or updated. |
| `YODECK_API_TOKEN_LABEL` | No | Label sent in Yodeck's `Token label:value` authorization header. Defaults to `event-playbook`. |
| `YODECK_PLAYLIST_NAME` | No | Friendly playlist name shown in the publishing dialog. Defaults to `Clubhouse`. |
| `YODECK_MEDIA_DURATION_SECONDS` | No | Display duration of each poster within the playlist. Defaults to 15 seconds. |
| `YODECK_API_BASE_URL` | No | Defaults to `https://app.yodeck.com/api/v2/`; primarily useful for local integration testing. |
| `INTELLIGENT_GOLF_DIARY_ENDPOINT` | For member-diary publishing | Private diary integration endpoint supplied for the club. It may contain `{eventId}`, which Event Playbook replaces with its stable external event reference. |
| `INTELLIGENT_GOLF_API_TOKEN` | For member-diary publishing | Server-side bearer token for the private diary integration. |
| `INTELLIGENT_GOLF_CLUB_ID` | For member-diary publishing | Club identifier expected by the diary integration. |
| `INTELLIGENT_GOLF_DIARY_HTTP_METHOD` | No | `PUT` by default so repeated sends update the same event; set to `POST` only if the supplied integration contract requires it. |
| `EventPlaybookApi__BaseUrl` | Yes for the IG plugin | Private Render address of the API service. The Blueprint supplies `http://botgc-event-playbook-api-dev:10000`. |
| `EventPlaybookApi__ApiKey` | Yes for the IG plugin | Must exactly match the private API service's value. Used only for server-to-server requests. |

Secrets belong in Render's Environment settings. Do not commit them to Git, the Dockerfile or `render.yaml`.

## Private API environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `EventPlaybookApi__ApiKey` | Yes outside Development | Required in the `X-Api-Key` header for every domain endpoint. Health and Swagger are exempt. |
| `IntelligentGolf__BaseUrl` | No | Defaults to `https://www.botgc.co.uk`. |
| `IntelligentGolf__MemberId` | Legacy fallback only | Normally supplied securely by the Web service from Plugin administration. |
| `IntelligentGolf__MemberPassword` | Legacy fallback only | Normally supplied securely by the Web service from Plugin administration. |
| `IntelligentGolf__AdminPassword` | Legacy fallback only | Normally supplied securely by the Web service from Plugin administration. |
| `IntelligentGolf__EmailSenderMemberNumber` | Sometimes for IG test email | Overrides the sender member record. It can be omitted when the numeric Plugin administration member ID identifies the sender. |
| `IntelligentGolf__EmailFromName` | For IG member email | Friendly sender name. |
| `IntelligentGolf__EmailFromAddress` | For IG member email | Sender email address. |
| `Cache__Provider` | No | `Memory` for the current single-instance prototype; use Redis only before scaling the API horizontally. |

The Yodeck token requires permission to view and change both **Media** and **Playlists** in the workspace that contains the Clubhouse playlist. The first send creates a tagged PNG media item with an availability window from the chosen start date through 23:59:59 on the event date and adds it to the existing playlist. Later sends for the same Event Playbook event update that media item's image, metadata and dates in place. Event Playbook also avoids duplicate playlist references and can recognise media created by earlier versions from the event ID stored in its description. Existing unrelated playlist items are preserved.

Intelligent Golf publicly documents the club diary and member-app experience, but not a write API. The member-diary button therefore remains visibly unavailable until the club's private endpoint, token and club identifier have all been supplied. Its server-side request includes a stable `event-playbook-…` external reference, event title/date/times, member-facing description, optional link and approved campaign artwork. Confirm the final endpoint, authentication and field contract with Intelligent Golf before enabling these variables; the browser never receives the token.

The in-app **Plugin administration** page manages the Intelligent Golf club-site login (site URL, member ID, member PIN/password and administrator password) and a Monday.com personal API token with optional workspace and board IDs. Each plugin has an administrator-controlled on/off switch. Turning Intelligent Golf on sends the credentials once from the Web server to the private API over Render's internal network, protected by `X-Api-Key`. The API validates them against IG, keeps its authenticated cookie session in memory and returns a four-hour opaque session token to the Web server; neither credentials nor token are returned to the browser. Turning a module off retains its encrypted settings, while turning it on is rejected until configuration and live authentication succeed. The encrypted settings live in `App_Data/plugin-settings.json`; leave a secret field blank when updating other settings to retain it. **Remove credentials** deletes all stored settings for that plugin. Monday.com task synchronisation remains the next adapter to be implemented.

## Local password-protected testing

PowerShell:

```powershell
$env:DEMO_PASSWORD = 'use-a-long-random-development-password'
$env:ADMIN_PASSWORD = 'use-a-different-long-random-admin-password'
dotnet run --project BOTGC.EventPlaybook.Web/BOTGC.EventPlaybook.Web.csproj
```

With `DEMO_PASSWORD` unset, local startup behaves as before and opens without a tester login screen. Administration is still protected by `ADMIN_PASSWORD`; when it is absent the two administration links remain visibly locked and explain that administrator access is not configured.

## Current persistence behaviour

This deployment is now suitable for lightweight, shared prototype testing:

- event plans, answers, task-board state, deadlines and contacts are shared through a revisioned server document at `App_Data/shared-playbook-state.json`;
- Poster Studio settings and every generated artwork format are saved per event under `App_Data/poster-sessions`;
- artwork embedded in generated member emails is stored under `App_Data/MemberEmailArtwork`, so links in sent emails survive restarts and redeployments;
- browser `localStorage` and IndexedDB remain local caches, so a temporary network failure does not immediately discard the tester's work;
- task completion records, the notification development outbox and development-login cookie encryption keys also live under `App_Data`;
- encrypted plugin credentials live in `App_Data/plugin-settings.json`, with their Data Protection keys in `App_Data/DataProtection-Keys`;
- the club name and uploaded crest configured in **Playbook Administration** live under `App_Data/branding` and are reused by the navigation, shared pages and Poster Studio;
- the Render disk mounted at `/app/App_Data` survives restarts and redeployments.

Two people using different browsers can therefore work with the same events and reopen the same Poster Studio campaigns. Event-state saves use revision checks and field-level merging for edits that overlap. This is deliberately a single-instance prototype: Poster Studio uses last-save-wins, there is no edit-presence indicator, and the JSON/file store is not intended to replace a production database or object store.

## Backups and production limits

Use **Export event plan** in the app for a portable event-level backup. Render disk snapshots and database/object-storage migration can be added later when the prototype stabilises. Keep this service at one instance: a Render persistent disk is attached to one service instance, and this file-based collaboration layer is designed on that basis.
