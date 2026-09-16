'use client';
import { useState } from 'react';
import { ArrowRight, Trash2, UsersRound } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  teamManagers,
  canLeague,
  leagueAcceptsRegistrations,
  type Action,
  type Player,
} from '@/lib/model';
import { Field, Pick, type AppTools } from './widgets';
import { Cap } from './parent-portal';
import { TeamInvitation } from './team-invitation';
import { ChildName } from './child-avatar';
import { TeamRemoval } from './team-replacement';

export function TeamRoster({
  tools,
  teamId,
  openLeague,
  embedded = false,
  focused = false,
}: {
  tools: AppTools;
  teamId: string;
  openLeague?: (id: string, page?: string) => void;
  embedded?: boolean;
  focused?: boolean;
}) {
  const { s, me, busy, act } = tools;
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [options, setOptions] = useState(false),
    [selected, setSelected] = useState('');
  const [addPlayer, setAddPlayer] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [moves, setMoves] = useState<Record<string, string>>({});
  const team = s.teams.find((t) => t.id === teamId)!;
  const league = s.leagues.find((l) => l.id === team.leagueId)!;
  const entriesOpen =
    team.enrollmentOpen !== false && leagueAcceptsRegistrations(league);
  const entries = (s.enrollments || []).filter((e) => e.teamId === teamId);
  const pending = entries.filter((e) => e.status === 'pending');
  const approved = entries.filter((e) => e.status === 'approved');
  const families = [
    ...new Set(
      approved.map(
        (e) =>
          s.players.find((p) => p.id === e.playerId)?.parentId || e.playerId,
      ),
    ),
  ].map((id) =>
    approved.filter(
      (e) =>
        (s.players.find((p) => p.id === e.playerId)?.parentId || e.playerId) ===
        id,
    ),
  );
  const otherTeams = s.teams.filter(
    (t) =>
      !t.withdrawnAt &&
      t.id !== teamId &&
      t.leagueId === team.leagueId &&
      teamManagers(s, t.id).includes(me.id),
  );
  const available = s.players.filter(
    (p) =>
      p.orgId === team.orgId &&
      !(s.enrollments || []).some(
        (e) =>
          e.playerId === p.id &&
          e.status === 'approved' &&
          s.teams.find((t) => t.id === e.teamId)?.leagueId === team.leagueId,
      ),
  );
  function siblings(p: Player) {
    const related = s.players.filter(
      (v) => v.id !== p.id && !!p.parentId && v.parentId === p.parentId,
    );
    return related
      .map((v) => {
        const entry = s.enrollments?.find(
          (e) =>
            e.playerId === v.id &&
            ['approved', 'pending'].includes(e.status) &&
            s.teams.some((t) => t.id === e.teamId && t.leagueId === league.id),
        );
        return entry
          ? `${v.name} · ${entry.status === 'pending' && entry.clubRequest ? 'awaiting team allocation' : s.teams.find((t) => t.id === entry.teamId)?.name} (${entry.status === 'approved' ? 'in team' : 'applying'})`
          : '';
      })
      .filter(Boolean)
      .join('; ');
  }
  async function run(action: Action) {
    setError('');
    try {
      await act(action);
      setAddPlayer('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function details(p: Player) {
    const parent = s.members.find((m) => m.id === p.parentId);
    return (
      <div className="family-review-details">
        {siblings(p) && <p>Sibling / same family: {siblings(p)}</p>}
        <p>
          {parent?.name} · {parent?.email}
          {parent?.phone ? ` · ${parent.phone}` : ''}
        </p>
        <p>
          Born {p.dob} · Handicap {p.handicap ?? 'Not yet held'}
        </p>
        <p>
          Emergency: {p.emergencyName} · {p.emergencyPhone}
        </p>
        <p>Diet: {p.diet || 'None recorded'}</p>
        <p>Support: {p.care || 'None recorded'}</p>
        <p>
          {p.photoConsent
            ? 'Photo publication permitted'
            : 'No photo publication consent'}
        </p>
      </div>
    );
  }
  function profileUpdates(p: Player) {
    return (s.profileChanges || [])
      .filter((c) => c.playerId === p.id && c.status === 'pending')
      .map((c) => (
        <details className="roster-profile" key={c.id}>
          <summary>Profile update to review</summary>
          <div className="family-review-details">
            {(['name', 'dob', 'handicap', 'photoConsent'] as const)
              .filter((k) => p[k] !== c.proposed[k])
              .map((k) => (
                <p key={k}>
                  <strong>
                    {
                      {
                        name: 'Name',
                        dob: 'Date of birth',
                        handicap: 'Handicap',
                        photoConsent: 'Photo consent',
                      }[k]
                    }
                    :
                  </strong>{' '}
                  {String(p[k] ?? 'None')} → {String(c.proposed[k] ?? 'None')}
                </p>
              ))}
            <p>
              Care, emergency information and consent withdrawals already take
              effect immediately.
            </p>
          </div>
          <Field
            label="Optional message to parent"
            value={reasons[c.id] || ''}
            onChange={(v) => setReasons({ ...reasons, [c.id]: v })}
          />
          <div className="row wrap mt-3">
            <button
              className="btn small"
              disabled={busy}
              onClick={() =>
                void run({
                  type: 'profile-review',
                  id: c.id,
                  decision: 'approve',
                  reason: reasons[c.id],
                })
              }
            >
              Approve update
            </button>
            <button
              className="btn small"
              disabled={busy}
              onClick={() =>
                void run({
                  type: 'profile-review',
                  id: c.id,
                  decision: 'reject',
                  reason: reasons[c.id],
                })
              }
            >
              Decline update
            </button>
          </div>
        </details>
      ));
  }
  return (
    <>
      {focused && (
        <header className="team-profile-heading">
          <div className="team-profile-identity">
            <span className="team-profile-cap">
              <Cap color={team.color} label={`${team.cap} caps`} size={52} />
            </span>
            <div>
              <h1>{team.name}</h1>
              <p>{s.orgs.find((o) => o.id === team.orgId)?.name}</p>
              <p className="team-profile-season">
                {league.name} · {league.year} <span>· {team.cap} caps</span>
              </p>
            </div>
          </div>
          <button className="btn" onClick={() => setOptions(true)}>
            Manage team
          </button>
        </header>
      )}
      <section
        className={`card organiser-team roster-card ${focused ? 'roster-focused' : ''}`}
        style={{ borderTopColor: team.color }}
        aria-label={`${team.name} · ${league.name} · ${league.year}`}
      >
        {!focused && (
          <header className="roster-header">
            {!embedded && (
              <>
                <Cap color={team.color} label={`${team.cap} cap`} size={32} />
                <div>
                  <h2>{team.name}</h2>
                  <p>
                    {s.orgs.find((o) => o.id === team.orgId)?.name} · {team.cap}{' '}
                    caps
                  </p>
                  <p>
                    {league.name} · {league.year}
                  </p>
                </div>
              </>
            )}
            <button className="btn small" onClick={() => setOptions(true)}>
              {embedded ? 'Manage team' : 'Team options'}
            </button>
          </header>
        )}
        {error && (
          <p className="error mt-3" role="alert">
            {error}
          </p>
        )}
        <div
          className={`squad-columns roster-columns ${!entriesOpen ? 'entry-closed' : ''}`}
        >
          {entriesOpen && (
            <section aria-label="Applying to play">
              <h3>
                Applying to play <span>{pending.length}</span>
              </h3>
              {!pending.length && (
                <p className="muted">No applications waiting.</p>
              )}
              {pending.map((e) => {
                const p = s.players.find((p) => p.id === e.playerId);
                if (!p) return null;
                return (
                  <article
                    className="roster-child"
                    key={e.id}
                    aria-label={`${p.name} application`}
                  >
                    <strong>
                      <ChildName
                        player={p}
                        workspace={tools.workspace}
                        view={tools.view}
                      />
                    </strong>
                    {siblings(p) && (
                      <p className="sibling-note">
                        Sibling / same family: {siblings(p)}
                      </p>
                    )}
                    <details>
                      <summary>
                        {e.preference
                          ? 'Parent’s note & application details'
                          : 'Application details'}
                      </summary>
                      {e.preference && (
                        <p className="notice">Parent’s note: {e.preference}</p>
                      )}
                      {details(p)}
                      {!!otherTeams.length && (
                        <div className="mt-3">
                          <label className="field">
                            <span>Choose another team (optional)</span>
                            <Pick
                              label={`Team for ${p.name}`}
                              value={moves[e.id] || teamId}
                              onChange={(v) =>
                                setMoves({ ...moves, [e.id]: v })
                              }
                              options={[team, ...otherTeams].map((t) => ({
                                value: t.id,
                                label: `${t.name} · ${t.cap} caps`,
                              }))}
                            />
                          </label>
                        </div>
                      )}
                      <Field
                        label="Optional message to parent"
                        value={reasons[e.id] || ''}
                        onChange={(v) => setReasons({ ...reasons, [e.id]: v })}
                      />
                    </details>
                    <div className="row wrap mt-3">
                      <button
                        className="btn primary small"
                        disabled={busy}
                        onClick={() =>
                          void run({
                            type: 'enrollment-decision',
                            id: e.id,
                            decision: 'approve',
                            teamId: moves[e.id] || teamId,
                            reason: reasons[e.id],
                          })
                        }
                      >
                        {moves[e.id] && moves[e.id] !== teamId
                          ? `Approve for ${otherTeams.find((t) => t.id === moves[e.id])?.name || 'selected team'}`
                          : 'Approve'}
                      </button>
                      <button
                        className="btn small"
                        disabled={busy}
                        onClick={() =>
                          void run({
                            type: 'enrollment-decision',
                            id: e.id,
                            decision: 'reject',
                            reason: reasons[e.id],
                          })
                        }
                      >
                        Decline
                      </button>
                    </div>
                    {profileUpdates(p)}
                  </article>
                );
              })}
            </section>
          )}
          <section aria-label="In the team">
            <div className="roster-section-heading">
              <h3>
                In the team <span>{approved.length}</span>
              </h3>
              {focused && (
                <p>
                  {entriesOpen ? 'Registration open' : 'Registration closed'}
                </p>
              )}
            </div>
            {!approved.length && (
              <p className="muted">No children approved yet.</p>
            )}
            <div className="roster-families">
              {families.map((family) => (
                <div
                  className={`roster-family ${family.length > 1 ? 'has-siblings' : ''}`}
                  key={family[0].id}
                >
                  {family.map((e) => {
                    const p = s.players.find((p) => p.id === e.playerId);
                    if (!p) return null;
                    return (
                      <button
                        key={e.id}
                        className="roster-player-button"
                        onClick={() => setSelected(e.id)}
                        aria-label={'Open profile for ' + p.name}
                      >
                        <ChildName
                          player={p}
                          workspace={tools.workspace}
                          view={tools.view}
                        />
                        {s.profileChanges?.some(
                          (c) => c.playerId === p.id && c.status === 'pending',
                        ) && <small>Update to review</small>}
                      </button>
                    );
                  })}
                  {family.length > 1 && (
                    <span className="roster-family-label">
                      <UsersRound size={14} aria-hidden="true" /> Siblings
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
        {options && (
          <Dialog open onOpenChange={setOptions}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{team.name} · team options</DialogTitle>
                <DialogDescription>
                  {team.enrollmentOpen === false
                    ? 'Entry is closed. Families cannot apply until you reopen it.'
                    : 'Entry is open. Review all applications before closing it.'}
                </DialogDescription>
              </DialogHeader>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="row wrap">
                <button
                  className="btn"
                  disabled={
                    busy ||
                    (team.enrollmentOpen !== false && pending.length > 0)
                  }
                  onClick={() =>
                    void run({
                      type: 'team-directory',
                      teamId,
                      open: team.enrollmentOpen === false,
                    })
                  }
                >
                  {team.enrollmentOpen === false
                    ? 'Reopen entry'
                    : 'Close entry'}
                </button>
                {team.enrollmentOpen !== false && !embedded && (
                  <button
                    className="btn"
                    onClick={() => {
                      setOptions(false);
                      setSharing(true);
                    }}
                  >
                    Invite families
                  </button>
                )}
              </div>
              {pending.length > 0 && (
                <p className="muted">
                  Approve or decline {pending.length} remaining application
                  {pending.length === 1 ? '' : 's'} before closing entry.
                </p>
              )}
              <footer className="roster-footer">
                <details>
                  <summary>Add a registered child</summary>
                  <div className="row wrap mt-3">
                    {available.length ? (
                      <>
                        <Pick
                          label="Choose a child registered with this club"
                          value={addPlayer}
                          onChange={setAddPlayer}
                          options={available.map((p) => ({
                            value: p.id,
                            label: p.name,
                          }))}
                        />
                        <button
                          className="btn small"
                          disabled={busy || !addPlayer}
                          onClick={() =>
                            void run({
                              type: 'enrollment-add',
                              teamId,
                              playerId: addPlayer,
                            })
                          }
                        >
                          Add to team
                        </button>
                      </>
                    ) : (
                      <p className="muted">
                        No other registered children available. Invite their
                        parent to register and request a place.
                      </p>
                    )}
                  </div>
                </details>
                {openLeague && (
                  <details>
                    <summary>League & fixtures</summary>
                    <div className="row wrap mt-3">
                      <button
                        className="text-link"
                        onClick={() => openLeague(league.id)}
                      >
                        Fixtures <ArrowRight size={14} />
                      </button>
                      <button
                        className="text-link"
                        onClick={() => openLeague(league.id, 'Leaderboards')}
                      >
                        Leaderboard
                      </button>
                    </div>
                  </details>
                )}
              </footer>
              {canLeague(me, team.leagueId) && (
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() => {
                    setOptions(false);
                    setRemoving(true);
                  }}
                >
                  <Trash2 size={16} />
                  Remove team
                </button>
              )}
            </DialogContent>
          </Dialog>
        )}
        {removing && (
          <TeamRemoval
            tools={tools}
            teamId={teamId}
            close={() => setRemoving(false)}
          />
        )}
        {!!selected &&
          (() => {
            const e = approved.find((e) => e.id === selected);
            const p = s.players.find((p) => p.id === e?.playerId);
            if (!e || !p) return null;
            return (
              <Dialog open onOpenChange={(v) => !v && setSelected('')}>
                <DialogContent className="editor-dialog">
                  <DialogHeader>
                    <DialogTitle>
                      <ChildName
                        player={p}
                        workspace={tools.workspace}
                        view={tools.view}
                      />
                    </DialogTitle>
                    <DialogDescription>
                      {team.name} · {league.name} · {league.year}
                    </DialogDescription>
                  </DialogHeader>
                  {error && (
                    <p className="error" role="alert">
                      {error}
                    </p>
                  )}
                  {details(p)}
                  {!!otherTeams.length && (
                    <div className="row wrap mt-3">
                      <Pick
                        label={`Move ${p.name} to another team`}
                        value={moves[e.id] || ''}
                        onChange={(v) => setMoves({ ...moves, [e.id]: v })}
                        options={otherTeams.map((t) => ({
                          value: t.id,
                          label: t.name,
                        }))}
                      />
                      <button
                        className="btn small"
                        disabled={
                          busy || !moves[e.id] || moves[e.id] === 'remove'
                        }
                        onClick={() =>
                          void run({
                            type: 'enrollment-transfer',
                            id: e.id,
                            teamId: moves[e.id],
                          })
                        }
                      >
                        Move
                      </button>
                    </div>
                  )}
                  <button
                    className="text-link mt-3"
                    disabled={busy}
                    onClick={() => setMoves({ ...moves, [e.id]: 'remove' })}
                  >
                    Remove from team
                  </button>
                  {moves[e.id] === 'remove' && (
                    <div className="notice mt-3">
                      <p>
                        Remove {p.name} from this team and future fixture
                        selections?
                      </p>
                      <div className="row wrap mt-3">
                        <button
                          className="btn small"
                          disabled={busy}
                          onClick={() =>
                            void run({ type: 'enrollment-remove', id: e.id })
                          }
                        >
                          Confirm removal
                        </button>
                        <button
                          className="btn small"
                          onClick={() => setMoves({ ...moves, [e.id]: '' })}
                        >
                          Keep in team
                        </button>
                      </div>
                    </div>
                  )}
                  {profileUpdates(p)}
                </DialogContent>
              </Dialog>
            );
          })()}
        {sharing && (
          <Dialog open onOpenChange={setSharing}>
            <DialogContent className="editor-dialog">
              <DialogHeader>
                <DialogTitle>Invite families to {team.name}</DialogTitle>
                <DialogDescription>
                  Parents choose their child and request a place. You approve
                  each application.
                </DialogDescription>
              </DialogHeader>
              <TeamInvitation tools={tools} teamId={teamId} />
            </DialogContent>
          </Dialog>
        )}
      </section>
    </>
  );
}
