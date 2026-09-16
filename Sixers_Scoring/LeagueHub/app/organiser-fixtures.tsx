'use client';
import { useState } from 'react';
import { availabilityFor } from '@/lib/lineup-planner';
import {
  rosterEligible,
  selectionConfirmed,
  points,
  type Team,
} from '@/lib/model';
import { TeamLineup } from './fixture-detail';
import { ChildName } from './child-avatar';
import { dateLabel, Pick, type AppTools } from './widgets';

export function OrganiserFixtures({
  tools,
  teams,
  openFixture,
}: {
  tools: AppTools;
  teams: Team[];
  openFixture: (id: string) => void;
}) {
  const { s } = tools;
  const today =
    s.demoToday ||
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  const fixtures = s.fixtures
    .filter(
      (f) =>
        !!s.leagues.find((l) => l.id === f.leagueId)?.fixturesConfirmedAt &&
        (f.status === 'live' ||
          (f.status === 'scheduled' && f.date >= today)) &&
        teams.some((t) => f.teamIds.includes(t.id)),
    )
    .sort(
      (a, b) =>
        Number(b.status === 'live') - Number(a.status === 'live') ||
        a.date.localeCompare(b.date) ||
        a.start.localeCompare(b.start),
    );
  const [fixtureId, setFixtureId] = useState('');
  const [teamId, setTeamId] = useState('');
  const f = fixtures.find((f) => f.id === fixtureId) || fixtures[0];
  if (!f)
    return (
      <section className="card mb-6">
        <h2>Ready for your next fixture</h2>
        <p className="muted mt-3">
          Upcoming fixtures will appear here once your administrator confirms
          the season list. You can keep managing your players meanwhile.
        </p>
      </section>
    );
  const participants = teams.filter((t) => f.teamIds.includes(t.id));
  const t = participants.find((t) => t.id === teamId) || participants[0];
  const roster = s.players.filter((p) => rosterEligible(s, p.id, t.id));
  const selected = f.pairs
    .filter((p) => p.teamId === t.id)
    .flatMap((p) => p.players);
  const league = s.leagues.find((l) => l.id === f.leagueId)!;
  const updates = (s.notifications || []).filter(
    (n) => n.fixtureId === f.id && !n.readAt,
  );
  return (
    <div className="organiser-preparation">
      <div className="preparation-controls">
        <Pick
          label="Upcoming fixture"
          value={f.id}
          onChange={(v) => {
            setFixtureId(v);
            setTeamId('');
          }}
          options={fixtures.map((f) => ({
            value: f.id,
            label: `${f.status === 'live' ? 'LIVE · ' : ''}${dateLabel(f.date)} · ${s.clubs.find((c) => c.id === f.clubId)?.name || f.name}`,
          }))}
        />
        {participants.length > 1 && (
          <Pick
            label="Your team"
            value={t.id}
            onChange={setTeamId}
            options={participants.map((t) => ({
              value: t.id,
              label: `${t.name} · ${t.cap} caps`,
            }))}
          />
        )}
      </div>
      <section
        className="card preparation-summary"
        style={{ borderTop: `4px solid ${t.color}` }}
      >
        <span className="eyebrow">
          {f.status === 'live'
            ? 'LIVE NOW'
            : f.id === fixtures[0].id
              ? 'NEXT FIXTURE'
              : 'UPCOMING FIXTURE'}{' '}
          · {league.name}
        </span>
        <h2>{s.clubs.find((c) => c.id === f.clubId)?.name || f.name}</h2>
        <p>
          {dateLabel(f.date)} · Arrive {f.arrival} · Start {f.start}
        </p>
        <div className="preparation-numbers">
          <span>
            <strong>
              {
                roster.filter((p) => availabilityFor(s, f, p.id) === 'yes')
                  .length
              }
            </strong>{' '}
            available
          </span>
          <span>
            <strong>
              {selected.length} / {league.pairs * 2}
            </strong>{' '}
            selected
          </span>
          <span>
            <strong>
              {selected.filter((id) => selectionConfirmed(s, f, id)).length} /{' '}
              {selected.length}
            </strong>{' '}
            confirmed
          </span>
        </div>
        <button className="text-link" onClick={() => openFixture(f.id)}>
          Fixture details
          {f.status === 'live' ? ' & live results' : ' & starting slots'} →
        </button>
        {!!updates.length && (
          <details className="mt-4">
            <summary>Family updates ({updates.length})</summary>
            {updates.map((n) => (
              <div className="preparation-update" key={n.id}>
                <p>{n.text}</p>
                <button
                  className="text-link"
                  disabled={tools.busy}
                  onClick={() =>
                    void tools.act({ type: 'notice-read', id: n.id })
                  }
                >
                  Mark read
                </button>
              </div>
            ))}
          </details>
        )}
      </section>
      {f.status === 'live' ? (
        <>
          <p className="notice mb-4">
            Scores refresh automatically. Open fixture details for results
            across the league.
          </p>
          <section className="card">
            <h2>{t.name} · live scores</h2>
            <div className="lineup-player-list" aria-live="polite">
              {f.pairs
                .filter((pair) => pair.teamId === t.id)
                .map((pair) => {
                  const scores = Array.from(
                    { length: league.holes },
                    (_, i) => f.scores[`${pair.id}:${i + 1}`],
                  );
                  return (
                    <article key={pair.id} className="lineup-player">
                      <div className="row wrap">
                        {pair.players.map((id) => {
                          const child = s.players.find((p) => p.id === id);
                          return child ? (
                            <ChildName
                              key={id}
                              player={child}
                              workspace={tools.workspace}
                              view={tools.view}
                              size={28}
                            />
                          ) : null;
                        })}
                      </div>
                      <p className="mt-3">
                        <strong>
                          {scores.reduce(
                            (sum, score) =>
                              sum +
                              (score
                                ? points(score.strokes, league.maxStrokes)
                                : 0),
                            0,
                          )}{' '}
                          points
                        </strong>{' '}
                        · {scores.filter(Boolean).length} of {league.holes}{' '}
                        holes scored
                      </p>
                      <p className="muted mt-2">
                        {scores
                          .map(
                            (score, i) =>
                              `Hole ${i + 1}: ${score ? score.strokes + ' strokes' : '—'}`,
                          )
                          .join(' · ')}
                      </p>
                    </article>
                  );
                })}
            </div>
          </section>
        </>
      ) : (
        <TeamLineup key={`${f.id}:${t.id}`} f={f} tid={t.id} tools={tools} />
      )}
    </div>
  );
}
