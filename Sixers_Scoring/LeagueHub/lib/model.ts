import { applyDeskAction, type RegistrationDesk } from './registration-desk';
import { clubWebsite } from './club-images';
import {
  validateStartSettings,
  startingPairsKey,
  type StartSettings,
} from './starting-allocations';
import {
  applySupportAction,
  canReadSupport,
  type SupportTicket,
} from './support';
import { addTestFamilies, addTestOrganisers } from './test-families';
import {
  planningKey,
  suggestFixtures,
  reviewFixtureDraft,
  type HostingOffer,
  type FixturePlanSettings,
} from './season-planning';
export type Role = 'admin' | 'league-admin' | 'organiser' | 'parent';
export type Member = {
  organiserOrgId?: string;
  organiserOrgIds?: string[];
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  leagueIds: string[];
  orgIds: string[];
};
export type League = {
  fixturesConfirmedAt?: string;
  fixturesConfirmedBy?: string;
  fixturePlanning?: FixturePlanSettings;
  adminId?: string;
  assistantId?: string;
  squadSize?: number;
  registrationOpen?: boolean;
  id: string;
  name: string;
  region: string;
  year: number;
  holes: number;
  pairs: number;
  maxStrokes: number;
  tiePolicy: 'average' | 'shared' | 'countback';
  status: string;
};
export type Club = {
  confirmedAt?: string;
  confirmedBy?: string;
  logoKey?: string;
  logoStatus?: string;
  logoMessage?: string;
  logoOriginal?: boolean;
  website?: string;
  imageKey?: string;
  imageSource?: string;
  imageStatus?: 'pending' | 'ready' | 'unavailable' | 'manual' | 'none';
  imageJobId?: string;
  imageRequestedAt?: string;
  county?: string;
  postcode?: string;
  id: string;
  orgId: string;
  name: string;
  address: string;
  instructions: string;
  welfareName: string;
  welfareEmail: string;
  safeGolf: boolean;
};
export type Org = { id: string; name: string };
function websiteFields(value: unknown, old?: Club): Partial<Club> {
  let website: string;
  try {
    website = clubWebsite(value);
  } catch {
    throw new AppError('Enter a public club website using https://.');
  }
  if (website === (old?.website || '')) return { website };
  return {
    website,
    imageKey: undefined,
    imageSource: undefined,
    imageStatus: website ? 'pending' : 'none',
    imageJobId: crypto.randomUUID(),
    imageRequestedAt: new Date().toISOString(),
  };
}
export type Team = {
  withdrawnAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  enrollmentOpen?: boolean;
  id: string;
  orgId: string;
  leagueId: string;
  name: string;
  color: string;
  cap: string;
};
export type Player = {
  gender?: 'boy' | 'girl' | 'another' | 'prefer-not-to-say' | '';
  familyManaged?: boolean;
  id: string;
  orgId: string;
  name: string;
  dob: string;
  handicap: number | null;
  parentId: string;
  diet: string;
  care: string;
  photoConsent: boolean;
  photoKey?: string;
  emergencyName: string;
  emergencyPhone: string;
  consentAt: string;
};
export type Pair = {
  id: string;
  teamId: string;
  players: string[];
  slotId: string;
};
export type Slot = {
  id: string;
  label: string;
  capacity: number;
  startHole?: number;
  startTime?: string;
};
export type Score = {
  strokes: number;
  version: number;
  by: string;
  at: string;
};
export type Result = {
  teamId: string;
  points: number;
  leaguePoints: number;
  rank: number;
};
export type Fixture = {
  desk?: RegistrationDesk;
  startSettings?: StartSettings;
  id: string;
  leagueId: string;
  clubId: string;
  name: string;
  date: string;
  arrival: string;
  start: string;
  registration: boolean;
  format: 'shotgun' | 'tee-times';
  foodBefore: string;
  foodAfter: string;
  instructions: string;
  status: 'scheduled' | 'live' | 'completed' | 'cancelled';
  teamIds: string[];
  pairs: Pair[];
  slots: Slot[];
  scores: Record<string, Score>;
  results: Result[];
  finalisedAt?: string;
};
export type Invite = {
  acceptedAt?: string;
  acceptedBy?: string;
  sentAt?: string;
  id: string;
  hash: string;
  role: Role;
  orgIds: string[];
  leagueIds: string[];
  email: string;
  expires: string;
  revoked: boolean;
};
export type State = {
  supportTickets?: SupportTicket[];
  demoSandbox?: boolean;
  demoToday?: string;
  hostingOffers?: HostingOffer[];
  fixtureConfirmations?: {
    fixtureId: string;
    playerId: string;
    selection: string;
    confirmedAt: string;
  }[];
  fixtureMessages?: FixtureMessage[];
  accessRequests?: AccessRequest[];
  loginHelpRequests?: LoginHelpRequest[];
  enrollments?: Enrollment[];
  availability?: Availability[];
  reserves?: Reserve[];
  notifications?: Notice[];
  profileChanges?: ProfileChange[];
  leagues: League[];
  orgs: Org[];
  clubs: Club[];
  teams: Team[];
  players: Player[];
  fixtures: Fixture[];
  members: Member[];
  invites: Invite[];
  activity: { id: string; at: string; by: string; text: string }[];
};
export type Enrollment = {
  clubRequest?: boolean;
  preference?: string;
  approvedAt?: string;
  id: string;
  playerId: string;
  teamId: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'removed';
  requestedAt: string;
  decidedAt?: string;
  reason?: string;
};
export type AccessRequest = {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: 'organiser' | 'admin';
  orgId: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  decidedAt?: string;
};
export type LoginHelpRequest = {
  id: string;
  orgId: string;
  name: string;
  phone: string;
  email: string;
  reason: 'forgot-email' | 'no-code' | 'lost-email' | 'other';
  status: 'new' | 'contacted' | 'resolved';
  requestedAt: string;
  updatedAt?: string;
  updatedBy?: string;
};
export function canHelpLogin(s: State, m: Member, orgId: string) {
  return (
    m.role === 'admin' || (m.role === 'organiser' && m.orgIds.includes(orgId))
  );
}
export type Availability = {
  fixtureId: string;
  playerId: string;
  status: 'yes' | 'no' | 'unsure';
  updatedAt: string;
  updatedBy?: string;
};
export type Reserve = { fixtureId: string; teamId: string; playerId: string };
export type Notice = {
  supportTicketId?: string;
  id: string;
  recipient: string;
  text: string;
  createdAt: string;
  readAt?: string;
  fixtureId?: string;
};
export type FixtureMessage = {
  id: string;
  fixtureId: string;
  teamId: string;
  playerId: string;
  audience?: 'team' | 'host';
  authorId: string;
  authorName: string;
  fromParent: boolean;
  text: string;
  createdAt: string;
};
export function canReadFixtureMessage(
  s: State,
  m: Member,
  message: Pick<FixtureMessage, 'playerId' | 'teamId'> &
    Partial<Pick<FixtureMessage, 'fixtureId' | 'audience'>>,
) {
  return m.role === 'parent'
    ? s.players.some((p) => p.id === message.playerId && p.parentId === m.id)
    : canManageTeam(s, m, message.teamId) ||
        (message.audience === 'host' &&
          s.fixtures.some(
            (f) => f.id === message.fixtureId && canHost(s, m, f),
          ));
}
export function selectionKey(f: Fixture, playerId: string) {
  const pair = f.pairs.find((p) => p.players.includes(playerId));
  return pair
    ? JSON.stringify([
        pair.teamId,
        [...pair.players].sort(),
        f.date,
        f.arrival,
        f.start,
        pair.slotId,
        f.slots.find((v) => v.id === pair.slotId)?.label || '',
      ])
    : '';
}
export function selectionConfirmed(s: State, f: Fixture, playerId: string) {
  const key = selectionKey(f, playerId);
  return (
    !!key &&
    !!s.fixtureConfirmations?.some(
      (c) =>
        c.fixtureId === f.id && c.playerId === playerId && c.selection === key,
    )
  );
}
export type ProfileChange = {
  id: string;
  playerId: string;
  proposed: Player;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  reason?: string;
};
export function rosterEligible(s: State, playerId: string, teamId: string) {
  const p = s.players.find((p) => p.id === playerId),
    t = s.teams.find((t) => t.id === teamId);
  if (!p || !t) return false;
  if (!s.enrollments) return p.orgId === t.orgId;
  return s.enrollments.some(
    (e) =>
      e.playerId === playerId && e.teamId === teamId && e.status === 'approved',
  );
}
export function notify(
  s: State,
  recipients: string[],
  message: string,
  fixtureId?: string,
) {
  s.notifications ??= [];
  for (const recipient of new Set(recipients))
    s.notifications.unshift({
      id: crypto.randomUUID(),
      recipient,
      text: message,
      fixtureId,
      createdAt: new Date().toISOString(),
    });
}
export function canManageTeam(s: State, m: Member, teamId: string) {
  const t = s.teams.find((t) => t.id === teamId);
  return (
    !!t &&
    (canLeague(m, t.leagueId) ||
      (m.role === 'organiser' && m.orgIds.includes(t.orgId)))
  );
}
export function teamManagers(s: State, teamId: string) {
  const t = s.teams.find((t) => t.id === teamId);
  return t
    ? s.members
        .filter(
          (m) =>
            canLeague(m, t.leagueId) ||
            (m.role === 'organiser' && m.orgIds.includes(t.orgId)),
        )
        .map((m) => m.id)
    : [];
}
export function organiserClubs(m: Member): string[] {
  return m.role === 'organiser'
    ? m.orgIds
    : m.role === 'admin'
      ? (m.organiserOrgIds ?? (m.organiserOrgId ? [m.organiserOrgId] : []))
      : [];
}
export function addOrganiserClubs(m: Member, orgIds: string[]) {
  m.organiserOrgIds = [...new Set([...organiserClubs(m), ...orgIds])];
  m.organiserOrgId = m.organiserOrgIds[0];
}
export function upgradeState(s: State) {
  for (const member of s.members) {
    if (
      member.role === 'admin' &&
      member.organiserOrgIds === undefined &&
      (member.organiserOrgId ||
        s.invites.some(
          (i) =>
            i.role === 'organiser' &&
            i.acceptedAt &&
            i.acceptedBy === member.id &&
            !i.revoked,
        ))
    ) {
      // Recover previously accepted club invitations lost by the old single-club field.
      addOrganiserClubs(
        member,
        s.invites
          .filter(
            (i) =>
              i.role === 'organiser' &&
              i.acceptedAt &&
              i.acceptedBy === member.id &&
              !i.revoked,
          )
          .flatMap((i) => i.orgIds)
          .filter((id) => s.orgs.some((o) => o.id === id)),
      );
    }
  }
  for (const team of s.teams) {
    const cap = findCap(team.cap);
    if (cap) Object.assign(team, cap);
  }
  if (!s.enrollments) {
    s.enrollments = [];
    const last = new Map<string, { playerId: string; teamId: string }>();
    for (const f of [...s.fixtures].sort((a, b) =>
      a.date.localeCompare(b.date),
    ))
      for (const pair of f.pairs)
        for (const playerId of pair.players)
          last.set(`${playerId}:${f.leagueId}`, {
            playerId,
            teamId: pair.teamId,
          });
    for (const e of last.values())
      s.enrollments.push({
        id: `legacy-${e.playerId}-${e.teamId}`,
        ...e,
        status: 'approved',
        requestedAt: '2026-01-01T00:00:00Z',
      });
  }
  s.availability ??= [];
  for (const entry of s.enrollments)
    if (entry.status === 'approved')
      entry.approvedAt ??= entry.decidedAt || entry.requestedAt;
  s.reserves ??= [];
  s.notifications ??= [];
  s.profileChanges ??= [];
  return s;
}
export type Action = { type: string; [key: string]: any };
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function requireThat(
  value: unknown,
  message: string,
  status = 400,
): asserts value {
  if (!value) throw new AppError(message, status);
}
export const emptyState = (): State => ({
  leagues: [],
  orgs: [],
  clubs: [],
  teams: [],
  players: [],
  fixtures: [],
  members: [],
  invites: [],
  activity: [],
});
export function canLeague(m: Member, id: string) {
  return (
    m.role === 'admin' ||
    (m.role === 'league-admin' && m.leagueIds.includes(id))
  );
}
export const MAX_LEAGUE_TEAMS = 6;
export const CAP_COLOURS = [
  { cap: 'Red', color: '#d95358' },
  { cap: 'Green', color: '#00816b' },
  { cap: 'Royal blue', color: '#5daaff' },
  { cap: 'Navy', color: '#1e5cbb' },
  { cap: 'Orange', color: '#e57c28' },
  { cap: 'Black', color: '#202124' },
];
function findCap(value: string) {
  const name = value.trim().toLowerCase();
  return CAP_COLOURS.find(
    (c) => c.cap.toLowerCase() === (name === 'blue' ? 'royal blue' : name),
  );
}
export function capOrder(a: Team, b: Team) {
  const index = (t: Team) => {
    const cap = findCap(t.cap);
    return cap ? CAP_COLOURS.indexOf(cap) : CAP_COLOURS.length;
  };
  return index(a) - index(b) || a.name.localeCompare(b.name);
}
export function availableCaps(s: State, leagueId: string, exceptId?: string) {
  return CAP_COLOURS.filter(
    (c) =>
      !s.teams.some(
        (t) =>
          !t.withdrawnAt &&
          t.leagueId === leagueId &&
          t.id !== exceptId &&
          (findCap(t.cap)?.cap === c.cap || t.color.toLowerCase() === c.color),
      ),
  );
}
export function responsibleForLeague(m: Member, l: League) {
  return (
    l.adminId === m.id ||
    l.assistantId === m.id ||
    (!l.adminId && !l.assistantId && m.leagueIds.includes(l.id))
  );
}
export function leagueHasTeamSpace(s: State, leagueId: string) {
  return (
    s.leagues.some((l) => l.id === leagueId) &&
    s.teams.filter((t) => !t.withdrawnAt && t.leagueId === leagueId).length <
      MAX_LEAGUE_TEAMS
  );
}
export function leagueAcceptsRegistrations(l: League | undefined) {
  return !!l && (l.registrationOpen ?? l.year >= new Date().getFullYear());
}
export function canOrg(s: State, m: Member, id: string) {
  return (
    m.role === 'admin' ||
    (m.role === 'organiser' && m.orgIds.includes(id)) ||
    (m.role === 'league-admin' &&
      s.teams.some((t) => t.orgId === id && m.leagueIds.includes(t.leagueId)))
  );
}
export function canHost(s: State, m: Member, f: Fixture) {
  return (
    canLeague(m, f.leagueId) ||
    (m.role === 'organiser' &&
      m.orgIds.includes(s.clubs.find((c) => c.id === f.clubId)?.orgId || ''))
  );
}
export function canPlayer(s: State, m: Member, p: Player) {
  return (
    (m.role === 'parent' && p.parentId === m.id) ||
    (s.enrollments
      ? s.enrollments.some(
          (e) =>
            e.playerId === p.id &&
            ['pending', 'approved'].includes(e.status) &&
            m.role !== 'parent' &&
            canManageTeam(s, m, e.teamId),
        ) || m.role === 'admin'
      : canOrg(s, m, p.orgId)) ||
    s.fixtures.some(
      (f) =>
        ['scheduled', 'live'].includes(f.status) &&
        canHost(s, m, f) &&
        (f.pairs.some((q) => q.players.includes(p.id)) ||
          f.desk?.entries.some((e) => e.playerId === p.id) ||
          s.reserves?.some((r) => r.fixtureId === f.id && r.playerId === p.id)),
    )
  );
}
export function accessibleLeagues(s: State, m: Member) {
  return s.leagues.filter(
    (l) =>
      m.role === 'league-admin' ||
      canLeague(m, l.id) ||
      (m.role === 'parent' &&
        s.enrollments?.some(
          (e) =>
            s.players.some((p) => p.id === e.playerId && p.parentId === m.id) &&
            s.teams.some((t) => t.id === e.teamId && t.leagueId === l.id),
        )) ||
      (['organiser', 'parent'].includes(m.role) &&
        s.teams.some(
          (t) =>
            t.leagueId === l.id &&
            (m.orgIds.includes(t.orgId) ||
              (m.role === 'parent' &&
                s.players.some(
                  (p) => p.orgId === t.orgId && p.parentId === m.id,
                ))),
        )),
  );
}
export function projectState(s: State, m: Member): State {
  const ids = accessibleLeagues(s, m).map((l) => l.id);
  const orgIds = new Set([
    ...(['parent', 'organiser'].includes(m.role) ? m.orgIds : []),
    ...(m.role === 'organiser'
      ? s.teams
          .filter((t) =>
            s.fixtures.some(
              (f) =>
                ids.includes(f.leagueId) &&
                canHost(s, m, f) &&
                f.teamIds.includes(t.id),
            ),
          )
          .map((t) => t.orgId)
      : s.teams.filter((t) => ids.includes(t.leagueId)).map((t) => t.orgId)),
  ]);
  const fixtures = s.fixtures.filter((f) => ids.includes(f.leagueId));
  const visiblePlayers = s.players.filter(
    (p) =>
      canPlayer(s, m, p) ||
      (m.role !== 'league-admin' &&
        fixtures.some((f) => f.pairs.some((q) => q.players.includes(p.id)))),
  );
  return {
    ...s,
    supportTickets: s.supportTickets?.filter((t) => canReadSupport(s, m, t)),
    hostingOffers: s.hostingOffers?.filter(
      (o) =>
        canLeague(m, o.leagueId) ||
        (m.role === 'organiser' &&
          s.clubs.some((c) => c.id === o.clubId && m.orgIds.includes(c.orgId))),
    ),
    fixtureMessages: s.fixtureMessages?.filter((message) =>
      canReadFixtureMessage(s, m, message),
    ),
    fixtureConfirmations: s.fixtureConfirmations?.filter((c) =>
      s.players.some((p) => p.id === c.playerId && canPlayer(s, m, p)),
    ),
    loginHelpRequests: s.loginHelpRequests?.filter((r) =>
      canHelpLogin(s, m, r.orgId),
    ),
    accessRequests: s.accessRequests?.filter(
      (r) => m.role === 'admin' || r.userId === m.id,
    ),
    enrollments: s.enrollments?.filter(
      (e) =>
        (m.role === 'parent' &&
          s.players.some((p) => p.id === e.playerId && p.parentId === m.id)) ||
        (m.role !== 'parent' && canManageTeam(s, m, e.teamId)) ||
        s.fixtures.some(
          (f) =>
            canHost(s, m, f) &&
            (f.pairs.some(
              (p) => p.teamId === e.teamId && p.players.includes(e.playerId),
            ) ||
              s.reserves?.some(
                (r) =>
                  r.fixtureId === f.id &&
                  r.teamId === e.teamId &&
                  r.playerId === e.playerId,
              )),
        ),
    ),
    availability: s.availability?.filter((a) =>
      s.players.some((p) => p.id === a.playerId && canPlayer(s, m, p)),
    ),
    reserves: s.reserves?.filter(
      (a) =>
        (m.role === 'parent' &&
          s.players.some((p) => p.id === a.playerId && p.parentId === m.id)) ||
        (m.role !== 'parent' && canManageTeam(s, m, a.teamId)) ||
        s.fixtures.some((f) => f.id === a.fixtureId && canHost(s, m, f)),
    ),
    notifications: s.notifications?.filter((n) => n.recipient === m.id),
    profileChanges: s.profileChanges?.filter((c) =>
      s.players.some((p) => p.id === c.playerId && canPlayer(s, m, p)),
    ),
    leagues: s.leagues.filter((l) => ids.includes(l.id)),
    orgs: s.orgs.filter(
      (o) =>
        m.role === 'league-admin' || orgIds.has(o.id) || canOrg(s, m, o.id),
    ),
    clubs: s.clubs.filter(
      (c) =>
        m.role === 'league-admin' ||
        orgIds.has(c.orgId) ||
        canOrg(s, m, c.orgId) ||
        fixtures.some((f) => f.clubId === c.id),
    ),
    teams: s.teams.filter((t) => ids.includes(t.leagueId)),
    fixtures: fixtures.map((f) =>
      canHost(s, m, f) ? f : { ...f, desk: undefined },
    ),
    players: visiblePlayers.map((p) =>
      canPlayer(s, m, p)
        ? p
        : {
            id: p.id,
            orgId: p.orgId,
            name: p.name.split(' ')[0],
            dob: '',
            handicap: null,
            parentId: '',
            diet: '',
            care: '',
            photoConsent: false,
            emergencyName: '',
            emergencyPhone: '',
            consentAt: '',
          },
    ),
    members: s.members
      .filter(
        (p) =>
          p.id === m.id ||
          (p.role !== 'parent' &&
            s.leagues.some(
              (l) =>
                ids.includes(l.id) && [l.adminId, l.assistantId].includes(p.id),
            )) ||
          (['admin', 'league-admin'].includes(m.role) &&
            ['admin', 'league-admin'].includes(p.role)) ||
          (p.role !== 'parent' &&
            (p.role === 'admin' ||
              p.leagueIds.some((id) => ids.includes(id)) ||
              p.orgIds.some((id) => orgIds.has(id)))) ||
          (p.role === 'parent' &&
            s.players.some((c) => c.parentId === p.id && canPlayer(s, m, c))),
      )
      .map((p) => ({ ...(p.id === m.id ? m : p) })),
    invites: s.invites
      .filter(
        (i) =>
          m.role === 'admin' ||
          i.orgIds.some((id) => canOrg(s, m, id)) ||
          i.leagueIds.some((id) => canLeague(m, id)),
      )
      .map((i) => ({ ...i, hash: '' })),
    activity:
      m.role === 'parent'
        ? []
        : s.activity
            .filter((a) => m.role === 'admin' || a.by === m.id)
            .slice(0, 30),
  };
}
export function text(v: any, name: string, max = 500, required = true) {
  requireThat(
    typeof v === 'string' &&
      v.length <= max &&
      (!required || v.trim().length > 0),
    `${name} is required and must be at most ${max} characters.`,
  );
  return v.trim();
}
function integer(v: any, min: number, max: number, name: string) {
  requireThat(
    Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max,
    `${name} must be between ${min} and ${max}.`,
  );
  return Number(v);
}
function unique(v: string[]) {
  return new Set(v).size === v.length;
}
function checkEmail(v: string) {
  requireThat(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    'Enter a valid email address.',
  );
  return v.toLowerCase();
}
function time(v: any) {
  requireThat(/^([01]\d|2[0-3]):[0-5]\d$/.test(v), 'Enter a valid time.');
  return v;
}
function date(v: any) {
  requireThat(
    typeof v === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    'Enter a valid date.',
  );
  return v;
}
export function points(strokes: number, max = 10) {
  return max + 1 - strokes;
}
export function fixtureResults(s: State, f: Fixture): Result[] {
  const l = s.leagues.find((l) => l.id === f.leagueId)!;
  const countback = (teamId: string, holes: number) =>
    f.pairs
      .filter((p) => p.teamId === teamId)
      .reduce(
        (sum, p) =>
          sum +
          Array.from(
            { length: holes },
            (_, i) => f.scores[`${p.id}:${l.holes - i}`],
          ).reduce((n, v) => n + (v ? points(v.strokes, l.maxStrokes) : 0), 0),
        0,
      );
  const compare = (
    a: { teamId: string; points: number },
    b: { teamId: string; points: number },
  ) => {
    if (a.points !== b.points) return b.points - a.points;
    if ((l.tiePolicy || 'countback') === 'countback')
      for (const holes of [3, 2, 1].filter((n) => n < l.holes)) {
        const difference =
          countback(b.teamId, holes) - countback(a.teamId, holes);
        if (difference) return difference;
      }
    return 0;
  };
  const rows = f.teamIds
    .map((teamId) => ({
      teamId,
      points: f.pairs
        .filter((p) => p.teamId === teamId)
        .reduce(
          (sum, p) =>
            sum +
            Array.from(
              { length: l.holes },
              (_, h) => f.scores[`${p.id}:${h + 1}`],
            ).reduce(
              (n, v) => n + (v ? points(v.strokes, l.maxStrokes) : 0),
              0,
            ),
          0,
        ),
      rank: 0,
      leaguePoints: 0,
    }))
    .sort(compare);
  return rows.map((r) => {
    const first = rows.findIndex((q) => compare(q, r) === 0);
    const tied = rows.filter((q) => compare(q, r) === 0).length;
    return {
      ...r,
      rank: first + 1,
      leaguePoints:
        rows.length - first - (l.tiePolicy !== 'shared' ? (tied - 1) / 2 : 0),
    };
  });
}
export function leagueStandings(s: State, id: string) {
  return s.teams
    .filter(
      (t) =>
        t.leagueId === id &&
        (!t.withdrawnAt ||
          s.fixtures.some(
            (f) =>
              f.status === 'completed' &&
              f.results.some((r) => r.teamId === t.id),
          )),
    )
    .map((t) => {
      const results = s.fixtures
        .filter((f) => f.leagueId === id && f.status === 'completed')
        .flatMap((f) => f.results.filter((r) => r.teamId === t.id));
      return {
        ...t,
        name: t.withdrawnAt ? `${t.name} (withdrawn)` : t.name,
        played: results.length,
        points: results.reduce((n, r) => n + r.leaguePoints, 0),
        gamePoints: results.reduce((n, r) => n + r.points, 0),
        wins: results.filter((r) => r.rank === 1).length,
      };
    })
    .sort((a, b) => b.points - a.points || b.gamePoints - a.gamePoints);
}
export function readiness(s: State, f: Fixture) {
  const l = s.leagues.find((l) => l.id === f.leagueId)!;
  const issues: string[] = [];
  if (f.teamIds.length < 2)
    issues.push('Choose at least two participating teams.');
  for (const tid of f.teamIds) {
    const pairs = f.pairs.filter((p) => p.teamId === tid);
    if (pairs.length !== l.pairs || pairs.some((p) => p.players.length !== 2))
      issues.push(
        `${s.teams.find((t) => t.id === tid)?.name}: select ${l.pairs * 2} players in ${l.pairs} pairs.`,
      );
  }
  if (f.pairs.some((p) => !f.slots.some((slot) => slot.id === p.slotId)))
    issues.push('Allocate every pair to a starting slot.');
  for (const slot of f.slots) {
    const n = f.pairs.filter((p) => p.slotId === slot.id).length;
    if (n < 2 || n > slot.capacity)
      issues.push(
        `${slot.label}: allocate between 2 and ${slot.capacity} pairs.`,
      );
  }
  return issues;
}
/** Published fixtures accept scores from their match date; viewing alone is read-only. */
export function fixtureScoringOpen(
  s: State,
  f: Fixture,
  today = s.demoToday ||
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(
      new Date(),
    ),
) {
  return (
    f.status === 'live' ||
    (f.status === 'scheduled' &&
      f.date <= today &&
      !!s.leagues.find((league) => league.id === f.leagueId)
        ?.fixturesConfirmedAt)
  );
}

