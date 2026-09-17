'use client';
import { AccountSignIn } from './account-sign-in';
import { GenderField } from './gender-field';
import { ChildAvatar, ChildName } from './child-avatar';
import { useState, useEffect, useRef } from 'react';
import {
  Flag,
  Plus,
  ArrowRight,
  ArrowLeft,
  Check,
  Clock,
  CalendarDays,
  Bell,
  Users,
  ShieldCheck,
  Trophy,
  MapPin,
  Mail,
  Upload,
  ChevronRight,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Field, Pick, CheckField, dateLabel, type AppTools } from './widgets';
import {
  leagueStandings,
  type Player,
  type Fixture,
  type State,
  type Member,
} from '@/lib/model';
import JoinTeam from './join-team';
import { ParentFixtureCard } from './parent-fixture-card';
import {
  readJourney,
  rememberJourney,
  parentJourney,
} from '@/lib/journey-context';
import { Scorecards } from './fixture-detail';
import {
  familyFixtures,
  parentFixtureSections,
  parentShowsScorecard,
} from '@/lib/parent-fixtures';
import { londonDay } from '@/lib/team-priority';
type Season = {
  workspace: string;
  state: State;
  me: Member;
  revision: number;
  demo: boolean;
};
export type Catalog = {
  workspace: string;
  team: any;
  league: any;
  organisation: any;
  code?: string;
};
export type ParentData = {
  clubs?: { workspace: string; id: string; name: string; venues: string[] }[];
  family: { children: Player[]; pendingSync: Record<string, string> };
  revision: number;
  me: Member;
  seasons: Season[];
  directory: Catalog[];
  demo: boolean;
  stage: string;
  syncPending: boolean;
};
export function Cap({
  color,
  label,
  size = 58,
}: {
  color: string;
  label: string;
  size?: number;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className="junior-cap"
      style={{ backgroundColor: color, width: size, height: size }}
    />
  );
}
async function request(url: string, body?: any) {
  const r = await fetch(url, {
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
    cache: 'no-store',
  });
  const b: any = await r.json();
  if (!r.ok) throw new Error(b.error || 'Please try again.');
  return b;
}
export default function ParentPortal() {
  const [auth, setAuth] = useState<any>(null),
    [data, setData] = useState<ParentData | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [screen, setScreen] = useState('home'),
    [edit, setEdit] = useState<Player | 'new' | null>(null),
    [joining, setJoining] = useState<Player | null>(null),
    [fixture, setFixture] = useState<{ season: Season; id: string } | null>(
      null,
    ),
    [confirmation, setConfirmation] = useState<{
      title: string;
      description: string;
      run: () => Promise<void>;
    } | null>(null),
    [toast, setToast] = useState(''),
    [demo, setDemo] = useState(false),
    [stage, setStage] = useState('ready'),
    [boot, setBoot] = useState(false),
    [initialCode, setInitialCode] = useState(''),
    [joiningTarget, setJoiningTarget] = useState<{
      workspace: string;
      club: string;
      league: string;
    } | null>(null),
    [useEmail, setUseEmail] = useState(false);
  const generation = useRef(0),
    saving = useRef(false);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const journey = parentJourney(location.search, readJourney());
    setDemo(journey.demo);
    setStage(journey.stage);
    q.set('demo', journey.demo ? '1' : '0');
    q.set('stage', journey.stage);
    history.replaceState({}, '', '/?' + q);
    setInitialCode(q.get('code') || '');
    if (q.get('joinWorkspace') && q.get('joinClub') && q.get('joinLeague')) {
      setJoiningTarget({
        workspace: q.get('joinWorkspace')!,
        club: q.get('joinClub')!,
        league: q.get('joinLeague')!,
      });
      setScreen('children');
    }
    setBoot(true);
    request('/api/auth')
      .then(setAuth)
      .catch((e) => setError(e.message));
  }, []);
  const invitedClub = data?.directory.find(
    (entry) =>
      entry.workspace === joiningTarget?.workspace &&
      entry.organisation.id === joiningTarget.club &&
      entry.league.id === joiningTarget.league,
  );
  async function refresh() {
    if (!boot || !auth?.user || saving.current) return;
    const g = ++generation.current;
    try {
      const b = await request(
        `/api/parent?demo=${demo ? '1' : '0'}&stage=${stage}`,
      );
      if (g === generation.current) {
        rememberJourney({
          demo: b.demo,
          stage: b.stage,
          workspace: b.seasons[0]?.workspace || '',
        });
        setData(b);
        setError('');
      }
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 4000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [boot, auth?.user, demo, stage]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function act(season: Season, a: any) {
    if (saving.current) throw new Error('Please wait for the current save.');
    saving.current = true;
    setBusy(true);
    generation.current++;
    try {
      const r = await request('/api/workspace', {
        workspace: season.workspace,
        view: 'parent',
        action: a,
      });
      setData((old) =>
        old
          ? {
              ...old,
              seasons: old.seasons.map((s) =>
                s.workspace === season.workspace
                  ? { ...s, state: r.state, revision: r.revision }
                  : s,
              ),
            }
          : old,
      );
      setToast(
        a.type === 'availability'
          ? 'Availability updated. Your organiser can see it.'
          : a.type === 'score'
            ? 'Score saved and shared.'
            : 'Saved.',
      );
      return r;
    } finally {
      saving.current = false;
      setBusy(false);
      void refresh();
    }
  }
  async function familyAct(a: any) {
    if (saving.current) throw new Error('Please wait for the current save.');
    saving.current = true;
    setBusy(true);
    generation.current++;
    try {
      const r = await request('/api/parent', { ...a, demo, stage });
      setData(r);
      setToast(
        a.type === 'request-team'
          ? 'Request sent. Your organiser will confirm the place.'
          : 'Child’s details saved.',
      );
      return r;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const openedDeepLink = useRef(false);
  useEffect(() => {
    if (!data || openedDeepLink.current) return;
    const id = new URLSearchParams(location.search).get('fixture');
    if (!id) return;
    const season = data.seasons.find((s) =>
      s.state.fixtures.some((f) => f.id === id),
    );
    if (season) {
      openedDeepLink.current = true;
      setFixture({ season, id });
      setScreen('fixture');
    }
  }, [data]);
  const children = data?.family.children || [];
  const regs = (p: Player) =>
    (data?.seasons || [])
      .flatMap((season) =>
        (season.state.enrollments || [])
          .filter(
            (e) =>
              e.playerId === p.id &&
              ['pending', 'approved', 'rejected'].includes(e.status),
          )
          .map((e) => ({
            season,
            e,
            team: season.state.teams.find((t) => t.id === e.teamId),
            league: season.state.leagues.find(
              (l) =>
                l.id ===
                season.state.teams.find((t) => t.id === e.teamId)?.leagueId,
            ),
          })),
      )
      .filter((e) => e.team);
  const joined = children.some((p) =>
    regs(p).some((r) => r.e.status === 'approved'),
  );
  const events = familyFixtures(data?.seasons || [], children);
  const today = data?.seasons?.[0]?.state.demoToday || londonDay();
  const { upcoming, selected, other, matchday } = parentFixtureSections(
    events,
    today,
  );
  const published = upcoming.filter((e) => e.published);
  const repliesNeeded = (list: typeof events) =>
    list.reduce(
      (total, e) =>
        total +
        e.kids.filter(
          (p) =>
            !e.f.pairs.some((pair) => pair.players.includes(p.id)) &&
            !e.season.state.reserves?.some(
              (r) => r.fixtureId === e.f.id && r.playerId === p.id,
            ) &&
            !e.season.state.availability?.some(
              (a) => a.fixtureId === e.f.id && a.playerId === p.id,
            ),
        ).length,
      0,
    );
  const availabilityNeeded = repliesNeeded(published);
  const otherRepliesNeeded = repliesNeeded(other);
  const fixtureFocus = published.length > 0 || matchday.length > 0;
  const notifications = (data?.seasons || [])
    .flatMap((season) =>
      (season.state.notifications || [])
        .filter(
          (n) =>
            !n.fixtureId ||
            season.state.fixtures.some(
              (f) =>
                f.id === n.fixtureId &&
                f.date >=
                  (data?.seasons?.[0]?.state.demoToday || londonDay()) &&
                !['completed', 'cancelled'].includes(f.status),
            ),
        )
        .map((n) => ({ season, n })),
    )
    .sort((a, b) => b.n.createdAt.localeCompare(a.n.createdAt));
  const unread = notifications.filter((v) => !v.n.readAt).length;
  const tools = (season: Season): AppTools => ({
    s: season.state,
    me: data!.me,
    busy,
    workspace: season.workspace,
    demo,
    view: 'parent',
    act: (a) => act(season, a),
    edit: () => {},
    refresh,
  });
  async function availability(
    season: Season,
    f: Fixture,
    p: Player,
    status: string,
  ) {
    const selected =
      f.pairs.some((q) => q.players.includes(p.id)) ||
      (season.state.reserves || []).some(
        (r) => r.fixtureId === f.id && r.playerId === p.id,
      );
    const run = async () => {
      await act(season, {
        type: 'availability',
        fixtureId: f.id,
        playerId: p.id,
        status,
      });
    };
    if (status === 'no' && selected)
      setConfirmation({
        title: `Withdraw ${p.name.split(' ')[0]} from this fixture?`,
        description:
          'Their playing or reserve place will be released and the organiser will be notified. You can mark them available again later, but the organiser will need to select them again.',
        run,
      });
    else
      try {
        await run();
      } catch (e) {
        setError((e as Error).message);
      }
  }
  function openFixture(season: Season, f: Fixture, instructions = false) {
    setFixture({ season, id: f.id });
    setScreen('fixture');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (instructions)
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          document
            .getElementById('fixture-host-instructions')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        ),
      );
  }
  function ChildCard({ p }: { p: Player }) {
    const memberships = regs(p),
      active = memberships.filter((r) => r.e.status === 'approved'),
      pending = memberships.filter((r) => r.e.status === 'pending'),
      changes = (data?.seasons || [])
        .flatMap((s) => s.state.profileChanges || [])
        .filter((c) => c.playerId === p.id && c.status === 'pending');
    return (
      <section className="family-child">
        <div className="row">
          <ChildAvatar player={p} size={56} />
          <div>
            <h2>{p.name}</h2>
            <p className="muted">
              {active.length
                ? 'Ready to grow their game'
                : pending.length
                  ? 'We’re saving a place for a little golfer'
                  : 'Let’s find their team'}
            </p>
          </div>
          <button className="text-link" onClick={() => setEdit(p)}>
            Edit
          </button>
        </div>
        {active.map((r) => {
          const row = leagueStandings(r.season.state, r.team!.leagueId),
            rank = row.findIndex((t) => t.id === r.team!.id),
            t = row[rank];
          return (
            <div
              className="child-team"
              key={r.e.id}
              style={{ borderLeftColor: r.team!.color }}
            >
              <Cap color={r.team!.color} label={`${r.team!.cap} junior cap`} />
              <div>
                <strong>{r.team!.name}</strong>
                <p>
                  {r.league?.name} · {r.league?.year}
                </p>
                <small>
                  {t?.played
                    ? `${rank + 1}${rank === 0 ? 'st' : rank === 1 ? 'nd' : rank === 2 ? 'rd' : 'th'} in the league · ${t.points} points`
                    : 'A new season together'}
                </small>
              </div>
              {screen === 'children' && (
                <button
                  className="text-link"
                  onClick={() =>
                    setConfirmation({
                      title: `Leave ${r.team!.name}?`,
                      description:
                        'Future selections and reserve places for this team will be removed. Previous results will stay in the season record.',
                      run: async () => {
                        await act(r.season, {
                          type: 'enrollment-remove',
                          id: r.e.id,
                        });
                      },
                    })
                  }
                >
                  Leave team
                </button>
              )}
            </div>
          );
        })}
        {pending.map((r) => (
          <div className="pending-team" key={r.e.id}>
            <Clock size={18} />
            <div>
              <strong>
                {r.e.clubRequest
                  ? r.season.state.orgs.find((o) => o.id === r.team!.orgId)
                      ?.name || 'Your club'
                  : r.team!.name}
              </strong>
              <p>
                {r.e.clubRequest
                  ? 'Waiting for the organiser to allocate a team.'
                  : 'Waiting for the organiser’s approval.'}
              </p>
              {r.e.preference && <p>Your message: {r.e.preference}</p>}
            </div>
            <button
              className="text-link"
              onClick={() =>
                act(r.season, { type: 'enrollment-remove', id: r.e.id }).catch(
                  (e) => setError(e.message),
                )
              }
            >
              Cancel request
            </button>
          </div>
        ))}
        {memberships
          .filter((r) => r.e.status === 'rejected')
          .map((r) => (
            <p className="notice mt-3" key={r.e.id}>
              Your request to {r.team!.name} wasn’t approved.
              {r.e.reason
                ? ' ' + r.e.reason
                : ' You can contact the organiser or choose another team.'}
            </p>
          ))}
        {changes.length > 0 && (
          <p className="notice mt-3">
            A profile update is waiting for organiser review. Care and emergency
            details are already up to date.
          </p>
        )}
        <div className="row wrap mt-4">
          <button
            className={active.length ? 'text-link' : 'btn primary'}
            onClick={() => setJoining(p)}
          >
            {invitedClub
              ? 'Request a place'
              : active.length
                ? 'Request a different team'
                : pending.length
                  ? 'Find another team'
                  : 'Join a team'}
            <ArrowRight size={15} />
          </button>
          {
            <label className="text-link upload">
              <Upload size={15} />
              {p.photoKey ? 'Change photo' : 'Add photo'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label={`Identification photo for ${p.name}`}
                disabled={busy}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const form = new FormData();
                  form.set('photo', f);
                  form.set('playerId', p.id);
                  form.set('demo', demo ? '1' : '0');
                  form.set('stage', stage);
                  setBusy(true);
                  try {
                    const r = await fetch('/api/family-photo', {
                      method: 'POST',
                      body: form,
                    });
                    const b: any = await r.json();
                    if (!r.ok) throw new Error(b.error);
                    await refresh();
                    setToast('Profile photo saved.');
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
          }
        </div>
      </section>
    );
  }
  function renderEvent(event: (typeof events)[number]) {
    const { season, f, kids } = event;
    const showScorecard = parentShowsScorecard(event, today);
    const details = (
      <ParentFixtureCard
        key={season.workspace + f.id}
        s={season.state}
        f={f}
        kids={kids}
        published={event.published}
        detail={showScorecard || screen === 'fixture'}
        busy={busy}
        send={(a) => act(season, a)}
        availability={(p, value) => void availability(season, f, p, value)}
        open={() => openFixture(season, f)}
      />
    );
    if (!showScorecard) return details;
    const Heading = screen === 'fixture' ? 'h1' : 'h2';
    return (
      <section className="family-matchday" key={season.workspace + ':' + f.id}>
        <header className="family-matchday-heading">
          <div>
            <span className="eyebrow">
              {f.date === today ? 'Today' : dateLabel(f.date)} ·{' '}
              {f.status === 'completed'
                ? 'Completed scorecard'
                : 'Your scorecard'}
            </span>
            <Heading>
              {season.state.clubs.find((club) => club.id === f.clubId)?.name ||
                f.name}
            </Heading>
            <p>
              Arrive {f.arrival} ·{' '}
              {f.format === 'shotgun' ? 'Shotgun start' : 'First tee time'}{' '}
              {f.start}
            </p>
          </div>
          <a
            className="btn"
            href={'#matchday-details-' + season.workspace + '-' + f.id}
            onClick={(e) => {
              e.preventDefault();
              const panel = document.getElementById(
                'matchday-details-' + season.workspace + '-' + f.id,
              ) as HTMLDetailsElement | null;
              if (panel) {
                panel.open = true;
                panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                panel.querySelector('summary')?.focus();
              }
            }}
          >
            <MapPin size={16} /> Instructions & fixture details
          </a>
        </header>
        <Scorecards f={f} tools={tools(season)} />
        <details
          className="family-matchday-details"
          id={'matchday-details-' + season.workspace + '-' + f.id}
        >
          <summary>Joining instructions, team & messages</summary>
          {details}
        </details>
      </section>
    );
  }

  const activeSeason =
    fixture &&
    data?.seasons.find((s) => s.workspace === fixture.season.workspace);
  const activeFixture = activeSeason?.state.fixtures.find(
    (f) => f.id === fixture?.id,
  );
  return (
    <div className="parent-shell">
      <header className="family-top">
        <a className="family-brand" href="/">
          <Flag />
          Golf<span>Sixes</span>
          <small>LEAGUE</small>
        </a>
        <nav className="family-nav">
          <button
            onClick={() => {
              setScreen('home');
              setFixture(null);
            }}
            className={screen === 'home' ? 'active' : ''}
          >
            Home
          </button>
          <button
            onClick={() => setScreen('children')}
            className={screen === 'children' ? 'active' : ''}
          >
            My children
          </button>
          <button
            aria-label={`${unread} unread updates`}
            onClick={() => setScreen('updates')}
            className={screen === 'updates' ? 'active' : ''}
          >
            <Bell size={18} />
            <span>Updates</span>
            {unread > 0 && <b>{unread}</b>}
          </button>
        </nav>
      </header>
      <main className="family-main">
        {error && (
          <div role="alert" className="error mb-5">
            {error}
            <button className="text-link ml-4" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        )}
        {!auth ? (
          <p className="muted">Checking your sign-in…</p>
        ) : !auth.user || useEmail ? (
          <EmailSignIn
            auth={auth}
            onDone={async () => {
              setAuth(await request('/api/auth'));
              setUseEmail(false);
            }}
          />
        ) : !data ? (
          <p className="muted">Bringing your family’s season together…</p>
        ) : (
          <>
            {data.syncPending && (
              <p className="notice mb-5">
                Your family details are saved. We’re retrying an update to a
                club; keep this page open until it completes.
              </p>
            )}
            {screen === 'home' && (
              <>
                <div className="parent-greeting">
                  <span className="eyebrow">
                    HELLO, {data.me.name.split(' ')[0].toUpperCase()}
                  </span>
                  <h1>
                    {!children.length
                      ? 'Let’s meet your young golfer.'
                      : matchday.length
                        ? 'It’s matchday. Let’s play!'
                        : !joined
                          ? 'A team for every little golfer.'
                          : selected.length
                            ? 'They’re in the team!'
                            : fixtureFocus
                              ? availabilityNeeded
                                ? 'When can your children play?'
                                : 'Your family’s fixtures.'
                              : 'Your family’s next round.'}
                  </h1>
                  <p>
                    {!children.length
                      ? 'Add your children first. We’ll help you find their teams next.'
                      : matchday.length
                        ? 'Enter scores for your child’s pair below. Joining instructions and organiser messages are still available.'
                        : !joined
                          ? 'Pick a team or use the code your organiser gave you. They’ll confirm your child’s place.'
                          : selected.length
                            ? 'Your organiser has chosen the players. Confirm they can play and check the host’s arrival details below.'
                            : fixtureFocus
                              ? availabilityNeeded
                                ? 'The fixtures are published. Tell your organiser when each child is available. You can change your answers at any time.'
                                : 'Your availability is saved. If plans change, update your answers below.'
                              : 'Your children, their fixtures, and the moments to look forward to.'}
                  </p>
                </div>
                {!joined && (
                  <ol className="family-steps">
                    <li className={children.length ? 'done' : 'current'}>
                      <span>{children.length ? <Check size={16} /> : '1'}</span>
                      Add your children
                    </li>
                    <li className={children.length ? 'current' : ''}>
                      <span>2</span>Join their teams
                    </li>
                    <li>
                      <span>3</span>Get ready to play
                    </li>
                  </ol>
                )}
                {!children.length ? (
                  <section className="first-child">
                    <div className="first-child-icon">
                      <Users size={36} />
                    </div>
                    <h2>
                      One parent account.
                      <br />
                      All your little golfers.
                    </h2>
                    <p>
                      Start with their name and birthday. You don’t need to know
                      their team or have a handicap yet.
                    </p>
                    <button
                      className="btn primary"
                      onClick={() => setEdit('new')}
                    >
                      <Plus size={18} />
                      Add my first child
                    </button>
                    <p className="privacy-note">
                      <ShieldCheck size={16} />
                      Your family details stay private. You choose which team to
                      share them with.
                    </p>
                  </section>
                ) : (
                  <>
                    {matchday.map((e) => renderEvent(e))}
                    {matchday.length > 0 && selected.length > 0 ? (
                      <details className="family-other-fixtures">
                        <summary>Selected for later fixtures</summary>
                        {selected.map((e) => renderEvent(e))}
                      </details>
                    ) : (
                      selected.map((e) => renderEvent(e))
                    )}
                    {joined && other.length > 0 && (
                      <details
                        className="family-other-fixtures"
                        open={selected.length === 0 && matchday.length === 0}
                      >
                        <summary>
                          <span>
                            {selected.length || matchday.length
                              ? 'Other upcoming fixtures'
                              : 'Upcoming fixtures & availability'}
                          </span>
                          <small>
                            {otherRepliesNeeded
                              ? `${otherRepliesNeeded} ${otherRepliesNeeded === 1 ? 'reply' : 'replies'} needed`
                              : 'Update your availability'}
                          </small>
                        </summary>
                        <p className="muted">
                          Tell your club organiser when your children can play.
                          Available does not mean selected.
                        </p>
                        {other.map((e) => renderEvent(e))}
                      </details>
                    )}
                    {joined && !upcoming.length && !matchday.length && (
                      <section className="card">
                        <h2>You’re all caught up.</h2>
                        <p className="muted mt-3">
                          New fixtures will appear here when your organiser adds
                          them.
                        </p>
                      </section>
                    )}
                    {fixtureFocus ? (
                      <div className="family-maintenance-link">
                        <button
                          className="btn"
                          onClick={() => setScreen('children')}
                        >
                          <Users size={18} /> My children{' '}
                          <ChevronRight size={16} />
                        </button>
                        <span>
                          Add a child, update their details or manage their club
                          registration.
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="family-section-title">
                          <h2>
                            {joined
                              ? 'Your children & their teams'
                              : 'Let’s find their place'}
                          </h2>
                          <button
                            className="text-link"
                            onClick={() => setEdit('new')}
                          >
                            <Plus size={16} />
                            Add another child
                          </button>
                        </div>
                        <div className="family-children">
                          {children.map((p) => (
                            <ChildCard key={p.id} p={p} />
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}
            {screen === 'children' && (
              <>
                <div className="page-heading">
                  <div>
                    <h1>
                      {invitedClub
                        ? `Join ${invitedClub.organisation.name}`
                        : 'Your little golfers.'}
                    </h1>
                    <p>
                      {invitedClub
                        ? `${invitedClub.league.name} · ${invitedClub.league.year}. Choose a child below to request their place, or add a child first. Your organiser will confirm their team.`
                        : 'Their details, their teams, all in one place.'}
                    </p>
                  </div>
                  <button
                    className="btn primary"
                    onClick={() => setEdit('new')}
                  >
                    <Plus size={17} />
                    Add a child
                  </button>
                </div>
                {joiningTarget && !invitedClub && (
                  <p className="notice">
                    This joining link is no longer open for applications. Your
                    organiser can help you with the next step.
                  </p>
                )}
                <div className="family-children">
                  {children.map((p) => (
                    <ChildCard key={p.id} p={p} />
                  ))}
                </div>
                {!children.length && (
                  <section className="first-child">
                    <h2>Let’s start with their name.</h2>
                    <button
                      className="btn primary mt-5"
                      onClick={() => setEdit('new')}
                    >
                      Add my first child
                    </button>
                  </section>
                )}
              </>
            )}
            {screen === 'fixtures' && (
              <>
                <h1 className="mb-7">All their upcoming fixtures.</h1>
                {matchday.map((e) => renderEvent(e))}
                {upcoming.map((e) => renderEvent(e))}
              </>
            )}
            {screen === 'updates' && (
              <>
                <div className="parent-greeting">
                  <h1>A little heads-up.</h1>
                  <p>
                    Team approvals, selections and changes that matter to your
                    family.
                  </p>
                </div>
                {notifications.length ? (
                  notifications.map(({ season, n }) => (
                    <button
                      className={`family-update ${n.readAt ? '' : 'unread'}`}
                      key={n.id}
                      onClick={async () => {
                        try {
                          await act(season, { type: 'notice-read', id: n.id });
                          const f = season.state.fixtures.find(
                            (f) => f.id === n.fixtureId,
                          );
                          if (f) openFixture(season, f);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <Bell size={19} />
                      <div>
                        <p>{n.text}</p>
                        <small>
                          {new Date(n.createdAt).toLocaleString('en-GB')}
                        </small>
                      </div>
                      {!n.readAt && <span className="badge green">New</span>}
                    </button>
                  ))
                ) : (
                  <section className="first-child">
                    <Bell size={30} />
                    <h2>No updates just yet.</h2>
                    <p>
                      We’ll show you a note here when a team request is approved
                      or your child is selected.
                    </p>
                  </section>
                )}
                <p className="notice mt-5">
                  Updates appear in this app. Email notifications haven’t been
                  connected yet.
                </p>
              </>
            )}
            {screen === 'fixture' && activeFixture && activeSeason && (
              <>
                <button
                  className="text-link row mb-6"
                  onClick={() => setScreen('home')}
                >
                  <ArrowLeft size={16} />
                  Back to our fixtures
                </button>
                {renderEvent({
                  season: activeSeason,
                  f: activeFixture,
                  published: !!activeSeason.state.leagues.find(
                    (l) => l.id === activeFixture.leagueId,
                  )?.fixturesConfirmedAt,
                  kids: children.filter(
                    (p) =>
                      activeFixture.pairs.some((pair) =>
                        pair.players.includes(p.id),
                      ) ||
                      regs(p).some(
                        (r) =>
                          r.season.workspace === activeSeason.workspace &&
                          r.e.status === 'approved' &&
                          activeFixture.teamIds.includes(r.e.teamId),
                      ),
                  ),
                })}
              </>
            )}
            <footer className="family-footer">
              <span>Signed in as {auth.user.email}</span>
              <button className="text-link" onClick={() => setUseEmail(true)}>
                Use another email
              </button>
              <a className="text-link" href="/">
                Change role
              </a>
            </footer>
          </>
        )}
      </main>
      {edit && data && (
        <ChildWizard
          key={edit === 'new' ? 'new' : edit.id}
          child={edit === 'new' ? null : edit}
          revision={data.revision}
          parentName={data.me.name}
          onSave={async (a) => {
            const result = await familyAct({ type: 'child', ...a });
            if (edit === 'new') {
              const added = result.family.children.find(
                (p: Player) =>
                  !data.family.children.some((old) => old.id === p.id),
              );
              if (added) setJoining(added);
            }
            setEdit(null);
          }}
          close={() => setEdit(null)}
          busy={busy}
        />
      )}{' '}
      {joining && data && (
        <JoinTeam
          child={joining}
          data={data}
          initialCode={initialCode}
          onSend={async (c, preference, clubRequest) => {
            await familyAct({
              type: 'request-team',
              workspace: c.workspace,
              teamId: c.team.id,
              playerId: joining.id,
              code: c.code,
              preference,
              clubRequest,
              consent: true,
            });
            setInitialCode('');
            setJoining(null);
          }}
          close={() => setJoining(null)}
          busy={busy}
        />
      )}
      <AlertDialog
        open={!!confirmation}
        onOpenChange={(open) => !open && setConfirmation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep their place</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await confirmation?.run();
                  setConfirmation(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Confirm withdrawal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {toast && (
        <div className="toast" role="status">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
function EmailSignIn({
  auth,
  onDone,
}: {
  auth: any;
  onDone: () => Promise<void>;
}) {
  return (
    <section className="parent-login">
      <span className="eyebrow">WELCOME, PARENT OR GUARDIAN</span>
      <h1>Your family’s season</h1>
      <AccountSignIn onDone={onDone} />
      <a className="text-link mt-5 block" href="/?role=parent&help=1">
        Having trouble signing in? Ask my organiser
      </a>
    </section>
  );
}

function ChildWizard({
  child,
  revision,
  parentName,
  onSave,
  close,
  busy,
}: {
  child: Player | null;
  revision: number;
  parentName: string;
  onSave: (a: any) => Promise<void>;
  close: () => void;
  busy: boolean;
}) {
  const [step, setStep] = useState(0),
    [d, setD] = useState<any>({
      name: '',
      dob: '',
      handicap: '',
      emergencyName: parentName,
      emergencyPhone: '',
      diet: '',
      care: '',
      photoConsent: false,
      consent: false,
      ...child,
    }),
    [error, setError] = useState('');
  const field = (key: string, label: string, props: any = {}) => (
    <Field
      label={label}
      value={d[key]}
      onChange={(v) => setD((old: any) => ({ ...old, [key]: v }))}
      {...props}
    />
  );
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="editor-dialog child-wizard">
        <DialogHeader>
          <span className="eyebrow">STEP {step + 1} OF 3</span>
          <DialogTitle className="text-2xl">
            {
              [
                'Let’s meet your young golfer.',
                'Help us look after them.',
                'All looking good?',
              ][step]
            }
          </DialogTitle>
          <DialogDescription>
            {
              [
                'You can find their team after this.',
                'Only you and the relevant organisers see these details.',
                'You can come back and update these details whenever you need to.',
              ][step]
            }
          </DialogDescription>
        </DialogHeader>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            if (step < 2) {
              setStep(step + 1);
              return;
            }
            try {
              await onSave({ ...d, expectedRevision: revision });
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {step === 0 && (
            <>
              {field('name', 'Child’s full name', { required: true })}
              {field('dob', 'Date of birth', { type: 'date', required: true })}
              <GenderField
                value={d.gender}
                onChange={(v) => setD((old: any) => ({ ...old, gender: v }))}
              />
              {field('handicap', 'Current handicap (if they have one)', {
                type: 'number',
                min: -10,
                max: 54,
                hint: 'No handicap? Leave this blank. Beginners are very welcome.',
              })}
            </>
          )}
          {step === 1 && (
            <>
              {field('emergencyName', 'Emergency contact name', {
                required: true,
              })}
              {field('emergencyPhone', 'Emergency contact phone', {
                type: 'tel',
                required: true,
              })}
              {field('diet', 'Allergies or dietary needs', {
                large: true,
                hint: 'Leave blank if there are none.',
              })}
              {field('care', 'Anything else that helps us support them?', {
                large: true,
                hint: 'For example, medical needs, safeguarding information or extra support.',
              })}
              <CheckField
                checked={d.photoConsent}
                onChange={(v) =>
                  setD((old: any) => ({ ...old, photoConsent: v }))
                }
              >
                I permit the club or league to publish photographs of my child.
              </CheckField>
              <p className="notice">
                Leaving this unchecked means no publication consent. A private
                identification photo can be added later.
              </p>
            </>
          )}
          {step === 2 && (
            <>
              <div className="child-summary">
                <Users size={32} />
                <h2>{d.name}</h2>
                <p>
                  Born{' '}
                  {d.dob
                    ? new Date(d.dob + 'T12:00:00').toLocaleDateString('en-GB')
                    : ''}
                </p>
                <p>
                  {d.handicap === '' || d.handicap === null
                    ? 'No handicap yet'
                    : `Handicap ${d.handicap}`}
                </p>
                <p>
                  {d.photoConsent
                    ? 'Photo publication permitted'
                    : 'No photo publication'}
                </p>
                <p>
                  Emergency contact: {d.emergencyName} · {d.emergencyPhone}
                </p>
              </div>
              <CheckField
                checked={!!d.consent}
                onChange={(v) => setD((old: any) => ({ ...old, consent: v }))}
              >
                I have parental responsibility or permission to register this
                child. I confirm these details are accurate and understand that
                I will choose a team to share them with.
              </CheckField>
              {child && (
                <p className="notice">
                  Existing teams will be notified. Routine profile changes need
                  organiser review; care and emergency details and photo-consent
                  withdrawals take effect immediately.
                </p>
              )}
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="btn"
              type="button"
              onClick={() => (step ? setStep(step - 1) : close())}
            >
              {step ? 'Back' : 'Cancel'}
            </button>
            <button
              className="btn primary"
              disabled={busy || (step === 2 && !d.consent)}
            >
              {step < 2 ? 'Next' : busy ? 'Saving…' : 'Save child’s details'}
              <ArrowRight size={15} />
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
