import { attributes, clubWebsite } from './club-images';
export function logoPageProblem(html: string) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(match[0]);
    if (
      a['http-equiv']?.toLowerCase() === 'refresh' &&
      /captcha|challenge/i.test(a.content || '')
    )
      return 'The club website requires a CAPTCHA and is blocking automatic logo lookup. Please upload the logo using Change logo.';
  }
  return null;
}
export function logoCandidates(html: string, website: string) {
  const found = new Map<
    string,
    { url: string; label: string; score: number }
  >();
  const add = (raw: string, label: string, score: number) => {
    try {
      const url = clubWebsite(
        new URL(raw.replace(/&amp;/g, '&'), website).href,
      );
      if (
        url &&
        !/facebook|twitter|instagram|safegolf|englandgolf|golf-foundation|google|youtube/i.test(
          url + ' ' + label,
        ) &&
        (!found.has(url) || found.get(url)!.score < score)
      )
        found.set(url, { url, label: label.slice(0, 250), score });
    } catch {}
  };
  // Follow element ancestry, rather than searching a fixed number of characters
  // around an image. Closing a logo container must not label later photos as logos.
  const clean = html.replace(
    /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    '',
  );
  const stack: {
    tag: string;
    logo: string;
    header: boolean;
    footer: boolean;
  }[] = [];
  for (const match of clean.matchAll(
    /<\/?[a-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi,
  )) {
    const tag = match[0],
      name = /^<\/?([\w:-]+)/.exec(tag)![1].toLowerCase();
    if (tag.startsWith('</')) {
      const index = stack.map((n) => n.tag).lastIndexOf(name);
      if (index >= 0) stack.length = index;
      continue;
    }
    const attrs = attributes(tag),
      parent = stack.at(-1);
    const own = [attrs.id, attrs.class, attrs.style].filter(Boolean).join(' ');
    const logo = /logo|brand|crest|badge/i.test(own)
      ? [own, attrs['aria-label']].filter(Boolean).join(' ')
      : parent?.logo || '';
    const header =
      !!parent?.header || /header|navbar|masthead/i.test(name + ' ' + own);
    const footer = !!parent?.footer || /footer/i.test(name + ' ' + own);
    if (name === 'img') {
      const label = [attrs.alt, attrs.class, attrs.id, attrs.style, logo]
        .filter(Boolean)
        .join(' ');
      const srcset = (attrs['data-srcset'] || attrs.srcset || '')
        .split(',')
        .map((s) => s.trim().split(/\s+/))
        .sort((a, b) => parseFloat(b[1] || '0') - parseFloat(a[1] || '0'));
      const sources = [
        attrs['data-src'],
        attrs['data-lazy-src'],
        srcset[0]?.[0],
        attrs.src,
      ].filter(Boolean);
      for (const src of sources)
        if (/logo|brand|crest|badge/i.test(label + ' ' + src)) {
          const score =
            (logo ? 140 : /logo|crest/i.test(label) ? 100 : 70) +
            (header ? 20 : 0) -
            (footer ? 30 : 0);
          add(src, label, score);
        }
    }
    if (
      !/\/>$/.test(tag) &&
      !/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(
        name,
      )
    ) {
      stack.push({ tag: name, logo, header, footer });
    }
  }
  for (const match of html.matchAll(
    /"logo"\s*:\s*(?:"([^"]+)"|\{[^}]*"url"\s*:\s*"([^"]+)")/gi,
  ))
    add(
      (match[1] || match[2]).replace(/\\\//g, '/'),
      'Structured club logo',
      110,
    );
  for (const match of clean.matchAll(/<link\b[^>]*>/gi)) {
    if (!/apple-touch-icon/i.test(match[0])) continue;
    const src = attributes(match[0]).href;
    if (src) add(src, 'Website app icon', 20);
  }
  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, 6);
}
// Vector logos retain their original paths and lettering; reject active or external content.
export function safeLogoSvg(bytes: Uint8Array) {
  const svg = new TextDecoder().decode(bytes);
  if (
    !/<svg[\s>]/i.test(svg) ||
    svg.length > 250000 ||
    /<(?:script|foreignObject|iframe|image|use|animate|set)\b|<!DOCTYPE|<!ENTITY|\bon\w+\s*=|(?:href|src)\s*=|@import|url\s*\(/i.test(
      svg,
    )
  )
    return null;
  return svg.replace(/<\?xml[^>]*\?>|<!--[\s\S]*?-->/g, '').trim();
}
