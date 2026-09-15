# GolfSixes League

A complete first implementation of season configuration, junior team preparation and shared matchday scoring. React / Vinext, Cloudflare Workers, D1 and private R2 photo storage.

## Run locally

Club organiser invitations now retain pending, accepted, expired and revoked states. Club details show joined organisers and outstanding invitations; Foundation admins can remove a club assignment and assigned organisers can invite colleagues to their own club. Invitation tokens are kept in private R2 storage for authorised copy/resend, while workspace snapshots expose no token or hash. Acceptance is email-bound and idempotent; an admin accepting an organiser invitation retains their admin role and gains the organiser club association. Email delivery uses the existing Resend adapter when `RESEND_API_KEY` and a verified `AUTH_FROM_EMAIL` are configured. Without those, the UI offers copy-link sharing and does not claim an email was sent. Private Sites audience restrictions still apply to invite recipients.

Apply `drizzle/0003_striped_bloodscream.sql` locally for background club logos. New or changed club websites queue bounded website-image discovery, AI logo identification and raster cleanup; original SVG artwork is preserved after active-content checks. Manual upload/removal overrides in-progress jobs and the original raster remains available. Logo jobs use their own D1 table and private R2 objects, so they do not change season revisions or invalidate an assistant import’s Undo. OpenAI background responses continue independently; active staff workspace polling advances retrieval and saves completed results. Club details show progress, fallback messages and upload/original/remove controls. `npm test` includes invitation permissions and logo job concurrency/fallback coverage.

Use Node 22.13+ (Node 24 is recommended). Install with `npm ci`, initialise the database with `node node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config wrangler.local.json --file drizzle/0000_powerful_may_parker.sql`, then `npm run dev`. Follow the local sign-in link. The starter's development-only identity is Seedy; production identity is supplied by the Sites authentication dispatcher.

`npm test` runs domain tests. `npm run test:api` exercises the local running server. `npm run typecheck` checks TypeScript. `npm run build` produces the Worker and client assets. Database schema changes use `npm run db:generate`.

## Workflows

Foundation admins have a floating AI assistant for club research, league/team/fixture proposals and image attachments (JPG/PNG/WebP, up to 4 MB). It uses the server-only `OPENAI_API_KEY` secret and optional `OPENAI_MODEL` (default `gpt-5.4`). Apply migration `0002_bumpy_roulette.sql` locally. The hosted secret is configured through Sites. Requests run using the Responses API background mode, with persistent task history and visible polling status. Closing the panel does not apply changes. Model context excludes stored family/child/contact details; explicitly submitted instructions and images are sent to OpenAI. Proposals are validated through existing domain rules and display an actual data diff. Every write requires explicit Apply. Sources and gaps appear alongside research results. Current support is clubs, leagues, teams and fixture details; access, children, care and scoring are maintained through the regular screens.

Assistant Apply/Undo uses a single D1 batch with workspace/task/family revision guards. Undo restores the previous snapshot only when there have been no later edits; it never overwrites conflicting changes. Workspace tools includes a reviewed reset preserving real Foundation admin accounts. Linked unshared children are cleared from family records too, while family registration and children used in other workspaces remain. Recovery copies and existing image objects are retained for Undo; this is a workspace reset, not permanent account erasure. `npm run test:assistant` checks preview-only behavior, scope, protected data, atomic resets, conflicts and Undo.

1. Foundation, organiser and parent views use the same persisted league, club and team records. There are no separate normal-use example or real-account directories.
2. Open Foundation administration. An existing authorised workspace is reused; the initial creator of a new workspace becomes its overall administrator. Add leagues and configure holes, pairs per team, the stroke cap and fixture tie policy.
3. Create club organisations. An organisation can represent one club or a consortium. Add venues, addresses, visitor instructions, SafeGolf status and welfare contacts. Enter multiple teams, each with a distinct cap colour per league. Venues may host zero or more fixtures.
4. Invite overall admins, league-scoped admins, organisation-scoped organisers and parents. Staff invitations are email-bound, single-use and expire after 14 days. Parent registration links can be reusable, scoped to organisations, optionally email-bound and revoked. No email is sent by the app.
5. Parents register one or more children with date of birth, handicap, emergency details, dietary/support information and explicit publication consent. Private identification photos can be uploaded after registration.
6. Schedule fixtures with participating teams, arrival and play times, registration, start format, food and welcome instructions. Organisers submit two players per pair; duplicate player selection across teams is rejected. Hosts allocate pairs to starting slots or accept editable suggestions.
7. The host starts play after readiness checks. Parents of either child in a pair and authorised organisers can score that pair. Polling refreshes shared scorecards every four seconds; conflicting edits to the same hole require review. There is no silent offline queue.
8. The host finalises complete scorecards. The app computes fixture results and updates the season table. Only league administrators may reopen results; reopening removes those league points until the fixture is finalised again.

