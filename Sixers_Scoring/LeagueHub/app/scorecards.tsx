'use client';
import { useRef, useState } from 'react';
import { Check, CheckCircle2 } from 'lucide-react';
import { ChildName } from './child-avatar';
import { Pick, Empty, Dot, type AppTools } from './widgets';
import {
  canHost,
  canOrg,
  fixtureScoringOpen,
  points,
  type Fixture,
} from '@/lib/model';

type Attempt = { hole: number; strokes: number; version: number };
type Score = Fixture['scores'][string];

export function Scorecards({ f, tools }: { f: Fixture; tools: AppTools }) {
  const { s, me } = tools;
  const pairs =
    tools.view === 'parent' || me.role === 'parent'
      ? f.pairs.filter((p) =>
          p.players.some((id) =>
            s.players.some((c) => c.id === id && c.parentId === me.id),
          ),
        )
      : f.pairs;
  const [chosen, choose] = useState('');
  const pair = pairs.find((p) => p.id === chosen) || pairs[0];
  if (!pair)
    return (
      <Empty title="Scorecards are on their way">
        Your pair’s scorecard will appear when the team has been selected.
      </Empty>
    );
  return (
    <PairCard
      key={f.id + pair.id}
      f={f}
      tools={tools}
      pair={pair}
      choose={choose}
      options={pairs.map((p) => ({
        value: p.id,
        label: `${s.teams.find((t) => t.id === p.teamId)?.name} · ${p.players.map((id) => s.players.find((c) => c.id === id)?.name || 'Player').join(' & ')}`,
      }))}
    />
  );
}