export function applyAction(
  source: State,
  m: Member,
  a: Action,
  now = new Date().toISOString(),
  viewingDate?: string,
): State {
  if (a.type.startsWith('desk-')) return applyDeskAction(source, m, a, now);
  if (a.type.startsWith('support-'))
    return applySupportAction(source, m, a, now);
  if (
    [
      'enrollment-transfer',
      'enrollment-add',
      'enrollment-decision',
      'enrollment-remove',
      'availability',
      'fixture-message',
      'fixture-confirm',
      'reserve',
      'notice-read',
      'profile-review',
      'team-directory',
    ].includes(a.type)
  )
    return applyFamilyAction(source, m, a, now);
  if (['member', 'invite'].includes(a.type))
    a = {
      ...a,
      orgIds: ['organiser', 'parent'].includes(a.role) ? a.orgIds : [],
      leagueIds: a.role === 'league-admin' ? a.leagueIds : [],
    };
  const s = structuredClone(source);
  const id = () => crypto.randomUUID();
  const authorized = (ok: boolean) =>
    requireThat(ok, 'You do not have permission for this action.', 403);
  let note = '';
  if (a.type === 'club-confirm') {
    const club = s.clubs.find((c) => c.id === a.clubId);
    requireThat(club, 'Club not found.');
    authorized(canOrg(s, m, club.orgId));
    club.confirmedAt = now;
    club.confirmedBy = m.id;
    note = `Confirmed ${club.name} details`;
  } else if (a.type === 'hosting-offer') {
    const club = s.clubs.find((c) => c.id === a.clubId);
    const league = s.leagues.find((l) => l.id === a.leagueId);
    requireThat(club && league, 'Choose your club and league.');
    authorized(
      canLeague(m, league.id) ||
        (m.role === 'organiser' && m.orgIds.includes(club.orgId)),
    );
    requireThat(
      s.teams.some(
        (t) =>
          !t.withdrawnAt && t.orgId === club.orgId && t.leagueId === league.id,
      ),
      'Your club does not have a team in this league.',
    );
    const capacity = integer(a.capacity, 0, 3, 'Hosting capacity');
    requireThat(
      Array.isArray(a.dates) && a.dates.length <= 200,
      'Provide up to 200 possible dates.',
    );
    const dates = [
      ...new Set<string>(a.dates.map((d: string) => date(d))),
    ].sort();
    requireThat(
      dates.every(
        (d) =>
          Number(d.slice(0, 4)) >= league.year &&
          Number(d.slice(0, 4)) <= league.year + 1,
      ),
      'Choose dates in the season year or the following calendar year.',
    );
    for (const k of ['shotgun', 'presentation', 'food'])
      requireThat(
        ['yes', 'no', 'unsure'].includes(a[k]),
        'Choose Yes, No or Not sure yet.',
      );
    const offer: HostingOffer = {
      clubId: club.id,
      leagueId: league.id,
      capacity,
      dates: capacity ? dates : [],
      shotgun: a.shotgun,
      presentation: a.presentation,
      food: a.food,
      notes: text(a.notes || '', 'Hosting notes', 2000, false),
      updatedAt: now,
      updatedBy: m.id,
    };
    s.hostingOffers = [
      ...(s.hostingOffers || []).filter(
        (o) => o.clubId !== club.id || o.leagueId !== league.id,
      ),
      offer,
    ];
    notify(
      s,
      s.members.filter((v) => canLeague(v, league.id)).map((v) => v.id),
      `${club.name} updated its hosting availability for ${league.name}.`,
    );
    note = `Saved hosting availability for ${club.name}`;
  } else if (a.type === 'fixture-planning') {
    const league = s.leagues.find((l) => l.id === a.leagueId);
    requireThat(league, 'League not found.');
    authorized(canLeague(m, league.id));
    const start = date(a.start),
      end = date(a.end);
    requireThat(
      start <= end &&
        Number(start.slice(0, 4)) === league.year &&
        Number(end.slice(0, 4)) <= league.year + 1,
      'Choose a date range starting in the season year and ending by the following year.',
    );
    league.fixturePlanning = {
      count: integer(a.count, 2, 36, 'Number of fixtures'),
      start,
      end,
      minGap: integer(a.minGap, 1, 60, 'Minimum days between fixtures'),
    };
    note = `Updated fixture planning for ${league.name}`;
  } else if (a.type === 'fixtures-confirm') {
    const league = s.leagues.find((l) => l.id === a.leagueId);
    requireThat(league, 'Choose a league.');
    authorized(canLeague(m, league.id));
    requireThat(
      s.fixtures.some(
        (f) => f.leagueId === league.id && f.status !== 'cancelled',
      ),
      'Create your fixtures before confirming the season list.',
    );
    if (league.fixturesConfirmedAt) return s;
    league.fixturesConfirmedAt = now;
    league.fixturesConfirmedBy = m.id;
    const teams = s.teams.filter(
      (t) => !t.withdrawnAt && t.leagueId === league.id,
    );
    const parents = s.players
      .filter((p) => teams.some((t) => rosterEligible(s, p.id, t.id)))
      .map((p) => p.parentId);
    const organisers = s.members
      .filter((person) =>
        organiserClubs(person).some((org) =>
          teams.some((t) => t.orgId === org),
        ),
      )
      .map((person) => person.id);
    notify(
      s,
      parents,
      `${league.name}: the season fixtures are confirmed. Open your fixtures to tell your organiser when your children can play.`,
    );
    notify(
      s,
      organisers,
      `${league.name}: the season fixtures are confirmed. Families can now share availability. Choose your players and pairs as each fixture approaches.`,
    );
    note = `Confirmed the season fixture list for ${league.name}`;
  } else if (a.type === 'fixture-plan-apply') {
    const league = s.leagues.find((l) => l.id === a.leagueId);
    requireThat(
      league?.fixturePlanning,
      'Save the season planning settings first.',
    );
    authorized(canLeague(m, league.id));
    requireThat(
      a.planningKey === planningKey(s, league.id),
      'Hosting information or league details have changed. Suggest the fixtures again before creating them.',
      409,
    );
    if (a.fixtures !== undefined) {
      requireThat(
        Array.isArray(a.fixtures) && a.fixtures.length <= 36,
        'Choose up to 36 fixtures.',
      );
      requireThat(
        a.fixtures.every(
          (f: any) =>
            f && typeof f.clubId === 'string' && typeof f.date === 'string',
        ),
        'Each fixture needs a club and date.',
      );
    }
    const proposed =
      a.fixtures === undefined
        ? suggestFixtures(s, league.id, league.fixturePlanning).fixtures
        : a.fixtures.map((f: any) => ({
            clubId: f.clubId,
            date: date(f.date),
          }));
    const proposal = reviewFixtureDraft(
      s,
      league.id,
      league.fixturePlanning,
      proposed,
    );
    requireThat(!proposal.errors.length, proposal.errors.join(' '));
    requireThat(
      proposal.fixtures.length > 0,
      'No fixtures are available to create. Adjust the season window or add hosting dates.',
    );
    requireThat(
      s.teams.filter((t) => !t.withdrawnAt && t.leagueId === league.id)
        .length >= 2,
      'Add at least two teams before creating fixtures.',
    );
    let next = s;
    for (const [index, f] of proposal.fixtures.entries()) {
      const offer = s.hostingOffers!.find(
        (o) => o.clubId === f.clubId && o.leagueId === league.id,
      )!;
      next = applyAction(
        next,
        m,
        {
          type: 'fixture',
          ...f,
          leagueId: league.id,
          arrival: a.arrival,
          start: a.start,
          registration: false,
          format: offer.shotgun === 'yes' ? 'shotgun' : 'tee-times',
          foodAfter:
            offer.food === 'yes' ? 'Food planned; details to follow.' : '',
          instructions:
            index === proposal.fixtures.length - 1 &&
            proposal.presentationConfirmed
              ? 'Season final with presentation evening. Details to follow.'
              : '',
          teamIds: s.teams
            .filter((t) => !t.withdrawnAt && t.leagueId === league.id)
            .map((t) => t.id),
        },
        now,
      );
    }
    return next;
  } else if (a.type === 'add-test-organisers') {
    authorized(m.role === 'admin');
    const added = addTestOrganisers(s, a.clubIds, a.count);
    note = `Added ${added} fictional test organisers. Existing memberships preserved. No sign-in accounts or invitations created.`;
  } else if (a.type === 'add-test-families') {
    authorized(m.role === 'admin');
    const result = addTestFamilies(
      s,
      text(a.leagueName, 'League name', 100),
      integer(a.year, 2020, 2100, 'Season'),
      now,
      a.teamName === undefined ? undefined : text(a.teamName, 'Team name', 100),
      a.targetSize === undefined
        ? undefined
        : integer(a.targetSize, 1, 60, 'Test squad target'),
    );
    note = `Added fictional test records: ${result.familiesAdded} families, ${result.childrenAdded} children (${result.approvedAdded} approved, ${result.applicationsAdded} applications). Existing records preserved.`;
  } else if (a.type === 'login-help-status') {
    const request = s.loginHelpRequests?.find((r) => r.id === a.id);
    requireThat(request, 'Help request not found.', 404);
    authorized(canHelpLogin(s, m, request.orgId));
    requireThat(
      ['new', 'contacted', 'resolved'].includes(a.status),
      'Choose a help request status.',
    );
    request.status = a.status;
    request.updatedAt = now;
    request.updatedBy = m.id;
    note = 'Updated a parent login help request.';
  } else if (a.type === 'access-request-decision') {
    authorized(m.role === 'admin');
    const request = s.accessRequests?.find(
      (r) => r.id === a.id && r.status === 'pending',
    );
    requireThat(request, 'This registration has already been reviewed.', 409);
    requireThat(
      ['approve', 'reject'].includes(a.decision),
      'Choose approve or decline.',
    );
    if (a.decision === 'approve') {
      requireThat(
        request.role === 'admin' || s.orgs.some((o) => o.id === request.orgId),
        'This club is no longer available.',
      );
      let member = s.members.find((p) => p.id === request.userId);
      if (!member) {
        member = {
          id: request.userId,
          name: request.name,
          email: request.email,
          phone: request.phone,
          role: request.role,
          orgIds: [],
          leagueIds: [],
        };
        s.members.push(member);
      }
      if (request.role === 'admin') {
        member.role = 'admin';
        member.leagueIds = [];
        member.orgIds = [];
      } else if (member.role === 'admin')
        addOrganiserClubs(member, [request.orgId]);
      else {
        requireThat(
          member.role !== 'league-admin',
          'Use People & access to update this existing league administrator.',
        );
        member.orgIds =
          member.role === 'organiser'
            ? [...new Set([...member.orgIds, request.orgId])]
            : [request.orgId];
        member.role = 'organiser';
        member.leagueIds = [];
      }
    }
    request.status = a.decision === 'approve' ? 'approved' : 'rejected';
    request.decidedAt = now;
    notify(
      s,
      [request.userId],
      `Your ${request.role === 'organiser' ? 'junior organiser' : 'Foundation administrator'} registration was ${request.status}.`,
    );
    note = `Registration ${request.status} for ${request.name}`;
  } else if (a.type === 'organiser-club') {
    authorized(m.role === 'admin');
    requireThat(
      s.orgs.some((o) => o.id === a.orgId),
      'Choose an existing club.',
    );
    addOrganiserClubs(
      s.members.find((p) => p.id === m.id)!,
      [a.orgId],
    );
    note = 'Updated own junior organiser club';
  } else if (a.type === 'profile') {
    const p = s.members.find((x) => x.id === m.id)!;
    p.name = text(a.name, 'Name', 100);
    p.phone = text(a.phone, 'Phone', 40, false);
    note = 'Updated contact details';
  } else if (a.type === 'league') {
    const existing = s.leagues.find((l) => l.id === a.id);
    authorized(existing ? canLeague(m, existing.id) : m.role === 'admin');
    if (
      existing &&
      s.fixtures.some(
        (f) =>
          f.leagueId === existing.id &&
          (f.status === 'live' || f.status === 'completed'),
      )
    )
      requireThat(
        Number(a.holes) === existing.holes &&
          Number(a.pairs) === existing.pairs &&
          Number(a.maxStrokes) === existing.maxStrokes &&
          a.tiePolicy === existing.tiePolicy,
        'Scoring rules are locked after a fixture starts.',
      );
    const l: League = {
      id: existing?.id || id(),
      name: text(a.name, 'League name', 100),
      region: text(a.region, 'Region', 80),
      year: integer(a.year, 2020, 2100, 'Season'),
      holes: integer(a.holes, 1, 18, 'Holes'),
      pairs: integer(a.pairs, 1, 6, 'Pairs per team'),
      maxStrokes: integer(a.maxStrokes, 2, 20, 'Stroke limit'),
      tiePolicy: ['shared', 'average'].includes(a.tiePolicy)
        ? a.tiePolicy
        : 'countback',
      adminId: a.adminId ?? existing?.adminId ?? m.id,
      assistantId: a.assistantId ?? existing?.assistantId ?? '',
      squadSize: integer(
        a.squadSize ?? existing?.squadSize ?? 12,
        2,
        60,
        'Squad target',
      ),
      status: 'active',
      registrationOpen:
        typeof a.registrationOpen === 'boolean'
          ? a.registrationOpen
          : (existing?.registrationOpen ?? true),
      fixturePlanning: existing?.fixturePlanning,
      fixturesConfirmedAt: existing?.fixturesConfirmedAt,
      fixturesConfirmedBy: existing?.fixturesConfirmedBy,
    };
    requireThat(
      !l.adminId || !l.assistantId || l.adminId !== l.assistantId,
      'Choose two different people as administrator and assistant.',
    );
    for (const memberId of [l.adminId, l.assistantId].filter(Boolean))
      requireThat(
        s.members.some(
          (p) =>
            p.id === memberId && ['admin', 'league-admin'].includes(p.role),
        ),
        'Choose a registered Foundation administrator or assistant.',
      );
    for (const member of s.members.filter((p) => p.role === 'league-admin')) {
      if ([l.adminId, l.assistantId].includes(member.id))
        member.leagueIds = [...new Set([...member.leagueIds, l.id])];
      else if (
        existing &&
        [existing.adminId, existing.assistantId].includes(member.id)
      )
        member.leagueIds = member.leagueIds.filter((v) => v !== l.id);
    }
    s.leagues = existing
      ? s.leagues.map((v) => (v.id === l.id ? l : v))
      : [...s.leagues, l];
    note = `Saved ${l.name}`;
  } else if (a.type === 'league-import') {
    authorized(m.role === 'admin');
    requireThat(
      Array.isArray(a.rows) && a.rows.length > 0 && a.rows.length <= 200,
      'Import between 1 and 200 spreadsheet rows.',
    );
    let next = s;
    const normalized = (v: string) => v.trim().toLowerCase();
    for (const [index, row] of a.rows.entries()) {
      try {
        const name = text(row.league, 'League name', 100),
          year = integer(row.year, 2020, 2100, 'Season');
        let league = next.leagues.find(
          (l) => normalized(l.name) === normalized(name) && l.year === year,
        );
        const staffId = (email: string) => {
          const member = next.members.find(
            (p) =>
              p.email.toLowerCase() === email.toLowerCase() &&
              ['admin', 'league-admin'].includes(p.role),
          );
          requireThat(
            member,
            `Foundation account not found: ${email}. Register this person first.`,
          );
          return member.id;
        };
        const settings = {
          region: row.region || name,
          holes: Number(row.holes || 6),
          pairs: Number(row.pairs || 3),
          maxStrokes: Number(row.max_strokes || 10),
          squadSize: Number(row.squad_size || 12),
          adminId: row.admin_email ? staffId(row.admin_email) : m.id,
          assistantId: row.assistant_email ? staffId(row.assistant_email) : '',
        };
        if (!league) {
          next = applyAction(
            next,
            m,
            {
              type: 'league',
              name,
              year,
              ...settings,
              tiePolicy: 'countback',
              registrationOpen: true,
            },
            now,
          );
          league = next.leagues.at(-1)!;
        } else {
          for (const [column, key] of [
            ['region', 'region'],
            ['holes', 'holes'],
            ['pairs', 'pairs'],
            ['max_strokes', 'maxStrokes'],
            ['squad_size', 'squadSize'],
            ['admin_email', 'adminId'],
            ['assistant_email', 'assistantId'],
          ] as const) {
            requireThat(
              !row[column] ||
                String(league[key] ?? (key === 'squadSize' ? 12 : '')) ===
                  String(settings[key]),
              `Conflicting ${column} for ${name}. Existing league settings are kept; edit them in League settings.`,
            );
          }
        }
        if (!row.club) {
          requireThat(!row.team && !row.cap, 'A team needs a club.');
          continue;
        }
        const clubName = text(row.club, 'Club name', 100);
        let org = next.orgs.find(
          (o) => normalized(o.name) === normalized(clubName),
        );
        if (!org) {
          next = applyAction(
            next,
            m,
            {
              type: 'club-import',
              clubs: [
                {
                  name: clubName,
                  address: row.address || '',
                  county: row.county || '',
                  postcode: row.postcode || '',
                  website: row.website || '',
                },
              ],
            },
            now,
          );
          org = next.orgs.at(-1)!;
        }
        const teamName = text(row.team || clubName, 'Team name', 100);
        const old = next.teams.find(
          (t) =>
            !t.withdrawnAt &&
            t.leagueId === league!.id &&
            t.orgId === org!.id &&
            normalized(t.name) === normalized(teamName),
        );
        if (old) {
          requireThat(
            !row.cap ||
              normalized(old.cap) === normalized(row.cap) ||
              (findCap(row.cap) !== undefined &&
                findCap(old.cap) === findCap(row.cap)),
            `A different cap is already assigned to ${teamName}.`,
          );
          continue;
        }
        next = applyAction(
          next,
          m,
          {
            type: 'team',
            leagueId: league.id,
            orgId: org.id,
            name: teamName,
            cap: row.cap || undefined,
          },
          now,
        );
      } catch (error) {
        throw new AppError(`Row ${index + 2}: ${(error as Error).message}`);
      }
    }
    return next;
  } else if (a.type === 'team-remove' || a.type === 'team-replace') {
    const team = s.teams.find((t) => t.id === a.teamId && !t.withdrawnAt);
    requireThat(team, 'Team not found.');
    authorized(canLeague(m, team.leagueId));
    requireThat(
      !s.fixtures.some(
        (f) => f.status === 'live' && f.teamIds.includes(team.id),
      ),
      'Finish or cancel the live fixture before removing this team.',
    );
    team.withdrawnAt = now;
    team.enrollmentOpen = false;
    let replacement: Team | undefined;
    if (a.type === 'team-replace') {
      const updated = applyAction(
        s,
        m,
        {
          type: 'team',
          leagueId: team.leagueId,
          orgId: a.orgId,
          name: a.name,
          cap: team.cap,
        },
        now,
      );
      replacement = updated.teams.at(-1)!;
      s.teams.push(replacement);
    }
    for (const entry of s.enrollments || [])
      if (
        entry.teamId === team.id &&
        ['pending', 'approved'].includes(entry.status)
      ) {
        if (entry.status === 'approved')
          entry.approvedAt ??= entry.decidedAt || entry.requestedAt;
        entry.status = 'removed';
        entry.decidedAt = now;
        entry.reason = 'Team withdrawn from this league.';
        const player = s.players.find((p) => p.id === entry.playerId);
        if (player)
          notify(
            s,
            [player.parentId],
            `${team.name} has withdrawn from the league. Please request a place with another team for ${player.name}.`,
          );
      }
    for (const fixture of s.fixtures.filter(
      (f) => f.status === 'scheduled' && f.teamIds.includes(team.id),
    )) {
      const pairIds = fixture.pairs
        .filter((p) => p.teamId === team.id)
        .map((p) => p.id);
      fixture.teamIds = fixture.teamIds.flatMap((t) =>
        t === team.id ? (replacement ? [replacement.id] : []) : [t],
      );
      fixture.pairs = fixture.pairs.filter((p) => p.teamId !== team.id);
      fixture.scores = Object.fromEntries(
        Object.entries(fixture.scores).filter(
          ([key]) => !pairIds.some((p) => key.startsWith(`${p}:`)),
        ),
      );
      s.reserves = s.reserves?.filter(
        (r) => r.fixtureId !== fixture.id || r.teamId !== team.id,
      );
    }
    note = replacement
      ? `Replaced ${team.name} with ${replacement.name}`
      : `Removed ${team.name} from its league`;
  } else if (a.type === 'club-import') {
    authorized(m.role === 'admin');
    requireThat(
      Array.isArray(a.clubs) && a.clubs.length > 0 && a.clubs.length <= 200,
      'Choose between 1 and 200 clubs.',
    );
    let added = 0;
    for (const row of a.clubs) {
      const name = text(row.name, 'Club name', 100);
      const address = text(row.address || '', 'Address', 500, false),
        instructions = text(
          row.instructions || '',
          'Instructions',
          2000,
          false,
        );
      if (s.orgs.some((o) => o.name.toLowerCase() === name.toLowerCase()))
        continue;
      const orgId = id();
      s.orgs.push({ id: orgId, name });
      s.clubs.push({
        id: id(),
        orgId,
        name,
        address,
        county: text(row.county || '', 'County', 100, false),
        postcode: text(row.postcode || '', 'Postcode', 20, false),
        instructions,
        welfareName: '',
        welfareEmail: '',
        safeGolf: false,
        ...websiteFields(row.website),
      });
      added++;
    }
    requireThat(
      added > 0,
      'These clubs already exist. No duplicate clubs were added.',
    );
    note = `Added ${added} club${added === 1 ? '' : 's'}`;
  } else if (a.type === 'organisation') {
    authorized(m.role === 'admin');
    s.orgs.push({ id: id(), name: text(a.name, 'Organisation name', 100) });
    note = 'Created a club organisation';
  } else if (a.type === 'club') {
    const old = s.clubs.find((c) => c.id === a.id);
    authorized(canOrg(s, m, a.orgId));
    requireThat(
      s.orgs.some((o) => o.id === a.orgId),
      'Choose a club organisation.',
    );
    if (old)
      requireThat(old.orgId === a.orgId, 'A venue cannot change organisation.');
    const c: Club = {
      ...old,
      id: old?.id || id(),
      orgId: a.orgId,
      name: text(a.name, 'Club name', 100),
      address: text(a.address ?? old?.address ?? '', 'Address', 500, false),
      county: text(a.county ?? old?.county ?? '', 'County', 100, false),
      postcode: text(a.postcode ?? old?.postcode ?? '', 'Postcode', 20, false),
      instructions: text(
        a.instructions || '',
        'Visitor instructions',
        2000,
        false,
      ),
      welfareName: text(a.welfareName || '', 'Welfare officer', 100, false),
      welfareEmail: a.welfareEmail ? checkEmail(a.welfareEmail) : '',
      safeGolf: !!a.safeGolf,
      ...websiteFields(a.website ?? old?.website, old),
    };
    s.clubs = old
      ? s.clubs.map((v) => (v.id === c.id ? c : v))
      : [...s.clubs, c];
    note = `Saved ${c.name}`;
  } else if (
    ['club-image-retry', 'club-image-clear', 'club-image-set'].includes(a.type)
  ) {
    const club = s.clubs.find((c) => c.id === a.clubId);
    requireThat(club, 'Club not found.', 404);
    authorized(canOrg(s, m, club.orgId));
    club.imageJobId = id();
    club.imageRequestedAt = now;
    if (a.type === 'club-image-retry') {
      requireThat(club.website, 'Add the club website first.');
      club.imageStatus = 'pending';
    } else {
      club.imageKey = a.type === 'club-image-set' ? a.imageKey : undefined;
      club.imageSource = undefined;
      club.imageStatus = a.type === 'club-image-set' ? 'manual' : 'none';
    }
    note = `Updated the fixture photo for ${club.name}`;
  } else if (a.type === 'team') {
    const old = s.teams.find((t) => t.id === a.id);
    requireThat(
      !old?.withdrawnAt,
      'This team has been removed from the league.',
    );
    authorized(canLeague(m, a.leagueId));
    requireThat(
      s.orgs.some((o) => o.id === a.orgId) &&
        s.leagues.some((l) => l.id === a.leagueId),
      'Choose an organisation and league.',
    );
    if (old)
      requireThat(
        old.orgId === a.orgId && old.leagueId === a.leagueId,
        'Team league and organisation cannot change.',
      );
    if (!old)
      requireThat(
        leagueHasTeamSpace(s, a.leagueId),
        'This league is full. A league can have a maximum of six teams.',
      );
    const chosenCap = a.cap
      ? findCap(String(a.cap))
      : availableCaps(s, a.leagueId, a.id)[0];
    requireThat(chosenCap, 'Choose one of the six league cap colours.');
    requireThat(
      !s.teams.some(
        (t) =>
          !t.withdrawnAt &&
          t.id !== a.id &&
          t.leagueId === a.leagueId &&
          (t.color.toLowerCase() === chosenCap.color ||
            findCap(t.cap)?.cap === chosenCap.cap),
      ),
      'This cap colour is already used in the league.',
    );
    const t: Team = {
      enrollmentOpen: old?.enrollmentOpen ?? true,
      approvedAt: old?.approvedAt || now,
      approvedBy: old?.approvedBy || m.id,
      id: old?.id || id(),
      orgId: a.orgId,
      leagueId: a.leagueId,
      name: text(a.name, 'Team name', 100),
      color: chosenCap.color,
      cap: chosenCap.cap,
    };
    s.teams = old
      ? s.teams.map((v) => (v.id === t.id ? t : v))
      : [...s.teams, t];
    note = `Saved ${t.name}`;
  } else if (a.type === 'player') {
    const old = s.players.find((p) => p.id === a.id);
    authorized(
      old
        ? (m.role === 'parent' && old.parentId === m.id) ||
            canOrg(s, m, old.orgId)
        : m.orgIds.includes(a.orgId) || canOrg(s, m, a.orgId),
    );
    requireThat(
      s.orgs.some((o) => o.id === a.orgId),
      'Choose a club organisation.',
    );
    if (old)
      requireThat(old.orgId === a.orgId, 'Player organisation cannot change.');
    const dob = date(a.dob);
    requireThat(
      dob < now.slice(0, 10) && dob > `${Number(now.slice(0, 4)) - 19}-01-01`,
      'Enter the date of birth of a junior player.',
    );
    requireThat(
      a.consent === true,
      'Confirm that you are authorised to register this child and share essential care details.',
    );
    const parentId =
      old?.parentId || (m.role === 'parent' ? m.id : a.parentId || m.id);
    requireThat(
      s.members.some((p) => p.id === parentId),
      'Choose the registering parent.',
    );
    const handicap =
      a.handicap === '' || a.handicap == null ? null : Number(a.handicap);
    requireThat(
      handicap === null ||
        (Number.isFinite(handicap) && handicap >= -10 && handicap <= 54),
      'Handicap must be between -10 and 54 or left blank.',
    );
    const p: Player = {
      id: old?.id || id(),
      orgId: a.orgId,
      parentId,
      name: text(a.name, 'Child name', 100),
      dob,
      handicap,
      gender: a.gender === undefined ? old?.gender || '' : a.gender,
      diet: text(a.diet || '', 'Dietary requirements', 2000, false),
      care: text(a.care || '', 'Care information', 2000, false),
      photoConsent: !!a.photoConsent,
      photoKey: old?.photoKey,
      familyManaged: old?.familyManaged,
      emergencyName: text(a.emergencyName, 'Emergency contact', 100),
      emergencyPhone: text(a.emergencyPhone, 'Emergency phone', 40),
      consentAt: now,
    };
    requireThat(
      ['', 'boy', 'girl', 'another', 'prefer-not-to-say'].includes(
        p.gender || '',
      ),
      'Choose a gender option or leave it unrecorded.',
    );
    s.players = old
      ? s.players.map((v) => (v.id === p.id ? p : v))
      : [...s.players, p];
    note = 'Updated a player registration';
  } else if (a.type === 'fixture') {
    const old = s.fixtures.find((f) => f.id === a.id);
    const club = s.clubs.find((c) => c.id === a.clubId);
    requireThat(club, 'Choose a hosting venue.');
    authorized(
      old
        ? canHost(s, m, old)
        : canLeague(m, a.leagueId) ||
            (m.role === 'organiser' && canOrg(s, m, club.orgId)),
    );
    requireThat(
      s.leagues.some((l) => l.id === a.leagueId),
      'Choose a league.',
    );
    requireThat(
      s.teams.some((t) => t.orgId === club.orgId && t.leagueId === a.leagueId),
      'The host must belong to this league.',
    );
    if (old) {
      requireThat(
        old.status === 'scheduled',
        'Only upcoming fixture details can be changed.',
      );
      requireThat(
        old.leagueId === a.leagueId,
        'A fixture cannot change league.',
      );
      if (!canLeague(m, old.leagueId))
        requireThat(
          old.clubId === a.clubId,
          'Only a league administrator may change the host.',
        );
    }
    requireThat(
      Array.isArray(a.teamIds) &&
        a.teamIds.length >= 2 &&
        unique(a.teamIds) &&
        a.teamIds.every((t: string) =>
          s.teams.some(
            (v) => !v.withdrawnAt && v.id === t && v.leagueId === a.leagueId,
          ),
        ),
      'Choose at least two teams from this league.',
    );
    const arrival = time(a.arrival),
      start = time(a.start);
    requireThat(arrival <= start, 'Arrival must be before the start time.');
    const fixtureDate = date(a.date);
    const fixtureName = `${club.name} · ${new Date(fixtureDate + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
    const f: Fixture = {
      id: old?.id || id(),
      leagueId: a.leagueId,
      clubId: club.id,
      name: fixtureName,
      date: fixtureDate,
      arrival,
      start,
      registration: !!a.registration,
      format: a.format === 'tee-times' ? 'tee-times' : 'shotgun',
      startSettings:
        old && old.format === a.format && old.start === start
          ? old.startSettings
          : undefined,
      foodBefore: text(a.foodBefore || '', 'Food before play', 500, false),
      foodAfter: text(a.foodAfter || '', 'Food after play', 500, false),
      instructions: text(
        a.instructions || '',
        'Match instructions',
        2000,
        false,
      ),
      status: 'scheduled',
      teamIds: a.teamIds,
      pairs: old?.pairs.filter((p) => a.teamIds.includes(p.teamId)) || [],
      slots: old?.slots || [],
      scores: {},
      results: [],
    };
    if (old && old.format !== f.format) {
      f.slots = [];
      f.pairs.forEach((p) => (p.slotId = ''));
    }
    s.fixtures = old
      ? s.fixtures.map((v) => (v.id === f.id ? f : v))
      : [...s.fixtures, f];
    if (s.leagues.find((l) => l.id === f.leagueId)?.fixturesConfirmedAt) {
      const relevant = [...new Set([...(old?.teamIds || []), ...f.teamIds])];
      const recipients = s.players
        .filter((p) => relevant.some((tid) => rosterEligible(s, p.id, tid)))
        .map((p) => p.parentId);
      notify(
        s,
        [...recipients, ...relevant.flatMap((tid) => teamManagers(s, tid))],
        `${old ? 'Fixture updated' : 'Fixture added'}: ${f.name}. Arrive ${f.arrival}, start ${f.start}. Check the latest details and your availability.`,
        f.id,
      );
    }
    note = `Saved ${f.name}`;
  } else if (
    [
      'lineup',
      'slots',
      'score',
      'start',
      'finalise',
      'reopen',
      'cancel',
    ].includes(a.type)
  ) {
    const f = s.fixtures.find((f) => f.id === a.fixtureId);
    requireThat(f, 'Fixture not found.', 404);
    const l = s.leagues.find((l) => l.id === f.leagueId)!;
    if (a.type === 'lineup') {
      const t = s.teams.find((t) => t.id === a.teamId);
      requireThat(
        t && f.teamIds.includes(t.id),
        'Team is not in this fixture.',
      );
      authorized(
        (m.role === 'organiser' && canOrg(s, m, t.orgId)) || canLeague(m, l.id),
      );
      requireThat(
        f.status === 'scheduled',
        'Pairings are locked once play starts.',
      );
      requireThat(
        Array.isArray(a.pairs) &&
          a.pairs.length === l.pairs &&
          a.pairs.every((p: any) => Array.isArray(p) && p.length === 2),
        'Choose two players in every pair.',
      );
      const ids = a.pairs.flat();
      requireThat(unique(ids), 'A player can only be selected once.');
      requireThat(
        ids.every((v: string) => rosterEligible(s, v, t.id)),
        'Choose players approved for this team.',
      );
      requireThat(
        !ids.some((v: string) =>
          s.availability?.some(
            (a) =>
              a.fixtureId === f.id && a.playerId === v && a.status === 'no',
          ),
        ),
        'An unavailable player cannot be selected.',
      );
      requireThat(
        !f.pairs.some(
          (p) => p.teamId !== t.id && p.players.some((v) => ids.includes(v)),
        ) &&
          !s.reserves?.some(
            (r) =>
              r.fixtureId === f.id &&
              r.teamId !== t.id &&
              ids.includes(r.playerId),
          ),
        'A player is already selected for another team.',
      );
      const previous = f.pairs.filter((p) => p.teamId === t.id);
      if (a.reserveIds !== undefined) {
        requireThat(
          Array.isArray(a.reserveIds) &&
            unique(a.reserveIds) &&
            a.reserveIds.every(
              (pid: string) =>
                rosterEligible(s, pid, t.id) && !ids.includes(pid),
            ),
          'Choose distinct reserves approved for this team, separate from the pairs.',
        );
        requireThat(
          !a.reserveIds.some((pid: string) =>
            s.availability?.some(
              (v) =>
                v.fixtureId === f.id && v.playerId === pid && v.status === 'no',
            ),
          ),
          'An unavailable player cannot be a reserve.',
        );
        requireThat(
          !a.reserveIds.some(
            (pid: string) =>
              f.pairs.some(
                (p) => p.teamId !== t.id && p.players.includes(pid),
              ) ||
              s.reserves?.some(
                (r) =>
                  r.fixtureId === f.id &&
                  r.teamId !== t.id &&
                  r.playerId === pid,
              ),
          ),
          'A reserve is already assigned to another team.',
        );
        const oldReserves = (s.reserves || [])
          .filter((r) => r.fixtureId === f.id && r.teamId === t.id)
          .map((r) => r.playerId);
        s.reserves = (s.reserves || []).filter(
          (r) => r.fixtureId !== f.id || r.teamId !== t.id,
        );
        for (const pid of a.reserveIds)
          s.reserves.push({ fixtureId: f.id, teamId: t.id, playerId: pid });
        for (const pid of new Set<string>([...oldReserves, ...a.reserveIds])) {
          if (
            oldReserves.includes(pid) === a.reserveIds.includes(pid) ||
            ids.includes(pid)
          )
            continue;
          const player = s.players.find((p) => p.id === pid)!;
          notify(
            s,
            [player.parentId],
            `${player.name} ${a.reserveIds.includes(pid) ? 'has been named as a reserve' : 'is no longer a reserve'} for ${f.name}.`,
            f.id,
          );
        }
      }
      const removed = previous
        .flatMap((p) => p.players)
        .filter((pid) => !ids.includes(pid));
      notify(
        s,
        removed.map((pid) => s.players.find((p) => p.id === pid)!.parentId),
        `${t.name}: the selection for ${f.name} has changed and your child is no longer selected. Check the fixture for their current status.`,
        f.id,
      );
      f.pairs = f.pairs.filter((p) => p.teamId !== t.id);
      a.pairs.forEach((players: string[], i: number) =>
        f.pairs.push({
          id: previous[i]?.id || id(),
          teamId: t.id,
          players,
          slotId: previous[i]?.slotId || '',
        }),
      );
      note = `Submitted ${t.name} pairings`;
      notify(
        s,
        s.members
          .filter((person) => person.id !== m.id && canHost(s, person, f))
          .map((person) => person.id),
        `${t.name} has submitted its pairs for ${f.name}. Review the players and allocate their starting holes and tee times.`,
        f.id,
      );
      s.reserves = s.reserves?.filter(
        (r) => r.fixtureId !== f.id || !ids.includes(r.playerId),
      );
      notify(
        s,
        ids.map((pid: string) => s.players.find((p) => p.id === pid)!.parentId),
        `${t.name}: your child has been selected for ${f.name}. Check their partner and starting details.`,
        f.id,
      );
    } else if (a.type === 'slots') {
      authorized(canHost(s, m, f));
      requireThat(
        f.status === 'scheduled',
        'Starting slots are locked once play starts.',
      );
      requireThat(
        !a.expectedPairsKey || a.expectedPairsKey === startingPairsKey(f),
        'Team selections changed. Reload the fixture and suggest allocations again.',
        409,
      );
      const settings = a.settings
        ? validateStartSettings(a.settings)
        : undefined;
      requireThat(
        Array.isArray(a.slots) && a.slots.length <= 50,
        'Invalid starting slots.',
      );
      const slots: Slot[] = a.slots.map((v: any) => ({
        id: typeof v.id === 'string' ? v.id : id(),
        label: text(v.label, 'Slot label', 50),
        capacity:
          settings?.capacity ?? integer(v.capacity, 2, 6, 'Pairs per slot'),
        ...(v.startHole !== undefined
          ? { startHole: integer(v.startHole, 1, 36, 'Starting hole') }
          : {}),
        ...(v.startTime !== undefined
          ? { startTime: text(v.startTime, 'Tee time', 5) }
          : {}),
      }));
      requireThat(
        slots.every(
          (v) =>
            v.startTime === undefined ||
            /^([01]\d|2[0-3]):[0-5]\d$/.test(v.startTime),
        ),
        'Enter a valid tee time.',
      );
      requireThat(
        unique(slots.map((v) => v.id)) && unique(slots.map((v) => v.label)),
        'Slots must have unique labels.',
      );
      requireThat(
        a.assignments && typeof a.assignments === 'object',
        'Assignments are required.',
      );
      f.slots = slots;
      f.pairs.forEach((p) => {
        p.slotId = a.assignments[p.id] || '';
        requireThat(
          !p.slotId || slots.some((v) => v.id === p.slotId),
          'Starting slot not found.',
        );
      });
      requireThat(
        slots.every(
          (v) => f.pairs.filter((p) => p.slotId === v.id).length <= v.capacity,
        ),
        'A starting slot is over capacity.',
      );
      requireThat(
        slots.every(
          (v) => f.pairs.filter((p) => p.slotId === v.id).length !== 1,
        ),
        'A pair cannot play alone. Move it into another group, or increase the shared capacity and suggest again.',
      );
      if (settings) {
        requireThat(
          slots.every(
            (v) =>
              typeof v.startTime === 'string' &&
              v.startTime >= settings.firstTime,
          ),
          'Starting slots must have a time at or after the configured start.',
        );
        requireThat(
          slots.every(
            (v) =>
              v.startHole !== undefined && settings.holes.includes(v.startHole),
          ),
          'Every starting slot must use one of the configured starting holes.',
        );
        requireThat(
          settings.format !== 'shotgun' ||
            (unique(slots.map((v) => String(v.startHole))) &&
              slots.every((v) => v.startTime === settings.firstTime)),
          'Shotgun groups need different starting holes and the same start time.',
        );
        requireThat(
          settings.format !== 'tee-times' ||
            unique(slots.map((v) => String(v.startTime))),
          'Each tee-time group needs a different start time.',
        );
        requireThat(
          settings.firstTime >= f.arrival,
          'The start time must be at or after the arrival time.',
        );
        f.startSettings = settings;
        f.format = settings.format;
        f.start = settings.firstTime;
      }
      note = 'Updated starting slots';
    } else if (a.type === 'score') {
      requireThat(
        fixtureScoringOpen(
          s,
          f,
          viewingDate ||
            s.demoToday ||
            new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Europe/London',
            }).format(new Date(now)),
        ),
        'Scoring opens on the date of a published fixture. Completed or cancelled fixtures cannot be scored.',
      );
      const pair = f.pairs.find((p) => p.id === a.pairId);
      requireThat(pair, 'Pair not found.');
      authorized(
        canHost(s, m, f) ||
          pair.players.some((pid) =>
            s.players.some((p) => p.id === pid && p.parentId === m.id),
          ) ||
          (m.role === 'organiser' &&
            canOrg(s, m, s.teams.find((t) => t.id === pair.teamId)!.orgId)),
      );
      const hole = integer(a.hole, 1, l.holes, 'Hole');
      const strokes = integer(a.strokes, 1, l.maxStrokes, 'Strokes');
      const key = `${pair.id}:${hole}`;
      requireThat(
        (f.scores[key]?.version || 0) === a.expectedVersion,
        'Another scorer updated this hole. Review their score and try again.',
        409,
      );
      // The first successful score records play starting. An invalid or stale
      // request cannot change fixture status, and viewing a date never writes it.
      f.status = 'live';
      f.scores[key] = {
        strokes,
        version: (f.scores[key]?.version || 0) + 1,
        by: m.id,
        at: now,
      };
      note = `Recorded hole ${hole} (${strokes} strokes)`;
    } else {
      authorized(canHost(s, m, f));
      if (a.type === 'start') {
        requireThat(
          f.status === 'scheduled',
          'This fixture cannot be started.',
        );
        const issues = readiness(s, f);
        requireThat(!issues.length, issues.join(' '));
        f.status = 'live';
        note = `Started ${f.name}`;
      }
      if (a.type === 'finalise') {
        requireThat(
          f.status === 'live',
          'Only live fixtures can be finalised.',
        );
        requireThat(
          f.pairs.every((p) =>
            Array.from(
              { length: l.holes },
              (_, i) => f.scores[`${p.id}:${i + 1}`],
            ).every(Boolean),
          ),
          'Complete every pair’s scorecard before finalising.',
        );
        f.results = fixtureResults(s, f);
        f.status = 'completed';
        f.finalisedAt = now;
        note = `Finalised ${f.name}`;
      }
      if (a.type === 'reopen') {
        authorized(canLeague(m, l.id));
        requireThat(
          f.status === 'completed',
          'Only completed fixtures can be reopened.',
        );
        f.status = 'live';
        f.results = [];
        delete f.finalisedAt;
        note = `Reopened ${f.name} for correction`;
      }
      if (a.type === 'cancel') {
        requireThat(
          f.status === 'scheduled',
          'Only upcoming fixtures can be cancelled.',
        );
        f.status = 'cancelled';
        note = `Cancelled ${f.name}`;
      }
    }
  } else if (a.type === 'invite') {
    authorized(
      m.role === 'admin' ||
        (a.role === 'parent' &&
          a.orgIds.length > 0 &&
          a.orgIds.every((v: string) => canOrg(s, m, v))) ||
        (['league-admin', 'organiser'].includes(m.role) &&
          a.role === 'organiser' &&
          a.orgIds.length > 0 &&
          a.orgIds.every((v: string) => canOrg(s, m, v))),
    );
    requireThat(
      ['admin', 'league-admin', 'organiser', 'parent'].includes(a.role),
      'Invalid role.',
    );
    requireThat(
      Array.isArray(a.orgIds) &&
        a.orgIds.every((v: string) => s.orgs.some((o) => o.id === v)) &&
        Array.isArray(a.leagueIds) &&
        a.leagueIds.every((v: string) => s.leagues.some((l) => l.id === v)),
      'Invalid access scope.',
    );
    if (a.role === 'league-admin')
      requireThat(a.leagueIds.length, 'Select at least one league.');
    if (['organiser', 'parent'].includes(a.role))
      requireThat(a.orgIds.length, 'Select at least one club organisation.');
    if (a.role !== 'parent') checkEmail(a.email);
    requireThat(
      !s.invites.some(
        (i) =>
          a.role !== 'parent' &&
          i.role === a.role &&
          i.email.toLowerCase() === a.email.toLowerCase() &&
          !i.revoked &&
          !i.acceptedAt &&
          Date.parse(i.expires) > Date.parse(now) &&
          a.orgIds.some((v: string) => i.orgIds.includes(v)),
      ),
      'There is already a pending invitation for this email and club. Copy or resend that invitation.',
    );
    s.invites.push({
      id: id(),
      hash: a.hash,
      role: a.role,
      orgIds: a.orgIds,
      leagueIds: a.leagueIds,
      email: a.email ? checkEmail(a.email) : '',
      expires: new Date(Date.parse(now) + 14 * 86400000).toISOString(),
      revoked: false,
    });
    note = 'Created an invitation link';
  } else if (a.type === 'revoke') {
    const invite = s.invites.find((i) => i.id === a.id);
    requireThat(invite, 'Invitation not found.');
    authorized(
      m.role === 'admin' ||
        (['parent', 'organiser'].includes(invite.role) &&
          invite.orgIds.length > 0 &&
          invite.orgIds.every((v) => canOrg(s, m, v))),
    );
    requireThat(
      !invite.acceptedAt,
      'This invitation has already been accepted. Remove club access instead.',
    );
    invite.revoked = true;
    note = 'Revoked an invitation';
  } else if (a.type === 'organiser-remove') {
    authorized(m.role === 'admin');
    const p = s.members.find((p) => p.id === a.memberId);
    requireThat(
      p && s.orgs.some((o) => o.id === a.orgId),
      'Organiser or club not found.',
    );
    requireThat(
      organiserClubs(p).includes(a.orgId),
      'This person is not an organiser for this club.',
    );
    p.orgIds = p.orgIds.filter((id) => id !== a.orgId);
    if (p.role === 'admin') {
      p.organiserOrgIds = organiserClubs(p).filter((id) => id !== a.orgId);
      p.organiserOrgId = p.organiserOrgIds[0];
    }
    for (const i of s.invites)
      if (
        i.role === 'organiser' &&
        i.acceptedBy === p.id &&
        i.orgIds.includes(a.orgId)
      )
        i.revoked = true;
    note = `Removed ${p.name} as a club organiser`;
  } else if (a.type === 'member') {
    authorized(m.role === 'admin');
    const p = s.members.find((p) => p.id === a.id);
    requireThat(p, 'Member not found.');
    requireThat(
      ['admin', 'league-admin', 'organiser', 'parent'].includes(a.role),
      'Invalid role.',
    );
    requireThat(
      p.id !== m.id,
      'Ask another overall admin to change your own access.',
    );
    requireThat(
      Array.isArray(a.leagueIds) &&
        a.leagueIds.every((v: string) => s.leagues.some((l) => l.id === v)) &&
        Array.isArray(a.orgIds) &&
        a.orgIds.every((v: string) => s.orgs.some((o) => o.id === v)),
      'Invalid scope.',
    );
    p.role = a.role;
    p.leagueIds = a.leagueIds;
    p.orgIds = a.orgIds;
    note = 'Updated access permissions';
  } else if (a.type === 'photo') {
    const p = s.players.find((p) => p.id === a.playerId);
    requireThat(p, 'Player not found.');
    authorized(
      (m.role === 'parent' && p.parentId === m.id) || canOrg(s, m, p.orgId),
    );
    p.photoKey = a.photoKey;
    note = 'Updated a private identification photo';
  } else throw new AppError('Unknown action.');
  s.activity.unshift({ id: id(), at: now, by: m.id, text: note });
  if (['slots', 'cancel', 'start', 'finalise', 'reopen'].includes(a.type)) {
    const f = s.fixtures.find((f) => f.id === a.fixtureId)!;
    const recipients =
      s.enrollments
        ?.filter((e) => e.status === 'approved' && f.teamIds.includes(e.teamId))
        .map((e) => s.players.find((p) => p.id === e.playerId)?.parentId || '')
        .filter(Boolean) || [];
    const label: Record<string, string> = {
      slots: 'starting details are ready',
      cancel: 'this fixture has been cancelled',
      start: 'play has started — your scorecard is ready',
      finalise: 'results are confirmed',
      reopen: 'results are being reviewed',
    };
    notify(
      s,
      [...recipients, ...f.teamIds.flatMap((t) => teamManagers(s, t))],
      `${f.name}: ${label[a.type]}.`,
      f.id,
    );
  }
  if (a.type === 'fixture' && a.id) {
    const fixture = s.fixtures.find((f) => f.id === a.id)!;
    const parentIds =
      s.enrollments
        ?.filter(
          (e) => e.status === 'approved' && fixture.teamIds.includes(e.teamId),
        )
        .map(
          (e) => s.players.find((p) => p.id === e.playerId)?.parentId || '',
        ) || [];
    notify(
      s,
      parentIds.filter(Boolean),
      `${fixture.name}: the host updated the fixture details. Please check your arrival time.`,
      fixture.id,
    );
  }
  s.activity = s.activity.slice(0, 500);
  return s;
}

function removeFutureSelection(s: State, playerId: string, teamId: string) {
  for (const f of s.fixtures.filter((f) => f.status === 'scheduled'))
    for (const p of f.pairs.filter((p) => p.teamId === teamId))
      p.players = p.players.filter((id) => id !== playerId);
  s.reserves = s.reserves?.filter(
    (r) => r.playerId !== playerId || r.teamId !== teamId,
  );
}
function applyFamilyAction(
  source: State,
  m: Member,
  a: Action,
  now: string,
): State {
  const s = upgradeState(structuredClone(source));
  const authorise = (ok: boolean) =>
    requireThat(ok, 'You do not have permission for this action.', 403);
  if (a.type === 'fixture-confirm') {
    const f = s.fixtures.find((f) => f.id === a.fixtureId),
      p = s.players.find((p) => p.id === a.playerId);
    requireThat(
      f && p && f.status === 'scheduled',
      'Choose an upcoming fixture.',
    );
    authorise(m.role === 'parent' && p.parentId === m.id);
    const selection = selectionKey(f, p.id);
    requireThat(
      !!selection && a.selection === selection,
      'The selection has changed. Review the latest details before confirming.',
      409,
    );
    s.fixtureConfirmations = (s.fixtureConfirmations || []).filter(
      (c) => c.fixtureId !== f.id || c.playerId !== p.id,
    );
    s.fixtureConfirmations.push({
      fixtureId: f.id,
      playerId: p.id,
      selection,
      confirmedAt: now,
    });
    s.availability = (s.availability || []).filter(
      (v) => v.fixtureId !== f.id || v.playerId !== p.id,
    );
    s.availability.push({
      fixtureId: f.id,
      playerId: p.id,
      status: 'yes',
      updatedAt: now,
    });
    const pair = f.pairs.find((pair) => pair.players.includes(p.id))!;
    notify(
      s,
      teamManagers(s, pair.teamId),
      `${p.name}'s family has confirmed the selection for ${f.name}.`,
      f.id,
    );
  }
  if (a.type === 'fixture-message') {
    const f = s.fixtures.find((f) => f.id === a.fixtureId);
    const p = s.players.find((p) => p.id === a.playerId);
    const t = s.teams.find((t) => t.id === a.teamId);
    requireThat(
      f && p && t && f.teamIds.includes(t.id),
      'Choose a child and team in this fixture.',
    );
    const audience = a.audience || 'team';
    requireThat(
      ['team', 'host'].includes(audience),
      'Choose the team organiser or fixture host.',
    );
    authorise(
      canReadFixtureMessage(s, m, {
        playerId: p.id,
        teamId: t.id,
        fixtureId: f.id,
        audience,
      }),
    );
    requireThat(
      rosterEligible(s, p.id, t.id) ||
        f.pairs.some(
          (pair) => pair.teamId === t.id && pair.players.includes(p.id),
        ),
      'This child is not in this fixture’s team.',
    );
    const message = text(a.text, 'Message', 2000);
    s.fixtureMessages ??= [];
    s.fixtureMessages.push({
      id: crypto.randomUUID(),
      fixtureId: f.id,
      teamId: t.id,
      playerId: p.id,
      authorId: m.id,
      audience,
      authorName: m.name,
      fromParent: m.role === 'parent',
      text: message,
      createdAt: now,
    });
    notify(
      s,
      [
        ...new Set([
          ...teamManagers(s, t.id),
          ...(m.role === 'parent' ? [] : [p.parentId]),
          ...(audience === 'host'
            ? s.members
                .filter((person) => canHost(s, person, f))
                .map((person) => person.id)
            : []),
        ]),
      ].filter((id) => id !== m.id),
      `New fixture message about ${p.name} · ${f.name}.`,
      f.id,
    );
  }
  if (a.type === 'enrollment-transfer') {
    const e = s.enrollments!.find(
      (e) => e.id === a.id && e.status === 'approved',
    );
    requireThat(e, 'Approved registration not found.', 404);
    const from = s.teams.find((t) => t.id === e.teamId)!,
      to = s.teams.find((t) => t.id === a.teamId);
    requireThat(
      to &&
        !to.withdrawnAt &&
        to.id !== from.id &&
        to.leagueId === from.leagueId,
      'Choose a different team in this league.',
    );
    authorise(
      m.role !== 'parent' &&
        canManageTeam(s, m, from.id) &&
        canManageTeam(s, m, to.id),
    );
    requireThat(
      !s.fixtures.some(
        (f) =>
          f.status === 'live' &&
          f.leagueId === from.leagueId &&
          f.pairs.some((q) => q.players.includes(e.playerId)),
      ),
      'Wait for the current fixture to finish before moving this child.',
    );
    e.status = 'removed';
    e.decidedAt = now;
    removeFutureSelection(s, e.playerId, from.id);
    const existing = s.enrollments!.find(
      (v) =>
        v.playerId === e.playerId &&
        v.teamId === to.id &&
        v.status === 'pending',
    );
    if (existing) {
      existing.status = 'approved';
      existing.approvedAt = now;
      existing.decidedAt = now;
    } else
      s.enrollments!.push({
        id: crypto.randomUUID(),
        playerId: e.playerId,
        teamId: to.id,
        status: 'approved',
        requestedAt: now,
        approvedAt: now,
        decidedAt: now,
      });
    const p = s.players.find((p) => p.id === e.playerId)!;
    p.orgId = to.orgId;
    notify(
      s,
      [p.parentId, ...teamManagers(s, from.id), ...teamManagers(s, to.id)],
      `${p.name} has moved from ${from.name} to ${to.name}. Future selections for their previous team have been removed.`,
    );
  }
  if (a.type === 'notice-read') {
    const n = s.notifications!.find(
      (n) => n.id === a.id && n.recipient === m.id,
    );
    requireThat(n, 'Notification not found.', 404);
    n.readAt = now;
  }
  if (a.type === 'enrollment-add') {
    const t = s.teams.find((t) => t.id === a.teamId),
      p = s.players.find((p) => p.id === a.playerId);
    requireThat(t && p, 'Choose a registered child and team.');
    requireThat(!t.withdrawnAt, 'This team has been removed from the league.');
    authorise(
      m.role !== 'parent' && canManageTeam(s, m, t.id) && canOrg(s, m, p.orgId),
    );
    requireThat(
      p.orgId === t.orgId,
      'Use a parent request to share a child with another club.',
    );
    requireThat(
      !s.enrollments!.some(
        (e) =>
          e.playerId === p.id &&
          e.status === 'approved' &&
          s.teams.find((t) => t.id === e.teamId)?.leagueId === t.leagueId,
      ),
      'This child already has a team in this league. Use Move instead.',
    );
    requireThat(!!p.consentAt, 'Record parental registration consent first.');
    const pending = s.enrollments!.find(
      (e) => e.playerId === p.id && e.teamId === t.id && e.status === 'pending',
    );
    if (pending) {
      pending.status = 'approved';
      pending.approvedAt = now;
      pending.decidedAt = now;
    } else
      s.enrollments!.push({
        id: crypto.randomUUID(),
        playerId: p.id,
        teamId: t.id,
        status: 'approved',
        requestedAt: now,
        approvedAt: now,
        decidedAt: now,
      });
    notify(
      s,
      [p.parentId, ...teamManagers(s, t.id)],
      `${p.name} has been added to ${t.name} by the organiser.`,
    );
  }
  if (a.type === 'team-directory') {
    authorise(m.role !== 'parent' && canManageTeam(s, m, a.teamId));
    requireThat(
      !s.teams.find((t) => t.id === a.teamId)?.withdrawnAt,
      'This team has been removed.',
    );
    requireThat(
      a.open ||
        !s.enrollments!.some(
          (e) => e.teamId === a.teamId && e.status === 'pending',
        ),
      'Approve or decline the remaining applications before closing entry.',
    );
    s.teams.find((t) => t.id === a.teamId)!.enrollmentOpen = !!a.open;
  }
  if (a.type === 'enrollment-decision' || a.type === 'enrollment-remove') {
    const e = s.enrollments!.find((e) => e.id === a.id);
    requireThat(e, 'Team registration not found.', 404);
    const p = s.players.find((p) => p.id === e.playerId)!;
    let t = s.teams.find((t) => t.id === e.teamId)!;
    authorise(
      (m.role !== 'parent' && canManageTeam(s, m, t.id)) ||
        (a.type === 'enrollment-remove' &&
          m.role === 'parent' &&
          p.parentId === m.id),
    );
    if (a.type === 'enrollment-decision') {
      if (a.decision === 'approve' && a.teamId && a.teamId !== t.id) {
        const target = s.teams.find((v) => v.id === a.teamId);
        requireThat(
          target &&
            !target.withdrawnAt &&
            target.orgId === t.orgId &&
            target.leagueId === t.leagueId,
          'Choose a team for this club in the same league.',
        );
        authorise(m.role !== 'parent' && canManageTeam(s, m, target.id));
        t = target;
        e.teamId = target.id;
      }
      requireThat(
        e.status === 'pending',
        'This request has already been reviewed.',
        409,
      );
      requireThat(
        ['approve', 'reject'].includes(a.decision),
        'Choose approve or reject.',
      );
      if (a.decision === 'approve') {
        const old = s.enrollments!.filter(
          (o) =>
            o.id !== e.id &&
            o.playerId === p.id &&
            o.status === 'approved' &&
            s.teams.find((t) => t.id === o.teamId)?.leagueId === t.leagueId,
        );
        requireThat(
          !s.fixtures.some(
            (f) =>
              f.status === 'live' &&
              f.leagueId === t.leagueId &&
              f.pairs.some((q) => q.players.includes(p.id)),
          ),
          'Wait for the current fixture to finish before changing this child’s team.',
        );
        for (const o of old) {
          o.status = 'removed';
          o.decidedAt = now;
          removeFutureSelection(s, p.id, o.teamId);
          notify(
            s,
            teamManagers(s, o.teamId),
            `${p.name} has moved to ${t.name}. Future selections for their previous team were removed.`,
          );
        }
        e.status = 'approved';
        e.approvedAt = now;
        p.orgId = t.orgId;
      } else e.status = 'rejected';
    } else {
      requireThat(
        ['pending', 'approved'].includes(e.status),
        'This registration is no longer active.',
      );
      requireThat(
        !s.fixtures.some(
          (f) =>
            f.status === 'live' &&
            f.pairs.some((q) => q.teamId === t.id && q.players.includes(p.id)),
        ),
        'This child is currently playing. Contact the host before removing them from the team.',
      );
      e.status =
        m.role === 'parent' && p.parentId === m.id ? 'withdrawn' : 'removed';
      removeFutureSelection(s, p.id, t.id);
    }
    e.decidedAt = now;
    e.reason = text(a.reason || '', 'Message', 500, false);
    notify(
      s,
      [p.parentId, ...teamManagers(s, t.id)],
      `${p.name} · ${t.name}: ${e.status === 'approved' ? 'team registration approved' : e.status === 'rejected' ? 'team request declined' : e.status === 'withdrawn' ? 'team request or membership withdrawn' : 'removed from team'}${e.reason ? '. ' + e.reason : ''}.`,
    );
  }
  if (a.type === 'availability') {
    const p = s.players.find((p) => p.id === a.playerId),
      f = s.fixtures.find((f) => f.id === a.fixtureId);
    requireThat(p && f, 'Player or fixture not found.', 404);
    authorise(
      (m.role === 'parent' && p.parentId === m.id) || canLeague(m, f.leagueId),
    );
    requireThat(
      f.status === 'scheduled',
      'Availability can be changed for upcoming fixtures. Contact the host if play has started.',
    );
    requireThat(
      s.enrollments!.some(
        (e) =>
          e.playerId === p.id &&
          e.status === 'approved' &&
          f.teamIds.includes(e.teamId),
      ),
      'This child is not registered for a participating team.',
    );
    requireThat(
      ['yes', 'no', 'unsure'].includes(a.status),
      'Choose available, unavailable or unsure.',
    );
    s.availability = s.availability!.filter(
      (v) => v.fixtureId !== f.id || v.playerId !== p.id,
    );
    s.availability.push({
      playerId: p.id,
      fixtureId: f.id,
      status: a.status,
      updatedAt: now,
      updatedBy: m.id,
    });
    const affected =
      f.pairs.some((q) => q.players.includes(p.id)) ||
      s.reserves!.some((r) => r.fixtureId === f.id && r.playerId === p.id);
    if (a.status !== 'yes') {
      s.fixtureConfirmations = s.fixtureConfirmations?.filter(
        (c) => c.fixtureId !== f.id || c.playerId !== p.id,
      );
    }
    if (a.status === 'no') {
      for (const pair of f.pairs)
        pair.players = pair.players.filter((id) => id !== p.id);
      s.reserves = s.reserves!.filter(
        (r) => r.fixtureId !== f.id || r.playerId !== p.id,
      );
    }
    const managers = s
      .enrollments!.filter(
        (e) =>
          e.playerId === p.id &&
          e.status === 'approved' &&
          f.teamIds.includes(e.teamId),
      )
      .flatMap((e) => teamManagers(s, e.teamId));
    notify(
      s,
      managers,
      `${p.name}: ${a.status === 'yes' ? 'available' : a.status === 'no' ? 'unavailable' : 'not sure yet'} for ${f.name}${affected && a.status === 'no' ? '. Their selection has been withdrawn; please choose a replacement' : ''}.`,
      f.id,
    );
  }
  if (a.type === 'reserve') {
    const f = s.fixtures.find((f) => f.id === a.fixtureId);
    requireThat(f, 'Fixture not found.');
    authorise(m.role !== 'parent' && canManageTeam(s, m, a.teamId));
    requireThat(
      f.status === 'scheduled' && f.teamIds.includes(a.teamId),
      'Choose a participating team in an upcoming fixture.',
    );
    requireThat(
      rosterEligible(s, a.playerId, a.teamId),
      'This child must be approved for the team.',
    );
    requireThat(
      !f.pairs.some((p) => p.players.includes(a.playerId)),
      'A selected player cannot also be a reserve.',
    );
    requireThat(
      !s.availability!.some(
        (v) =>
          v.playerId === a.playerId &&
          v.fixtureId === f.id &&
          v.status === 'no',
      ),
      'This player is unavailable.',
    );
    s.reserves = s.reserves!.filter(
      (v) => v.playerId !== a.playerId || v.fixtureId !== f.id,
    );
    if (a.selected)
      s.reserves.push({
        fixtureId: f.id,
        teamId: a.teamId,
        playerId: a.playerId,
      });
    const p = s.players.find((p) => p.id === a.playerId)!;
    notify(
      s,
      [p.parentId],
      `${p.name} ${a.selected ? 'has been named as a reserve' : 'is no longer a reserve'} for ${f.name}.`,
      f.id,
    );
  }
  if (a.type === 'profile-review') {
    const change = s.profileChanges!.find((c) => c.id === a.id);
    requireThat(
      change && change.status === 'pending',
      'This update has already been reviewed.',
      409,
    );
    const p = s.players.find((p) => p.id === change.playerId)!;
    authorise(
      s.enrollments!.some(
        (e) =>
          e.playerId === p.id &&
          ['pending', 'approved'].includes(e.status) &&
          m.role !== 'parent' &&
          canManageTeam(s, m, e.teamId),
      ),
    );
    requireThat(
      ['approve', 'reject'].includes(a.decision),
      'Choose approve or reject.',
    );
    change.status = a.decision === 'approve' ? 'approved' : 'rejected';
    change.reason = text(a.reason || '', 'Message', 500, false);
    if (change.status === 'approved') {
      p.name = change.proposed.name;
      p.dob = change.proposed.dob;
      p.handicap = change.proposed.handicap;
      p.photoConsent = change.proposed.photoConsent;
    }
    notify(
      s,
      [p.parentId],
      `${p.name}: your profile update was ${change.status}${change.reason ? '. ' + change.reason : ''}.`,
    );
  }
  s.activity.unshift({
    id: crypto.randomUUID(),
    at: now,
    by: m.id,
    text: a.type,
  });
  return s;
}