## Access and persistence

All API writes check identity, membership, role and scope on the server. Real workspaces never grant privileges from the demo role selector. Other children's birth dates, care notes, photos and emergency details are removed from parent responses. Host organisers can see participating players' care details for scheduled/live fixtures. Publication consent does not make identification photos public. Photos are served through authenticated, no-store routes with MIME-signature and size checks.

D1 stores versioned workspace snapshots. Compare-and-swap prevents lost updates, and hole versions distinguish conflicting scores from independent changes. Invitation tokens are stored only as SHA-256 digests. Score changes include author and timestamp; a bounded activity history is retained with the workspace. R2 stores photo bytes. No authoritative data is stored in browser storage.

The first implementation is intended for a managed pilot. A national rollout should partition the snapshot persistence into indexed entity/league records, benchmark concurrent scoring, add full audit retention, establish data retention/deletion procedures and confirm organisation-specific consent wording. The current implementation does not provide offline score entry, outgoing fixture email notifications, photo moderation or a Golf Genius integration. Email sign-in is prepared for provider connection. It is not a national-scale performance claim.

The Site is published privately to its owner. Before inviting actual clubs and families, enable the intended Sites audience; app invitations do not override the outer Site access policy. Sign-in currently uses ChatGPT. Do not treat a workspace admin role as a claim of official employment by the Golf Foundation.

## Research and rule decisions

Research checked 11 September 2026:

- [Official GolfSixes League programme](https://www.golf-foundation.org/golfsixes-league/): six shortened holes, beginner focus, squad selection, handicap guidance, parent chaperones, SafeGolf and welfare expectations.
- [Golf Foundation team manager FAQs](https://golffoundation.b-cdn.net/wp-content/uploads/2024/02/GolfSixes-League-FAQ-Team-Managers.pdf): three pairs, Texas Scramble, maximum ten strokes, points equal to 11 minus strokes, combined team scores and placement-based league points.

The programme is run by the Golf Foundation with home-nation partners, including England Golf. This independent implementation is not connected to the Foundation's current Golf Genius system. The visual direction uses golf greens, clear typography and team cap colours; formal brand approval and supplied brand assets remain part of rollout.

Average placement points for tied fixture positions are an explicit app default, not asserted as a verified national rule. Admins can instead select shared-place points. Season ties use aggregate game points, then share a place. Handicap below 37 prompts review but is not an automatic exclusion. League settings lock once play starts. The configured variations and flexible hosting implement the requested scope beyond the standard programme defaults.

Browser visual/interaction QA was not requested and has not been claimed. WebMCP fixture navigation is feature-detected; a supported WebMCP runtime was unavailable for contract verification. Domain tests, API tests, TypeScript and the production build provide the automated checks.

## Guided parent experience

The landing page asks how the visitor is taking part. The parent area has Home, My children and Updates, with a three-step child-registration wizard. Children belong to the parent account before a club is chosen. Saving a new child leads directly to club selection. Parents choose the child's home club first, then choose among that club's leagues/seasons and teams. Single available choices are selected automatically. Club searches tolerate punctuation such as hyphens; consortium venue names are also searchable. Registered clubs remain visible before their teams open, with a distinct explanation for no clubs, no matching clubs, or no open teams. The directory exposes only club IDs, names and venue names. Six-digit codes and QR invitations are optional shortcuts. All requests require organiser approval, including code invitations. Siblings can join different teams and clubs.

Organisers land on their teams, each labelled with its league and season, pending requests and approved children. Parent requests provides detailed approval/decline, profile review, QR invitations and squad management. A child can have one approved team per league; transferring removes future selections for the old team and keeps historical results. Participants cannot be moved within a live league until play ends, but next season's registration can proceed. Existing workspace rosters are upgraded using their most recent recorded selections; organisers can assign unselected players through the squad panel.

## Foundation season setup

Foundation administrators lead with the season's leagues. Start another season (for example, 2027 while it is still 2026), create leagues, create/import clubs, then approve a club team into a league. A club is retained across seasons and can have multiple teams in different leagues. Each team is a distinct league entry: a club can have a Staffordshire team and a Derbyshire team. Only an overall or appropriately scoped league administrator can create/edit the team assignment. Saving it records Foundation approval; this is a participation decision, not a payment collection or subscription billing integration. Existing teams are retained as previously accepted entries.

Teams appear automatically to parents while the league's registration is open. There is no separate organiser directory switch. Foundation admins can close registration independently of fixtures/results; a closed league also rejects requests made with a code. Legacy leagues without an explicit setting accept registration for the current or future year. New leagues have registration open by default.

Club CSV import accepts `club_name` (required), `address`, `county`, `postcode` and `instructions`. The downloadable template, preview and confirmation show what will be imported. Existing/duplicate club names are skipped without overwriting details; up to 200 clubs per import, 90 KB CSV limit. A club organisation and initial venue are created together; welfare/accreditation details can be completed later in club details. Fixtures can be created and updated while those fields remain incomplete.

Foundation Overview contains compact league cards for the selected season. League links open their fixture page, including creation/editing, participating teams and a league-specific leaderboard. Add a club searches the directory before creating its team entry. The separate Clubs page supports name/address/postcode search, recorded-county filtering, 20-row pagination, venue details, CSV import and team assignment across leagues and seasons. County/postcode fields are optional for existing clubs and persist inside the workspace snapshot. Scoped Foundation admins can search unassigned clubs but remain limited to their assigned leagues and authorised family records.

The Players & families directory searches player and guardian contacts and combines league, club, team, care/consent, handicap and prior-participation filters. League/team filters follow pending or approved child enrolments, rather than inferring a child's league from the club. Private details open on demand; server projections continue to control visibility. Previous participation means selection in a completed fixture in an accessible league from a season before the chosen year. Missing records are labelled as unrecorded history, not as proof that a child is new. Organiser Overview remains team-based, lists other clubs in each league, links to player/request management, and opens joining instructions and QR codes directly.

Existing primary example workspaces and examples containing custom club/league setup are adopted in place when their owner opens either staff or parent APIs. Their record IDs and existing team links are retained, and the authenticated owner becomes an administrator. Seeded children keep their original guardian; children entered or edited by the owner are preserved in the owner’s family account. Legacy family records are retained, and completed imports are tracked for idempotence.

Parents see their children's upcoming fixtures and can answer available / unsure / unavailable. Selections include the paired player and reserve status. Withdrawing releases a selected/reserve place and alerts organisers. During live play, the relevant scorecard comes first. Child cards show cap colours and league position; completed fixtures remain accessible. In-app notifications cover approvals, selections, reserves, withdrawals, starting details, fixture edits/cancellation and finalised results. External fixture email delivery is not connected.

Family profiles and child-specific team enrollments persist in D1. A versioned family outbox retries propagation to joined workspaces. Care/emergency changes and withdrawal of photo-publication consent take effect immediately and alert organisers. Routine name, birthday, handicap and consent-grant changes require review once enrolled. Private identification photos are stored in R2; they are independent of publication consent. Replaced photo objects currently require a retention cleanup process before wider rollout.

Old example URLs and ordinary parent URLs now resolve to the same account-owned family and the same shared registration directory. Fresh users receive no fictional family records.

Apply `drizzle/0001_mean_jigsaw.sql` locally after the initial migration with the same Wrangler command. Real workspaces never grant privileges from the demo role selector; the parent view can only narrow existing access.

## Connecting email sign-in

No provider credentials are configured. `/api/auth` exposes readiness; the UI disables email-code submission until connected and offers the current private account for review. The implementation has a Resend adapter in `lib/email.ts`; configure `RESEND_API_KEY` and a verified sender in `AUTH_FROM_EMAIL` as server-side Sites runtime secrets, or replace the adapter for a chosen provider. No secrets belong in frontend variables or git. Six-digit login codes expire after ten minutes, permit five verification attempts and are single-use; request limits apply per email. Session tokens are hashed in D1 and sent only in HttpOnly, Secure, SameSite cookies, with server-side logout invalidation. This connection must be exercised with the chosen provider before email login is advertised as available. Connecting email does not change the Site's private audience; wider parent access is a separate publishing decision.

Cap artwork uses the Phosphor baseball-cap icon under the MIT license in `public/phosphor-LICENSE.txt`. QR graphics are generated locally by `qrcode` from the team invitation link; no third-party QR service receives family data.

League capacity is six teams, including multiple teams from one club. Overview shows assigned teams with cap colours and occupied places; full leagues disable admission in Overview, fixtures and the club/team pickers, and the server rejects a seventh team while allowing existing team edits and parent requests to existing teams.

Role navigation retains only a workspace preference. All parent routes ignore legacy demo/stage flags and use the same family and shared catalog; URL or browser storage values never grant permissions. Overall administrators can view the same records as an organiser or parent with reduced permissions; ordinary accounts cannot grant themselves those roles. Local development and published deployment still have separate databases, so review continues at the published app.

New fixtures include all league teams by default. Team selection is inside a collapsed Exceptions section, whose summary always shows whether all teams are included or a subset was selected.

Fixture titles are generated from the hosting venue and date on creation and updates; no separate name is required.
