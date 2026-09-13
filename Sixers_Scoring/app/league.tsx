import { useEffect, useState } from 'react';
import { Trophy, Plus, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { leagueLeaderboard } from '../server/scoring.mjs';
import type { Card, Settings } from './page';
type Entry = { club: string; colour: string; startingPoints: number | null };
const display = (n: number | null) =>
  n === null ? '—' : Number(n.toFixed(3)).toString();
export default function LeagueBoard({
  cards,
  settings,
  onSaved,
}: {
  cards: Card[];
  settings: Settings;
  onSaved: () => Promise<unknown>;
}) {
  const league = leagueLeaderboard(cards, settings);
  const [entries, setEntries] = useState<Entry[] | null>(null),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!window.location.hash.startsWith('#league=')) return;
    try {
      const imported = JSON.parse(
        decodeURIComponent(window.location.hash.slice(8)),
      );
      if (
        !Array.isArray(imported) ||
        imported.length > 100 ||
        imported.some(
          (row) =>
            !row ||
            typeof row.club !== 'string' ||
            typeof row.colour !== 'string' ||
            (row.startingPoints !== null &&
              (typeof row.startingPoints !== 'number' ||
                !Number.isFinite(row.startingPoints) ||
                row.startingPoints < 0)),
        )
      )
        throw new Error('The starting standings link is invalid.');
      setEntries(
        imported.map(({ club, colour, startingPoints }) => ({
          club,
          colour,
          startingPoints,
        })),
      );
      setRevision(settings.revision);
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  function edit() {
    setEntries(
      league.rows.map((r: Entry) => ({
        club: r.club,
        colour: r.colour,
        startingPoints: r.startingPoints,
      })),
    );
    setRevision(settings.revision);
    setError('');
    setSaved(false);
  }
  function change(index: number, patch: Partial<Entry>) {
    setEntries((items) =>
      items!.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/league', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries, revision }),
      });
      const result: any = await response.json();
      if (!response.ok) throw new Error(result.error);
      await onSaved();
      setEntries(null);
      setSaved(true);
    } catch (e: any) {
      setError(e.message || 'Could not save league standings.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel league-panel">
      <div className="section-heading">
        <h2>
          <Trophy size={21} /> League leaderboard
        </h2>
        <span>{league.provisional ? 'Provisional' : 'Match complete'}</span>
      </div>
      <p className="league-rule">
        1st earns 6, then 5, 4, 3, 2, 1. Ties share the points for the places
        occupied.
      </p>
      {!league.startingComplete && !entries && (
        <div className="notice league-notice">
          Starting league points haven't all been entered. Today's awards are
          shown; league totals stay blank where the starting score is unknown.
        </div>
      )}
      {league.provisional && (
        <p className="muted league-caption">
          Today's awards will change as the remaining scorecards are confirmed.
        </p>
      )}
      {saved && (
        <p className="notice success league-notice" role="status">
          Starting league standings saved.
        </p>
      )}
      {entries ? (
        <div className="league-editor">
          <h3>Points before today's match</h3>
          <p className="muted">
            Enter existing league points, including any half-points. Leave
            unknown scores blank.
          </p>
          {entries.map((entry, i) => (
            <div className="league-entry" key={i}>
              <label className="field">
                Club
                <input
                  value={entry.club}
                  onChange={(e) => change(i, { club: e.target.value })}
                  placeholder="Club"
                />
              </label>
              <label className="field">
                Team / colour
                <input
                  value={entry.colour}
                  onChange={(e) => change(i, { colour: e.target.value })}
                  placeholder="Colour"
                />
              </label>
              <label className="field">
                Starting points
                <input
                  aria-label={`${entry.club} ${entry.colour} starting league points`}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={entry.startingPoints ?? ''}
                  onChange={(e) =>
                    change(i, {
                      startingPoints:
                        e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <Button
                variant="ghost"
                aria-label={`Remove league row ${i + 1}`}
                onClick={() => setEntries(entries.filter((_, j) => i !== j))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() =>
              setEntries([
                ...entries,
                { club: '', colour: '', startingPoints: null },
              ])
            }
          >
            <Plus size={16} /> Add team
          </Button>
          <p className="muted mt-4">
            Starting points entered:{' '}
            {display(
              entries.reduce(
                (total, row) => total + (row.startingPoints ?? 0),
                0,
              ),
            )}
          </p>
          <div className="actions mt-4">
            <Button disabled={busy} onClick={save}>
              <Save size={16} />
              {busy ? 'Saving…' : 'Save starting points'}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setEntries(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          {league.rows.length ? (
            <div className="league-table">
              <div className="league-columns">
                <span>Team</span>
                <span>Before</span>
                <span>Today</span>
                <span>Total</span>
              </div>
              {league.rows.map((row: any) => (
                <div className="league-score" key={row.key}>
                  <div>
                    <span className="league-rank">{row.rank ?? '—'}</span>
                    <strong>{row.team}</strong>
                  </div>
                  <span>{display(row.startingPoints)}</span>
                  <span className="league-award">
                    {row.today === null ? '—' : `+${display(row.today)}`}
                  </span>
                  <strong>{display(row.total)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty">
              Add the current league standings to get started.
            </p>
          )}
          <div className="league-actions">
            <Button variant="outline" onClick={edit}>
              {league.startingComplete
                ? 'Edit starting points'
                : 'Enter current standings'}
            </Button>
            <p className="muted">
              League total = points before today + this match's award.
            </p>
          </div>
        </>
      )}
      {error && (
        <div className="notice error league-notice" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
