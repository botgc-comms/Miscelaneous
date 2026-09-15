import { normalisePostcode, type MapPosition } from './league-map';

export async function lookupPostcodes(
  postcodes: string[],
  origin: string,
  cache?: Cache,
  fetcher: typeof fetch = fetch,
) {
  const unique = [...new Set(postcodes.map(normalisePostcode).filter(Boolean))];
  const positions: Record<string, MapPosition | null> = {};
  let unavailable = false;
  const key = (postcode: string) =>
    new Request(
      `${origin}/__postcode-cache/v1/${encodeURIComponent(postcode)}`,
    );
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100);
    const missing: string[] = [];
    await Promise.all(
      batch.map(async (postcode) => {
        const saved = await cache?.match(key(postcode)).catch(() => undefined);
        if (saved)
          positions[postcode] = (await saved.json()) as MapPosition | null;
        else missing.push(postcode);
      }),
    );
    if (!missing.length) continue;
    try {
      const response = await fetcher('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes: missing }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Postcode lookup unavailable');
      const body = (await response.json()) as {
        result?: { query: string; result: MapPosition | null }[];
      };
      if (!Array.isArray(body.result))
        throw new Error('Invalid postcode response');
      for (const row of body.result) {
        const postcode = normalisePostcode(row.query);
        if (!missing.includes(postcode)) continue;
        const p = row.result;
        if (
          p !== null &&
          (!p ||
            !Number.isFinite(p.latitude) ||
            !Number.isFinite(p.longitude) ||
            p.latitude < 49 ||
            p.latitude > 62 ||
            p.longitude < -9 ||
            p.longitude > 3)
        )
          continue;
        positions[postcode] = p
          ? { latitude: p.latitude, longitude: p.longitude }
          : null;
        await cache
          ?.put(
            key(postcode),
            Response.json(positions[postcode], {
              headers: {
                'Cache-Control': `public, max-age=${p ? 86400 * 30 : 3600}`,
              },
            }),
          )
          .catch(() => {});
      }
      if (missing.some((p) => !(p in positions))) unavailable = true;
    } catch {
      unavailable = true;
    }
  }
  return { positions, unavailable };
}
