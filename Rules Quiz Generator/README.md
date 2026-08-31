# RulesReady Content Studio

This internal support service maintains and publishes the illustrated Rules of Golf content used by RulesReady.golf. Content Studio reads the working library dynamically, so adding or revising a rule no longer requires rebuilding a fixed HTML page.

## Library lifecycle

Each rule has four lifecycle stages:

1. **Working** (`Output/<rule>`): editable metadata, versioned questions, prompts, and illustrations.
2. **Compiled** (`compiled/<rule>`): a validated canonical rule package containing the selected questions, prompt, and an optimized WebP illustration.
3. **Published**: the compiled revision has been committed to a release branch in the RulesReady GitHub repository and included in a pull request.
4. **Live**: the public RulesReady manifest reports the same source revision after that pull request has been merged and deployed.

The portal fingerprints the files selected for a rule. A rule is:

- **Draft** when its working fingerprint does not match a current compiler package.
- **Ready** when the validated compiler package matches the working fingerprint.
- **Published** when that fingerprint has been pushed to the configured RulesReady release pull request.
- **Live** only when the configured public manifest reports that fingerprint.
- **Changed** when an older revision was published or deployed but the working files have changed.

Compilation never publishes content. Publishing never marks content live. These are deliberately separate operations.

The publisher adds or updates this structure in the RulesReady repository (the root is configurable):

```text
public/content/rules/
  library.json
  <rule-folder>/
    rule.json
    image-<revision>.webp
```

Original PNG files, prompts, and superseded working versions remain on the Content Studio disk and are not copied into the website repository.
The local `compiled/` directory is a disposable build cache and is ignored by Git.

## Portal features

- Search and filter drafts, compiled rules ready to publish, rules in a release PR, or verified live rules.
- Review standard and junior-friendly questions and the current illustration.
- Queue multiple rules from the **Add rule** dialog; each draft is generated independently and remains visible in the background-activity stack.
- Generate versioned question revisions and replacement illustrations.
- Compile one rule or compile every draft as a background job. Compilation validates the quiz data and creates the optimized website image.
- Publish one compiled rule or combine every ready rule into one GitHub release branch and pull request.
- Show the pull request link and distinguish it from a revision verified on the live RulesReady website.
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
| `RULESREADY_GITHUB_REPOSITORY` | Destination repository in `owner/repository` format. |
| `RULESREADY_GITHUB_TOKEN` | Fine-grained token scoped to the destination repository with Contents and Pull requests write access. |
| `RULESREADY_GITHUB_BRANCH` | Pull-request target branch; defaults to `main`. |
| `RULESREADY_CONTENT_PATH` | Repository-relative library root; defaults to `public/content/rules`. |
| `RULESREADY_LIVE_MANIFEST_URL` | Public URL of the deployed `library.json`, used to verify that revisions are genuinely live. |
| `PORT` | HTTP port; supplied automatically by Render. |
| `OPENAI_QUESTION_MODEL`, `OPENAI_JUNIOR_TEXT_MODEL`, `OPENAI_IMAGE_MODEL` | Optional model overrides. |

## Render deployment

The repository is a monorepo. The included `render.yaml` defines:

- a Node web service rooted at `Rules Quiz Generator`;
- Node `24.14.1`;
- the `/healthz` health check;
- a 5 GB persistent disk mounted at `/var/data`;
- prompted secrets for `OPENAI_API_KEY`, `PORTAL_PASSWORD`, and `RULESREADY_GITHUB_TOKEN`;
- prompted RulesReady repository and live-manifest settings.

In Render, create a Blueprint from `botgc-comms/Miscelaneous` and set the Blueprint path to `Rules Quiz Generator/render.yaml`. Render prompts for the secrets and destination-specific repository values during initial setup.

On the first start, the app copies the committed `Output` and `Input` seed libraries to the persistent disk. Subsequent drafts and compiled packages are made only on that disk and survive restarts and deploys. Render persistent disks require a paid web service and restrict the service to one instance.

Create a fine-grained GitHub token for the RulesReady repository with **Contents: Read and write** and **Pull requests: Read and write**. The Content Studio never merges its own pull request or pushes directly to `main`.

## Operational notes

- Drafts are intentionally not committed to Git. Back up the Render disk periodically using Render snapshots or a file transfer.
- Compilation and publication jobs continue after the initiating HTTP request returns, but an app restart interrupts an in-progress job. Completed compiler packages and recorded pull requests remain intact.
- The initial publication requires recompilation because older packages contain PNG files and predate the validating WebP compiler.
- Publication status is stored in `/var/data/published/publication-manifest.json`. Live status is never inferred from that local record; it is checked against `RULESREADY_LIVE_MANIFEST_URL`.
- The legacy generated review page and scripts remain available for historical use but are no longer part of production startup.
