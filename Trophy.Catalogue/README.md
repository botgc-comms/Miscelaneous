# BOTGC Trophy Archive

A mobile-first working archive for reading and verifying the names engraved on Burton-on-Trent Golf Club trophies.

The app is preloaded with the club's 102 trophy records and reference images. For each trophy you can:

- take repeated phone photographs of engraved bands;
- upload complementary paper rubbings;
- ask the OpenAI vision reader to consolidate names and years across every saved image;
- edit and explicitly confirm uncertain readings;
- set a known first/latest year and expose gaps in the chronology;
- mark a trophy's list complete; and
- export the full club archive as CSV.

## Run locally

Requires the .NET 9 SDK.

```powershell
$env:OPENAI_API_KEY = "your-project-key"
dotnet run
```

Open `http://127.0.0.1:5173`. A password is optional in local Development. Without an OpenAI key, uploads and manual editing still work and the saved images can be analysed later.

Local records and uploads are stored in `data-store/`, which is deliberately ignored by Git.

## Release to Render

This repository is a monorepo. Create a Render Blueprint for the repository and set the Blueprint file path to:

```text
Trophy.Catalogue/render.yaml
```

During Blueprint creation, Render asks for two secrets:

1. `APP_PASSWORD` — the shared password that protects the archive and its billable AI action.
2. `OPENAI_API_KEY` — an OpenAI project API key with billing enabled.

The included Blueprint builds the Docker image, deploys in Frankfurt, checks `/health`, and mounts a 5 GB persistent disk at `/var/data`. Render persistent disks require a paid web service and restrict the service to one instance; that matches this small, club-operated archive. Do not switch to a free/ephemeral service: its uploads and confirmed winners would be lost on a redeploy.

Useful official references:

- [Render Blueprints](https://render.com/docs/infrastructure-as-code)
- [Render persistent disks](https://render.com/docs/disks)
- [OpenAI Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)

## Data and privacy

- The Render service stores the working catalogue JSON and original uploads on its attached disk.
- Uploaded evidence is sent to the configured OpenAI project only when the reader runs. Requests set `store: false`.
- Confirmed human edits are never replaced by a later AI reading.
- Keep Render backups or periodically download the CSV. An attached disk is durable, but the CSV is the simplest portable copy of the reconstructed archive.
