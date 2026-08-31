# RulesReady Content Studio

This internal support service maintains and publishes the illustrated Rules of Golf content used by RulesReady.golf. Content Studio reads the working library dynamically, so adding or revising a rule no longer requires rebuilding a fixed HTML page.

## Library lifecycle

Each rule has three versions:

1. **Working** (`Output/<rule>`): editable metadata, versioned questions, prompts, and illustrations.
2. **Compiled** (`compiled/<rule>`): the current standard and junior questions packaged with the selected image and prompt.
3. **Published** (`published/rules/<rule>/<revision>`): an immutable copy of the released compiled rule.

The portal fingerprints the files selected for a rule. A rule is:

- **Draft / unpublished** when its current fingerprint has never been released.
- **Compiled** when the staged package matches the current fingerprint.
- **Live** when the public release manifest points to the current fingerprint.
- **Changed** when an older version is live but the working files have changed.

The public library is available without portal credentials at:

- `/published/library.json`
- `/published/manifest.json`
- `/published/<rule-folder>/metadata.json`
- `/published/<rule-folder>/illustration.png`
- `/published/<rule-folder>/final-prompt.txt`

## Portal features

- Search and filter all, unpublished, compiled, or live rules.
- Review standard and junior-friendly questions and the current illustration.
- Add a rule from the **Add new rule** dialog.
- Generate versioned question revisions and replacement illustrations.
- Compile or release one rule.
- Compile and release every unpublished rule as a background job with progress.
- Protect the maintenance console and OpenAI-powered routes with an HTML sign-in page and a signed, HTTP-only session cookie.

## Local development

Requires Node.js 24.

```powershell
npm install
$env:OPENAI_API_KEY = "..."
npm run dev
```

Open `http://localhost:4317`. Authentication is optional outside production. Set `PORTAL_USERNAME` and `PORTAL_PASSWORD` to test the HTML sign-in flow locally. Authenticated sessions expire after 12 hours and are invalidated when the portal password changes.

Useful commands:

```powershell
npm run build
npm test
npm run compile
```

## Configuration

Copy `.env.example` values into your environment. Do not commit secrets.

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required for creating rules, question revisions, and images. |
| `PORTAL_PASSWORD` | Required in production; protects the maintenance portal. |
| `PORTAL_USERNAME` | Optional; defaults to `admin`. |
| `DATA_ROOT` | Root of mutable data. Render uses `/var/data`. |
| `OUTPUT_DIR`, `INPUT_DIR`, `COMPILED_DIR`, `PUBLISHED_DIR` | Optional data-directory overrides. |
| `PORT` | HTTP port; supplied automatically by Render. |
| `OPENAI_QUESTION_MODEL`, `OPENAI_JUNIOR_TEXT_MODEL`, `OPENAI_IMAGE_MODEL` | Optional model overrides. |

## Render deployment

The repository is a monorepo. The included `render.yaml` defines:

- a Node web service rooted at `Rules Quiz Generator`;
- Node `24.14.1`;
- the `/healthz` health check;
- a 5 GB persistent disk mounted at `/var/data`;
- prompted secrets for `OPENAI_API_KEY` and `PORTAL_PASSWORD`.

In Render, create a Blueprint from `botgc-comms/Miscelaneous` and set the Blueprint path to `Rules Quiz Generator/render.yaml`. Render prompts for both secrets during initial setup.

On the first start, the app copies the committed `Output` and `Input` seed libraries to the persistent disk. Subsequent edits are made only on that disk and survive restarts and deploys. Render persistent disks require a paid web service and restrict the service to one instance.

The Blueprint currently deploys the `codex/render-maintenance-portal` feature branch. Change `branch` to `main` after the feature is merged.

## Operational notes

- Portal changes do not alter Git. Back up the Render disk periodically using Render snapshots or a file transfer.
- A release job continues after the initiating HTTP request returns, but an app restart interrupts an in-progress job. Successfully released rules remain live and can be resumed by running **Release unpublished** again.
- The initial release recompiles the legacy library because older compiled metadata has no source fingerprint.
- The legacy generated review page and scripts remain available for historical use but are no longer part of production startup.
