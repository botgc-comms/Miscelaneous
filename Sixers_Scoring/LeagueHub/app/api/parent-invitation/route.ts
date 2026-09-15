import { context, json, failure, sameOrigin } from '@/lib/server';
import {
  requireThat,
  canManageTeam,
  leagueAcceptsRegistrations,
} from '@/lib/model';
import { sendParentJoiningEmail, limit } from '@/lib/email';

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const body = (await req.json()) as any;
    const c = await context(body.workspace, body.view);
    requireThat(
      canManageTeam(c.state, c.me, body.teamId),
      'Only this team’s organisers can invite parents.',
      403,
    );
    const team = c.state.teams.find((t) => t.id === body.teamId)!;
    const league = c.state.leagues.find((l) => l.id === team.leagueId)!;
    requireThat(
      !team.withdrawnAt &&
        team.enrollmentOpen !== false &&
        leagueAcceptsRegistrations(league),
      'Registration is closed for this team.',
    );
    requireThat(
      typeof body.email === 'string' &&
        body.email.length <= 254 &&
        /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(body.email),
      'Enter one valid parent email address.',
    );
    await limit(`parent-invite:${c.me.id}:${c.row.id}`, 30, 3600);
    const club = c.state.orgs.find((o) => o.id === team.orgId)!;
    const link = new URL('/', req.url);
    link.search = new URLSearchParams({
      role: 'parent',
      joinWorkspace: c.row.id,
      joinClub: team.orgId,
      joinLeague: team.leagueId,
      joinTeam: team.id,
    }).toString();
    await sendParentJoiningEmail(
      body.email.trim(),
      club.name,
      `${league.name} (${league.year})`,
      link.href,
    );
    return json({ sent: true });
  } catch (e) {
    return failure(e);
  }
}
