'use client';
import { RegistrationDesk } from './registration-desk';
import { Scorecards } from './scorecards';
import { LiveLeaderboard } from './live-leaderboard';
export { Scorecards } from './scorecards';
import { TeamLineup } from './team-lineup';
import { StartingSlots } from './starting-allocations';
import { FixtureMessageInbox } from './fixture-conversation';
export { TeamLineup } from './team-lineup';
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  MapPin,
  Utensils,
  Flag,
  Check,
  ShieldCheck,
} from 'lucide-react';
import { Badge, Dot, dateLabel, type AppTools } from './widgets';
import {
  canManageTeam,
  capOrder,
  canHost,
  canLeague,
  readiness,
  fixtureResults,
  fixtureScoringOpen,
  type Fixture,
} from '@/lib/model';
export function FixtureDetail({
  f,
  tools,
  back,
}: {
  f: Fixture;
  tools: AppTools;
  back: () => void;
}) {
  const { s, me, busy, act, edit } = tools;
  const l = s.leagues.find((l) => l.id === f.leagueId)!;
  const club = s.clubs.find((c) => c.id === f.clubId);
  const host = canHost(s, me, f);
  const scoringOpen = fixtureScoringOpen(s, f);
  const [tab, setTab] = useState(
    scoringOpen
      ? host
        ? 'registration'
        : 'live'
      : f.status === 'completed'
        ? 'results'
        : me.role === 'organiser'
          ? 'pairings'
          : 'details',
  );
  const [error, setError] = useState('');
  const run = async (type: string) => {
    setError('');
    try {
      await act({ type, fixtureId: f.id });
      if (type === 'finalise') setTab('results');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const issues = readiness(s, f);
  const showScorecards = scoringOpen || f.status === 'completed';
  const showResults = f.status === 'completed';
  const visibleTab =
    (tab === 'score' && !showScorecards) ||
    (tab === 'live' && !scoringOpen) ||
    (tab === 'results' && !showResults)
      ? showScorecards
        ? f.status === 'completed'
          ? 'results'
          : 'live'
        : 'details'
      : tab;
  return (
    <>
      <button className="text-link row mb-5" onClick={back}>
        <ArrowLeft size={16} />
        All fixtures
      </button>
      <div className="page-heading">
        <div>
          <div className="row mb-2">
            <span className="eyebrow">{l.name}</span>
            {scoringOpen && f.status === 'scheduled' ? (
              <span className="badge green">Scoring open</span>
            ) : (
              <Badge status={f.status} />
            )}
          </div>
          <h1>{f.name}</h1>
          <p>
            {club?.name} · {dateLabel(f.date)} {f.date.slice(0, 4)}
          </p>
        </div>
        <div className="row wrap">
          {host && f.status === 'scheduled' && (
            <>
              <button className="btn" onClick={() => edit('fixture', f)}>
                Edit fixture
              </button>
            </>
          )}
          {host && f.status === 'live' && (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => run('finalise')}
            >
              <Check size={16} />
              Finalise results
            </button>
          )}
          {canLeague(me, l.id) && f.status === 'completed' && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => run('reopen')}
            >
              Reopen for correction
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="error mb-4">
          {error}
        </p>
      )}
      {f.status === 'scheduled' && !scoringOpen && (
        <section className="fixture-responsibility">
          <strong>
            {host
              ? me.role === 'admin'
                ? 'You’re managing the whole fixture'
                : 'Your club is hosting this fixture'
              : 'Your club is visiting'}
          </strong>
          <p>
            {host
              ? 'Review every team’s pairs, allocate starting holes and tee times, and share arrival details and directions with everyone.'
              : 'Choose your club’s players and pairs. The host will organise starting holes, tee times and joining instructions.'}
          </p>
          {host && (
            <div className="host-progress">
              <span>
                <strong>
                  {
                    f.teamIds.filter(
                      (id) =>
                        f.pairs.filter((p) => p.teamId === id).length ===
                        l.pairs,
                    ).length
                  }{' '}
                  of {f.teamIds.length}
                </strong>{' '}
                teams selected
              </span>
              <span>
                <strong>
                  {
                    f.pairs.filter((p) =>
                      f.slots.some((slot) => slot.id === p.slotId),
                    ).length
                  }{' '}
                  of {f.pairs.length}
                </strong>{' '}
                pairs allocated a start
              </span>
            </div>
          )}
          <div className="row wrap">
            {tab !== 'pairings' && (
              <button className="btn" onClick={() => setTab('pairings')}>
                {host ? 'Review all teams' : 'Choose my players'}
              </button>
            )}
            {host && (
              <>
                <button className="btn" onClick={() => setTab('starts')}>
                  Allocate starts
                </button>
                <button
                  className="text-link"
                  onClick={() => edit('fixture', f)}
                >
                  Edit joining instructions
                </button>
              </>
            )}
          </div>
        </section>
      )}
      <FixtureMessageInbox s={s} fixtureId={f.id} busy={busy} send={act} />
      <Tabs value={visibleTab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="tab-list" variant="line">
          {host && ['scheduled', 'live'].includes(f.status) && (
            <TabsTrigger value="registration">Registration</TabsTrigger>
          )}
          {[
            ...(scoringOpen ? [['live', 'Live leaderboard']] : []),
            ['details', 'Match details'],
            ['pairings', 'Team selection'],
            ['starts', 'Starting allocations'],
            ...(showScorecards ? [['score', 'Scorecards']] : []),
            ...(showResults ? [['results', 'Results']] : []),
          ].map(([id, name]) => (
            <TabsTrigger value={id} key={id}>
              {name}
            </TabsTrigger>
          ))}
        </TabsList>
        {scoringOpen && (
          <TabsContent value="live">
            <LiveLeaderboard f={f} tools={tools} />
          </TabsContent>
        )}
        {host && ['scheduled', 'live'].includes(f.status) && (
          <TabsContent value="registration">
            <RegistrationDesk tools={tools} f={f} />
          </TabsContent>
        )}
        <TabsContent value="details">
          <div className="dashboard-grid">
            <section className="card">
              <h2>Everything for matchday</h2>
              <div className="detail-list">
                <div>
                  <CalendarDays />
                  <span>
                    Date
                    <strong>
                      {dateLabel(f.date)} {f.date.slice(0, 4)}
                    </strong>
                  </span>
                </div>
                <div>
                  <Clock />
                  <span>
                    Arrival & start
                    <strong>
                      Arrive {f.arrival} · Play {f.start}
                    </strong>
                  </span>
                </div>
                <div>
                  <Flag />
                  <span>
                    Format
                    <strong>
                      {f.format === 'shotgun' ? 'Shotgun start' : 'Tee times'} ·{' '}
                      {l.holes} holes · Texas Scramble
                    </strong>
                  </span>
                </div>
                <div>
                  <Check />
                  <span>
                    Arrival registration
                    <strong>
                      {f.registration
                        ? 'Please register with the host on arrival'
                        : 'No registration desk — meet at the briefing'}
                    </strong>
                  </span>
                </div>
                <div>
                  <MapPin />
                  <span>
                    Venue<strong>{club?.address}</strong>
                  </span>
                </div>
              </div>
              <h3>A warm welcome</h3>
              <p className="muted whitespace-pre-wrap mt-2">
                {f.instructions ||
                  'The host has not added match instructions yet.'}
              </p>
              <p className="muted whitespace-pre-wrap mt-4">
                {club?.instructions}
              </p>
            </section>
            <div className="stack">
              <section className="card">
                <div className="row mb-4">
                  <Utensils size={20} />
                  <h2>Food & refreshments</h2>
                </div>
                <h3>Before play</h3>
                <p className="muted mt-2 mb-5">
                  {f.foodBefore || 'No food arranged before play.'}
                </p>
                <h3>After play</h3>
                <p className="muted mt-2">
                  {f.foodAfter || 'No food arranged after play.'}
                </p>
              </section>
              <section className="card">
                <div className="row mb-4">
                  <ShieldCheck size={20} />
                  <h2>Your welfare contact</h2>
                </div>
                <p>{club?.welfareName || 'Ask the host club'}</p>
                {club?.welfareEmail && (
                  <a className="text-link" href={`mailto:${club.welfareEmail}`}>
                    {club.welfareEmail}
                  </a>
                )}
                <p className="muted mt-3">
                  {club?.safeGolf
                    ? 'SafeGolf accredited club'
                    : 'Accreditation details not yet recorded'}
                </p>
              </section>
            </div>
          </div>
          {host && f.status === 'scheduled' && (
            <section className="card mt-5">
              <h2>Match-day preparation</h2>
              <p className="muted mt-2">
                Scoring opens automatically on the fixture date. Keep team
                selections and starting groups up to date before scores are
                entered.
              </p>
              {issues.length ? (
                <ul className="issue-list">
                  {issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              ) : (
                <p className="notice mt-4">
                  All teams and starting slots are ready. You can start play
                  when everyone is present.
                </p>
              )}
            </section>
          )}
        </TabsContent>
        <TabsContent value="pairings">
          <Lineups f={f} tools={tools} />
        </TabsContent>
        <TabsContent value="starts">
          <StartingSlots
            key={`${f.id}-${f.pairs.length}`}
            f={f}
            tools={tools}
          />
        </TabsContent>
        {showScorecards && (
          <TabsContent value="score">
            <Scorecards f={f} tools={tools} />
          </TabsContent>
        )}
        {showResults && (
          <TabsContent value="results">
            <Results f={f} tools={tools} />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
function Lineups({ f, tools }: { f: Fixture; tools: AppTools }) {
  const { s, me } = tools;
  const hosting = canHost(s, me, f);
  const teams = s.teams
    .filter(
      (t) =>
        f.teamIds.includes(t.id) && (hosting || canManageTeam(s, me, t.id)),
    )
    .sort(capOrder);
  const [tid, setTid] = useState(hosting ? '' : teams[0]?.id || '');
  const team = teams.find((t) => t.id === tid);
  if (team)
    return (
      <div className="stack">
        {(hosting || teams.length > 1) && (
          <button className="text-link self-start" onClick={() => setTid('')}>
            ← {hosting ? 'All participating teams' : 'My teams'}
          </button>
        )}
        <TeamLineup key={`${f.id}-${tid}`} f={f} tid={tid} tools={tools} />
      </div>
    );
  return (
    <div className="stack">
      <div>
        <h2>{hosting ? 'All participating teams' : 'My teams'}</h2>
        <p className="muted mt-2">
          {hosting
            ? 'Each club submits its players and pairs. Allocate all submitted pairs to starting holes and tee times in Starting allocations.'
            : 'Choose your players and publish the pairs for the hosting organiser.'}
        </p>
      </div>
      <div className="fixture-team-overview">
        {teams.map((t) => {
          const pairs = f.pairs.filter((p) => p.teamId === t.id);
          const expected = s.leagues.find((l) => l.id === f.leagueId)!.pairs;
          return (
            <section className="card" key={t.id}>
              <div className="row">
                <Dot color={t.color} />
                <h3>{t.name}</h3>
              </div>
              <p className="muted mt-2">
                {pairs.length === expected
                  ? 'Selection submitted'
                  : 'Awaiting complete selection'}{' '}
                · {pairs.length} of {expected} pairs
              </p>
              <ul>
                {pairs.map((p) => (
                  <li key={p.id}>
                    {p.players
                      .map(
                        (id) =>
                          s.players.find((v) => v.id === id)?.name || 'Player',
                      )
                      .join(' & ')}
                  </li>
                ))}
              </ul>
              {canManageTeam(s, me, t.id) && (
                <button className="btn" onClick={() => setTid(t.id)}>
                  {pairs.length ? 'Review team selection' : 'Choose players'}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
function Results({ f, tools }: { f: Fixture; tools: AppTools }) {
  const { s } = tools;
  const l = s.leagues.find((l) => l.id === f.leagueId)!;
  const rows = f.status === 'completed' ? f.results : fixtureResults(s, f);
  return (
    <section className="card">
      <div className="section-top">
        <div>
          <h2>
            {f.status === 'completed'
              ? 'The matchday results'
              : 'Live team leaderboard'}
          </h2>
          <p className="muted mt-2">
            {f.status === 'completed'
              ? 'Final results are included in the season standings.'
              : 'Provisional until every scorecard is checked and the host finalises the fixture.'}
          </p>
        </div>
        <Badge status={f.status} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Place</TableHead>
            <TableHead>Team</TableHead>
            <TableHead>Holes scored</TableHead>
            <TableHead>Game points</TableHead>
            <TableHead>League points</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const t = s.teams.find((t) => t.id === r.teamId)!;
            const played = f.pairs
              .filter((p) => p.teamId === t.id)
              .reduce(
                (n, p) =>
                  n +
                  Array.from(
                    { length: l.holes },
                    (_, i) => !!f.scores[`${p.id}:${i + 1}`],
                  ).filter(Boolean).length,
                0,
              );
            return (
              <TableRow key={r.teamId}>
                <TableCell>{r.rank}</TableCell>
                <TableCell>
                  <span className="row">
                    <Dot color={t.color} />
                    {t.name}
                  </span>
                </TableCell>
                <TableCell>
                  {played} / {l.holes * l.pairs}
                </TableCell>
                <TableCell>
                  <strong>{r.points}</strong>
                </TableCell>
                <TableCell>
                  {f.status === 'completed' ? r.leaguePoints : 'Pending'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="muted mt-5">
        Game points = {l.maxStrokes + 1} − strokes per hole.{' '}
        {l.tiePolicy === 'countback'
          ? 'Ties use team points over the last 3, then 2, then 1 holes. Unresolved ties share the available league points equally.'
          : l.tiePolicy === 'average'
            ? 'Tied teams share the average of the available league points.'
            : 'Tied teams each receive points for the shared position.'}
      </p>
    </section>
  );
}
