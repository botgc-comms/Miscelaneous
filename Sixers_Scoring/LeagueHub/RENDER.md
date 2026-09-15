# Render deployment

Target: existing `junior-golf-sixes` service in `My Workspace`.
URL: https://junior-golf-sixes.onrender.com
Repository: https://github.com/botgc-comms/Miscelaneous
Service root: `Sixers_Scoring` (Docker; Frankfurt; existing Starter plan and disk).

## Runtime

- Build with `npm run build:render`; start with `npm run start:render`.
- Node 24; listen on `0.0.0.0:$PORT`.
- `DATA_DIR=/var/data/golfsixes-league` stores SQLite and private uploaded objects.
- The existing scoring app's files under `/var/data` must not be deleted or overwritten.
- `/health` checks database connectivity.
- SQL migrations run transactionally at runtime, when the disk is available.
- Sites builds remain available via `npm run build`.

The Node runtime implements the D1 operations used by the app, including atomic
batches and UPDATE RETURNING, and stores uploaded objects under hashed filenames.
Records and uploads are not included in source control or the container image.

## Sign-in and secrets

Sites-authenticated headers are explicitly ignored on Render. Verified email codes
use the existing Resend integration. After code verification, an existing member ID
is reused when the email uniquely matches a migrated account. Ambiguous accounts
are rejected rather than granting an arbitrary account's permissions.

For the private preview, set `PRIVATE_PREVIEW=true` and retain the existing
`APP_PASSWORD`. This opens the migrated Foundation administrator account with
a 12-hour session. API routes require that session. This shared preview is for
the owner to test, not for distributing to parents or organisers.

Later, set `RESEND_API_KEY` and a verified `AUTH_FROM_EMAIL` for individual sign-in.
Reuse the existing `OPENAI_API_KEY` only after confirming it supports the league
assistant's API operations. Preserve all unrelated service settings and secrets.
Disable `PRIVATE_PREVIEW` when individual email sign-in is ready.

## Cutover gates

1. Verify sign-in and authenticated administration on the Render runtime.
2. Export a complete, consistent backup of the current Sites database and private
   objects. The Sites table-inspection tool truncates long JSON cells and is NOT
   an export tool; its results must never be imported as production data.
3. Import into the separate league data directory, retaining record IDs and
   relationships. Exclude old login sessions and one-time authentication codes.
4. Compare counts and test an existing parent's children, organiser club membership,
   fixtures, availability, selections, uploaded pictures and notifications.
5. Only then merge the deployment change into main and trigger the selected Render
   service. Keep the Sites deployment as a rollback reference until verification.

A source build or a 200 health response alone does not establish that migration is
complete. Do not replace the live Render application with an empty/unusable league.

## Local validation

`npm run typecheck`
`node --test tests/render-runtime.test.mjs`
`node --test tests/model.test.mjs`
`npm run build:render`

Set `DATA_DIR` to a fresh ignored test directory and `PORT` to an unused port, then
run `npm run start:render`. Verify `/health` returns 200 and `/api/auth` returns
`user: null` even when a request supplies `oai-authenticated-user-*` headers.
