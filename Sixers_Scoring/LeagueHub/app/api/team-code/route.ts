import {
  db,
  context,
  user,
  json,
  failure,
  sameOrigin,
  type Row,
} from '@/lib/server';
import {
  requireThat,
  canManageTeam,
  leagueAcceptsRegistrations,
  type State,
} from '@/lib/model';
import { limit } from '@/lib/email';
export async function GET(req: Request) {
  try {
    const u = await user();
    const q = new URL(req.url).searchParams;
    if (q.has('workspace')) {
      const c = await context(q.get('workspace')!, q.get('view') || 'admin');
      requireThat(
        canManageTeam(c.state, c.me, q.get('teamId') || ''),
        'Only team organisers can view joining codes.',
        403,
      );
      return json(
        (
          await db()
            .prepare(
              'SELECT code,expires,revoked FROM team_codes WHERE workspace=? AND team_id=? ORDER BY expires DESC',
            )
            .bind(c.row.id, q.get('teamId'))
            .all()
        ).results,
      );
    }
    await limit(`code:${u.userId}`, 12, 600);
    const code = (q.get('code') || '').replace(/\s/g, '');
    requireThat(/^\d{6}$/.test(code), 'Enter the six-digit team code.');
    const link = await db()
      .prepare(
        'SELECT * FROM team_codes WHERE code=? AND revoked=0 AND expires>?',
      )
      .bind(code, new Date().toISOString())
      .first<{ workspace: string; team_id: string }>();
    requireThat(
      link,
      'This code is invalid or expired. Ask the organiser for a new one.',
      404,
    );
    const row = await db()
      .prepare('SELECT * FROM workspaces WHERE id=?')
      .bind(link.workspace)
      .first<Row>();
    requireThat(
      row && (!row.demo || row.owner === u.userId),
      'Team not found.',
      404,
    );
    const s = JSON.parse(row.data) as State,
      team = s.teams.find((t) => t.id === link.team_id)!;
    requireThat(
      team && !team.withdrawnAt && team.enrollmentOpen !== false,
      'This team is closed to new applications.',
    );
    requireThat(
      leagueAcceptsRegistrations(s.leagues.find((l) => l.id === team.leagueId)),
      'The Foundation has closed registration for this season.',
    );
    return json({
      workspace: row.id,
      team,
      league: s.leagues.find((l) => l.id === team.leagueId),
      organisation: s.orgs.find((o) => o.id === team.orgId),
      code,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const b: any = await req.json();
    const c = await context(b.workspace, b.view);
    requireThat(
      canManageTeam(c.state, c.me, b.teamId),
      'Only team organisers can manage joining codes.',
      403,
    );
    if (b.revoke) {
      await db()
        .prepare(
          'UPDATE team_codes SET revoked=1 WHERE code=? AND workspace=? AND team_id=?',
        )
        .bind(b.revoke, c.row.id, b.teamId)
        .run();
      return json({ ok: true });
    }
    await limit(`issue-code:${c.row.id}:${b.teamId}`, 10, 600);
    for (let i = 0; i < 10; i++) {
      const code = String(
        100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000),
      );
      const expires = new Date(Date.now() + 14 * 86400000).toISOString();
      const r = await db()
        .prepare(
          'INSERT OR IGNORE INTO team_codes(code,workspace,team_id,expires,revoked) VALUES (?,?,?,?,0)',
        )
        .bind(code, c.row.id, b.teamId, expires)
        .run();
      if (r.meta.changes) return json({ code, expires });
    }
    throw new Error('Code allocation unavailable');
  } catch (e) {
    return failure(e);
  }
}
