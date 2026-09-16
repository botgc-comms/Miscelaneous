'use client';
import { ChildName } from './child-avatar';
import { TeamLineup } from './team-lineup';
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
  Users,
  Plus,
  Check,
  ShieldCheck,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  Pick,
  Empty,
  Badge,
  Dot,
  Field,
  dateLabel,
  type AppTools,
} from './widgets';
import {
  canOrg,
  canManageTeam,
  capOrder,
  canHost,
  canLeague,
  readiness,
  fixtureResults,
  points,
  type Fixture,
  type Slot,
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
  const [tab, setTab] = useState(
    f.status === 'live'
      ? 'score'
      : f.status === 'completed'
        ? 'results'
        : 'details',
  );
  const [error, setError] = useState('');
  const run = async (type: string) => {
    setError('');
    try {
      await act({ type, fixtureId: f.id });
      if (type === 'start') setTab('score');
      if (type === 'finalise') setTab('results');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const issues = readiness(s, f);
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
            <Badge status={f.status} />
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
              <button
                className="btn primary"
                disabled={busy || issues.length > 0}
                title={issues.join(' ')}
                onClick={() => run('start')}
              >
                <Flag size={16} />
                Start play
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
      {f.status === 'scheduled' && (
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
          <div className="row wrap">
            <button className="btn" onClick={() => setTab('pairings')}>
              {host ? 'Review all teams' : 'Choose my players'}
            </button>
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
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="tab-list" variant="line">
          {[
            ['details', 'Match details'],
            ['pairings', 'Team selection'],
            ['starts', 'Starting allocations'],
            ['score', 'Scorecards'],
            ['results', 'Results'],
          ].map(([id, name]) => (
            <TabsTrigger value={id} key={id}>
              {name}
            </TabsTrigger>
          ))}
        </TabsList>
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
              <h2>Ready to play?</h2>
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
        <TabsContent value="score">
          <Scorecards f={f} tools={tools} />
        </TabsContent>
        <TabsContent value="results">
          <Results f={f} tools={tools} />
        </TabsContent>
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
        <h2>{team.name}</h2>
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
function StartingSlots({ f, tools }: { f: Fixture; tools: AppTools }) {
  const { s, me, busy, act } = tools;
  const allowed = canHost(s, me, f) && f.status === 'scheduled';
  const [slots, setSlots] = useState<Slot[]>(
    f.slots.map((slot) => ({
      ...slot,
      startHole:
        slot.startHole || Number(slot.label.match(/hole\s+(\d+)/i)?.[1]) || 1,
      startTime:
        slot.startTime || slot.label.match(/\b\d{2}:\d{2}\b/)?.[0] || f.start,
    })),
  );
  const [assign, setAssign] = useState<Record<string, string>>(
    Object.fromEntries(f.pairs.map((p) => [p.id, p.slotId])),
  );
  const [error, setError] = useState('');
  const playerNames = (ids: string[]) =>
    ids
      .map((id) => s.players.find((p) => p.id === id)?.name || 'Player')
      .join(' & ');
  const generate = () => {
    const n = Math.floor(f.pairs.length / 2);
    if (!n) {
      setError('Submit team selections before allocating starting slots.');
      return;
    }
    const start = f.start.split(':').map(Number);
    const generated = Array.from({ length: n }, (_, i) => ({
      id: crypto.randomUUID(),
      label:
        f.format === 'shotgun'
          ? `Hole ${(i % s.leagues.find((l) => l.id === f.leagueId)!.holes) + 1}${i >= s.leagues.find((l) => l.id === f.leagueId)!.holes ? ' B' : ''}`
          : `${String(Math.floor((start[0] * 60 + start[1] + i * 10) / 60) % 24).padStart(2, '0')}:${String((start[0] * 60 + start[1] + i * 10) % 60).padStart(2, '0')}`,
      startHole:
        f.format === 'shotgun'
          ? (i % s.leagues.find((l) => l.id === f.leagueId)!.holes) + 1
          : 1,
      startTime:
        f.format === 'shotgun'
          ? f.start
          : `${String(Math.floor((start[0] * 60 + start[1] + i * 10) / 60) % 24).padStart(2, '0')}:${String((start[0] * 60 + start[1] + i * 10) % 60).padStart(2, '0')}`,
      capacity: i === n - 1 && f.pairs.length % 2 ? 3 : 2,
    }));
    const sorted = [...f.pairs].sort((a, b) => {
      const ai = f.pairs
          .filter((p) => p.teamId === a.teamId)
          .findIndex((p) => p.id === a.id),
        bi = f.pairs
          .filter((p) => p.teamId === b.teamId)
          .findIndex((p) => p.id === b.id);
      return ai - bi || a.teamId.localeCompare(b.teamId);
    });
    setSlots(generated);
    setAssign(
      Object.fromEntries(
        sorted.map((p, i) => [
          p.id,
          generated[Math.min(Math.floor(i / 2), n - 1)].id,
        ]),
      ),
    );
    setError('');
  };
  return (
    <div className="stack">
      <div className="section-top">
        <div>
          <h2>{f.format === 'shotgun' ? 'Starting holes' : 'Tee times'}</h2>
          <p className="muted mt-2">
            Bring pairs together in groups of two or more.
          </p>
        </div>
        {allowed && (
          <button className="btn" onClick={generate}>
            Suggest allocations
          </button>
        )}
      </div>
      {!f.pairs.length ? (
        <Empty title="Choose the teams first">
          Starting slots will be available once pairings are submitted.
        </Empty>
      ) : (
        <>
          <div className="slot-grid">
            {slots.map((slot, i) => (
              <section className="card" key={slot.id}>
                {allowed ? (
                  <div className="form-grid">
                    <Field
                      label="Starting hole"
                      type="number"
                      min={1}
                      max={36}
                      value={slot.startHole || 1}
                      onChange={(v) =>
                        setSlots((old) =>
                          old.map((s, j) =>
                            j === i ? { ...s, startHole: Number(v) } : s,
                          ),
                        )
                      }
                    />
                    <Field
                      label="Tee time"
                      type="time"
                      value={slot.startTime || f.start}
                      onChange={(v) =>
                        setSlots((old) =>
                          old.map((s, j) =>
                            j === i ? { ...s, startTime: v } : s,
                          ),
                        )
                      }
                    />
                    <Field
                      label="Pair capacity"
                      type="number"
                      value={slot.capacity}
                      min={2}
                      max={4}
                      onChange={(v) =>
                        setSlots((old) =>
                          old.map((s, j) =>
                            i === j ? { ...s, capacity: Number(v) } : s,
                          ),
                        )
                      }
                    />
                  </div>
                ) : (
                  <h3>{slot.label}</h3>
                )}
                <div className="muted mt-3">
                  {f.pairs.filter((p) => assign[p.id] === slot.id).length} /{' '}
                  {slot.capacity} pairs
                </div>
                {f.pairs
                  .filter((p) => assign[p.id] === slot.id)
                  .map((p) => (
                    <div className="slot-pair" key={p.id}>
                      <span className="row">
                        <Dot
                          color={
                            s.teams.find((t) => t.id === p.teamId)?.color ||
                            '#888'
                          }
                        />
                        <strong>
                          {s.teams.find((t) => t.id === p.teamId)?.name}
                        </strong>
                      </span>
                      <p>
                        {p.players.map((id) => {
                          const player = s.players.find((v) => v.id === id);
                          return player ? (
                            <ChildName
                              key={id}
                              player={player}
                              workspace={tools.workspace}
                              view={tools.view}
                              size={28}
                            />
                          ) : (
                            <span key={id}>Player</span>
                          );
                        })}
                      </p>
                    </div>
                  ))}
              </section>
            ))}
          </div>
          {allowed && (
            <>
              <button
                className="btn self-start"
                onClick={() =>
                  setSlots((v) => [
                    ...v,
                    {
                      id: crypto.randomUUID(),
                      label:
                        f.format === 'shotgun'
                          ? `Hole ${v.length + 1}`
                          : `Extra tee time ${v.length + 1}`,
                      startHole: f.format === 'shotgun' ? v.length + 1 : 1,
                      startTime: f.start,
                      capacity: 2,
                    },
                  ])
                }
              >
                <Plus size={16} />
                Add starting slot
              </button>
              <section className="card">
                <h2>Pair allocations</h2>
                {f.pairs.map((p) => (
                  <div className="allocation" key={p.id}>
                    <div>
                      <strong>
                        {s.teams.find((t) => t.id === p.teamId)?.name}
                      </strong>
                      <p className="muted">{playerNames(p.players)}</p>
                    </div>
                    <Pick
                      label="Choose a starting slot"
                      value={assign[p.id] || ''}
                      onChange={(v) =>
                        setAssign((old) => ({ ...old, [p.id]: v }))
                      }
                      options={slots.map((v, i) => ({
                        value: v.id,
                        label: `${v.startTime || f.start} · Hole ${v.startHole || 1} · Group ${i + 1}`,
                      }))}
                    />
                  </div>
                ))}
              </section>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="btn primary self-start"
                disabled={busy}
                onClick={async () => {
                  try {
                    await act({
                      type: 'slots',
                      fixtureId: f.id,
                      slots: slots.map((slot, i) => ({
                        ...slot,
                        label: `${slot.startTime || f.start} · Hole ${slot.startHole || 1} · Group ${i + 1}`,
                      })),
                      assignments: assign,
                    });
                    setError('');
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Save starting slots
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
export function Scorecards({ f, tools }: { f: Fixture; tools: AppTools }) {
  const { s, me, busy, act } = tools;
  const l = s.leagues.find((l) => l.id === f.leagueId)!;
  const mine = f.pairs.filter((p) =>
    p.players.some((id) =>
      s.players.some((c) => c.id === id && c.parentId === me.id),
    ),
  );
  const [pid, setPid] = useState(mine[0]?.id || f.pairs[0]?.id || '');
  const [hole, setHole] = useState(1);
  const [draft, setDraft] = useState<{
    strokes: number;
    version: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const pair = f.pairs.find((p) => p.id === pid);
  if (!pair)
    return (
      <Empty title="Scorecards are on their way">
        Submit team selections to create the pair scorecards.
      </Empty>
    );
  const t = s.teams.find((t) => t.id === pair.teamId)!;
  const canScore =
    canHost(s, me, f) ||
    canOrg(s, me, t.orgId) ||
    mine.some((p) => p.id === pid);
  const score = f.scores[`${pid}:${hole}`];
  const options = (me.role === 'parent' ? mine : f.pairs).map((p) => ({
    value: p.id,
    label: `${s.teams.find((t) => t.id === p.teamId)?.name} · ${p.players.map((id) => s.players.find((c) => c.id === id)?.name || 'Player').join(' & ')}`,
  }));
  const total = Array.from(
    { length: l.holes },
    (_, i) => f.scores[`${pid}:${i + 1}`],
  ).reduce((n, v) => n + (v ? points(v.strokes, l.maxStrokes) : 0), 0);
  const move = (n: number) => {
    setHole(n);
    setDraft(null);
    setError('');
    setSaved(false);
  };
  return (
    <div className="score-layout">
      <section
        className="card scorecard"
        style={{ borderTop: `5px solid ${t.color}` }}
      >
        <div className="section-top">
          <span className="row">
            <Dot color={t.color} />
            <strong>{t.name}</strong>
          </span>
          <Badge status={f.status} />
        </div>
        <Pick
          label="Choose your pair"
          value={pid}
          onChange={(v) => {
            setPid(v);
            move(1);
          }}
          options={options}
        />
        <p className="muted mt-4">
          {pair.players.map((id) => {
            const player = s.players.find((p) => p.id === id);
            return player ? (
              <ChildName
                key={id}
                player={player}
                workspace={tools.workspace}
                view={tools.view}
              />
            ) : (
              <span key={id}>Player</span>
            );
          })}{' '}
          ·{' '}
          {f.slots.find((v) => v.id === pair.slotId)?.label ||
            'Starting slot to follow'}
        </p>
        <div className="hole-tabs" aria-label="Choose a hole">
          {Array.from({ length: l.holes }, (_, i) => (
            <button
              key={i}
              aria-label={`Hole ${i + 1}`}
              aria-pressed={hole === i + 1}
              className={hole === i + 1 ? 'active' : ''}
              style={hole === i + 1 ? { background: t.color } : undefined}
              onClick={() => move(i + 1)}
            >
              {i + 1}
              {f.scores[`${pid}:${i + 1}`] && <span>✓</span>}
            </button>
          ))}
        </div>
        <div className="score-focus">
          <span className="eyebrow">HOLE {hole}</span>
          <h2>How many strokes?</h2>
          <p>Count your pair’s shots together.</p>
          <div className="score-number" style={{ color: t.color }}>
            {draft?.strokes ?? score?.strokes ?? '–'}
          </div>
          <p>
            {draft
              ? `${points(draft.strokes, l.maxStrokes)} points for your team`
              : score
                ? `${points(score.strokes, l.maxStrokes)} points · Saved`
                : 'No score recorded yet'}
          </p>
        </div>
        {canScore && f.status === 'live' ? (
          <>
            <div className="stroke-buttons">
              {Array.from({ length: l.maxStrokes }, (_, i) => (
                <button
                  key={i}
                  className={
                    (draft?.strokes ?? score?.strokes) === i + 1 ? 'active' : ''
                  }
                  onClick={() => {
                    setDraft({ strokes: i + 1, version: score?.version || 0 });
                    setSaved(false);
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              className="btn primary save-score"
              disabled={busy || !draft}
              onClick={async () => {
                if (!draft) return;
                try {
                  await act({
                    type: 'score',
                    fixtureId: f.id,
                    pairId: pid,
                    hole,
                    strokes: draft.strokes,
                    expectedVersion: draft.version,
                  });
                  setDraft(null);
                  setError('');
                  setSaved(true);
                } catch (e) {
                  setError((e as Error).message);
                  setDraft(null);
                  await tools.refresh();
                }
              }}
            >
              {busy ? 'Saving…' : saved ? '✓ Score saved' : `Save hole ${hole}`}
            </button>
            <p className="scorer-note">
              Both parents share this card. Scores refresh every 4 seconds.
            </p>
          </>
        ) : (
          <p className="notice mt-4">
            {f.status === 'completed'
              ? 'This scorecard is final. A league administrator can reopen the fixture for corrections.'
              : f.status === 'scheduled'
                ? 'The host will open scoring when play begins.'
                : 'You can follow this scorecard. Assigned parents and organisers can enter scores.'}
          </p>
        )}
        {error && (
          <p className="error mt-4" role="alert">
            {error}
          </p>
        )}
        <div className="score-nav">
          <button
            className="btn small"
            disabled={hole === 1}
            onClick={() => move(hole - 1)}
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          <span className="muted">{total} team points</span>
          <button
            className="btn small"
            disabled={hole === l.holes}
            onClick={() => move(hole + 1)}
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      </section>
      <div className="stack">
        <section className="card">
          <h2>Your round</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hole</TableHead>
                <TableHead>Strokes</TableHead>
                <TableHead>Points</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: l.holes }, (_, i) => {
                const sc = f.scores[`${pid}:${i + 1}`];
                return (
                  <TableRow key={i}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell>{sc?.strokes ?? '—'}</TableCell>
                    <TableCell>
                      {sc ? points(sc.strokes, l.maxStrokes) : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow>
                <TableCell colSpan={2}>
                  <strong>Total points</strong>
                </TableCell>
                <TableCell>
                  <strong>{total}</strong>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </section>
        <section className="card season-card">
          <Flag />
          <h2>
            Every shot is
            <br />a team effort.
          </h2>
          <p>
            Play from your best ball, encourage your partner, and enjoy your
            round.
          </p>
          <p>
            Reached {l.maxStrokes} strokes? Pick up, record {l.maxStrokes}, and
            move to the next hole.
          </p>
        </section>
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
