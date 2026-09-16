'use client';
import { useState, useEffect } from 'react';
import { ArrowRight, ArrowLeft, Check, Flag } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Field, CheckField } from './widgets';
import { Cap, type ParentData, type Catalog } from './parent-portal';
import type { Player } from '@/lib/model';
export default function JoinTeam({
  child,
  data,
  initialCode,
  onSend,
  close,
  busy,
}: {
  child: Player;
  data: ParentData;
  initialCode: string;
  onSend: (
    c: Catalog,
    preference: string,
    clubRequest: boolean,
  ) => Promise<void>;
  close: () => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState(initialCode ? 'code' : 'find'),
    [preference, setPreference] = useState(''),
    [code, setCode] = useState(initialCode),
    [search, setSearch] = useState(''),
    [clubKey, setClubKey] = useState(''),
    [leagueKey, setLeagueKey] = useState(''),
    [selected, setSelected] = useState<Catalog | null>(null),
    [consent, setConsent] = useState(false),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (initialCode) return;
    const q = new URLSearchParams(location.search);
    const match = data.directory.find(
      (c) =>
        c.workspace === q.get('joinWorkspace') &&
        c.organisation.id === q.get('joinClub') &&
        c.league.id === q.get('joinLeague') &&
        (!q.get('joinTeam') || c.team.id === q.get('joinTeam')),
    );
    if (match) {
      setClubKey(`${match.workspace}:${match.organisation.id}`);
      setLeagueKey(match.league.id);
      setSelected(match);
    }
  }, []);
  const clubId = (c: { workspace: string; id: string }) =>
    `${c.workspace}:${c.id}`;
  const normalise = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const clubs = data.clubs || [
    ...new Map(
      data.directory.map((c) => [
        `${c.workspace}:${c.organisation.id}`,
        {
          workspace: c.workspace,
          id: c.organisation.id,
          name: c.organisation.name,
          venues: [],
        },
      ]),
    ).values(),
  ];
  const matchingClubs = clubs
    .filter((c) =>
      normalise(`${c.name} ${c.venues.join(' ')}`).includes(normalise(search)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const club = clubs.find((c) => clubId(c) === clubKey);
  const clubTeams = data.directory.filter(
    (c) => c.workspace === club?.workspace && c.organisation.id === club.id,
  );
  const leagues = [
    ...new Map(clubTeams.map((c) => [c.league.id, c.league])).values(),
  ].sort((a, b) => b.year - a.year || a.name.localeCompare(b.name));
  const chosenLeague = leagueKey || (leagues.length === 1 ? leagues[0].id : '');
  const shown = clubTeams.filter((c) => c.league.id === chosenLeague);
  function chooseClub(key: string) {
    setClubKey(key);
    setLeagueKey('');
    setSelected(null);
    setConsent(false);
    setError('');
    const entries = data.directory.filter(
      (c) => `${c.workspace}:${c.organisation.id}` === key,
    );
    if (entries.length && new Set(entries.map((c) => c.league.id)).size === 1)
      setSelected(entries[0]);
  }
  function chooseLeague(key: string) {
    setLeagueKey(key);
    setSelected(null);
    setConsent(false);
    setError('');
    const entries = clubTeams.filter((c) => c.league.id === key);
    if (entries.length) setSelected(entries[0]);
  }
  function status(c: Catalog) {
    return data.seasons
      .find((s) => s.workspace === c.workspace)
      ?.state.enrollments?.find(
        (e) =>
          e.playerId === child.id &&
          (e.teamId === c.team.id ||
            (mode === 'find' &&
              data.directory.some(
                (v) =>
                  v.workspace === c.workspace &&
                  v.organisation.id === c.organisation.id &&
                  v.league.id === c.league.id &&
                  v.team.id === e.teamId,
              ))) &&
          ['pending', 'approved'].includes(e.status),
      )?.status;
  }
  async function lookup() {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/team-code?code=${encodeURIComponent(code)}`);
      const c: any = await r.json();
      if (!r.ok) throw new Error(c.error);
      setSelected(c);
      setConsent(false);
    } catch (e) {
      setError((e as Error).message);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (initialCode) void lookup();
  }, []);
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="editor-dialog team-finder">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            Request a place for {child.name.split(' ')[0]}
          </DialogTitle>
          <DialogDescription>
            Choose their home club. The organiser will confirm their place.
          </DialogDescription>
        </DialogHeader>
        <div className="join-options">
          <button
            className={mode === 'find' ? 'active' : ''}
            onClick={() => {
              setMode('find');
              chooseClub(clubKey);
            }}
          >
            Find my club
          </button>
          <button
            className={mode === 'code' ? 'active' : ''}
            onClick={() => {
              setMode('code');
              setSelected(null);
              setConsent(false);
              setError('');
            }}
          >
            Use a team code
          </button>
        </div>
        {mode === 'find' ? (
          <>
            {!club ? (
              <>
                <span className="eyebrow">1 · CHOOSE THEIR HOME CLUB</span>
                <Field
                  label="Home club name"
                  value={search}
                  onChange={setSearch}
                  hint="Choose a club below, or type its name to narrow the list."
                />
                <div className="find-team-list" aria-label="Available clubs">
                  {matchingClubs.map((c) => {
                    const entries = data.directory.filter(
                      (t) =>
                        t.workspace === c.workspace &&
                        t.organisation.id === c.id,
                    );
                    return (
                      <button
                        key={clubId(c)}
                        className="find-team-choice"
                        onClick={() => chooseClub(clubId(c))}
                      >
                        <Flag size={25} />
                        <div>
                          <strong>{c.name}</strong>
                          <p>
                            {entries.length
                              ? `${entries.length} team${entries.length === 1 ? '' : 's'} accepting requests`
                              : 'No teams open for registration yet'}
                          </p>
                          {c.venues.filter((v) => v !== c.name).length > 0 && (
                            <p>
                              {c.venues.filter((v) => v !== c.name).join(' · ')}
                            </p>
                          )}
                        </div>
                        <ArrowRight size={18} />
                      </button>
                    );
                  })}
                </div>
                {!matchingClubs.length && (
                  <div className="notice">
                    {clubs.length ? (
                      <>
                        No clubs match “{search}”. Try a shorter name or ask
                        your organiser which club name is registered.
                      </>
                    ) : (
                      <>
                        There are no clubs in this registration directory yet.
                        Your child’s details are saved. The Foundation needs to
                        add the club and approve its teams before you can join.
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <button
                  className="text-link row"
                  onClick={() => chooseClub('')}
                >
                  <ArrowLeft size={16} />
                  Change home club
                </button>
                <div className="chosen-home-club">
                  {clubTeams.length === 1 ? (
                    <Cap
                      color={clubTeams[0].team.color}
                      label={`${clubTeams[0].team.cap} cap`}
                      size={45}
                    />
                  ) : (
                    <Flag size={25} />
                  )}
                  <div>
                    <span className="eyebrow">HOME CLUB</span>
                    <h2>{club.name}</h2>
                    {clubTeams.length === 1 && (
                      <p>
                        {clubTeams[0].league.name} · {clubTeams[0].league.year}{' '}
                        · {clubTeams[0].team.cap} caps
                      </p>
                    )}
                    {clubTeams.length > 1 && leagues.length === 1 && (
                      <p>
                        {leagues[0].name} · {leagues[0].year}
                      </p>
                    )}
                  </div>
                </div>
                {!clubTeams.length ? (
                  <div className="notice">
                    {club.name} is registered, but has no teams accepting
                    requests in an open season. Ask the junior organiser when
                    its league teams will be ready. You do not need a code to
                    join once registration opens.
                  </div>
                ) : (
                  <>
                    {leagues.length > 1 ? (
                      <>
                        <span className="eyebrow">
                          2 · CHOOSE THEIR LEAGUE AND SEASON
                        </span>
                        <div className="club-league-choices">
                          {leagues.map((l) => (
                            <button
                              key={l.id}
                              className={`find-team-choice ${chosenLeague === l.id ? 'selected' : ''}`}
                              aria-pressed={chosenLeague === l.id}
                              onClick={() => chooseLeague(l.id)}
                            >
                              <div>
                                <strong>{l.name}</strong>
                                <p>
                                  {l.year} season ·{' '}
                                  {
                                    clubTeams.filter(
                                      (t) => t.league.id === l.id,
                                    ).length
                                  }{' '}
                                  club team
                                  {clubTeams.filter((t) => t.league.id === l.id)
                                    .length === 1
                                    ? ''
                                    : 's'}
                                </p>
                              </div>
                              {chosenLeague === l.id ? (
                                <Check size={18} />
                              ) : (
                                <ArrowRight size={18} />
                              )}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {shown.length > 0 && (
                      <p className="notice">
                        Your organiser will choose the team. Let them know below
                        if you have a preference or would like siblings kept
                        together.
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </>
        ) : (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void lookup();
            }}
          >
            <Field
              label="Six-digit team code"
              value={code}
              onChange={(v) => {
                setCode(v);
                setSelected(null);
              }}
              required
              hint="The code is an optional shortcut from your organiser."
            />
            <button className="btn" disabled={loading}>
              {loading ? 'Finding the team…' : 'Find this team'}
            </button>
          </form>
        )}
        {selected && (
          <div className="team-request-confirm">
            {mode === 'code' && (
              <div className="chosen-home-club">
                <Cap
                  color={selected.team.color}
                  label={`${selected.team.cap} cap`}
                  size={50}
                />
                <div>
                  <strong>{selected.organisation.name}</strong>
                  <p>
                    {selected.team.name} · {selected.league.name} ·{' '}
                    {selected.league.year} · {selected.team.cap} caps
                  </p>
                </div>
              </div>
            )}
            {status(selected) ? (
              <p className="notice mt-4">
                {status(selected) === 'approved'
                  ? 'Your child already has a place in this team.'
                  : 'Your request is with the organiser. Their decision will appear on Home and in Updates.'}
              </p>
            ) : (
              <>
                <Field
                  label="Message or team preference (optional)"
                  value={preference}
                  onChange={setPreference}
                  hint="For example, please keep my children together."
                />
                <CheckField checked={consent} onChange={setConsent}>
                  Share {child.name.split(' ')[0]}’s registration, care
                  information and my contact details with this club’s
                  organisers.
                </CheckField>
                <p className="muted">
                  The organiser will review your request and confirm{' '}
                  {child.name.split(' ')[0]}’s place.
                </p>
              </>
            )}
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={close}>
            Not now
          </button>
          <button
            className="btn primary"
            disabled={
              !selected || !!(selected && status(selected)) || !consent || busy
            }
            onClick={async () => {
              try {
                await onSend(selected!, preference, mode === 'find');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {busy ? 'Sending…' : 'Send request to join'}
            <ArrowRight size={16} />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
