import {
  AppError,
  applyAction,
  emptyState,
  type Action,
  type Member,
  type State,
} from './model';
import { planningKey } from './season-planning';

// The assistant uses the same validated domain actions as the admin screens.
export const ADMIN_ACTIONS: Record<string, string> = {
  'fixtures-confirm':
    'leagueId. Explicitly confirm/publish an existing season fixture list and notify families and organisers in the app. Only when the administrator asks to confirm or publish fixtures. This does not close player registration.',
  availability:
    'fixtureId,playerId,status(yes|no|unsure). Record player availability as the administrator. Do not invent real family responses; generated data must be explicitly requested as test data.',
  'club-confirm': 'clubId. Confirm club details.',
  'hosting-offer':
    'clubId,leagueId,capacity(0..3),dates(YYYY-MM-DD[]),shotgun,presentation,food(each yes|no|unsure),notes. Record or update provisional hosting availability. Preserve existing responses unless asked to replace them. For generated test responses put TEST AVAILABILITY in notes; updatedBy remains the administrator, never impersonate the organiser.',
  'fixture-planning':
    'leagueId,count(2..36),start,end(YYYY-MM-DD),minGap(1..60 days). Save planning settings. Season dates may extend into the following calendar year.',
  'fixture-plan-apply':
    'leagueId,arrival,start(HH:MM). Generate fixtures from saved planning settings and hosting offers using the app scheduling rules. planningKey is supplied by the app. Do not invent a key.',
  'team-directory':
    'teamId,open(boolean). Open or close one team for registration; resolve pending applications first.',
  'team-replace':
    'teamId,orgId,name,cap,color. Replace a league team; old memberships and future selections end, history is retained.',
  organisation: 'name. Create a club organisation.',
  player:
    'id? and changed fields: orgId,parentId,name,dob,handicap,gender,diet,care,photoConsent,emergencyName,emergencyPhone,consent. Existing fields are merged locally. For new real children require supplied details and explicit registration/consent authority; never infer photo or care consent. Use test-family actions for generated children.',
  lineup:
    'fixtureId,teamId,pairs(array of two player IDs per pair). Select the required number of pairs from approved available players.',
  slots:
    'fixtureId,slots([{id,label,capacity(2..4)}]),assignments({pairId:slotId}). Allocate tee times or starting holes. Use unique local slot IDs when creating slots.',
  score:
    'fixtureId,pairId,hole,strokes. Current score version is supplied locally. Scores need a live fixture; only generate fictional scores when explicitly asked for test scores.',
  start: 'fixtureId. Start a ready fixture.',
  finalise:
    'fixtureId. Complete a fully scored live fixture and calculate results.',
  reopen: 'fixtureId. Reopen completed results for correction.',
  cancel: 'fixtureId. Cancel an upcoming fixture.',
  'enrollment-add':
    'playerId,teamId. Add an existing child to their club team.',
  'enrollment-decision':
    'id(enrollment),decision(approve|reject),teamId?,reason?. Decide an application; optionally allocate a different team of that club.',
  'enrollment-transfer':
    'id(enrollment),teamId. Move a child between teams in the same league.',
  'enrollment-remove':
    'id(enrollment),reason?. Remove a child from a team and future selections.',
  reserve: 'fixtureId,teamId,playerId,selected(boolean). Add/remove a reserve.',
  member:
    'id,role(admin|league-admin|organiser|parent),orgIds,leagueIds. Update an existing member’s role/scope only when requested; cannot change the acting admin’s own access.',
  'organiser-remove':
    'memberId,orgId. Remove organiser access to one club, keeping other affiliations.',
  'organiser-club':
    'orgId. Associate the acting Foundation admin with another organiser club.',
  'access-request-decision':
    'id,decision(approve|reject). Decide an access request.',
  'login-help-status':
    'id,status(new|contacted|resolved). Update a login help request.',
  'profile-review':
    'id,decision(approve|reject),reason?. Decide a pending profile update.',
  'fixture-message':
    'fixtureId,playerId,teamId,text. Send an in-app fixture message only when explicitly requested. No email is sent.',
  revoke: 'id(invitation). Revoke a pending invitation.',
  'workspace-reset':
    'No extra fields. Clear the workspace while keeping Foundation admin access; only when explicitly asked to clear/reset. Must be the sole action. Review and Undo use the existing reset recovery process.',
};

