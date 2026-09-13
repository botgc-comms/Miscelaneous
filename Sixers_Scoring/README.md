# Junior Golf Sixes Final

Phone-friendly scorecard photographs, human review, strokes-to-points checks, and a team leaderboard. Each club-and-colour team is ranked separately. Each card has three pairs and six holes. Defaults: six cards, six clubs, three pairs per club; change counts and club names in Event setup.

## Run locally

Requires Node.js 24. The API key stays on the server.

1. Run `npm ci`.
2. Set `OPENAI_API_KEY` in your environment (the same key used by Trophy Guru is supported). Optional `OPENAI_MODEL` defaults to Trophy Guru's `gpt-5.6-terra`.
3. Run `npm run build`, then `npm start`.
4. Open `http://localhost:3001`. For development, run `npm run dev:server` and `npm run dev` in separate terminals.

Optional environment variables are listed in `.env.example`. The server reads process environment variables; to use an `.env` file, run `node --env-file=.env server/index.mjs`.

## Render deployment

`render.yaml` targets the existing `botgc-comms/Miscelaneous` GitHub repository, using `Sixers_Scoring` as the service root.

1. Commit and push this folder to that repository.
2. In Render, create a Blueprint from the repository and set **Blueprint Path** to `Sixers_Scoring/render.yaml`.
3. Set `APP_PASSWORD` to an event password of at least 12 characters, and set `OPENAI_API_KEY` to the existing OpenAI key. Share the event password only with the scorers.
4. Deploy, then open the Render HTTPS URL on your phone. The password protects scores, edits, names and photos.

For a manual Render Web Service, choose Docker, Root Directory `Sixers_Scoring`, Dockerfile `./Dockerfile`, and health check `/health`. Add the environment variables from `render.yaml` and a persistent disk mounted at `/var/data` with 1 GB storage. A paid instance is required for a persistent disk. The Blueprint specifies the Starter plan; review the price in Render before deployment.

If you move this folder into its own standalone GitHub repository, remove `rootDir: Sixers_Scoring` from the Blueprint and use `render.yaml` as its Blueprint path.

SQLite scores, edit history and original photos are stored together under `DATA_PATH`. Keep the Render disk attached; the app intentionally uses one instance. Never put a real key in Git, browser code, Docker build arguments or the Blueprint.

## Matchday flow

- Set club spellings and the expected number of cards/pairs in Event setup.
- Take a photo or upload an existing image; one photo represents one scorecard. The original photo is expandable during review.
- Check the club, team colour, players and the six strokes. No pair number is required.
- Enter or correct the six strokes for each pair. The original image remains available for comparison.
- 1 stroke scores 10 points, through 10 strokes scoring 1 point. Blanks remain blank. Scores beyond this printed range are rejected until the event rule is clarified.
- Points and totals are calculated automatically from strokes. Written points and totals are compared with calculated results and differences appear beside the team. They never block confirmation: the leaderboard always uses calculated points.
- Save incomplete cards as drafts. Tap the sticky Confirm button to save and return directly to the leaderboard. No extra checkbox is required.
- Reopen a saved card with Edit. Saving changes replaces its previous contribution. Saving a confirmed card as a draft removes its contribution until re-confirmed.
- Each club-and-colour team has its own total. Missing team colours stay separate rather than being combined by club. Equal totals share a rank; no unconfirmed tie-break rule is applied. Standings refresh every 20 seconds.
- Backup downloads score data and edit history as JSON; original photos remain on the server disk. The JSON export is a readable backup, not an in-app restore file.

Identical photo bytes and reused card numbers are rejected. Multiple pairs and colours from the same club are allowed. Concurrent edits use revision checks to avoid silent overwrites. Confirmation is enforced on the server as well as the screen.

## Verification

`npm test` checks scoring and server persistence/authentication behavior. `npm run build` builds the phone UI. `npx tsc --noEmit` checks TypeScript.

The supplied labelled blank card was successfully read with the live OpenAI API: Ashbourne Orange, Ashbourne Black and Chevin Green were identified, and all 18 blank stroke fields stayed blank. Filled-in handwriting must still be reviewed on the day.

An optional, feature-detected WebMCP tool reads standings from the same API. It does not change results. No supported WebMCP validation context was available during implementation.

## League standings

The League tab shows points before the event, today's match award, and the updated total. Enter prior scores with **Enter current standings**. Unknown starting scores remain blank; zero is only used when entered explicitly. All league standings are stored on the server and included in the JSON backup.

Match positions award 6, 5, 4, 3, 2, and 1 league points; later positions award zero. Ties average the points for all occupied positions: two tied first get 5.5 each, three tied first get 5 each, and two tied fifth get 1.5 each. Drafts do not receive an award. Awards remain provisional until all expected scorecards are confirmed.

Totals are always recalculated as the starting score plus the current match award, so editing or re-confirming a card never adds the award a second time. A club with a single uncoloured team in the official starting standings (such as Burton) uses that team identity across its cards; clubs with multiple team colours remain separate. Starting standings must be saved into the app, not committed as event data to the source repository.

## Delete a scorecard

Use **Delete** beside a card's Edit button, or open the card and use Delete in its header. The confirmation identifies the card and teams. Deleting removes its active scores and photo, frees the card number for reuse, and recalculates match standings and today's league awards. Starting league points stay unchanged. An audit entry remains in the score-data backup. A card changed on another device must be reopened before it can be deleted.
