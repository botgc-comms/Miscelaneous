import { context, json, failure } from '@/lib/server';
import { mapInputs, mapData } from '@/lib/league-map';
import { lookupPostcodes } from '@/lib/postcodes';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url),
      q = url.searchParams;
    const c = await context(
      q.get('workspace') || undefined,
      q.get('view') || undefined,
    );
    const input = mapInputs(
      c.state,
      c.me,
      Number(q.get('year')),
      q.get('scope') || 'mine',
    );
    const cache =
      typeof caches !== 'undefined'
        ? (caches as CacheStorage & { default?: Cache }).default
        : undefined;
    // Only club postcodes from the authorised workspace reach the public postcode service.
    const result = await lookupPostcodes(
      input.clubs.map((c) => c.postcode),
      url.origin,
      cache,
    );
    return json(mapData(input, result.positions, result.unavailable));
  } catch (e) {
    return failure(e);
  }
}