export type Proposal = {
  message: string;
  changes: { description: string; action: Action }[];
  sources: { title: string; url: string }[];
  warnings: string[];
  reset?: boolean;
};
const allowed = new Set([
  'club-import',
  'club',
  'league',
  'team',
  'team-remove',
  'fixture',
  'add-test-families',
  'add-test-organisers',
  ...Object.keys(ADMIN_ACTIONS),
]);
export function assistantContext(s: State) {
  // Include operational identities, but keep contact details, care notes, photos and invitation secrets local.
  return {
    leagues: s.leagues,
    participants: s.players.map(({ id, name, orgId, parentId, handicap }) => ({
      id,
      name,
      orgId,
      parentId,
      handicap,
    })),
    staffAndFamilies: s.members.map(
      ({ id, name, role, orgIds, leagueIds, organiserOrgIds }) => ({
        id,
        name,
        role,
        orgIds,
        leagueIds,
        organiserOrgIds,
      }),
    ),
    enrollments: (s.enrollments || []).map(
      ({ id, playerId, teamId, status }) => ({ id, playerId, teamId, status }),
    ),
    availability: s.availability || [],
    reserves: s.reserves || [],
    hostingOffers: s.hostingOffers || [],
    accessRequests: (s.accessRequests || []).map(
      ({ id, name, role, orgId, status }) => ({
        id,
        name,
        role,
        orgId,
        status,
      }),
    ),
    profileChanges: (s.profileChanges || []).map(
      ({ id, playerId, status }) => ({ id, playerId, status }),
    ),
    loginHelpRequests: (s.loginHelpRequests || []).map(
      ({ id, orgId, status }) => ({ id, orgId, status }),
    ),
    invitations: s.invites.map(
      ({ id, role, orgIds, leagueIds, acceptedAt, revoked, expires }) => ({
        id,
        role,
        orgIds,
        leagueIds,
        acceptedAt,
        revoked,
        expires,
      }),
    ),
    clubs: s.clubs.map(
      ({ id, orgId, name, address, county, postcode, website }) => ({
        id,
        orgId,
        name,
        address,
        county,
        postcode,
        website,
      }),
    ),
    organisations: s.orgs,
    teams: s.teams
      .filter((t) => !t.withdrawnAt)
      .map(({ id, orgId, leagueId, name, color, cap, enrollmentOpen }) => ({
        id,
        orgId,
        leagueId,
        name,
        color,
        cap,
        enrollmentOpen,
        registeredCount: new Set(
          (s.enrollments || [])
            .filter(
              (e) =>
                e.teamId === id && ['approved', 'pending'].includes(e.status),
            )
            .map((e) => e.playerId),
        ).size,
        approvedCount: (s.enrollments || []).filter(
          (e) => e.teamId === id && e.status === 'approved',
        ).length,
      })),
    fixtures: s.fixtures.map(
      ({
        id,
        leagueId,
        clubId,
        date,
        arrival,
        start,
        format,
        status,
        teamIds,
        pairs,
        slots,
        scores,
        results,
      }) => ({
        id,
        leagueId,
        clubId,
        date,
        arrival,
        start,
        format,
        status,
        teamIds,
        pairs,
        slots,
        scores,
        results,
      }),
    ),
  };
}
export function parseProposal(raw: any): Proposal {
  if (
    !raw ||
    typeof raw.message !== 'string' ||
    raw.message.length > 6000 ||
    !Array.isArray(raw.changes) ||
    raw.changes.length > 500
  )
    throw new AppError(
      'The assistant returned an incomplete proposal. Please try a smaller request.',
    );
  const changes = raw.changes.map((c: any) => {
    if (
      typeof c.description !== 'string' ||
      c.description.length > 1000 ||
      typeof c.actionJson !== 'string' ||
      c.actionJson.length > 80000
    )
      throw new AppError(
        'The assistant returned an invalid change. Nothing has been applied.',
      );
    const action = JSON.parse(c.actionJson);
    if (!action || !allowed.has(action.type))
      throw new AppError(
        'The proposed action is not recognised. Please describe the change using the app’s clubs, leagues, players or fixtures.',
      );
    // Images are separate user-approved jobs; avoid invisible writes invalidating undo.
    if (
      action.type === 'club-import' &&
      (!Array.isArray(action.clubs) ||
        action.clubs.some((r: any) => !r || typeof r.name !== 'string'))
    )
      throw new AppError(
        'The club list is incomplete. Nothing has been applied.',
      );
    return { description: c.description, action };
  });
  const sources = (Array.isArray(raw.sources) ? raw.sources : [])
    .slice(0, 200)
    .filter((s: any) => {
      try {
        return (
          typeof s.title === 'string' &&
          s.title.length <= 300 &&
          ['https:', 'http:'].includes(new URL(s.url).protocol)
        );
      } catch {
        return false;
      }
    })
    .map((s: any) => ({ title: s.title, url: s.url }));
  return {
    message: raw.message,
    changes,
    ...(changes.some((c: any) => c.action.type === 'workspace-reset')
      ? { reset: true }
      : {}),
    sources,
    warnings: (Array.isArray(raw.warnings) ? raw.warnings : [])
      .filter((s: any) => typeof s === 'string')
      .slice(0, 20),
  };
}
export function applyProposal(s: State, me: Member, p: Proposal): State {
  if (me.role !== 'admin')
    throw new AppError('Foundation administrator access is required.', 403);
  if (p.reset) {
    if (p.changes.some((c) => c.action.type !== 'workspace-reset'))
      throw new AppError(
        'Review a workspace reset separately from other changes.',
      );
    const next = emptyState();
    next.members = s.members
      .filter((m) => m.role === 'admin' && !m.id.startsWith('demo-'))
      .map((m) => ({
        ...m,
        organiserOrgId: undefined,
        organiserOrgIds: [],
        orgIds: [],
        leagueIds: [],
      }));
    if (!next.members.some((m) => m.id === me.id))
      next.members.push({
        ...me,
        organiserOrgId: undefined,
        organiserOrgIds: [],
        orgIds: [],
        leagueIds: [],
      });
    return next;
  }
  let next = structuredClone(s);
  for (const c of p.changes) {
    if (!allowed.has(c.action.type))
      throw new AppError('This change is not supported by the assistant.');
    if (
      c.action.type === 'add-test-organisers' &&
      (Object.keys(c.action).some(
        (key) => !['type', 'clubIds', 'count'].includes(key),
      ) ||
        !Array.isArray(c.action.clubIds) ||
        c.action.clubIds.some((id: unknown) => typeof id !== 'string') ||
        !Number.isInteger(c.action.count))
    )
      throw new AppError(
        'Choose clubs and a test-organiser count. The app creates the fictional profiles itself.',
      );
    if (
      c.action.type === 'add-test-families' &&
      (Object.keys(c.action).some(
        (key) =>
          !['type', 'leagueName', 'year', 'teamName', 'targetSize'].includes(
            key,
          ),
      ) ||
        !Number.isInteger(c.action.targetSize))
    )
      throw new AppError(
        'For test families, choose a league, season and target size. The app creates the fictional profiles itself.',
      );
    let action = { ...c.action };
    const collection =
      action.type === 'league'
        ? next.leagues
        : action.type === 'team'
          ? next.teams
          : action.type === 'fixture'
            ? next.fixtures
            : action.type === 'club'
              ? next.clubs
              : action.type === 'player'
                ? next.players
                : undefined;
    if (action.id && collection && !collection.some((v) => v.id === action.id))
      throw new AppError(
        'A record in this proposal no longer exists. Please ask again.',
      );
    if (action.type === 'club') {
      const old = next.clubs.find((v) => v.id === action.id);
      action = {
        ...old,
        ...action,
      };
    }
    if (action.type === 'league') {
      const old = next.leagues.find((v) => v.id === action.id);
      action = {
        ...old,
        ...action,
        adminId: action.adminId ?? old?.adminId ?? me.id,
        assistantId: action.assistantId ?? old?.assistantId ?? '',
      };
    }
    if (
      action.type === 'team' ||
      action.type === 'fixture' ||
      action.type === 'player' ||
      action.type === 'member'
    ) {
      const records =
        action.type === 'team'
          ? next.teams
          : action.type === 'fixture'
            ? next.fixtures
            : action.type === 'player'
              ? next.players
              : next.members;
      const old = records.find((v) => v.id === action.id);
      action = { ...old, ...action };
      if (action.type === 'player' && old && !('consent' in c.action))
        action.consent = !!(old as any).consentAt;
    }
    if (action.type === 'fixture-plan-apply')
      action.planningKey = planningKey(next, action.leagueId);
    if (action.type === 'score')
      action.expectedVersion =
        next.fixtures.find((f) => f.id === action.fixtureId)?.scores[
          `${action.pairId}:${action.hole}`
        ]?.version || 0;
    next = applyAction(next, me, action);
  }
  // Keep website discovery manual for these batches, so Apply has one predictable result.
  next.clubs.forEach((c) => {
    if (
      c.imageStatus === 'pending' &&
      !s.clubs.some((old) => old.imageJobId === c.imageJobId)
    )
      c.imageStatus = 'none';
  });
  return next;
}
export function describeChanges(before: State, after: State) {
  const resolve = (value: any, state: State): string => {
    if (value === undefined || value === '') return '—';
    const lookup = (v: any) =>
      typeof v === 'string'
        ? [
            ...state.clubs,
            ...state.orgs,
            ...state.leagues,
            ...state.teams,
            ...state.players,
            ...state.members,
            ...state.fixtures,
          ].find((x) => x.id === v)?.name || v
        : v;
    return typeof value === 'object'
      ? JSON.stringify(value, (key, v) => lookup(v))
      : String(lookup(value));
  };
  const changes = (
    ['leagues', 'clubs', 'teams', 'fixtures', 'players', 'members'] as const
  ).flatMap((key) => {
    // Test-family contacts are already included in their children's preview.
    const a = before[key].filter(
        (x) => key !== 'members' || !x.id.startsWith('test-families-'),
      ),
      b = after[key].filter(
        (x) => key !== 'members' || !x.id.startsWith('test-families-'),
      );
    return [
      ...a
        .filter((x) => !b.some((y) => x.id === y.id))
        .map((x) => ({
          kind: 'Remove',
          entity: key,
          name: x.name,
          details: [] as string[],
        })),
      ...b.flatMap((x) => {
        const old = a.find((y) => y.id === x.id);
        if (old && JSON.stringify(old) === JSON.stringify(x)) return [];
        const fields = [
          'name',
          'address',
          'county',
          'postcode',
          'website',
          'instructions',
          'year',
          'region',
          'date',
          'arrival',
          'start',
          'format',
          'registration',
          'foodBefore',
          'foodAfter',
          'cap',
          'leagueId',
          'orgId',
          'clubId',
          'enrollmentOpen',
          'registrationOpen',
          'withdrawnAt',
          'holes',
          'pairs',
          'maxStrokes',
          'squadSize',
          'tiePolicy',
          'status',
          'teamIds',
          'fixturePlanning',
          'fixturesConfirmedAt',
          'fixturesConfirmedBy',
          'adminId',
          'assistantId',
          'role',
          'orgIds',
          'leagueIds',
          'organiserOrgIds',
          'welfareName',
          'welfareEmail',
          'safeGolf',
          'confirmedAt',
          'dob',
          'handicap',
          'gender',
          'diet',
          'care',
          'photoConsent',
          'emergencyName',
          'emergencyPhone',
          'slots',
          'scores',
          'results',
        ];
        const label = (field: string, value: any, state: State): string => {
          if (field === 'leagueId')
            return (
              state.leagues.find((l) => l.id === value)?.name || String(value)
            );
          if (field === 'orgId')
            return (
              state.orgs.find((o) => o.id === value)?.name || String(value)
            );
          if (field === 'clubId')
            return (
              state.clubs.find((c) => c.id === value)?.name || String(value)
            );
          if (field === 'teamIds' && Array.isArray(value))
            return value
              .map((id) => state.teams.find((t) => t.id === id)?.name || id)
              .join(', ');
          return resolve(value, state);
        };
        const names: Record<string, string> = {
          leagueId: 'League',
          orgId: 'Club',
          clubId: 'Venue',
          enrollmentOpen: 'Team registration open',
          registrationOpen: 'Registration open',
          withdrawnAt: 'Removed',
          tiePolicy: 'Tied positions',
        };
        const details = fields
          .filter(
            (f) =>
              f !== 'name' &&
              JSON.stringify((x as any)[f]) !==
                JSON.stringify((old as any)?.[f]),
          )
          .map(
            (f) =>
              `${names[f] || f.charAt(0).toUpperCase() + f.slice(1)}: ${old ? label(f, (old as any)[f], before) + ' → ' : ''}${label(f, (x as any)[f], after)}`,
          );
        if (
          key === 'teams' &&
          (x as any).withdrawnAt &&
          !(old as any)?.withdrawnAt
        )
          details.push(
            'Current memberships and future selections end. Past results and children’s profiles are kept.',
          );
        if (key === 'players' && !old) {
          const enrollment = after.enrollments?.find(
            (e) =>
              e.playerId === x.id && ['approved', 'pending'].includes(e.status),
          );
          const team = after.teams.find((t) => t.id === enrollment?.teamId);
          if (team)
            details.push(
              `Team: ${team.name} · ${team.cap} caps`,
              `Place: ${enrollment?.status === 'approved' ? 'In the team' : 'Applying to play'}`,
            );
          const parent = after.members.find(
            (m) => m.id === (x as any).parentId,
          );
          if (parent && x.id.startsWith('test-families-'))
            details.push(
              `Fictional family: ${parent.name}. No account or email invitation is created.`,
            );
        }
        if (key === 'members' && x.id.startsWith('test-organisers-v1:')) {
          const member = x as Member;
          details.push(
            'Role: Junior organiser (fictional test profile)',
            `Club: ${after.clubs
              .filter((c) => member.orgIds.includes(c.orgId))
              .map((c) => c.name)
              .join(', ')}`,
            'No sign-in account or email invitation is created.',
          );
        }
        return [
          { kind: old ? 'Update' : 'Add', entity: key, name: x.name, details },
        ];
      }),
    ];
  });
  const extras: {
    kind: string;
    entity: string;
    name: string;
    details: string[];
  }[] = [];
  const excluded = new Set([
    'leagues',
    'clubs',
    'teams',
    'fixtures',
    'players',
    'members',
    'activity',
    'notifications',
  ]);
  const keyFor = (x: any) =>
    x.id ||
    [x.clubId, x.leagueId, x.fixtureId, x.playerId, x.teamId]
      .filter(Boolean)
      .join(':');
  const hidden = new Set([
    'id',
    'hash',
    'createdAt',
    'updatedAt',
    'requestedAt',
    'decidedAt',
    'updatedBy',
    'confirmedAt',
    'acceptedAt',
  ]);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (excluded.has(key)) continue;
    const a: any[] = (before as any)[key] || [],
      b: any[] = (after as any)[key] || [];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    for (const id of new Set([...a, ...b].map(keyFor))) {
      const old = a.find((x) => keyFor(x) === id),
        next = b.find((x) => keyFor(x) === id);
      if (JSON.stringify(old) === JSON.stringify(next)) continue;
      const row = next || old;
      const fields = [
        ...new Set([...Object.keys(old || {}), ...Object.keys(next || {})]),
      ].filter(
        (f) =>
          !hidden.has(f) &&
          JSON.stringify(old?.[f]) !== JSON.stringify(next?.[f]),
      );
      if (!fields.length) continue;
      const name =
        [
          row.name,
          row.clubId,
          row.leagueId,
          row.playerId,
          row.teamId,
          row.fixtureId,
        ]
          .filter(Boolean)
          .map((v) => resolve(v, after))
          .join(' · ') || key;
      extras.push({
        kind: !next ? 'Remove' : old ? 'Update' : 'Add',
        entity: key,
        name,
        details: fields.map(
          (f) =>
            `${f}: ${old ? resolve(old[f], before) + ' → ' : ''}${resolve(next?.[f], after)}`,
        ),
      });
    }
  }
  const notices = (after.notifications || []).filter(
    (n) => !before.notifications?.some((v) => v.id === n.id),
  );
  if (notices.length)
    extras.push({
      kind: 'Add',
      entity: 'notifications',
      name: `${notices.length} in-app notifications`,
      details: [...new Set(notices.map((n) => n.text))],
    });
  return [...changes, ...extras];
}
