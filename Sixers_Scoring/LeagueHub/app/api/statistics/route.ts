import { context, json, failure } from '@/lib/server';
import { requireThat } from '@/lib/model';
import { buildStatistics } from '@/lib/statistics';
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const c = await context(
      q.get('workspace') || undefined,
      q.get('view') || undefined,
    );
    requireThat(
      ['admin', 'league-admin'].includes(c.me.role),
      'Statistics are available to Foundation administrators.',
      403,
    );
    const years = (q.get('years') || '').split(',').map(Number);
    requireThat(
      years.length >= 1 &&
        years.length <= 5 &&
        years.every((y) => Number.isInteger(y) && y >= 2020 && y <= 2100),
      'Choose between one and five season years.',
    );
    return json(
      buildStatistics(c.state, c.me, years, {
        league: q.get('league') || 'all',
        club: q.get('club') || 'all',
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