function PairCard({
  f,
  tools,
  pair,
  options,
  choose,
}: {
  f: Fixture;
  tools: AppTools;
  pair: Fixture['pairs'][number];
  options: { value: string; label: string }[];
  choose: (id: string) => void;
}) {
  const { s, me, act, busy } = tools;
  const league = s.leagues.find((l) => l.id === f.leagueId)!;
  const team = s.teams.find((t) => t.id === pair.teamId)!;
  const storageKey = `golfsixes-score:${tools.workspace}:${me.id}:${f.id}:${pair.id}`;
  const [pending, setPending] = useState<Attempt | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
      return value &&
        Number.isInteger(value.hole) &&
        value.hole >= 1 &&
        value.hole <= league.holes &&
        Number.isInteger(value.strokes) &&
        value.strokes >= 1 &&
        value.strokes <= league.maxStrokes &&
        Number.isInteger(value.version) &&
        value.version >= 0
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const [confirmed, setConfirmed] = useState<Record<string, Score>>({});
  const scores = { ...f.scores };
  for (const [key, value] of Object.entries(confirmed))
    if (!scores[key] || scores[key].version < value.version)
      scores[key] = value;
  const holes = Array.from({ length: league.holes }, (_, i) => i + 1);
  const firstMissing = (source: typeof scores, after = 0) =>
    [
      ...holes.filter((h) => h > after),
      ...holes.filter((h) => h <= after),
    ].find((h) => !source[`${pair.id}:${h}`]) || 0;
  const [hole, setHole] = useState(
    () => pending?.hole || firstMissing(f.scores),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(
    pending
      ? 'This score has not been confirmed as saved. Please check it below.'
      : '',
  );
  const [notice, setNotice] = useState('');
  const [lastSaved, setLastSaved] = useState<Attempt | null>(null);
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const canScore =
    fixtureScoringOpen(s, f) &&
    (canHost(s, me, f) ||
      canOrg(s, me, team.orgId) ||
      pair.players.some((id) =>
        s.players.some((p) => p.id === id && p.parentId === me.id),
      ));
  const blocked = busy || saving;
  const savedCount = holes.filter((h) => scores[`${pair.id}:${h}`]).length;
  const complete = savedCount === league.holes && !hole && !pending;
  const current = scores[`${pair.id}:${hole}`];
  const conflict =
    pending &&
    (scores[`${pair.id}:${pending.hole}`]?.version || 0) !== pending.version;
  const stored = pending ? scores[`${pair.id}:${pending.hole}`] : undefined;
  function remember(value: Attempt | null) {
    setPending(value);
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      else localStorage.removeItem(storageKey);
    } catch {
      /* Saving still works when browser storage is unavailable. */
    }
  }
  function move(next: number) {
    if (locked.current || pending) return;
    setHole(next);
    setError('');
    setNotice('');
  }
  function acceptStored() {
    if (!pending || !stored) return;
    remember(null);
    setError('');
    setNotice(`Hole ${pending.hole} saved · ${stored.strokes} strokes`);
    setHole(firstMissing(scores, pending.hole));
  }
  async function save(attempt: Attempt) {
    if (locked.current || busy || !canScore) return;
    locked.current = true;
    setSaving(true);
    setError('');
    remember(attempt);
    setNotice(`Saving hole ${attempt.hole} · ${attempt.strokes} strokes…`);
    try {
      const result = await act({
        type: 'score',
        fixtureId: f.id,
        pairId: pair.id,
        hole: attempt.hole,
        strokes: attempt.strokes,
        expectedVersion: attempt.version,
      });
      const updated =
        (result?.state?.fixtures as Fixture[] | undefined)?.find(
          (v) => v.id === f.id,
        )?.scores || {};
      const key = `${pair.id}:${attempt.hole}`;
      const receipt = updated[key] || {
        strokes: attempt.strokes,
        version: attempt.version + 1,
        by: me.id,
        at: new Date().toISOString(),
      };
      const nextScores = { ...scores, ...updated, [key]: receipt };
      setConfirmed((old) => ({ ...old, [key]: receipt }));
      remember(null);
      setLastSaved(attempt);
      setNotice(`Hole ${attempt.hole} saved · ${attempt.strokes} strokes`);
      // Keep the old buttons locked through the transition so a double tap cannot score the next hole.
      await new Promise((resolve) => setTimeout(resolve, 650));
      setHole(firstMissing(nextScores, attempt.hole));
      heading.current?.focus({ preventScroll: true });
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch (e) {
      setNotice('');
      setError(
        (e as Error).message ||
          'We could not confirm that your score was saved.',
      );
      try {
        await tools.refresh();
      } catch {
        /* Keep the pending score visible while offline. */
      }
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }
  return (
    <section
      className="card tap-scorecard"
      style={{ borderTop: `5px solid ${team.color}` }}
      aria-label="Pair scorecard"
    >
      <header className="tap-scorecard-header">
        <div className="row">
          <Dot color={team.color} />
          <strong>{team.name}</strong>
        </div>
        <span>
          {savedCount} of {league.holes} holes saved
        </span>
      </header>
      {options.length > 1 && (
        <div className="tap-pair-picker">
          <span className="tap-pair-label">Which pair are you scoring?</span>
          <Pick
            label="Which pair are you scoring?"
            value={pair.id}
            onChange={choose}
            options={options}
            disabled={blocked || !!pending}
          />
        </div>
      )}
      <div className="tap-pair-names">
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
        })}
      </div>
      <div className="tap-score-status" aria-live="polite" aria-atomic="true">
        {notice ? (
          <>
            <span>
              {!saving && <Check size={18} />} {notice}
            </span>
            {lastSaved && !blocked && !pending && (
              <button
                className="text-link"
                onClick={() => move(lastSaved.hole)}
              >
                Change score
              </button>
            )}
          </>
        ) : (
          <span>
            {canScore
              ? 'Tap a score to save it and move to the next hole.'
              : f.status === 'completed'
                ? 'Final scorecard'
                : 'Scorecard · read only'}
          </span>
        )}
      </div>
      {error && pending && (
        <div className="tap-score-error" role="alert">
          <strong>
            Hole {pending.hole} · {pending.strokes} strokes — not confirmed
          </strong>
          <p>
            {conflict && stored
              ? `The shared scorecard shows ${stored.strokes} strokes. Check before changing it.`
              : error}
          </p>
          <div className="row">
            {stored && conflict ? (
              <>
                <button
                  className="btn primary"
                  disabled={blocked}
                  onClick={acceptStored}
                >
                  Keep saved score: {stored.strokes}
                </button>
                {stored.strokes !== pending.strokes && canScore && (
                  <button
                    className="btn"
                    disabled={blocked}
                    onClick={() =>
                      void save({ ...pending, version: stored.version })
                    }
                  >
                    Replace with {pending.strokes}
                  </button>
                )}
              </>
            ) : (
              <button
                className="btn primary"
                disabled={blocked || !canScore}
                onClick={() => void save(pending)}
              >
                Retry saving {pending.strokes}
              </button>
            )}
            <button
              className="btn"
              disabled={blocked}
              onClick={() => {
                remember(null);
                setError('');
                setNotice('Choose the correct score below.');
              }}
            >
              Cancel this change
            </button>
          </div>
        </div>
      )}
      <div className="tap-hole-focus">
        {complete ? (
          <>
            <CheckCircle2 size={44} />
            <h2 ref={heading} tabIndex={-1}>
              All {league.holes} holes saved
            </h2>
            <p>
              Your scores are shared with the organiser. You can check them
              below.
            </p>
          </>
        ) : (
          <>
            <h2 ref={heading} tabIndex={-1}>
              Hole {hole || 1}
              <span> of {league.holes}</span>
            </h2>
            <p>
              {canScore
                ? current
                  ? `Saved: ${current.strokes} strokes. Tap a different score to correct it.`
                  : 'How many strokes did your pair take?'
                : current
                  ? `${current.strokes} strokes · ${points(current.strokes, league.maxStrokes)} points`
                  : 'No score recorded.'}
            </p>
          </>
        )}
      </div>
      {!complete && canScore && (
        <div className="tap-strokes" aria-label={`Score for hole ${hole || 1}`}>
          {Array.from({ length: league.maxStrokes }, (_, i) => i + 1).map(
            (strokes) => (
              <button
                key={strokes}
                aria-label={`${strokes} strokes for hole ${hole || 1}`}
                aria-pressed={
                  (pending?.strokes ?? current?.strokes) === strokes
                }
                disabled={blocked || !!pending}
                onClick={() =>
                  void save({
                    hole: hole || 1,
                    strokes,
                    version: current?.version || 0,
                  })
                }
              >
                {strokes}
              </button>
            ),
          )}
        </div>
      )}
      <div className="tap-round">
        <div className="section-top">
          <h3>{complete ? 'Your completed round' : 'Your round'}</h3>
          <span>
            {holes.reduce(
              (total, h) =>
                total +
                (scores[`${pair.id}:${h}`]
                  ? points(scores[`${pair.id}:${h}`].strokes, league.maxStrokes)
                  : 0),
              0,
            )}{' '}
            points
          </span>
        </div>
        <div className="tap-round-holes">
          {holes.map((h) => (
            <button
              key={h}
              disabled={blocked || !!pending}
              aria-label={`Review hole ${h}${scores[`${pair.id}:${h}`] ? `, ${scores[`${pair.id}:${h}`].strokes} strokes` : ', not scored'}`}
              aria-current={hole === h ? 'step' : undefined}
              onClick={() => move(h)}
            >
              <span>Hole {h}</span>
              <strong>{scores[`${pair.id}:${h}`]?.strokes ?? '—'}</strong>
              {scores[`${pair.id}:${h}`] && <Check size={13} />}
            </button>
          ))}
        </div>
        <p>
          {canScore
            ? `Tap a hole to check or correct it. At ${league.maxStrokes} strokes, pick up and record ${league.maxStrokes}.`
            : 'Scores are shared with your organiser.'}
        </p>
      </div>
    </section>
  );
}
