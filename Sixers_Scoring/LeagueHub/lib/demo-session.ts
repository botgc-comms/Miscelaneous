import { cookies } from 'next/headers';
import { currentIdentity, digest } from './identity';
import { db, type Row } from './server';
import { requireThat, type State } from './model';
export async function activeDemo() {
  const real = await currentIdentity();
  const token = (await cookies()).get('golfsixes_session')?.value;
  if (!real || !token) return null;
  const session = await db()
    .prepare(
      'SELECT workspace,actor,today FROM demo_sessions WHERE session_hash=? AND owner=?',
    )
    .bind(await digest(token), real.userId)
    .first<{ workspace: string; actor: string; today: string | null }>();
  if (!session) return null;
  const row = await db()
    .prepare('SELECT * FROM workspaces WHERE id=? AND owner=? AND demo=2')
    .bind(session.workspace, real.userId)
    .first<Row>();
  if (!row) return null;
  const state = JSON.parse(row.data) as State,
    actor = state.members.find((m) => m.id === session.actor);
  if (!actor) return null;
  return { real, session, row, state, actor };
}
export async function demoOwner() {
  const real = await currentIdentity();
  requireThat(real, 'Please sign in.', 401);
  const row = await db()
    .prepare(
      "SELECT id FROM workspaces WHERE demo=0 AND EXISTS(SELECT 1 FROM json_each(workspaces.data,'$.members') m WHERE json_extract(m.value,'$.id')=? AND json_extract(m.value,'$.role')='admin') LIMIT 1",
    )
    .bind(real.userId)
    .first();
  requireThat(row, 'Only Foundation administrators can open demo mode.', 403);
  return real;
}
