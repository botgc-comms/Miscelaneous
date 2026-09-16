'use client';
import { InvitationList } from './invitations';
import { ChildAvatar } from './child-avatar';
import { AdminAssistant } from './admin-assistant';
import { LoginHelpQueue } from './login-help-queue';
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from 'react';
import {
  Flag,
  LayoutDashboard,
  CalendarDays,
  Users,
  Trophy,
  ShieldCheck,
  Plus,
  Clock,
  ArrowUpRight,
  ChevronRight,
  ChevronDown,
  MapPin,
  Link,
  Mail,
  Phone,
  Upload,
  Search,
  BookOpen,
  ChartNoAxesCombined,
} from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
  useSidebar,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { londonDay } from '@/lib/team-priority';
import { demoUser } from '@/lib/demo';
import {
  emptyState,
  canOrg,
  canHost,
  canLeague,
  leagueHasTeamSpace,
  leagueStandings,
  capOrder,
  type State,
  type Member,
  type Action,
  type Fixture,
} from '@/lib/model';
import { EditDialog, type Editor } from './edit-dialog';
import FamilyReview from './family-review';
import {
  ClubsDirectory,
  PlayersDirectory,
  AddClubToLeague,
} from './staff-directories';
import { SeasonHome } from './season-home';
import { OrganiserHome } from './organiser-home';
import { FixturePlanner } from './fixture-planner';
import { FixtureSeasonStatus } from './fixture-season-status';
import { OrganiserGuideProvider } from './organiser-guide';
const StatisticsPage = lazy(() =>
  import('./statistics').then((m) => ({ default: m.StatisticsPage })),
);
const LeagueMapPage = lazy(() =>
  import('./league-map').then((m) => ({ default: m.LeagueMapPage })),
);
import {
  readJourney,
  rememberJourney,
  roleHref,
  staffJourney,
} from '@/lib/journey-context';
import { FixtureDetail } from './fixture-detail';
import { Pick, Empty, Badge, Dot, dateLabel, type AppTools } from './widgets';
type Reply = {
  state: State;
  me: Member;
  workspace: string;
  workspaceName: string;
  demo: boolean;
  canSwitchRoles?: boolean;
  organiserClubs?: { id: string; name: string }[];
  revision: number;
  workspaces: { id: string; name: string }[];
  inviteToken?: string;
};
function AppNavButton(props: React.ComponentProps<typeof SidebarMenuButton>) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      {...props}
      onClick={(e) => {
        props.onClick?.(e);
        setOpenMobile(false);
      }}
    />
  );
}
export default function LeagueApp() {
  const [data, setData] = useState<Reply>(() => ({
    state: emptyState(),
    me: demoUser,
    workspace: '',
    workspaceName: 'GolfSixes League',
    demo: false,
    revision: 0,
    workspaces: [],
  }));
  const [workspace, setWorkspace] = useState('');
  const [view, setView] = useState('admin');
  const [page, setPage] = useState('Overview');
  const [reviewTeam, setReviewTeam] = useState('');
  const [league, setLeague] = useState('surrey');
  const [season, setSeason] = useState('');
  const [leagueScope, setLeagueScope] = useState('mine');
  const [addingClub, setAddingClub] = useState(false);
  const [fixtureId, setFixtureId] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('upcoming');
  const [join, setJoin] = useState('');
  const [inviteInfo, setInviteInfo] = useState<any>(null);
  const generation = useRef(0);
  const saving = useRef(false);
  const [boot, setBoot] = useState(false);
  const { state: s, me } = data;
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    setView(
      q.get('view') || (q.get('role') === 'staff' ? 'organiser' : 'admin'),
    );
    setWorkspace(q.get('workspace') || readJourney()?.workspace || '');
    setJoin(q.get('join') || '');
    if (q.get('fixture')) {
      setFixtureId(q.get('fixture')!);
      setPage('Fixtures');
    }
    setBoot(true);
  }, []);
  const applyReply = useCallback((r: Reply) => {
    rememberJourney(staffJourney(r.demo, r.workspace));
    setData((old) =>
      old.workspace === r.workspace &&
      old.me.id === r.me.id &&
      old.revision > r.revision
        ? old
        : r,
    );
    setLeague((id) =>
      r.state.leagues.some((l) => l.id === id)
        ? id
        : r.state.leagues[0]?.id || '',
    );
    setReady(true);
  }, []);
  const refresh = useCallback(async () => {
    if (!boot || saving.current) return;
    const g = ++generation.current;
    try {
      const q = new URLSearchParams({
        view,
        ...(workspace ? { workspace } : {}),
      });
      const response = await fetch(`/api/workspace?${q}`, {
        cache: 'no-store',
      });
      const result: any = await response.json();
      if (g !== generation.current) return;
      if (!response.ok) throw new Error(result.error);
      applyReply(result);
      setError('');
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    }
  }, [workspace, view, boot, applyReply]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 4000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (join)
      fetch(`/api/invite?token=${encodeURIComponent(join)}`)
        .then(async (r) => {
          const b: any = await r.json();
          setInviteInfo(b);
        })
        .catch(() =>
          setInviteInfo({ error: 'Could not load this invitation.' }),
        );
  }, [join]);
  const switchWorkspace = (id: string) => {
    setWorkspace(id);
    setSeason('');
    setReviewTeam('');
    setFixtureId('');
    setPage('Overview');
    setView('admin');
    setReady(false);
    const q =
      '?role=admin&view=admin' +
      (id ? `&workspace=${encodeURIComponent(id)}` : '');
    rememberJourney(staffJourney(!id, id));
    history.replaceState({}, '', location.pathname + q);
  };
  const act = useCallback(
    async (action: Action) => {
      if (saving.current) throw new Error('Please wait for the current save.');
      saving.current = true;
      setBusy(true);
      generation.current++;
      try {
        const response = await fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace: workspace || undefined,
            view,
            action,
          }),
        });
        const result: any = await response.json();
        if (!response.ok) throw new Error(result.error);
        applyReply(result);
        setNotice(
          action.type === 'fixture-plan-suggest'
            ? ''
            : action.type === 'score'
              ? 'Score saved and shared.'
              : 'Changes saved.',
        );
        return result;
      } catch (e) {
        setNotice('');
        throw e;
      } finally {
        saving.current = false;
        setBusy(false);
      }
    },
    [workspace, view, applyReply],
  );
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  const edit = (kind: string, form: any = {}) => {
    if (!ready) {
      setError('Wait for your workspace to connect, then try again.');
      return;
    }
    setEditor({ kind, data: form });
  };
  const tools: AppTools = {
    s,
    me,
    busy: busy || !ready,
    workspace: data.workspace,
    demo: data.demo,
    view,
    act,
    edit,
    refresh,
  };
  const l = s.leagues.find((v) => v.id === league);
  const teams = s.teams
    .filter((t) => !t.withdrawnAt && t.leagueId === league)
    .sort(capOrder);
  const fixtures = s.fixtures
    .filter((f) => f.leagueId === league)
    .sort((a, b) => a.date.localeCompare(b.date));
  const standings = leagueStandings(s, league);
  const active =
    fixtures.find((f) => f.status === 'live') ||
    fixtures.find((f) => f.status === 'scheduled');
  const players = s.players.filter((p) =>
    teams.some((t) => t.orgId === p.orgId),
  );
  const ownPlayers = s.players.filter((p) => p.parentId === me.id);
  const openFixture = (f: Fixture) => {
    setLeague(f.leagueId);
    setFixtureId(f.id);
    setPage('Fixtures');
  };
  const openLeague = (id: string, target = 'Fixtures') => {
    setLeague(id);
    setSeason(
      String(
        s.leagues.find((l) => l.id === id)?.year || new Date().getFullYear(),
      ),
    );
    setFixtureId('');
    setFilter('upcoming');
    setPage(target);
  };
  const openTeam = (id: string) => {
    setReviewTeam(id);
    setPage('Teams & players');
  };
  const manage = me.role !== 'parent';
  const admin = me.role === 'admin';
  const needsHostingAvailability = s.leagues.some(
    (l) =>
      l.year === Number(season) &&
      !l.fixturesConfirmedAt &&
      s.teams.some(
        (t) =>
          !t.withdrawnAt && t.leagueId === l.id && me.orgIds.includes(t.orgId),
      ),
  );
  const confirmClubFirst =
    me.role === 'organiser' &&
    s.clubs.some((c) => me.orgIds.includes(c.orgId) && !c.confirmedAt);
  useEffect(() => {
    if (confirmClubFirst) {
      setPage('Overview');
      setFixtureId('');
    }
  }, [confirmClubFirst]);
  const currentFixture = s.fixtures.find((f) => f.id === fixtureId);
  const nav: [typeof Flag, string][] = [
    [LayoutDashboard, 'Overview'],
    ...(manage ? [[Users, 'Teams & players']] : []),
    [CalendarDays, 'Fixtures'],
    ...(manage ? [[Users, me.role === 'organiser' ? 'My club' : 'Clubs']] : []),
    [Users, manage ? 'Players & families' : 'My children'],
    [Trophy, 'Leaderboards'],
    ...(['admin', 'league-admin'].includes(me.role)
      ? [[ChartNoAxesCombined, 'Statistics']]
      : []),
    [ShieldCheck, manage ? 'People & access' : 'Contacts'],
  ] as [typeof Flag, string][];
  const navGroups: { label?: string; items: [typeof Flag, string][] }[] = [
    'admin',
    'league-admin',
  ].includes(me.role)
    ? [
        {
          label: 'YOUR SEASON',
          items: [
            [LayoutDashboard, 'Overview'],
            [Users, 'Clubs'],
            [Users, 'Teams & players'],
            [CalendarDays, 'Fixtures'],
          ],
        },
        {
          items: [
            [Trophy, 'Leaderboards'],
            [ChartNoAxesCombined, 'Statistics'],
            [MapPin, 'League map'],
          ],
        },
        {
          label: 'ADMIN',
          items: [
            [Users, 'Players & families'],
            [ShieldCheck, 'People & access'],
          ],
        },
      ]
    : me.role === 'organiser'
      ? [
          {
            items: [
              [LayoutDashboard, 'Overview'],
              ...(!confirmClubFirst
                ? ([
                    [Users, 'My club'],
                    ...(needsHostingAvailability
                      ? [[CalendarDays, 'Our availability']]
                      : []),
                  ] as [typeof Flag, string][])
                : []),
              ...(!confirmClubFirst &&
              s.fixtures.some((f) => f.status !== 'cancelled')
                ? ([
                    [CalendarDays, 'Fixtures'],
                    [Trophy, 'Leaderboards'],
                  ] as [typeof Flag, string][])
                : []),
            ],
          },
        ]
      : [{ label: 'YOUR SEASON', items: nav }];
  useEffect(() => {
    const modelContext = (document as any).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        modelContext.registerTool(
          {
            name: 'open_golfsixes_fixture',
            title: 'Open GolfSixes fixture',
            description:
              'Open an accessible fixture in the league workspace. This changes navigation only.',
            inputSchema: {
              type: 'object',
              properties: { fixtureId: { type: 'string' } },
              required: ['fixtureId'],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: (input: any) => {
              if (
                !input ||
                Object.keys(input).length !== 1 ||
                typeof input.fixtureId !== 'string' ||
                !s.fixtures.some((f) => f.id === input.fixtureId)
              )
                throw new Error('An accessible fixture ID is required.');
              setFixtureId(input.fixtureId);
              setPage('Fixtures');
              return { fixtureId: input.fixtureId, opened: true };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, [s.fixtures]);
  const testDataState = useRef(s);
  testDataState.current = s;
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!ready || !admin || !context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'add_golfsixes_test_families',
            title: 'Add fictional GolfSixes families',
            description:
              'Administrator-only: add up to eight clearly labelled fictional children and five families per team in the named league. Existing records are preserved; repeating the same league seed does not duplicate it. Creates parent contact records, not sign-in credentials. Only use when the user asks for test data.',
            inputSchema: {
              type: 'object',
              properties: {
                leagueName: { type: 'string' },
                year: { type: 'integer' },
                teamName: {
                  type: 'string',
                  description:
                    'An exact team name to distinguish leagues with the same name and year.',
                },
              },
              required: ['leagueName', 'year'],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: true },
            execute: async (input: any) => {
              if (
                !input ||
                Object.keys(input).some(
                  (k) => !['leagueName', 'year', 'teamName'].includes(k),
                ) ||
                (input.teamName !== undefined &&
                  typeof input.teamName !== 'string') ||
                typeof input.leagueName !== 'string' ||
                !Number.isInteger(input.year)
              )
                throw new Error('A league name and season are required.');
              const originalPlayers = testDataState.current.players;
              const result = await act({
                type: 'add-test-families',
                leagueName: input.leagueName,
                year: input.year,
                teamName: input.teamName,
              });
              setPage('Players & families');
              return {
                summary: result.state.activity[0]?.text,
                totalPlayers: result.state.players.length,
                originalPlayersPreserved: originalPlayers.every((p) =>
                  result.state.players.some(
                    (v: any) =>
                      v.id === p.id && JSON.stringify(v) === JSON.stringify(p),
                  ),
                ),
                families: result.state.members.filter((m: any) =>
                  m.id.startsWith('test-families-v1:'),
                ).length,
                fictionalChildren: result.state.players.filter((p: any) =>
                  p.id.startsWith('test-families-v1:'),
                ).length,
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, [ready, admin, act]);
  async function upload(playerId: string, file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set('workspace', data.workspace);
      form.set('view', view);
      form.set('playerId', playerId);
      form.set('photo', file);
      const r = await fetch('/api/photo', { method: 'POST', body: form });
      const result: any = await r.json();
      if (!r.ok) throw new Error(result.error);
      applyReply(result);
      setNotice('Private identification photo saved.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const header = (title: string, sub: string, action?: React.ReactNode) => (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {action}
    </div>
  );
  return (
    <SidebarProvider>
      <OrganiserGuideProvider key={`${data.workspace}:${me.id}:${me.role}`}>
        <Sidebar>
          <SidebarHeader>
            <div className="brand">
              <Flag />
              <div>
                Golf<span>Sixes</span>
                <small>LEAGUE</small>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            {navGroups.map((group, index) => (
              <div key={group.label || 'results'}>
                {index > 0 && <SidebarSeparator />}
                {group.label && <p className="nav-label">{group.label}</p>}
                <SidebarMenu>
                  {group.items.map(([Icon, label]) => (
                    <SidebarMenuItem key={label}>
                      <AppNavButton
                        data-organiser-nav={label}
                        isActive={page === label}
                        onClick={() => {
                          if (label === 'Teams & players') setReviewTeam('');
                          setPage(label);
                          setFixtureId('');
                          setSearch('');
                        }}
                      >
                        <Icon />
                        <span>
                          {me.role === 'organiser' && label === 'Overview'
                            ? 'Home'
                            : label}
                        </span>
                      </AppNavButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </div>
            ))}
            <div className="sidebar-note">
              <Flag />
              <strong>
                Small teams.
                <br />
                Big possibilities.
              </strong>
              <p>
                Every child. Every shot.
                <br />
                Part of something brilliant.
              </p>
            </div>
          </SidebarContent>
          <SidebarFooter>
            <div className="foundation">
              THE GOLF FOUNDATION<small>Golf for Good</small>
            </div>
          </SidebarFooter>
        </Sidebar>
        <div className="workspace">
          <div id="service-tools-slot" />
          <header className="topbar">
            <div className="row">
              <SidebarTrigger />
              <details className="workspace-picker" key={data.workspace}>
                <summary>
                  <span>
                    <small>Workspace{data.demo ? ' · demo' : ''}</small>
                    <strong>{data.workspaceName}</strong>
                  </span>
                  <ChevronDown size={16} />
                </summary>
                <div className="workspace-picker-panel">
                  <p className="muted">
                    A workspace contains its own clubs, leagues and people.
                  </p>
                  {data.workspaces.length > 1 && !data.demo && (
                    <Pick
                      label="Switch workspace"
                      value={data.workspace}
                      onChange={switchWorkspace}
                      options={data.workspaces.map((w) => ({
                        value: w.id,
                        label: w.name,
                      }))}
                    />
                  )}
                  {admin && (
                    <button
                      className="btn"
                      onClick={(e) => {
                        e.currentTarget
                          .closest('details')
                          ?.removeAttribute('open');
                        edit('rename-workspace', { name: data.workspaceName });
                      }}
                    >
                      Rename workspace
                    </button>
                  )}
                  {admin && (
                    <button
                      className="btn"
                      disabled={data.demo}
                      title={
                        data.demo
                          ? 'Return to the live service to create a workspace.'
                          : undefined
                      }
                      onClick={(e) => {
                        e.currentTarget
                          .closest('details')
                          ?.removeAttribute('open');
                        edit('create-workspace');
                      }}
                    >
                      Create a new workspace
                    </button>
                  )}
                </div>
              </details>
            </div>
            <div className="row">
              {data.canSwitchRoles ? (
                <Pick
                  label="Your view"
                  value={view}
                  onChange={(v) => {
                    if (v === 'parent') {
                      location.href = roleHref(
                        'parent',
                        staffJourney(data.demo, data.workspace),
                      );
                      return;
                    }
                    setView(v);
                    setSeason('');
                    setReviewTeam('');
                    setPage('Overview');
                    setFixtureId('');
                    setReady(false);
                  }}
                  options={[
                    { value: 'admin', label: 'Foundation admin' },
                    { value: 'organiser', label: 'Junior organiser' },
                    { value: 'parent', label: 'Parent' },
                  ]}
                />
              ) : (
                <span className="badge">{me.role.replace('-', ' ')}</span>
              )}
              <button
                className="avatar"
                title="Your contact details"
                aria-label="Your contact details"
                onClick={() => edit('profile', me)}
              >
                {me.name
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')}
              </button>
            </div>
          </header>
          <main className="main">
            {error && (
              <div className="error global-error" role="alert">
                <span>{error}</span>
                <button className="text-link" onClick={() => void refresh()}>
                  Retry
                </button>
                <a className="text-link" target="_top" href={locationSafe()}>
                  Sign in
                </a>
              </div>
            )}
            {join && (
              <section className="card invite-banner">
                <h2>
                  {inviteInfo?.error
                    ? 'Invitation unavailable'
                    : `Join ${inviteInfo?.name || 'your league'}`}
                </h2>
                <p className="muted">
                  {inviteInfo?.error ||
                    `You’re invited as a ${inviteInfo?.role || 'participant'}${inviteInfo?.organisations?.length ? ' for ' + inviteInfo.organisations.join(', ') : ''}.`}
                </p>
                {!inviteInfo?.error && (
                  <button
                    className="btn primary mt-4"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await fetch('/api/invite', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ token: join }),
                        });
                        const b: any = await r.json();
                        if (!r.ok) throw new Error(b.error);
                        setJoin('');
                        applyReply(b);
                        switchWorkspace(b.workspace);
                        setPage(
                          b.me.role === 'parent' ? 'My children' : 'Overview',
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Accept invitation
                  </button>
                )}
              </section>
            )}
            {page === 'Fixtures' && currentFixture ? (
              <FixtureDetail
                key={currentFixture.id}
                f={currentFixture}
                tools={tools}
                back={() => setFixtureId('')}
              />
            ) : (
              <>
                {page === 'Teams & players' && (
                  <FamilyReview
                    key={reviewTeam}
                    tools={tools}
                    initialTeamId={reviewTeam}
                    initialYear={season}
                  />
                )}
                {page === 'Statistics' &&
                  ['admin', 'league-admin'].includes(me.role) && (
                    <Suspense
                      fallback={
                        <p className="notice" role="status">
                          Loading statistics…
                        </p>
                      }
                    >
                      <StatisticsPage tools={tools} initialYear={season} />
                    </Suspense>
                  )}
                {page === 'League map' &&
                  ready &&
                  ['admin', 'league-admin'].includes(me.role) && (
                    <Suspense
                      fallback={
                        <p className="notice" role="status">
                          Loading your league map…
                        </p>
                      }
                    >
                      <LeagueMapPage
                        tools={tools}
                        year={
                          season ||
                          String(
                            Math.max(
                              new Date().getFullYear(),
                              ...s.leagues.map((l) => l.year),
                            ),
                          )
                        }
                        setYear={setSeason}
                        scope={leagueScope}
                        setScope={setLeagueScope}
                        openLeague={openLeague}
                      />
                    </Suspense>
                  )}
                {page === 'Overview' && manage && ready && (
                  <SeasonHome
                    key={`${data.workspace}:${me.role}`}
                    tools={tools}
                    year={
                      season ||
                      String(
                        Math.max(
                          new Date().getFullYear(),
                          ...s.leagues.map((l) => l.year),
                        ),
                      )
                    }
                    setYear={setSeason}
                    scope={leagueScope}
                    setScope={setLeagueScope}
                    openFixture={(id) => {
                      setFixtureId(id);
                      setPage('Fixtures');
                    }}
                    openLeague={openLeague}
                    navigate={setPage}
                    openTeam={(id) => {
                      setReviewTeam(id);
                      setPage('Teams & players');
                    }}
                  />
                )}
                {page === 'Overview' && !manage && (
                  <>
                    <div className="eyebrow">LET’S GET OUT AND PLAY</div>
                    {header(
                      me.role === 'parent'
                        ? 'Your family’s next adventure.'
                        : 'Your league, together.',
                      'A little organisation. A whole lot of golf.',
                      manage ? (
                        <button
                          className="btn primary"
                          disabled={!l || !ready}
                          onClick={() => edit('fixture', { leagueId: league })}
                        >
                          <Plus size={17} />
                          Create fixture
                        </button>
                      ) : (
                        <button
                          className="btn primary"
                          onClick={() => edit('player')}
                        >
                          <Plus size={17} />
                          Register a child
                        </button>
                      ),
                    )}
                    <div className="league-strip">
                      <div className="row">
                        <Flag size={20} />
                        <Pick
                          label="Select a league"
                          value={league}
                          onChange={setLeague}
                          options={s.leagues.map((l) => ({
                            value: l.id,
                            label: `${l.name} · ${l.year}`,
                          }))}
                        />
                        <span className="muted">{l?.year || 'New season'}</span>
                      </div>
                      <span className="badge green">
                        {l ? '● Season in progress' : 'Ready when you are'}
                      </span>
                    </div>
                    {!l ? (
                      <Empty
                        title="Let’s build your first league"
                        action={
                          admin ? (
                            <button
                              className="btn primary"
                              onClick={() => edit('league')}
                            >
                              Create a league
                            </button>
                          ) : (
                            <button
                              className="btn"
                              onClick={() => edit('player')}
                            >
                              Register your child
                            </button>
                          )
                        }
                      >
                        {admin
                          ? 'Set the season and playing format, then bring your clubs and teams together.'
                          : 'Your organiser will add the club’s teams and fixtures here.'}
                      </Empty>
                    ) : (
                      <>
                        <div className="stats">
                          {[
                            [teams.length, 'TEAMS IN THE LEAGUE'],
                            [
                              me.role === 'parent'
                                ? ownPlayers.length
                                : players.length,
                              me.role === 'parent'
                                ? 'YOUR YOUNG GOLFERS'
                                : 'YOUNG GOLFERS',
                            ],
                            [fixtures.length, 'SEASON FIXTURES'],
                            [
                              `${fixtures.filter((f) => f.status === 'completed').length} of ${fixtures.length}`,
                              'FIXTURES COMPLETED',
                            ],
                          ].map(([n, label]) => (
                            <div className="stat" key={label}>
                              <strong>{n}</strong>
                              <span>{label}</span>
                            </div>
                          ))}
                        </div>
                        <div className="dashboard-grid">
                          {active ? (
                            <section className="card next-fixture">
                              <div className="section-top">
                                <span className="eyebrow">
                                  {active.status === 'live'
                                    ? 'OUT ON THE COURSE'
                                    : 'NEXT ON THE TEE'}
                                </span>
                                <Badge status={active.status} />
                              </div>
                              <h2>{active.name}</h2>
                              <p className="muted">
                                {
                                  s.clubs.find((c) => c.id === active.clubId)
                                    ?.name
                                }{' '}
                                · {l.name}
                              </p>
                              <div className="fixture-facts">
                                <span>
                                  <CalendarDays />
                                  {dateLabel(active.date)}
                                </span>
                                <span>
                                  <Clock />
                                  Arrive {active.arrival} · Start {active.start}
                                </span>
                                <span>
                                  <MapPin />
                                  {active.format === 'shotgun'
                                    ? 'Shotgun start'
                                    : 'Tee times'}{' '}
                                  · {l.holes} holes
                                </span>
                              </div>
                              <div className="card-bottom">
                                <span>
                                  {active.pairs.length} of{' '}
                                  {active.teamIds.length * l.pairs} pairs
                                  selected
                                </span>
                                <button
                                  className="btn primary"
                                  onClick={() => openFixture(active)}
                                >
                                  {active.status === 'live'
                                    ? 'Follow the action'
                                    : 'Prepare fixture'}
                                  <ArrowUpRight size={17} />
                                </button>
                              </div>
                            </section>
                          ) : (
                            <section className="card">
                              <Empty
                                title="The fairway is waiting"
                                action={
                                  manage ? (
                                    <button
                                      className="btn primary"
                                      onClick={() =>
                                        edit('fixture', { leagueId: league })
                                      }
                                    >
                                      Add the first fixture
                                    </button>
                                  ) : undefined
                                }
                              >
                                Your next fixture will appear here.
                              </Empty>
                            </section>
                          )}
                          <section className="card">
                            <div className="section-top">
                              <h2>
                                {manage
                                  ? 'Ahead of matchday'
                                  : 'Ready, set, golf'}
                              </h2>
                            </div>
                            {[
                              [
                                manage
                                  ? 'Choose your six players'
                                  : 'Check your child’s details',
                                manage ? 'Fixtures' : 'My children',
                                'Give everyone their time on the course',
                              ],
                              [
                                'Bring the pairs together',
                                'Fixtures',
                                'One partner, one shared scorecard',
                              ],
                              [
                                'Check the welcome details',
                                'Fixtures',
                                'Arrival, food and everything in between',
                              ],
                            ].map(([title, p, sub], i) => (
                              <button
                                className="task-row"
                                key={title}
                                onClick={() => {
                                  setPage(p);
                                  if (p === 'Fixtures' && active)
                                    setFixtureId(active.id);
                                }}
                              >
                                <span className="step">{i + 1}</span>
                                <div>
                                  <strong>{title}</strong>
                                  <small>{sub}</small>
                                </div>
                                <ChevronRight size={17} />
                              </button>
                            ))}
                          </section>
                          <section className="card">
                            <div className="section-top">
                              <h2>League standings</h2>
                              <button
                                className="text-link"
                                onClick={() => setPage('Leaderboards')}
                              >
                                Full table ↗
                              </button>
                            </div>
                            {standings.length ? (
                              standings.slice(0, 5).map((t, i) => (
                                <div className="standing" key={t.id}>
                                  <span className="rank">{i + 1}</span>
                                  <Dot color={t.color} />
                                  <strong>{t.name}</strong>
                                  <b>
                                    {t.points}
                                    <small>pts</small>
                                  </b>
                                </div>
                              ))
                            ) : (
                              <p className="muted">
                                Add teams to start the season table.
                              </p>
                            )}
                          </section>
                          <section className="card season-card">
                            <span className="eyebrow">
                              THREE STEPS TO A GREAT SEASON
                            </span>
                            <h2>
                              Less admin.
                              <br />
                              More high fives.
                            </h2>
                            <p>
                              Bring your clubs together, get your teams ready,
                              and make every hole count.
                            </p>
                            {[
                              ['League setup', 'League settings'],
                              ['Match preparation', 'Fixtures'],
                              ['Play & score', 'Fixtures'],
                            ].map(([t, p], i) => (
                              <button
                                className="phase w-full"
                                key={t}
                                onClick={() => {
                                  setPage(manage ? p : 'Fixtures');
                                  if (i === 2 && active)
                                    setFixtureId(active.id);
                                }}
                              >
                                {t}
                                <span>0{i + 1}</span>
                              </button>
                            ))}
                          </section>
                        </div>
                      </>
                    )}
                  </>
                )}
                {page === 'Fixtures' && (
                  <>
                    {header(
                      l ? `${l.name} · ${l.year}` : 'League fixtures',
                      'Your fixtures and matchday details.',
                      l &&
                        (canLeague(me, l.id) ||
                          s.clubs.some(
                            (c) =>
                              me.orgIds.includes(c.orgId) &&
                              teams.some((t) => t.orgId === c.orgId),
                          )) ? (
                        <button
                          className="btn primary"
                          onClick={() => edit('fixture', { leagueId: league })}
                        >
                          <Plus size={17} />
                          Create fixture
                        </button>
                      ) : undefined,
                    )}
                    <div className="toolbar">
                      <Pick
                        label="League"
                        value={league}
                        onChange={setLeague}
                        options={s.leagues.map((l) => ({
                          value: l.id,
                          label: `${l.name} · ${l.year}`,
                        }))}
                      />
                      <Pick
                        label="Fixture status"
                        value={filter}
                        onChange={setFilter}
                        options={[
                          'upcoming',
                          'all',
                          'scheduled',
                          'live',
                          'completed',
                          'cancelled',
                        ].map((v) => ({
                          value: v,
                          label:
                            v === 'upcoming'
                              ? 'Upcoming fixtures'
                              : v === 'all'
                                ? 'All fixtures'
                                : v === 'scheduled'
                                  ? 'Scheduled (all dates)'
                                  : v[0].toUpperCase() + v.slice(1),
                        }))}
                      />
                    </div>
                    {l && canLeague(me, l.id) && (
                      <FixtureSeasonStatus
                        key={l.id}
                        tools={tools}
                        leagueId={l.id}
                      />
                    )}
                    {l && !canLeague(me, l.id) && !l.fixturesConfirmedAt && (
                      <p className="notice">
                        Provisional dates — your administrator has not confirmed
                        the season fixture list yet. Families can still indicate
                        availability.
                      </p>
                    )}
                    {l &&
                      canLeague(me, l.id) &&
                      !l.fixturesConfirmedAt &&
                      !fixtures.some((f) => f.status !== 'cancelled') && (
                        <FixturePlanner
                          key={l.id}
                          tools={tools}
                          leagueId={l.id}
                        />
                      )}
                    <div className="fixture-list">
                      {fixtures
                        .filter((f) =>
                          filter === 'upcoming'
                            ? ['scheduled', 'live'].includes(f.status) &&
                              f.date >= (s.demoToday || londonDay())
                            : filter === 'all' || f.status === filter,
                        )
                        .map((f) => (
                          <button
                            className="fixture-row"
                            key={f.id}
                            onClick={() => openFixture(f)}
                          >
                            <div className="date-tile">
                              <strong>{f.date.slice(8)}</strong>
                              <span>
                                {new Date(
                                  f.date + 'T12:00:00',
                                ).toLocaleDateString('en-GB', {
                                  month: 'short',
                                })}
                              </span>
                            </div>
                            <div className="grow">
                              <h3>{f.name}</h3>
                              <p>
                                {s.clubs.find((c) => c.id === f.clubId)?.name}
                              </p>
                              <small>
                                Arrive {f.arrival} ·{' '}
                                {f.format === 'shotgun'
                                  ? 'Shotgun'
                                  : 'Tee times'}{' '}
                                {f.start} · {f.teamIds.length} teams
                              </small>
                              {me.role === 'organiser' && (
                                <span className="fixture-duty">
                                  {canHost(s, me, f)
                                    ? 'You’re hosting · Organise all teams and starting times'
                                    : 'Away fixture · Choose your team’s players'}
                                </span>
                              )}
                            </div>
                            <Badge status={f.status} />
                            <ArrowUpRight size={20} />
                          </button>
                        ))}
                    </div>
                    {!fixtures.filter((f) =>
                      filter === 'upcoming'
                        ? ['scheduled', 'live'].includes(f.status) &&
                          f.date >= (s.demoToday || londonDay())
                        : filter === 'all' || f.status === filter,
                    ).length && (
                      <Empty title="No fixtures here yet">
                        Try another status, or add a fixture to the season.
                      </Empty>
                    )}
                  </>
                )}
                {(page === 'My club' || page === 'Our availability') &&
                  me.role === 'organiser' && (
                    <OrganiserHome
                      tools={tools}
                      year={
                        season ||
                        String(
                          Math.max(
                            new Date().getFullYear(),
                            ...s.leagues.map((l) => l.year),
                          ),
                        )
                      }
                      setYear={setSeason}
                      navigate={setPage}
                      openLeague={openLeague}
                      openFixture={(id) => {
                        setFixtureId(id);
                        setPage('Fixtures');
                      }}
                      detailsOnly={page === 'My club'}
                      availabilityOnly={page === 'Our availability'}
                    />
                  )}
                {(page === 'Clubs' ||
                  (page === 'My club' && me.role !== 'organiser')) && (
                  <ClubsDirectory
                    key={data.workspace + me.id}
                    tools={tools}
                    openTeam={openTeam}
                    openLeague={openLeague}
                  />
                )}
                {page === 'Players & families' && (
                  <PlayersDirectory
                    key={data.workspace + me.id}
                    tools={tools}
                    openTeam={openTeam}
                    upload={upload}
                  />
                )}
                {page === 'My children' && (
                  <>
                    {header(
                      me.role === 'parent'
                        ? 'Little golfers. Big adventures.'
                        : 'Your next generation.',
                      'Registrations, family contacts and the details that help every child thrive.',
                      <button
                        className="btn primary"
                        onClick={() => edit('player')}
                      >
                        <Plus size={17} />
                        Register a child
                      </button>,
                    )}
                    <div className="toolbar">
                      <label className="search">
                        <Search size={17} />
                        <input
                          aria-label="Search players"
                          placeholder="Find a young golfer…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      {manage && (
                        <button
                          className="btn"
                          onClick={() => edit('invite', { role: 'parent' })}
                        >
                          <Link size={16} />
                          Parent registration link
                        </button>
                      )}
                    </div>
                    <p className="notice mb-5">
                      <ShieldCheck size={18} />
                      Care details and identification photos are private.
                      Publication consent is shown separately and defaults to
                      no.
                    </p>
                    <div className="player-grid">
                      {s.players
                        .filter(
                          (p) =>
                            p.dob &&
                            (manage || p.parentId === me.id) &&
                            p.name.toLowerCase().includes(search.toLowerCase()),
                        )
                        .map((p) => (
                          <section className="card player-card" key={p.id}>
                            <div className="row">
                              <ChildAvatar
                                player={p}
                                workspace={data.workspace}
                                view={view}
                                size={48}
                              />
                              <div>
                                <h3>{p.name}</h3>
                                <p className="muted">
                                  {s.orgs.find((o) => o.id === p.orgId)?.name}
                                </p>
                              </div>
                            </div>
                            <div className="player-details">
                              <span>
                                Born{' '}
                                <strong>
                                  {new Date(
                                    p.dob + 'T12:00:00',
                                  ).toLocaleDateString('en-GB')}
                                </strong>
                              </span>
                              <span>
                                Handicap{' '}
                                <strong>{p.handicap ?? 'Not yet held'}</strong>
                              </span>
                            </div>
                            <div className="row wrap">
                              <span
                                className={`badge ${p.photoConsent ? 'green' : 'amber'}`}
                              >
                                {p.photoConsent
                                  ? 'Photo publication permitted'
                                  : 'No photo publication'}
                              </span>
                              {p.handicap !== null && p.handicap < 37 && (
                                <span className="badge amber">
                                  Review eligibility
                                </span>
                              )}
                            </div>
                            <details className="care-details">
                              <summary>Care & emergency information</summary>
                              <p>
                                <strong>Diet:</strong>{' '}
                                {p.diet || 'None recorded'}
                              </p>
                              <p>
                                <strong>Additional support:</strong>{' '}
                                {p.care || 'None recorded'}
                              </p>
                              <p>
                                <strong>Emergency:</strong> {p.emergencyName} ·{' '}
                                <a href={`tel:${p.emergencyPhone}`}>
                                  {p.emergencyPhone}
                                </a>
                              </p>
                            </details>
                            {(p.parentId === me.id ||
                              canOrg(s, me, p.orgId)) && (
                              <div className="row wrap mt-4">
                                <button
                                  className="btn small"
                                  onClick={() => edit('player', p)}
                                >
                                  Edit details
                                </button>
                                <label className="text-link upload">
                                  <Upload size={15} />
                                  Identification photo
                                  <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    aria-label={`Upload identification photo for ${p.name}`}
                                    disabled={busy}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) void upload(p.id, file);
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
                              </div>
                            )}
                          </section>
                        ))}
                    </div>
                    {!s.players.some(
                      (p) => p.dob && (manage || p.parentId === me.id),
                    ) && (
                      <Empty title="Your young golfers go here">
                        Register your first child, then add any siblings using
                        the same account.
                      </Empty>
                    )}
                  </>
                )}
                {page === 'Leaderboards' && (
                  <>
                    {header(
                      l ? `${l.name} leaderboard` : 'League leaderboard',
                      l
                        ? `${l.year} season · Finalised fixture results`
                        : 'Choose a league to follow its results.',
                    )}
                    <div className="toolbar">
                      <Pick
                        label="League"
                        value={league}
                        onChange={setLeague}
                        options={s.leagues.map((l) => ({
                          value: l.id,
                          label: `${l.name} · ${l.year}`,
                        }))}
                      />
                      <span className="badge green">
                        {
                          fixtures.filter((f) => f.status === 'completed')
                            .length
                        }{' '}
                        fixtures finalised
                      </span>
                    </div>
                    <section className="card">
                      <div className="section-top">
                        <h2>{l?.name || 'Season standings'}</h2>
                        <Trophy className="text-[#96a559]" />
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Place</TableHead>
                            <TableHead>Team</TableHead>
                            <TableHead>Played</TableHead>
                            <TableHead>Wins</TableHead>
                            <TableHead>Game points</TableHead>
                            <TableHead>League points</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {standings.map((t, i) => (
                            <TableRow key={t.id}>
                              <TableCell>
                                {standings.findIndex(
                                  (v) =>
                                    v.points === t.points &&
                                    v.gamePoints === t.gamePoints,
                                ) + 1}
                              </TableCell>
                              <TableCell>
                                <span className="row">
                                  <Dot color={t.color} />
                                  <strong>{t.name}</strong>
                                </span>
                              </TableCell>
                              <TableCell>{t.played}</TableCell>
                              <TableCell>{t.wins}</TableCell>
                              <TableCell>{t.gamePoints}</TableCell>
                              <TableCell>
                                <strong className="league-points">
                                  {t.points}
                                </strong>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <p className="muted mt-5">
                        Only finalised fixtures count. Teams are ranked by
                        league points, then total game points; any remaining
                        ties share a place.
                      </p>
                    </section>
                    <h2 className="mt-8 mb-4">Matchday results</h2>
                    <div className="fixture-list">
                      {fixtures
                        .filter((f) => ['live', 'completed'].includes(f.status))
                        .map((f) => (
                          <button
                            className="fixture-row"
                            key={f.id}
                            onClick={() => openFixture(f)}
                          >
                            <Trophy size={20} />
                            <div className="grow">
                              <h3>{f.name}</h3>
                              <p>{dateLabel(f.date)}</p>
                            </div>
                            <Badge status={f.status} />
                            <ArrowUpRight size={18} />
                          </button>
                        ))}
                    </div>
                  </>
                )}
                {['People & access', 'Contacts'].includes(page) && (
                  <>
                    {manage && <LoginHelpQueue tools={tools} history />}
                    {header(
                      'The people behind the play.',
                      'Find the right contact, bring organisers together, and welcome families.',
                      manage ? (
                        <button
                          className="btn primary"
                          onClick={() => edit('invite')}
                        >
                          <Plus size={16} />
                          Invite someone
                        </button>
                      ) : undefined,
                    )}
                    <div className="people-grid">
                      {s.members.map((m) => (
                        <section className="card" key={m.id}>
                          <div className="row">
                            <span className="avatar">
                              {m.name
                                .split(' ')
                                .map((v) => v[0])
                                .slice(0, 2)
                                .join('')}
                            </span>
                            <div>
                              <h3>{m.name}</h3>
                              <span className="badge mt-2">
                                {m.role === 'admin'
                                  ? 'Overall Foundation admin'
                                  : m.role === 'league-admin'
                                    ? 'League administrator'
                                    : m.role === 'organiser'
                                      ? 'Junior organiser'
                                      : 'Parent / guardian'}
                              </span>
                            </div>
                          </div>
                          <div className="contact-details">
                            <a href={`mailto:${m.email}`}>
                              <Mail size={16} />
                              {m.email}
                            </a>
                            {m.phone && (
                              <a href={`tel:${m.phone}`}>
                                <Phone size={16} />
                                {m.phone}
                              </a>
                            )}
                          </div>
                          <p className="muted">
                            {m.role === 'admin'
                              ? 'All leagues'
                              : m.leagueIds
                                  .map(
                                    (id) =>
                                      s.leagues.find((l) => l.id === id)?.name,
                                  )
                                  .concat(
                                    m.orgIds.map(
                                      (id) =>
                                        s.orgs.find((o) => o.id === id)?.name,
                                    ),
                                  )
                                  .filter(Boolean)
                                  .join(' · ')}
                          </p>
                          {admin && m.id !== me.id && (
                            <button
                              className="btn small mt-4"
                              onClick={() => edit('member', m)}
                            >
                              Manage access
                            </button>
                          )}
                        </section>
                      ))}
                    </div>
                    {manage && s.invites.length > 0 && (
                      <section className="card mt-6">
                        <h2>Invitation links</h2>
                        <InvitationList tools={tools} />
                      </section>
                    )}
                  </>
                )}
                {page === 'League settings' && (
                  <>
                    {header(
                      'Set up a brilliant season.',
                      'Choose the playing format and give your clubs a shared starting point.',
                      admin ? (
                        <button
                          className="btn primary"
                          onClick={() => edit('league')}
                        >
                          <Plus size={16} />
                          New league
                        </button>
                      ) : undefined,
                    )}
                    <div className="stack">
                      {s.leagues.map((l) => (
                        <section className="card" key={l.id}>
                          <div className="section-top">
                            <div>
                              <h2>{l.name}</h2>
                              <p className="muted mt-2">
                                {l.region} · {l.year}
                              </p>
                            </div>
                            {canLeague(me, l.id) && (
                              <button
                                className="btn"
                                onClick={() => edit('league', l)}
                              >
                                Edit settings
                              </button>
                            )}
                          </div>
                          <div className="rule-grid">
                            <div>
                              <strong>{l.holes}</strong>
                              <span>scoring holes</span>
                            </div>
                            <div>
                              <strong>{l.pairs}</strong>
                              <span>pairs per team</span>
                            </div>
                            <div>
                              <strong>{l.maxStrokes}</strong>
                              <span>stroke limit</span>
                            </div>
                            <div>
                              <strong>{l.pairs * 2}</strong>
                              <span>players on matchday</span>
                            </div>
                          </div>
                          <p className="muted mt-5">
                            Texas Scramble ·{' '}
                            {l.tiePolicy === 'countback'
                              ? 'Countback: last 3, 2, then 1 holes'
                              : l.tiePolicy === 'average'
                                ? 'Average points for tied positions'
                                : 'Shared-place points'}{' '}
                            · Season ties use total game points
                          </p>
                        </section>
                      ))}
                      <section className="card research-card">
                        <div className="row mb-4">
                          <BookOpen />
                          <h2>Grounded in GolfSixes</h2>
                        </div>
                        <p>
                          The Foundation’s format brings beginner golfers
                          together in pairs over six shortened holes. A team’s
                          three pair scores combine into its fixture result,
                          then its placing earns league points.
                        </p>
                        <p className="mt-3">
                          The programme is intended for players with no handicap
                          or a handicap of 37 and above. Clubs should be
                          SafeGolf accredited and have a nominated welfare
                          officer.
                        </p>
                        <p className="mt-3">
                          This app allows multiple teams and joint-club
                          organisations, flexible hosting, and configurable
                          league formats. Tied fixture places use your league’s
                          chosen rule.
                        </p>
                        <div className="row wrap mt-5">
                          <a
                            className="text-link"
                            href="https://www.golf-foundation.org/golfsixes-league/"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Official GolfSixes guidance ↗
                          </a>
                          <a
                            className="text-link"
                            href="https://golffoundation.b-cdn.net/wp-content/uploads/2024/02/GolfSixes-League-FAQ-Team-Managers.pdf"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Team manager FAQs ↗
                          </a>
                        </div>
                      </section>
                    </div>
                  </>
                )}
              </>
            )}
            <footer className="page-footer">
              <span>Made for the moments that grow the game.</span>
              <a
                href="https://www.golf-foundation.org/golfsixes-league/"
                target="_blank"
                rel="noreferrer"
              >
                GolfSixes guide ↗
              </a>
            </footer>
          </main>
        </div>
        {ready && admin && tools.workspace && (
          <AdminAssistant key={tools.workspace} tools={tools} />
        )}
        {editor && (
          <EditDialog
            key={`${editor.kind}-${editor.data.id || 'new'}`}
            editor={editor}
            close={() => setEditor(null)}
            tools={tools}
            onCreated={(r) => switchWorkspace(r.workspace)}
          />
        )}{' '}
        {notice && (
          <div className="toast" role="status">
            ✓ {notice}
          </div>
        )}
      </OrganiserGuideProvider>
    </SidebarProvider>
  );
}
function locationSafe() {
  return typeof location === 'undefined'
    ? '/'
    : location.pathname + location.search;
}
