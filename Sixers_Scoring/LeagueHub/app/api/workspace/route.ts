import {
  context,
  snapshot,
  mutate,
  json,
  failure,
  createWorkspace,
  hash,
  sameOrigin,
} from '@/lib/server';
import { AppError, canLeague, requireThat } from '@/lib/model';
import { planningKey, suggestFixtures } from '@/lib/season-planning';
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    return json(
      await snapshot(
        await context(
          q.get('workspace') || undefined,
          q.get('view') || undefined,
        ),
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    if (Number(req.headers.get('content-length') || 0) > 100000)
      throw new AppError('This update is too large.');
    const body: any = await req.json();
    const a = body.action;
    if (!a || typeof a.type !== 'string') throw new AppError('Invalid action.');
    if (a.type === 'create-workspace')
      return json(await createWorkspace(a.name));
    if (a.type === 'fixture-plan-suggest') {
      const c = await context(body.workspace, body.view);
      requireThat(
        canLeague(c.me, a.leagueId),
        'You cannot plan this league.',
        403,
      );
      const league = c.state.leagues.find((l) => l.id === a.leagueId);
      requireThat(league?.fixturePlanning, 'Save the planning settings first.');
      requireThat(
        a.planningKey === planningKey(c.state, league.id),
        'Hosting information changed. Close the draft and suggest again.',
        409,
      );
      requireThat(
        Number.isInteger(a.variant) && a.variant >= 0 && a.variant <= 100000,
        'Invalid suggestion number.',
      );
      const previous = Array.isArray(a.previous)
        ? a.previous
            .slice(0, 36)
            .filter(
              (f: any) =>
                f && typeof f.clubId === 'string' && typeof f.date === 'string',
            )
        : [];
      return json({
        ...(await snapshot(c)),
        fixtureProposal: {
          ...suggestFixtures(c.state, league.id, league.fixturePlanning, {
            variant: a.variant,
            previous,
          }),
          key: planningKey(c.state, league.id),
        },
      });
    }
    if (a.type === 'photo') throw new AppError('Use the photo upload action.');
    if (a.type === 'club-image-set')
      throw new AppError('Use the club photo upload action.');
    if (a.type === 'organiser-club') {
      await mutate(body.workspace, undefined, a);
      return json(await snapshot(await context(body.workspace, body.view)));
    }
    let token: string | undefined;
    if (a.type === 'invite') {
      token = crypto.randomUUID() + crypto.randomUUID();
      a.hash = await hash(token);
    }
    const result = await mutate(body.workspace, body.view, a);
    if (a.type === 'fixture-planning') {
      const c = await context(body.workspace, body.view);
      requireThat(
        canLeague(c.me, a.leagueId),
        'You cannot plan this league.',
        403,
      );
      const league = c.state.leagues.find((l) => l.id === a.leagueId)!;
      return json({
        ...(await snapshot(c)),
        fixtureProposal: {
          ...suggestFixtures(c.state, league.id, league.fixturePlanning!),
          key: planningKey(c.state, league.id),
        },
      });
    }
    return json({
      ...result,
      ...(token ? { inviteToken: token } : {}),
    });
  } catch (e) {
    return failure(e);
  }
}
