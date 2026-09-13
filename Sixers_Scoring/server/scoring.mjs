export const DEFAULT_SETTINGS = {
  title: 'Junior Golf Sixes Final',
  venue: 'Burton-on-Trent',
  date: '2026-09-13',
  expectedCards: 6,
  expectedClubs: 6,
  pairsPerClub: 3,
  clubs: [],
};
export function points(strokes) {
  return Number.isInteger(strokes) && strokes >= 1 && strokes <= 10
    ? 11 - strokes
    : null;
}
export function nameKey(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-GB');
}
function text(value, max = 100) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function score(value, max = 10, min = 1) {
  if (value === null || value === undefined || value === '') return null;
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Scores must be whole numbers from ${min} to ${max}.`);
  return value;
}
export function blankCard(slot = 1) {
  return {
    id: crypto.randomUUID(),
    slot,
    revision: 0,
    status: 'draft',
    notes: '',
    reviewed: false,
    pairs: Array.from({ length: 3 }, () => ({
      club: '',
      colour: '',
      players: '',
      pairNumber: null,
      strokes: Array(6).fill(null),
      writtenPoints: Array(6).fill(null),
      writtenTotal: null,
      writtenStrokesTotal: null,
    })),
  };
}
export function validateCard(raw) {
  if (!raw || !Number.isInteger(raw.slot) || raw.slot < 1 || raw.slot > 60)
    throw new Error('Choose a card number from 1 to 60.');
  if (!Array.isArray(raw.pairs) || raw.pairs.length !== 3)
    throw new Error('Each scorecard must contain exactly three pairs.');
  if (!['draft', 'confirmed'].includes(raw.status))
    throw new Error('Invalid card status.');
  const card = {
    slot: raw.slot,
    status: raw.status,
    notes: text(raw.notes, 2500),
    reviewed: raw.reviewed === true,
    pairs: raw.pairs.map((p) => {
      if (
        !p ||
        !Array.isArray(p.strokes) ||
        p.strokes.length !== 6 ||
        !Array.isArray(p.writtenPoints) ||
        p.writtenPoints.length !== 6
      )
        throw new Error('Each pair must have six holes.');
      const pair = {
        club: text(p.club),
        colour: text(p.colour),
        players: text(p.players, 200),
        pairNumber: score(p.pairNumber, 30),
        strokes: p.strokes.map((v) => score(v, raw.status === 'draft' ? 99 : 10, raw.status === 'draft' ? 0 : 1)),
        writtenPoints: p.writtenPoints.map((v) => score(v, 99, 0)),
        writtenTotal: score(p.writtenTotal, 999, 0),
        writtenStrokesTotal: score(p.writtenStrokesTotal, 999, 0),
      };
      if (
        raw.status === 'confirmed' &&
        (!pair.club || !pair.pairNumber || pair.strokes.some((v) => v === null))
      )
        throw new Error(
          'Every pair needs a club, pair number and all six strokes before confirming.',
        );
      return pair;
    }),
  };
  if (raw.status === 'confirmed' && !card.reviewed)
    throw new Error('Review all three pairs before confirming.');
  if (raw.status === 'confirmed' && issues(card).length)
    throw new Error(
      'Resolve the highlighted points or totals before confirming.',
    );
  return card;
}
export function issues(card) {
  return card.pairs.flatMap((p, index) => {
    const result = [];
    p.strokes.forEach((s, h) => {
      if (s !== null && points(s) === null) result.push(`Pair ${index + 1}, hole ${h + 1}: review ${s} strokes; the printed rule only covers 1 to 10.`);
      if (
        points(s) !== null &&
        p.writtenPoints[h] !== null &&
        points(s) !== p.writtenPoints[h]
      )
        result.push(
          `Pair ${index + 1}, hole ${h + 1}: ${s} strokes should be ${points(s)} points.`,
        );
    });
    if (p.strokes.every((s) => points(s) !== null)) {
      const total = p.strokes.reduce((n, s) => n + points(s), 0),
        strokes = p.strokes.reduce((n, s) => n + s, 0);
      if (p.writtenTotal !== null && p.writtenTotal !== total)
        result.push(
          `Pair ${index + 1}: written points total is ${p.writtenTotal}; calculated total is ${total}.`,
        );
      if (p.writtenStrokesTotal !== null && p.writtenStrokesTotal !== strokes)
        result.push(
          `Pair ${index + 1}: written strokes total is ${p.writtenStrokesTotal}; calculated total is ${strokes}.`,
        );
    }
    return result;
  });
}
export function checkDuplicates(card, others) {
  const seen = new Set();
  for (const c of [...others.filter((c) => c.id !== card.id), card])
    for (const p of c.pairs) {
      if (!p.club || !p.pairNumber) continue;
      const key = nameKey(p.club) + '|' + p.pairNumber;
      if (seen.has(key))
        throw new Error(
          `${p.club} pair ${p.pairNumber} is already assigned. Choose the correct pair number or edit its existing card.`,
        );
      seen.add(key);
    }
}
export function leaderboard(cards, settings = DEFAULT_SETTINGS) {
  const clubs = new Map(
    settings.clubs.map((club) => [
      nameKey(club),
      { club, pairs: 0, points: 0, strokes: 0 },
    ]),
  );
  for (const card of cards) {
    for (const p of card.pairs) {
      if (!p.club) continue;
      const key = nameKey(p.club);
      if (!clubs.has(key))
        clubs.set(key, { club: p.club, pairs: 0, points: 0, strokes: 0 });
      if (card.status !== 'confirmed') continue;
      const row = clubs.get(key);
      row.pairs++;
      row.points += p.strokes.reduce((n, s) => n + points(s), 0);
      row.strokes += p.strokes.reduce((n, s) => n + s, 0);
    }
  }
  const rows = [...clubs.values()].sort(
    (a, b) => b.points - a.points || a.club.localeCompare(b.club),
  );
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.points !== rows[i - 1].points) rank = i + 1;
    return { ...r, rank: r.pairs ? rank : null };
  });
}
export function validateSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  for (const key of ['title', 'venue', 'date']) out[key] = text(raw[key]);
  if (!out.title) throw new Error('An event title is required.');
  for (const key of ['expectedCards', 'expectedClubs', 'pairsPerClub']) {
    if (!Number.isInteger(raw[key]) || raw[key] < 1 || raw[key] > 60)
      throw new Error('Event counts must be between 1 and 60.');
    out[key] = raw[key];
  }
  if (!Array.isArray(raw.clubs) || raw.clubs.length > 60)
    throw new Error('Enter up to 60 clubs.');
  out.clubs = [
    ...new Map(
      raw.clubs.map((c) => [nameKey(c), text(c)]).filter(([k]) => k),
    ).values(),
  ];
  return out;
}

