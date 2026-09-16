import { cookies } from 'next/headers';
import { db, json, failure, sameOrigin } from '@/lib/server';
import { currentIdentity, digest } from '@/lib/identity';
import { activeDemo, demoOwner } from '@/lib/demo-session';
import { demoState } from '@/lib/demo';
import { requireThat, upgradeState } from '@/lib/model';
export async function GET() {
  try {
    const real = await currentIdentity();
    if (!real) return json({ available: false });
    let available = false;
    try {
      await demoOwner();
      available = true;
    } catch {}
    const d = await activeDemo();
    return json({
      available,
      active: !!d,
      workspace: d?.row.id,
      actor: d?.actor.id,
      today: d?.session.today,
      actors: d?.state.members.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        club: d.state.orgs
          .filter((o) => m.orgIds.includes(o.id))
          .map((o) => o.name)
          .join(', '),
      })),
      fixtures: d?.state.fixtures
        .filter((f) => f.status !== 'cancelled')
        .map((f) => ({ id: f.id, name: f.name, date: f.date }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const real = await demoOwner(),
      a: any = await req.json();
    const token = (await cookies()).get('golfsixes_session')?.value;
    requireThat(token, 'Please sign in again.', 401);
    const hash = await digest(token);
    if (a.type === 'exit') {
      await db()
        .prepare('DELETE FROM demo_sessions WHERE session_hash=?')
        .bind(hash)
        .run();
      return json({ url: '/?role=admin&view=admin' });
    }
    let d = await activeDemo();
    if (a.type === 'enter') {
      const id = 'sandbox-' + (await digest(real.userId));
      let row = await db()
        .prepare(
          'SELECT data FROM workspaces WHERE id=? AND owner=? AND demo=2',
        )
        .bind(id, real.userId)
        .first<{ data: string }>();
      if (!row) {
        const source = upgradeState(demoState());
        // Namespace every identifier, including parent IDs missing from the original sample's member list.
        for (const p of source.players)
          if (!source.members.some((m) => m.id === p.parentId))
            source.members.push({
              id: p.parentId,
              name: p.name.split(' ').slice(-1)[0] + ' family',
              email: p.parentId + '@example.invalid',
              phone: '',
              role: 'parent',
              orgIds: [],
              leagueIds: [],
            });
        const memberIds = new Map(
          source.members.map((m) => [m.id, `${id}:${m.id}`]),
        );
        for (const m of source.members) {
          m.id = memberIds.get(m.id)!;
          m.email = m.id.split(':').pop() + '@example.invalid';
        }
        for (const p of source.players) p.parentId = memberIds.get(p.parentId)!;
        source.invites = [];
        source.notifications = [];
        source.activity = [];
        source.demoSandbox = true;
        for (const l of source.leagues)
          l.fixturesConfirmedAt = new Date().toISOString();
        await db()
          .prepare(
            'INSERT INTO workspaces(id,name,owner,demo,revision,data,updated) VALUES (?,?,?,2,0,?,?)',
          )
          .bind(
            id,
            'Demo season',
            real.userId,
            JSON.stringify(source),
            new Date().toISOString(),
          )
          .run();
      }
      await db()
        .prepare(
          'INSERT INTO demo_sessions(session_hash,owner,workspace,actor,today) VALUES (?,?,?,?,?) ON CONFLICT(session_hash) DO UPDATE SET workspace=excluded.workspace,actor=excluded.actor,today=excluded.today',
        )
        .bind(hash, real.userId, id, id + ':demo-admin', '2026-09-13')
        .run();
      d = await activeDemo();
    }
    requireThat(d, 'Open demo mode first.');
    const actor = a.actor
      ? d.state.members.find((m) => m.id === a.actor)
      : d.actor;
    requireThat(actor, 'Choose an actor from this demo.');
    const today = a.today === null ? null : a.today || d.session.today;
    requireThat(
      today === null ||
        (/^\d{4}-\d{2}-\d{2}$/.test(today) &&
          !Number.isNaN(Date.parse(today)) &&
          new Date(today).toISOString().slice(0, 10) === today),
      'Choose a valid date.',
    );
    await db()
      .prepare(
        'UPDATE demo_sessions SET actor=?,today=? WHERE session_hash=? AND owner=?',
      )
      .bind(actor.id, today, hash, real.userId)
      .run();
    const role =
      actor.role === 'parent'
        ? 'parent'
        : actor.role === 'organiser'
          ? 'staff'
          : 'admin';
    return json({
      url: `/?role=${role}&view=${actor.role === 'organiser' ? 'organiser' : role}&workspace=${encodeURIComponent(d.row.id)}&demo=1`,
    });
  } catch (e) {
    return failure(e);
  }
}
