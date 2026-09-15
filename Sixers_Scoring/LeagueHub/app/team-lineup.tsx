'use client';
import { useState, type DragEvent } from 'react';
import { GripVertical, X, Undo2 } from 'lucide-react';
import {
  availabilityFor,
  participation,
  selectionCandidates,
  siblingSelections,
  suggestLineup,
  moveLineupPlayer,
  type LineupDraft,
  type LineupDestination,
} from '@/lib/lineup-planner';
import {
  canManageTeam,
  rosterEligible,
  selectionConfirmed,
  type Fixture,
  type Player,
} from '@/lib/model';
import { ChildName } from './child-avatar';
import { FixtureConversation } from './fixture-conversation';
import { Dot, type AppTools } from './widgets';

export function TeamLineup({
  f,
  tid,
  tools,
}: {
  f: Fixture;
  tid: string;
  tools: AppTools;
}) {
  const { s, me, busy, act } = tools;
  const league = s.leagues.find((l) => l.id === f.leagueId)!;
  const team = s.teams.find((t) => t.id === tid)!;
  const saved = f.pairs.filter((p) => p.teamId === tid);
  const savedDraft: LineupDraft = {
    pairs: Array.from({ length: league.pairs }, (_, i) => [
      saved[i]?.players[0] || '',
      saved[i]?.players[1] || '',
    ]),
    reserves: (s.reserves || [])
      .filter((r) => r.fixtureId === f.id && r.teamId === tid)
      .map((r) => r.playerId),
  };
  const [draft, setDraft] = useState<LineupDraft>(savedDraft);
  const [dirty, setDirty] = useState(false);
  const [picked, setPicked] = useState('');
  const [dragged, setDragged] = useState('');
  const [over, setOver] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const editing = canManageTeam(s, me, tid) && f.status === 'scheduled';
  // Polling updates availability immediately; untouched selections follow the saved state.
  const board = dirty ? draft : savedDraft;
  const candidates = selectionCandidates(s, f, tid);
  const selected = new Set([...board.pairs.flat(), ...board.reserves]);
  const pool = candidates.filter((p) => !selected.has(p.id));
  const unavailable = candidates.filter(
    (p) => availabilityFor(s, f, p.id) === 'no',
  );
  const count = board.pairs.flat().filter(Boolean).length;
  const labels = {
    yes: 'Available',
    unconfirmed: 'No reply yet',
    unsure: 'Not sure yet',
    no: 'Unavailable',
  };
  const name = (id: string) =>
    s.players.find((p) => p.id === id)?.name || 'Player';
  function change(next: LineupDraft) {
    setDraft(next);
    setDirty(true);
    setPicked('');
    setError('');
    setNotice('Draft updated. Submit when you’re ready to notify families.');
  }
  function move(id: string, destination: LineupDestination) {
    if (!editing || busy || !id) return;
    if (
      destination !== 'pool' &&
      (!candidates.some((p) => p.id === id) ||
        availabilityFor(s, f, id) === 'no')
    ) {
      setError(
        'This child is no longer available for this team. Choose another player.',
      );
      return;
    }
    change(moveLineupPlayer(board, id, destination));
  }
  function drop(e: DragEvent, destination: LineupDestination) {
    e.preventDefault();
    setOver('');
    // Only accept a player dragged from this board, not text/files from elsewhere.
    if (
      dragged &&
      e.dataTransfer.getData('application/x-golfsixes-player') === dragged
    )
      move(dragged, destination);
    setDragged('');
  }
  function target(key: string, destination: LineupDestination) {
    return {
      onDragOver: (e: DragEvent) => {
        if (dragged && editing && !busy) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setOver(key);
        }
      },
      onDragLeave: () => setOver(''),
      onDrop: (e: DragEvent) => drop(e, destination),
    };
  }
  function playerButton(player: Player, assigned = false) {
    const status = availabilityFor(s, f, player.id);
    const canPick =
      editing &&
      !busy &&
      status !== 'no' &&
      candidates.some((p) => p.id === player.id);
    return (
      <div
        key={player.id}
        className={`selection-player ${picked === player.id ? 'is-picked' : ''}`}
      >
        <button
          type="button"
          className="selection-player-main"
          disabled={!canPick}
          aria-pressed={picked === player.id}
          aria-label={`Choose ${player.name}, ${labels[status]}`}
          draggable={canPick}
          onDragStart={(e) => {
            setDragged(player.id);
            e.dataTransfer.setData('application/x-golfsixes-player', player.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => {
            setDragged('');
            setOver('');
          }}
          onClick={() => setPicked(picked === player.id ? '' : player.id)}
        >
          {editing && <GripVertical size={16} className="selection-grip" />}
          <span className="selection-player-info">
            <ChildName
              player={player}
              workspace={tools.workspace}
              view={tools.view}
              size={28}
            />
            <span className="selection-player-meta">
              <span className={`selection-availability status-${status}`}>
                {labels[status]}
              </span>{' '}
              · {participation(s, f, player.id).played} played
            </span>
          </span>
        </button>
        {assigned && editing && (
          <button
            type="button"
            className="selection-remove"
            disabled={busy}
            aria-label={`Remove ${player.name} from selection`}
            onClick={() => move(player.id, 'pool')}
          >
            <X size={16} />
          </button>
        )}
      </div>
    );
  }
  return (
    <section
      className="card selection-board"
      style={{ borderTop: `4px solid ${team.color}` }}
    >
      <div className="section-top">
        <div>
          <h2 className="row">
            <Dot color={team.color} />
            {team.name}
          </h2>
          <p className="muted mt-2">
            {league.pairs * 2} players · {league.pairs} pairs · {team.cap} caps
          </p>
        </div>
        <span className="badge">
          {dirty
            ? 'Unsaved selection'
            : saved.length === league.pairs &&
                saved.every((p) => p.players.length === 2)
              ? 'Selection submitted'
              : 'Selection needed'}
        </span>
      </div>
      {editing && (
        <div className="selection-toolbar">
          <p>
            Drag a name into a pair or reserves. On your phone, tap a name, then
            a place.
          </p>
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              const suggested = suggestLineup(s, f, tid);
              const ids = suggested.pairs.flat();
              change({
                pairs: suggested.pairs,
                reserves: board.reserves.filter(
                  (id) =>
                    !ids.includes(id) && availabilityFor(s, f, id) !== 'no',
                ),
              });
              setNotice(
                suggested.shortfall
                  ? `Suggested pairs need ${suggested.shortfall} more available players. Review the empty places.`
                  : 'Suggested pairs balance appearances and keep siblings together where possible. Review before submitting.',
              );
            }}
          >
            Suggest a line-up
          </button>
        </div>
      )}
      {editing && (
        <div className="selection-feedback" role="status">
          {picked ? (
            <>
              <strong>{name(picked)}</strong> selected. Choose a pair place or{' '}
              <button
                className="text-link"
                onClick={() => move(picked, 'reserves')}
              >
                Add to reserves
              </button>
              .{' '}
              <button className="text-link" onClick={() => setPicked('')}>
                Cancel
              </button>
            </>
          ) : (
            notice || 'Nothing is sent to families until you submit.'
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className={`selection-layout ${editing ? '' : 'is-readonly'}`}>
        {editing && (
          <div
            className={`selection-pool ${over === 'pool' ? 'is-over' : ''}`}
            {...target('pool', 'pool')}
          >
            <h3>Choose your players</h3>
            {(
              [
                ['yes', 'Available'],
                ['unconfirmed', 'No reply yet'],
                ['unsure', 'Not sure yet'],
              ] as const
            ).map(([status, title]) => {
              const players = pool.filter(
                (p) => availabilityFor(s, f, p.id) === status,
              );
              return players.length ? (
                <div className="selection-group" key={status}>
                  <h4>
                    {title} <span>{players.length}</span>
                  </h4>
                  {players.map((p) => playerButton(p))}
                </div>
              ) : null;
            })}
            {!pool.some((p) => availabilityFor(s, f, p.id) !== 'no') && (
              <p className="muted">
                No more players to choose. All eligible players are assigned or
                unavailable.
              </p>
            )}
            {!!unavailable.length && (
              <details className="selection-unavailable">
                <summary>Unavailable ({unavailable.length})</summary>
                {unavailable.map((p) => (
                  <div key={p.id} className="selection-unavailable-name">
                    <ChildName
                      player={p}
                      workspace={tools.workspace}
                      view={tools.view}
                      size={24}
                    />
                    <span>Can’t play</span>
                  </div>
                ))}
              </details>
            )}
          </div>
        )}
        <div className="selection-places">
          <div className="selection-pairs">
            {board.pairs.map((pair, i) => (
              <section className="selection-pair" key={i}>
                <h3>Pair {i + 1}</h3>
                {[0, 1].map((j) => {
                  const id = pair[j];
                  const player = s.players.find((p) => p.id === id);
                  const key = `${i}:${j}`;
                  return (
                    <div
                      key={j}
                      className={`selection-slot ${over === key ? 'is-over' : ''}`}
                      {...target(key, { pair: i, slot: j })}
                    >
                      {player ? (
                        <>
                          {playerButton(player, true)}
                          {editing && picked && picked !== id && (
                            <button
                              className="selection-place-action"
                              disabled={busy}
                              onClick={() => move(picked, { pair: i, slot: j })}
                            >
                              Place {name(picked)} here
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          className="selection-empty"
                          disabled={!editing || busy}
                          onClick={() =>
                            picked
                              ? move(picked, { pair: i, slot: j })
                              : setNotice(
                                  'Choose a name from the player list first.',
                                )
                          }
                          aria-label={`Pair ${i + 1}, player ${j + 1}: empty place`}
                        >
                          {picked
                            ? `Place ${name(picked)} here`
                            : 'Drop a player here'}
                          <small>
                            {picked ? '' : 'or tap a name, then here'}
                          </small>
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
          <section
            className={`selection-reserves ${over === 'reserves' ? 'is-over' : ''}`}
            {...target('reserves', 'reserves')}
          >
            <h3>
              Reserves <span>{board.reserves.length}</span>
            </h3>
            {board.reserves.map((id) => {
              const p = s.players.find((p) => p.id === id);
              return p ? playerButton(p, true) : null;
            })}
            {editing && (
              <button
                className="selection-empty"
                disabled={busy}
                onClick={() =>
                  picked
                    ? move(picked, 'reserves')
                    : setNotice(
                        'Choose a name from the player list, then tap Add to reserves.',
                      )
                }
              >
                {picked
                  ? `Add ${name(picked)} to reserves`
                  : 'Drop reserves here'}
                <small>{picked ? '' : 'or tap a name, then here'}</small>
              </button>
            )}
            {!editing && !board.reserves.length && (
              <p className="muted">No reserves selected.</p>
            )}
          </section>
        </div>
      </div>
      {editing && (
        <div className="selection-submit">
          <span>
            {count} of {league.pairs * 2} players · {board.reserves.length}{' '}
            reserves
          </span>
          <div className="row wrap">
            {dirty && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  setDirty(false);
                  setPicked('');
                  setError('');
                  setNotice('Restored the saved selection.');
                }}
              >
                <Undo2 size={16} /> Reset changes
              </button>
            )}
            <button
              className="btn primary"
              disabled={busy || count !== league.pairs * 2}
              onClick={async () => {
                setError('');
                try {
                  await act({
                    type: 'lineup',
                    fixtureId: f.id,
                    teamId: tid,
                    pairs: board.pairs,
                    reserveIds: board.reserves,
                  });
                  setDirty(false);
                  setPicked('');
                  setNotice(
                    'Selection submitted. Families have been notified in the app.',
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {busy ? 'Saving…' : 'Submit selection & notify families'}
            </button>
          </div>
        </div>
      )}
      {canManageTeam(s, me, tid) && (
        <details className="lineup-roster">
          <summary>Availability & family replies</summary>
          <div className="lineup-player-list">
            {selectionCandidates(s, f, tid)
              .filter((p) => availabilityFor(s, f, p.id) !== 'no')
              .map((p) => {
                const siblings = siblingSelections(s, f, p);
                return (
                  <article className="lineup-player" key={p.id}>
                    <ChildName
                      player={p}
                      workspace={tools.workspace}
                      view={tools.view}
                      size={28}
                    />
                    <p className="muted">
                      {labels[availabilityFor(s, f, p.id)]} ·{' '}
                      {participation(s, f, p.id).played} played
                      {selectionConfirmed(s, f, p.id)
                        ? ' · Place confirmed'
                        : ''}
                    </p>
                    {!!siblings.length && (
                      <p className="sibling-note">
                        Family:{' '}
                        {siblings
                          .map(
                            (c) =>
                              `${c.name} · ${s.teams.find((t) => t.id === c.teamId)?.name || 'another team'}`,
                          )
                          .join('; ')}
                      </p>
                    )}
                    <FixtureConversation
                      s={s}
                      fixtureId={f.id}
                      teamId={tid}
                      playerId={p.id}
                      busy={busy}
                      send={act}
                    />
                  </article>
                );
              })}
          </div>
          <details className="selection-unavailable">
            <summary>Unavailable players & replies</summary>
            {s.players
              .filter(
                (p) =>
                  rosterEligible(s, p.id, tid) &&
                  availabilityFor(s, f, p.id) === 'no',
              )
              .map((p) => (
                <article className="lineup-player" key={p.id}>
                  <ChildName
                    player={p}
                    workspace={tools.workspace}
                    view={tools.view}
                  />
                  <FixtureConversation
                    s={s}
                    fixtureId={f.id}
                    teamId={tid}
                    playerId={p.id}
                    busy={busy}
                    send={act}
                  />
                </article>
              ))}
          </details>
        </details>
      )}
    </section>
  );
}
