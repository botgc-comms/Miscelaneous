// Only public HTTPS sites are eligible. Redirect destinations are checked again.
export function clubWebsite(value: unknown): string {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    raw.length > 2000 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
    /\.(?:local|localhost|internal|test|invalid|example|lan|home|arpa)$/.test(
      host,
    )
  )
    throw new Error('Enter a public club website using https://.');
  url.hash = '';
  return url.href;
}
function decode(value: string) {
  return value.replace(
    /&(?:amp|quot|apos|lt|gt|#(\d+)|#x([\da-f]+));/gi,
    (all, decimal, hex) => {
      if (decimal || hex) {
        const n = parseInt(decimal || hex, decimal ? 10 : 16);
        return n <= 0x10ffff ? String.fromCodePoint(n) : '';
      }
      return (
        (
          {
            '&amp;': '&',
            '&quot;': '"',
            '&apos;': "'",
            '&lt;': '<',
            '&gt;': '>',
          } as Record<string, string>
        )[all.toLowerCase()] || all
      );
    },
  );
}
export function attributes(tag: string) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(
      (m) => [m[1].toLowerCase(), decode(m[2] ?? m[3] ?? m[4])],
    ),
  );
}
export function clubImageCandidates(html: string, website: string): string[] {
  const candidates: { url: string; priority: number }[] = [];
  const add = (raw: string | undefined, priority: number) => {
    if (
      !raw ||
      /(?:logo|icon|badge|avatar|sprite|pixel|spacer|accredit|safe-golf|england-golf|portrait|nivo-bullets|nivo-arrows|loading\.gif)/i.test(
        raw,
      )
    )
      return;
    try {
      const url = clubWebsite(new URL(raw, website).href);
      if (url) candidates.push({ url, priority });
    } catch {
      /* Ignore unusable image links. */
    }
  };
  const clean = html.replace(
    /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>/gi,
    '',
  );
  for (const m of clean.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    const key = (a.property || a.name || '').toLowerCase();
    if (
      [
        'og:image',
        'og:image:url',
        'og:image:secure_url',
        'twitter:image',
        'twitter:image:src',
      ].includes(key)
    )
      add(a.content, key.startsWith('og:') ? 100 : 90);
  }
  for (const m of clean.matchAll(/<img\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    const width = Number(
        a.width ||
          a['data-max-width'] ||
          a.style?.match(/max-width:\s*(\d+)px/)?.[1] ||
          0,
      ),
      height = Number(a.height || 0);
    if (
      (width && width < 400) ||
      (height && height < 180) ||
      (width && height && width < height * 1.3) ||
      /logo|icon|avatar|sponsor/i.test(`${a.alt} ${a.class}`)
    )
      continue;
    const srcset = (a['data-srcset'] || a.srcset || '')
      .split(',')
      .map((s) => s.trim().split(/\s+/))
      .sort((a, b) => parseFloat(b[1] || '0') - parseFloat(a[1] || '0'));
    add(
      srcset[0]?.[0] || a['data-src'] || a.src,
      /course|clubhouse|fairway|hero|landscape|slideshow/i.test(
        `${a.alt} ${a.class} ${a.src}`,
      )
        ? 85
        : width >= 800 && height >= 300
          ? 80
          : 30,
    );
  }
  for (const m of clean.matchAll(
    /background(?:-image)?\s*:[^;<>]*?url\(\s*['"]?([^'"\)]+)['"]?\s*\)/gi,
  ))
    add(decode(m[1]), 60);
  return [
    ...new Set(
      candidates.sort((a, b) => b.priority - a.priority).map((c) => c.url),
    ),
  ].slice(0, 6);
}
export function imageType(bytes: Uint8Array): string | undefined {
  if (bytes.length < 12) return;
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n))
    return 'image/png';
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
}
export function landscapePhoto(bytes: Uint8Array) {
  const type = imageType(bytes),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0;
  try {
    if (type === 'image/png') {
      width = view.getUint32(16);
      height = view.getUint32(20);
    } else if (type === 'image/jpeg') {
      for (let p = 2; p + 9 < bytes.length;) {
        if (bytes[p++] !== 255) continue;
        const marker = bytes[p++];
        if (marker === 255 || marker === 0) continue;
        if (
          [
            0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
            0xce, 0xcf,
          ].includes(marker)
        ) {
          height = view.getUint16(p + 3);
          width = view.getUint16(p + 5);
          break;
        }
        const size = view.getUint16(p);
        if (size < 2) break;
        p += size;
      }
    } else if (type === 'image/webp') {
      const kind = new TextDecoder().decode(bytes.slice(12, 16));
      if (kind === 'VP8X') {
        width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
        height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      } else if (kind === 'VP8 ') {
        width = view.getUint16(26, true) & 0x3fff;
        height = view.getUint16(28, true) & 0x3fff;
      } else if (kind === 'VP8L') {
        width = 1 + bytes[21] + ((bytes[22] & 63) << 8);
        height =
          1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10);
      }
    }
  } catch {
    return false;
  }
  return (
    width >= 600 &&
    height >= 250 &&
    width / height >= 1.3 &&
    width / height <= 4 &&
    width * height <= 40_000_000
  );
}
export async function boundedBody(response: Response, limit: number) {
  if (Number(response.headers.get('content-length') || 0) > limit) {
    await response.body?.cancel();
    throw new Error('File too large.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response.');
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > limit) throw new Error('File too large.');
      parts.push(r.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
export function isPublicAddress(ip: string) {
  if (ip.includes(':'))
    return (
      /^[23][\da-f]{3}:/i.test(ip) && !/^2001:(?:0:|db8:|10:|20:)/i.test(ip)
    );
  const n = ip.split('.').map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
    return false;
  return !(
    n[0] === 0 ||
    n[0] === 10 ||
    n[0] === 127 ||
    n[0] >= 224 ||
    (n[0] === 169 && n[1] === 254) ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
    (n[0] === 192 && n[1] === 168) ||
    (n[0] === 192 && n[1] === 0 && [0, 2].includes(n[2])) ||
    (n[0] === 192 && n[1] === 88 && n[2] === 99) ||
    (n[0] === 100 && n[1] >= 64 && n[1] <= 127) ||
    (n[0] === 198 && [18, 19].includes(n[1])) ||
    (n[0] === 198 && n[1] === 51 && n[2] === 100) ||
    (n[0] === 203 && n[1] === 0 && n[2] === 113)
  );
}
export async function fetchPublic(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  for (let hop = 0; hop < 4; hop++) {
    url = clubWebsite(url);
    const host = new URL(url).hostname;
    const addresses = await Promise.all(
      ['A', 'AAAA'].map(async (type) => {
        const r = await fetcher(
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
          { headers: { Accept: 'application/dns-json' }, signal },
        );
        if (!r.ok) throw new Error('Could not verify website.');
        const dns = JSON.parse(
          new TextDecoder().decode(await boundedBody(r, 32000)),
        );
        return (dns.Answer || [])
          .filter((a: any) => a.type === 1 || a.type === 28)
          .map((a: any) => String(a.data));
      }),
    );
    const ips = addresses.flat();
    if (!ips.length || ips.some((ip) => !isPublicAddress(ip)))
      throw new Error('Website must use a public address.');
    const response = await fetcher(url, {
      redirect: 'manual',
      signal,
      headers: {
        Accept: 'text/html,image/jpeg,image/png,image/webp;q=0.9',
        'User-Agent': 'GolfSixesClubImage/1.0',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('Invalid redirect.');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Website unavailable.');
    }
    return { response, url };
  }
  throw new Error('Too many website redirects.');
}
export async function discoverClubImage(
  website: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const page = await fetchPublic(website, signal, fetcher);
  if (!page.response.headers.get('content-type')?.includes('text/html')) {
    await page.response.body?.cancel();
    throw new Error('Website did not return a page.');
  }
  const html = new TextDecoder().decode(
    await boundedBody(page.response, 1_000_000),
  );
  for (const url of clubImageCandidates(html, page.url).slice(0, 3)) {
    try {
      const image = await fetchPublic(url, signal, fetcher);
      const bytes = await boundedBody(image.response, 4_000_000);
      const type = imageType(bytes);
      if (type && bytes.length >= 5000 && landscapePhoto(bytes))
        return { bytes, type, source: image.url };
    } catch {
      if (signal.aborted) break;
    }
  }
  throw new Error('No suitable course photo found.');
}
