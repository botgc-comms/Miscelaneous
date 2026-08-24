# Development deployment

The simplest hosted development environment for this project is a Render Web Service built from the repository's `Dockerfile`. The included `render.yaml` creates a free service in Render's Frankfurt region, enables health checks and deploys each commit to the connected branch.

## Deploy to Render

1. Push this directory to a private GitHub repository.
2. Sign in to Render and choose **New → Blueprint**.
3. Connect the repository containing `render.yaml`.
4. Enter the prompted secret values:
   - `DEMO_PASSWORD`: a strong shared password for approved testers;
   - `OPENAI_API_KEY`: the server-side OpenAI API key, or leave it empty to use mock artwork generation.
5. Apply the Blueprint and wait for `/health` to pass.
6. Open the generated `onrender.com` URL and sign in with the shared password.

Render automatically rebuilds and deploys the service whenever a commit reaches the connected branch. Change `autoDeployTrigger` in `render.yaml` to `checksPass` after adding a GitHub Actions build if deployments should wait for CI.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DEMO_PASSWORD` | Recommended for every hosted development deployment | Enables the shared-password screen. Authentication is disabled when absent. |
| `OPENAI_API_KEY` | Only for live generation | Enables OpenAI prompt and image generation. Without it, the server uses mock artwork. |
| `OPENAI_IMAGE_MODEL` | No | Defaults to `gpt-image-2`. |
| `OPENAI_IMAGE_QUALITY` | No | Defaults to `high`. |
| `OPENAI_PROMPT_MODEL` | No | Defaults to `gpt-5.6`. |

Secrets belong in Render's Environment settings. Do not commit them to Git, the Dockerfile or `render.yaml`.

## Local password-protected testing

PowerShell:

```powershell
$env:DEMO_PASSWORD = 'use-a-long-random-development-password'
dotnet run
```

With `DEMO_PASSWORD` unset, local startup behaves as before and opens without a login screen.

## Current persistence behaviour

This deployment is suitable for individual testing, not yet for shared collaborative data:

- event plans and task-board state are stored in each browser's `localStorage`;
- Poster Studio sessions and generated artwork are stored in each browser's IndexedDB;
- task completion records and the notification development outbox are written to `App_Data` on the server;
- development-login cookie encryption keys are stored under `App_Data/DataProtection-Keys`;
- a free Render service has an ephemeral filesystem, so server-side `App_Data` files can be lost on restart, spin-down or redeployment.

Each tester therefore gets their own browser-local workspace. Moving events and tasks to PostgreSQL, and generated artwork to object storage, is the next step before treating the deployment as a collaborative environment.

## Moving beyond the free development service

The free service sleeps when idle. Upgrade the Render service if immediate wake-up is important. If the development outbox or completion-link state must persist before the database work is complete, use a paid service with a disk mounted at `/app/App_Data`.
