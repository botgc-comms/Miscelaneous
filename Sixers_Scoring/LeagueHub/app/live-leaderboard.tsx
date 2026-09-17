'use client';
import { fixtureResults, points, type Fixture } from '@/lib/model';
import { type AppTools } from './widgets';

export function LiveLeaderboard({ f, tools }: { f: Fixture; tools: AppTools }) {
  const { s } = tools;
  const league = s.leagues.find((l) => l.id === f.leagueId)!;
  const rows = fixtureResults(s, f);
  const expected = f.teamIds.length * league.pairs * league.holes;
  const scored = f.pairs.reduce(
    (sum, p) =>
      sum +
      Array.from(
        { length: league.holes },
        (_, i) => !!f.scores[`${p.id}:${i + 1}`],
      ).filter(Boolean).length,
    0,
  );
  return (
    <section className="live-board" aria-label="Live team leaderboard">
      <header className="live-board-heading">
        <div>
          <span className="eyebrow">
            {scored ? 'PLAY IN PROGRESS' : 'READY FOR PLAY'}
          </span>
          <h2>Live leaderboard</h2>
          <p>
            Highest points first. Standings are provisional until the host
            confirms the results.
          </p>
        </div>
        <div className="live-board-progress">
          <strong>
            {scored}
            <span> / {expected}</span>
          </strong>
          <span>pair holes scored</span>
        </div>
      </header>
      <div className="live-board-labels" aria-hidden="true">
        <span>Place</span>
        <span>Team</span>
        <span>Progress</span>
        <span>Points</span>
      </div>
      <div className="live-board-teams">
        {rows.map((row) => {
          const team = s.teams.find((t) => t.id === row.teamId)!;
          const pairs = f.pairs.filter((p) => p.teamId === team.id);
          const done = pairs.reduce(
            (sum, p) =>
              sum +
              Array.from(
                { length: league.holes },
                (_, i) => !!f.scores[`${p.id}:${i + 1}`],
              ).filter(Boolean).length,
            0,
          );
          const full = league.pairs * league.holes;
          const tied = rows.filter((r) => r.rank === row.rank).length > 1;
          return (
            <details
              key={team.id}
              className={`live-board-team ${done && row.rank === 1 ? 'leading' : ''}`}
            >
              <summary>
                <span className="live-board-rank">
                  {done ? `${tied ? '=' : ''}${row.rank}` : '—'}
                </span>
                <span className="live-board-name">
                  <span
                    className="junior-cap"
                    aria-hidden="true"
                    style={{
                      backgroundColor: team.color,
                      width: 32,
                      height: 32,
                    }}
                  />
                  <span>
                    <strong>{team.name}</strong>
                    <small>
                      {done === full
                        ? 'Round complete'
                        : done
                          ? 'Playing'
                          : pairs.length
                            ? 'Awaiting first score'
                            : 'Team selection needed'}
                    </small>
                  </span>
                </span>
                <span className="live-board-through">
                  <span>
                    {done} / {full} holes
                  </span>
                  <progress
                    value={done}
                    max={full}
                    aria-label={`${team.name}: ${done} of ${full} pair holes scored`}
                  />
                </span>
                <span className="live-board-points">
                  <strong>{done ? row.points : '—'}</strong>
                  <small>points</small>
                </span>
              </summary>
              <div className="live-board-pairs">
                <p>Scores by pair · strokes on each hole</p>
                {pairs.length ? (
                  pairs.map((pair) => {
                    const values = Array.from(
                      { length: league.holes },
                      (_, i) => f.scores[`${pair.id}:${i + 1}`],
                    );
                    return (
                      <div key={pair.id} className="live-board-pair">
                        <strong>
                          {pair.players
                            .map(
                              (id) =>
                                s.players.find((p) => p.id === id)?.name ||
                                'Player',
                            )
                            .join(' & ')}
                        </strong>
                        <div className="live-pair-holes">
                          {values.map((score, i) => (
                            <span key={i}>
                              <small>H{i + 1}</small>
                              <b>{score?.strokes ?? '—'}</b>
                            </span>
                          ))}
                          <span>
                            <small>Points</small>
                            <b>
                              {values.reduce(
                                (sum, v) =>
                                  sum +
                                  (v
                                    ? points(v.strokes, league.maxStrokes)
                                    : 0),
                                0,
                              )}
                            </b>
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p>No pairs have been selected yet.</p>
                )}
              </div>
            </details>
          );
        })}
      </div>
      <p className="live-board-note">
        Scores refresh automatically. Open a team to see its pairs. Teams may
        have completed different numbers of holes.
      </p>
    </section>
  );
}
