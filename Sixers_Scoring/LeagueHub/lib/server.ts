import { env, waitUntil } from 'cloudflare:workers';
import { currentIdentity } from './identity';
import {
  AppError,
  applyAction,
  emptyState,
  projectState,
  upgradeState,
  organiserClubs,
  type State,
  type Member,
  type Action,
} from './model';
import { adoptWorkspace, hasCustomSetup } from './shared-records';
export type Row = {
  id: string;
  name: string;
  owner: string;
  demo: number;
  revision: number;
  data: string;
  updated: string;
};
export const db = () => (env as unknown as { DB: D1Database }).DB;
export const files = () => (env as unknown as { FILES: R2Bucket }).FILES;
export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export function failure(e: unknown) {
  return json(
    {
      error:
        e instanceof AppError
          ? e.message
          : 'We could not save this change. Please try again.',
    },
    e instanceof AppError ? e.status : 500,
  );
}
export async function user() {
  const u = await currentIdentity();
  if (!u) throw new AppError('Sign in to open your league workspace.', 401);
  return u;
}
export async function unifyOwnedRecords(
  u: Awaited<ReturnType<typeof user>>,
  requested?: string,
) {
  const legacy = await db()
    .prepare('SELECT * FROM workspaces WHERE owner=? AND demo=1')
    .bind(u.userId)
    .all<Row>();
  for (const row of legacy.results) {
    const state = JSON.parse(row.data) as State;
    if (
      row.id !== `demo-${u.userId}` &&
      row.id !== requested &&
      !hasCustomSetup(state)
    )
      continue;
    const next = adoptWorkspace(state, u);
    const result = await db()
      .prepare(
        'UPDATE workspaces SET demo=0,name=?,data=?,revision=revision+1,updated=? WHERE id=? AND owner=? AND demo=1 AND revision=?',
      )
      .bind(
        row.name === 'Example season' || row.name === 'Parent journey example'
          ? 'GolfSixes League'
          : row.name,
        JSON.stringify(next),
        new Date().toISOString(),
        row.id,
        u.userId,
        row.revision,
      )
      .run();
    if (!result.meta.changes) {
      const current = await db()
        .prepare('SELECT demo FROM workspaces WHERE id=?')
        .bind(row.id)
        .first<{ demo: number }>();
      if (current?.demo)
        throw new AppError(
          'Another update arrived. Please refresh to finish connecting your records.',
          409,
        );
    }
  }
}
export async function context(workspace?: string, view?: string) {
  const u = await user();
  await unifyOwnedRecords(u, workspace);
  const defaultRow = !workspace
    ? await db()
        .prepare(
          "SELECT id FROM workspaces WHERE demo=0 AND EXISTS (SELECT 1 FROM json_each(workspaces.data,'$.members') m WHERE json_extract(m.value,'$.id')=?) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END, id LIMIT 1",
        )
        .bind(u.userId, `demo-${u.userId}`)
        .first<{ id: string }>()
    : null;
  const key = workspace || defaultRow?.id || `league-${u.userId}`;
  let row = await db()
    .prepare('SELECT * FROM workspaces WHERE id = ?')
    .bind(key)
    .first<Row>();
  if (!row) throw new AppError('Workspace not found.', 404);
  const state = upgradeState(JSON.parse(row.data) as State);
  let me: Member | undefined;
  if (row.demo) {
    if (row.owner !== u.userId)
      throw new AppError(
        'This example season belongs to another account.',
        403,
      );
    me = state.members.find(
      (m) =>
        m.id ===
        (view === 'parent'
          ? 'demo-parent'
          : view === 'organiser'
            ? 'demo-organiser'
            : 'demo-admin'),
    );
  } else {
    me = state.members.find((m) => m.id === u.userId);
    if (me && view === 'parent')
      me = { ...me, role: 'parent', orgIds: [], leagueIds: [] };
    else if (me?.role === 'admin' && view === 'organiser')
      me = {
        ...me,
        role: 'organiser',
        orgIds: organiserClubs(me).filter((id) =>
          state.orgs.some((o) => o.id === id),
        ),
        leagueIds: [],
      };
  }
  if (!me)
    throw new AppError('Ask your league administrator for an invitation.', 403);
  return { row, state, me, u };
}
export async function snapshot(c: Awaited<ReturnType<typeof context>>) {
  const projected = projectState(c.state, c.me);
  if (c.me.role !== 'parent') {
    const { logoRows, processLogos } = await import('./club-logo-jobs');
    const logos = await logoRows(c.row.id);
    for (const club of projected.clubs) {
      const row = logos.find(
        (r) =>
          r.club_id === club.id && r.website === (club.website || 'manual'),
      );
      if (row) {
        const logo = JSON.parse(row.data);
        club.logoKey = logo.key;
        club.logoStatus = logo.status;
        club.logoMessage = logo.message;
        club.logoOriginal = !!logo.original && logo.key !== logo.original;
      } else if (club.website) club.logoStatus = 'queued';
    }
    if (['admin', 'organiser', 'league-admin'].includes(c.me.role))
      waitUntil(processLogos(c.row.id, projected.clubs).catch(() => {}));
  }
  const all = await db()
    .prepare(
      "SELECT id,name FROM workspaces WHERE demo = 0 AND EXISTS (SELECT 1 FROM json_each(workspaces.data,'$.members') AS member WHERE json_extract(member.value,'$.id') = ?)",
    )
    .bind(c.u.userId)
    .all<{ id: string; name: string }>();
  return {
    workspace: c.row.id,
    workspaceName: c.row.name,
    demo: !!c.row.demo,
    canSwitchRoles: c.state.members.some(
      (m) => m.id === c.u.userId && m.role === 'admin',
    ),
    organiserClubs:
      c.me.role === 'organiser' &&
      c.state.members.some((m) => m.id === c.u.userId && m.role === 'admin')
        ? c.state.orgs.map((o) => ({ id: o.id, name: o.name }))
        : [],
    revision: c.row.revision,
    me: c.me,
    state: projected,
    workspaces: all.results,
  };
}
export async function saveCAS(row: Row, state: State) {
  const r = await db()
    .prepare(
      'UPDATE workspaces SET data = ?,revision = revision + 1,updated = ? WHERE id = ? AND revision = ?',
    )
    .bind(JSON.stringify(state), new Date().toISOString(), row.id, row.revision)
    .run();
  return r.meta.changes === 1;
}
export async function mutate(
  workspace: string | undefined,
  view: string | undefined,
  action: Action,
) {
  for (let i = 0; i < 4; i++) {
    const c = await context(workspace, view);
    if (
      action.type === 'player' &&
      c.me.role === 'parent' &&
      c.state.players.some((p) => p.id === action.id && p.familyManaged)
    )
      throw new AppError(
        'Update this child through My children so their organisers can review the changes.',
        403,
      );
    const next = applyAction(c.state, c.me, action);
    if (await saveCAS(c.row, next)) {
      const jobs = next.clubs.filter(
        (club) =>
          club.imageStatus === 'pending' &&
          club.imageJobId &&
          c.state.clubs.find((old) => old.id === club.id)?.imageJobId !==
            club.imageJobId,
      );
      const obsolete = c.state.clubs
        .filter(
          (old) =>
            old.imageKey &&
            !next.clubs.some((club) => club.imageKey === old.imageKey),
        )
        .map((c) => c.imageKey!);
      if (jobs.length)
        waitUntil(
          import('./club-image-jobs')
            .then((mod) => mod.processClubImages(c.row.id, jobs))
            .catch(() => {}),
        );
      if (obsolete.length)
        waitUntil(
          files()
            .delete(obsolete)
            .catch(() => {}),
        );
      c.state = next;
      c.row.revision++;
      return snapshot(c);
    }
  }
  throw new AppError(
    'Another update arrived at the same time. Please try again.',
    409,
  );
}
export async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
export async function createWorkspace(name: string) {
  const u = await user();
  const existing = await context();
  if (existing.me.role !== 'admin')
    throw new AppError('Foundation administrator access is required.', 403);
  if (typeof name !== 'string' || !name.trim() || name.length > 100)
    throw new AppError('Enter a workspace name (up to 100 characters).');
  const id = crypto.randomUUID(),
    state = emptyState();
  state.members.push({
    id: u.userId,
    name: u.displayName,
    email: u.email,
    phone: '',
    role: 'admin',
    leagueIds: [],
    orgIds: [],
  });
  await db()
    .prepare(
      'INSERT INTO workspaces (id,name,owner,demo,revision,data,updated) VALUES (?,?,?,0,0,?,?)',
    )
    .bind(
      id,
      name.trim(),
      u.userId,
      JSON.stringify(state),
      new Date().toISOString(),
    )
    .run();
  return snapshot(await context(id));
}
export function publicOrigin(req: Request) {
  const config = env as unknown as Record<string, string>;
  return config.GOLFSIXES_RUNTIME === 'node' && config.GOLFSIXES_PUBLIC_ORIGIN
    ? new URL(config.GOLFSIXES_PUBLIC_ORIGIN).origin
    : new URL(req.url).origin;
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  const expected = publicOrigin(req);
  if (origin && origin !== expected)
    throw new AppError('Cross-site requests are not allowed.', 403);
}
