import { db, user, unifyOwnedRecords, saveCAS, type Row } from './server';
import {
  AppError,
  applyAction,
  emptyState,
  upgradeState,
  projectState,
  notify,
  teamManagers,
  requireThat,
  leagueAcceptsRegistrations,
  text,
  type Player,
  type State,
  type Member,
} from './model';
import { isEnteredChild } from './shared-records';
export type Family = {
  registration?: { name: string; phone: string; parent: boolean };
  children: Player[];
  pendingSync: Record<string, string>;
  legacyImports?: string[];
};
type FamilyRow = { id: string; revision: number; data: string };
export async function ownedWorkspaces(uid: string) {
  return (
    await db()
      .prepare(
        "SELECT * FROM workspaces WHERE (demo=0 OR demo=2) AND EXISTS (SELECT 1 FROM json_each(workspaces.data,'$.members') m WHERE json_extract(m.value,'$.id')=?)",
      )
      .bind(uid)
      .all<Row>()
  ).results;
}
export function parentMember(u: {
  userId: string;
  displayName: string;
  email: string;
}): Member {
  return {
    id: u.userId,
    name: u.displayName,
    email: u.email,
    phone: '',
    role: 'parent',
    leagueIds: [],
    orgIds: [],
  };
}
export async function familyContext(_demo = false, _stage = 'ready') {
  const u = await user();
  await unifyOwnedRecords(u);
  const member = parentMember(u);
  const rows = await ownedWorkspaces(u.userId);
  const children = [
    ...new Map(
      rows
        .flatMap((w) =>
          (JSON.parse(w.data) as State).players.filter(
            (p) => p.parentId === u.userId,
          ),
        )
        .map((p) => [p.id, p]),
    ).values(),
  ];
  await db()
    .prepare('INSERT OR IGNORE INTO families(id,data,revision) VALUES (?,?,0)')
    .bind(u.userId, JSON.stringify({ children, pendingSync: {} }))
    .run();
  const legacy = await db()
    .prepare(
      "SELECT f.id,f.data,f.revision FROM families f JOIN workspaces w ON f.id=w.id || ':family' WHERE w.owner=?",
    )
    .bind(u.userId)
    .all<FamilyRow>();
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = (await db()
      .prepare('SELECT * FROM families WHERE id=?')
      .bind(u.userId)
      .first<FamilyRow>())!;
    const family = JSON.parse(row.data) as Family;
    if (family.registration) {
      member.name = family.registration.name;
      member.phone = family.registration.phone;
    }
    let changed = false;
    family.legacyImports ??= [];
    for (const previous of legacy.results) {
      if (family.legacyImports.includes(previous.id)) continue;
      const old = JSON.parse(previous.data) as Family;
      for (const p of old.children) {
        if (!isEnteredChild(p) || family.children.some((c) => c.id === p.id))
          continue;
        family.children.push({ ...p, parentId: u.userId, familyManaged: true });
        family.pendingSync[p.id] = new Date().toISOString();
      }
      family.legacyImports.push(previous.id);
      changed = true;
    }
    for (const p of children)
      if (!family.children.some((c) => c.id === p.id)) {
        family.children.push(p);
        changed = true;
      }
    if (changed && !(await familyCAS(row, family))) continue;
    if (changed) row.revision++;
    return {
      u,
      member,
      row,
      family,
      demo: !!u.demoWorkspace,
      stage: 'ready',
    };
  }
  throw new AppError(
    'Your family records changed during the update. Please refresh.',
    409,
  );
}
export async function familyCAS(row: FamilyRow, family: Family) {
  const r = await db()
    .prepare(
      'UPDATE families SET data=?,revision=revision+1 WHERE id=? AND revision=?',
    )
    .bind(JSON.stringify(family), row.id, row.revision)
    .run();
  return r.meta.changes === 1;
}
export async function syncFamily(c: Awaited<ReturnType<typeof familyContext>>) {
  const targets = await ownedWorkspaces(c.u.userId);
  let done = true;
  for (const [pid, stamp] of Object.entries(c.family.pendingSync)) {
    const proposed = c.family.children.find((p) => p.id === pid);
    if (!proposed) continue;
    for (const target of targets) {
      let ok = false;
      for (let i = 0; i < 4; i++) {
        const row = await db()
          .prepare('SELECT * FROM workspaces WHERE id=?')
          .bind(target.id)
          .first<Row>();
        const s = upgradeState(JSON.parse(row!.data));
        const p = s.players.find(
          (p) => p.id === pid && p.parentId === c.member.id,
        );
        if (!p || (p as any).familyVersion >= stamp) {
          ok = true;
          break;
        }
        const active = s.enrollments!.filter(
          (e) =>
            e.playerId === pid && ['pending', 'approved'].includes(e.status),
        );
        const managers = active.flatMap((e) => teamManagers(s, e.teamId));
        p.photoKey = proposed.photoKey;
        if (proposed.gender !== undefined) p.gender = proposed.gender;
        p.diet = proposed.diet;
        p.care = proposed.care;
        p.emergencyName = proposed.emergencyName;
        p.emergencyPhone = proposed.emergencyPhone;
        if (!proposed.photoConsent) p.photoConsent = false;
        (p as any).familyVersion = stamp;
        p.familyManaged = true;
        const routine =
          p.name !== proposed.name ||
          p.dob !== proposed.dob ||
          p.handicap !== proposed.handicap ||
          p.photoConsent !== proposed.photoConsent;
        s.profileChanges = s.profileChanges!.filter(
          (v) => v.playerId !== pid || v.status !== 'pending',
        );
        if (routine && active.some((e) => e.status === 'approved'))
          s.profileChanges.push({
            id: crypto.randomUUID(),
            playerId: pid,
            proposed: { ...proposed, orgId: p.orgId },
            status: 'pending',
            requestedAt: stamp,
          });
        else {
          p.name = proposed.name;
          p.dob = proposed.dob;
          p.handicap = proposed.handicap;
          p.photoConsent = proposed.photoConsent;
        }
        notify(
          s,
          managers,
          `${p.name}: a parent updated their details. Care and emergency information is current${routine ? '; review the profile changes' : ''}.`,
        );
        if (await saveCAS(row!, s)) {
          ok = true;
          break;
        }
      }
      done &&= ok;
    }
  }
  if (done && Object.keys(c.family.pendingSync).length) {
    const next = { ...c.family, pendingSync: {} };
    if (await familyCAS(c.row, next)) {
      c.family = next;
      c.row.revision++;
    }
  }
  return done;
}
export async function parentSnapshot(demo = false, stage = 'ready') {
  const c = await familyContext(demo, stage);
  const synced = await syncFamily(c);
  const rows = await ownedWorkspaces(c.u.userId);
  const demoSession = c.u.demoWorkspace
    ? await (await import('./demo-session')).activeDemo()
    : null;
  const viewingDate = c.u.demoWorkspace
    ? demoSession?.session.today
    : await (await import('./live-clock')).liveViewingDate();
  const seasons = rows.map((row) => {
    const s = upgradeState(JSON.parse(row.data));
    return {
      workspace: row.id,
      workspaceName: row.name,
      demo: !!row.demo,
      revision: row.revision,
      me: c.member,
      state: {
        ...projectState(s, c.member),
        demoToday: viewingDate || undefined,
      },
      workspaces: [],
    };
  });
  const catalogRows = (
    await db()
      .prepare(
        c.u.demoWorkspace
          ? 'SELECT * FROM workspaces WHERE id=? AND demo=2'
          : 'SELECT * FROM workspaces WHERE demo=0',
      )
      .bind(...(c.u.demoWorkspace ? [c.u.demoWorkspace] : []))
      .all<Row>()
  ).results;
  const directory = catalogRows.flatMap((row) => {
    const s = JSON.parse(row.data) as State;
    return s.teams
      .filter(
        (t) =>
          !t.withdrawnAt &&
          t.enrollmentOpen !== false &&
          leagueAcceptsRegistrations(
            s.leagues.find((l) => l.id === t.leagueId),
          ),
      )
      .map((t) => ({
        workspace: row.id,
        team: t,
        league: s.leagues.find((l) => l.id === t.leagueId)!,
        organisation: s.orgs.find((o) => o.id === t.orgId)!,
      }));
  });
  const clubs = catalogRows.flatMap((row) => {
    const s = JSON.parse(row.data) as State;
    return s.orgs.map((o) => ({
      workspace: row.id,
      id: o.id,
      name: o.name,
      venues: s.clubs.filter((c) => c.orgId === o.id).map((c) => c.name),
    }));
  });
  return {
    family: c.family,
    revision: c.row.revision,
    me: c.member,
    seasons,
    directory,
    clubs,
    demo: c.demo,
    stage: 'ready',
    syncPending: !synced,
  };
}
export async function saveChild(a: any, demo = false, stage = 'ready') {
  const c = await familyContext(demo, stage);
  requireThat(
    a.expectedRevision === c.row.revision,
    'Your family details changed elsewhere. Refresh and try again.',
    409,
  );
  const old = c.family.children.find((p) => p.id === a.id);
  if (a.id) requireThat(old, 'Child not found.', 404);
  const state = emptyState();
  state.members = [c.member];
  state.orgs = [{ id: 'family', name: 'Family' }];
  state.players = old ? [{ ...old, orgId: 'family' }] : [];
  const me = { ...c.member, orgIds: ['family'] };
  const changed = applyAction(state, me, {
    ...a,
    type: 'player',
    orgId: 'family',
    parentId: me.id,
  });
  const child = {
    ...changed.players[0],
    orgId: old?.orgId || '',
    familyManaged: true,
  };
  c.family.children = old
    ? c.family.children.map((p) => (p.id === child.id ? child : p))
    : [...c.family.children, child];
  c.family.pendingSync[child.id] = new Date().toISOString();
  requireThat(
    await familyCAS(c.row, c.family),
    'Your family details changed elsewhere. Refresh and try again.',
    409,
  );
  return parentSnapshot(demo, stage);
}
export async function requestTeam(a: any, demo = false, stage = 'ready') {
  const c = await familyContext(demo, stage);
  const child = c.family.children.find((p) => p.id === a.playerId);
  requireThat(child, 'Choose one of your children.', 404);
  requireThat(
    a.consent === true,
    'Confirm sharing this child’s registration with the team organiser.',
  );
  for (let i = 0; i < 4; i++) {
    const row = await db()
      .prepare('SELECT * FROM workspaces WHERE id=?')
      .bind(a.workspace)
      .first<Row>();
    requireThat(row, 'Team not found.', 404);
    requireThat(
      c.u.demoWorkspace
        ? row.id === c.u.demoWorkspace && row.demo === 2
        : !row.demo,
      'This team is not available for registration.',
      403,
    );
    const s = upgradeState(JSON.parse(row.data));
    const team = s.teams.find((t) => t.id === a.teamId);
    requireThat(team, 'Team not found.', 404);
    requireThat(
      !team.withdrawnAt && team.enrollmentOpen !== false,
      'This team is closed to new applications. Please contact its organiser.',
    );
    requireThat(
      leagueAcceptsRegistrations(s.leagues.find((l) => l.id === team.leagueId)),
      'This team’s season is not open for new registrations.',
    );
    let viaCode = false;
    if (typeof a.code === 'string') {
      const code = await db()
        .prepare(
          'SELECT code FROM team_codes WHERE code=? AND workspace=? AND team_id=? AND revoked=0 AND expires>?',
        )
        .bind(a.code, a.workspace, team.id, new Date().toISOString())
        .first();
      viaCode = !!code;
    }
    requireThat(
      !a.code || viaCode,
      'This code has expired or been revoked. Find the team by name or ask for a new code.',
    );
    requireThat(
      !s.enrollments!.some(
        (e) =>
          e.playerId === child.id &&
          (e.teamId === team.id ||
            (a.clubRequest &&
              s.teams.some(
                (t) =>
                  t.id === e.teamId &&
                  t.orgId === team.orgId &&
                  t.leagueId === team.leagueId,
              ))) &&
          ['pending', 'approved'].includes(e.status),
      ),
      'This child already has a request or a place in this team.',
    );
    if (!s.members.some((m) => m.id === c.member.id)) s.members.push(c.member);
    if (!s.players.some((p) => p.id === child.id))
      s.players.push({ ...child, orgId: team.orgId });
    s.enrollments!.push({
      id: crypto.randomUUID(),
      playerId: child.id,
      teamId: team.id,
      clubRequest: a.clubRequest === true,
      preference: text(a.preference || '', 'Message', 1000, false),
      status: 'pending',
      requestedAt: new Date().toISOString(),
    });
    notify(
      s,
      teamManagers(s, team.id),
      `${child.name} would like to join ${a.clubRequest ? s.orgs.find((o) => o.id === team.orgId)?.name || 'your club' : team.name}. Review the parent’s request and team preference.`,
    );
    notify(
      s,
      [c.member.id],
      `Your request for ${child.name} to join ${a.clubRequest ? s.orgs.find((o) => o.id === team.orgId)?.name || 'the club' : team.name} has been sent. The organiser will confirm their team.`,
    );
    if (await saveCAS(row, s)) return parentSnapshot(demo, stage);
  }
  throw new AppError('Another update arrived. Please try again.', 409);
}
