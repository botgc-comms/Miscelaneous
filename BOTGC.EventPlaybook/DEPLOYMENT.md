# Development deployment

The simplest hosted development environment for this project is a Render Web Service built from the repository's `Dockerfile`. The included `render.yaml` creates a paid Starter service in Render's Frankfurt region, attaches a 1 GB persistent disk at `/app/App_Data`, enables health checks and deploys each commit to the connected branch.

## Deploy to Render

1. Commit and push the latest `BOTGC.EventPlaybook` changes to the `botgc-comms/Miscelaneous` GitHub repository.
2. Sign in to Render and choose **New → Blueprint**.
3. Connect the `botgc-comms/Miscelaneous` repository.
4. Set **Blueprint Path** to `BOTGC.EventPlaybook/render.yaml` and select the branch you want to deploy.
5. Enter the prompted secret values:
   - `DEMO_PASSWORD`: a strong shared password for approved testers;
   - `OPENAI_API_KEY`: the server-side OpenAI API key, or leave it empty to use mock artwork generation;
   - `YODECK_API_TOKEN`: an API token with Media and Playlists view/change access;
   - `YODECK_PLAYLIST_ID`: the numeric ID of the existing Clubhouse playlist.
6. Click **Deploy Blueprint** and wait for `/health` to pass.
7. Open the generated `onrender.com` URL and sign in with the shared password.

If the web service already exists, use **Blueprints → Sync** after pushing this version. Render will ask you to confirm the Starter-plan and persistent-disk changes. Attaching the disk causes a redeploy and the service is briefly unavailable while it restarts.

Render automatically rebuilds and deploys the service whenever a commit reaches the connected branch. Change `autoDeployTrigger` in `render.yaml` to `checksPass` after adding a GitHub Actions build if deployments should wait for CI.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DEMO_PASSWORD` | Recommended for every hosted development deployment | Enables the shared-password screen. Authentication is disabled when absent. |
| `OPENAI_API_KEY` | Only for live generation | Enables OpenAI prompt and image generation. Without it, the server uses mock artwork. |
| `OPENAI_IMAGE_MODEL` | No | Defaults to `gpt-image-2`. |
| `OPENAI_IMAGE_QUALITY` | No | Defaults to `high`. |
| `OPENAI_PROMPT_MODEL` | No | Defaults to `gpt-5.6`. |
| `YODECK_API_TOKEN` | For Yodeck publishing | Server-side token created under Yodeck **Account Settings → Advanced Settings → API Tokens**. |
| `YODECK_PLAYLIST_ID` | For Yodeck publishing | Numeric ID of the existing Clubhouse playlist to which event artwork is appended. |
| `YODECK_API_TOKEN_LABEL` | No | Label sent in Yodeck's `Token label:value` authorization header. Defaults to `event-playbook`. |
| `YODECK_PLAYLIST_NAME` | No | Friendly playlist name shown in the publishing dialog. Defaults to `Clubhouse`. |
| `YODECK_MEDIA_DURATION_SECONDS` | No | Display duration of each poster within the playlist. Defaults to 15 seconds. |
| `YODECK_API_BASE_URL` | No | Defaults to `https://app.yodeck.com/api/v2/`; primarily useful for local integration testing. |

Secrets belong in Render's Environment settings. Do not commit them to Git, the Dockerfile or `render.yaml`.

The Yodeck token requires permission to view and change both **Media** and **Playlists** in the workspace that contains the Clubhouse playlist. Publishing creates a tagged PNG media item with an availability window from the chosen start date through 23:59:59 on the event date, uploads the file using Yodeck's signed upload URL, and appends the item to the existing playlist. Existing playlist items are preserved.

## Local password-protected testing

PowerShell:

```powershell
$env:DEMO_PASSWORD = 'use-a-long-random-development-password'
dotnet run
```

With `DEMO_PASSWORD` unset, local startup behaves as before and opens without a login screen.

## Current persistence behaviour

This deployment is now suitable for lightweight, shared prototype testing:

- event plans, answers, task-board state, deadlines and contacts are shared through a revisioned server document at `App_Data/shared-playbook-state.json`;
- Poster Studio settings and every generated artwork format are saved per event under `App_Data/poster-sessions`;
- browser `localStorage` and IndexedDB remain local caches, so a temporary network failure does not immediately discard the tester's work;
- task completion records, the notification development outbox and development-login cookie encryption keys also live under `App_Data`;
- the Render disk mounted at `/app/App_Data` survives restarts and redeployments.

Two people using different browsers can therefore work with the same events and reopen the same Poster Studio campaigns. Event-state saves use revision checks and field-level merging for edits that overlap. This is deliberately a single-instance prototype: Poster Studio uses last-save-wins, there is no edit-presence indicator, and the JSON/file store is not intended to replace a production database or object store.

## Backups and production limits

Use **Export event plan** in the app for a portable event-level backup. Render disk snapshots and database/object-storage migration can be added later when the prototype stabilises. Keep this service at one instance: a Render persistent disk is attached to one service instance, and this file-based collaboration layer is designed on that basis.
