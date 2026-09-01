# Trophy Archive AI

A mobile-first working archive for recovering the names and years engraved on historic trophies.

The current repository contains the proven Burton-on-Trent Golf Club archive plus a commercial product preview. It can:

- create new trophy records from the mobile catalogue;
- take repeated photographs or upload a batch of photographs and rubbings;
- consolidate the complete image set with an OpenAI vision model after the user pauses;
- generate a catalogue illustration from up to four real trophy angles;
- edit, confirm and manually add winners, including highlighted missing years;
- import CSV, TSV or XLSX member exports without retaining the original spreadsheet or full date of birth;
- suggest age-plausible probabilistic member matches and explain their confidence; and
- export trophy, winner and optional member-match data as CSV.

The public home page is intentionally marked as a commercial preview. The current persistence and password gate are still single-club architecture; they are not a safe substitute for multi-tenant accounts and billing. See [COMMERCIAL-LAUNCH.md](COMMERCIAL-LAUNCH.md) for the recommended pricing, Stripe model, privacy boundaries, launch architecture and release gates.

## Run locally

Requires the .NET 9 SDK.

```powershell
$env:OPENAI_API_KEY = "your-project-key"
dotnet run
```

Open `http://127.0.0.1:5173` for the product page, or `http://127.0.0.1:5173/archive.html#catalogue` for the working archive. A password is optional in local Development. Without an OpenAI key, uploads, imports and manual editing still work; AI reading and illustration generation remain disabled.

Local records, member matches, uploads and generated illustrations are stored in `data-store/`, which is deliberately ignored by Git. Fictional CSV and XLSX member-import examples are available in `Data/member-import-template.csv` and `outputs/commercial-member-import/member-import-template.xlsx`.

## AI configuration

- `OPENAI_MODEL` selects the engraving reader model.
- `OPENAI_IMAGE_MODEL` selects the image edit model and defaults to `gpt-image-2`.
- `TROPHY_ILLUSTRATION_PROMPT` replaces the built-in museum-catalogue prompt. Include `{{trophy_name}}` if the name should be inserted.
- `ANALYSIS_DEBOUNCE_SECONDS` controls how long the background reader waits after the most recent upload so that a phone user can add several photographs first.

Evidence uploads are sent to OpenAI only when an analysis or illustration is requested. The engraving reader sets `store: false`. Human-confirmed winner records are not silently replaced by later automatic readings.

## Release the current single-club archive to Render

This repository is a monorepo. Create a Render Blueprint for the repository and set the Blueprint file path to:

```text
Trophy.Catalogue/render.yaml
```

During Blueprint creation, Render asks for two secrets:

1. `APP_PASSWORD` — the shared password protecting the current archive and its billable AI actions.
2. `OPENAI_API_KEY` — an OpenAI project API key with billing enabled.

The included Blueprint builds the Docker image, deploys in Frankfurt, checks `/health`, and mounts a 5 GB persistent disk at `/var/data`. This topology remains suitable for the existing single-club archive only. Do not expose it as a paid multi-customer service; complete the production gates in `COMMERCIAL-LAUNCH.md` first.

Useful official references:

- [Render Blueprints](https://render.com/docs/infrastructure-as-code)
- [Render persistent disks](https://render.com/docs/disks)
- [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation)

## Data and privacy

- The current Render service stores catalogue JSON, generated illustrations, member birth years/membership numbers and original evidence images on its attached disk.
- The member importer persists only normalised matching fields. Full dates of birth are reduced to birth year in memory, and the uploaded spreadsheet is not retained.
- Member matches are suggestions with a confidence and explanation; a human remains responsible for verification.
- Keep Render backups and periodically download the CSV. The CSV is the simplest portable copy of the reconstructed archive.
