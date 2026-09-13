export const DEFAULT_SETTINGS = {
  title: 'Junior Golf Sixes Final',
  venue: 'Burton-on-Trent',
  date: '2026-09-13',
  expectedCards: 6,
  expectedClubs: 6,
  pairsPerClub: 3,
  clubs: [],
  leagueStandings: [],
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
    reviewed: raw.status === 'confirmed' || raw.reviewed === true,
    pairs: raw.pairs.map((p) => {
      if (!p || !Array.isArray(p.strokes) || p.strokes.length !== 6)
        throw new Error('Each pair must have six holes.');
      const pair = {
        club: text(p.club),
        colour: text(p.colour),
        players: text(p.players, 200),
        pairNumber: Number.isInteger(p.pairNumber) ? p.pairNumber : null,
        strokes: p.strokes.map((v) =>
          score(
            v,
            raw.status === 'draft' ? 99 : 10,
            raw.status === 'draft' ? 0 : 1,
          ),
        ),
        writtenPoints: Array.from({ length: 6 }, (_, i) =>
          Number.isInteger(p.writtenPoints?.[i]) ? p.writtenPoints[i] : null,
        ),
        writtenTotal: Number.isInteger(p.writtenTotal) ? p.writtenTotal : null,
        writtenStrokesTotal: Number.isInteger(p.writtenStrokesTotal)
          ? p.writtenStrokesTotal
          : null,
      };
      if (
        raw.status === 'confirmed' &&
        (!pair.club || pair.strokes.some((v) => v === null))
      )
        throw new Error(
          'Every pair needs a club and all six strokes before confirming.',
        );
      return pair;
    }),
  };
  return card;
}
export function issues(card) {
  return card.pairs.flatMap((p, index) => {
    const result = [];
    p.strokes.forEach((s, h) => {
      if (s !== null && points(s) === null)
        result.push(
          `Pair ${index + 1}, hole ${h + 1}: review ${s} strokes; the printed rule only covers 1 to 10.`,
        );
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
// Confirmation is based only on the team and strokes. Printed points and
// totals are retained as source evidence, never as a barrier to saving.
export function confirmationProblems(card) {
  return card.pairs.flatMap((pair, i) => {
    const problems = [];
    if (!pair.club.trim()) problems.push(`Team ${i + 1}: enter the club.`);
    const holes = pair.strokes.flatMap((s, h) =>
      points(s) === null ? [h + 1] : [],
    );
    if (holes.length)
      problems.push(
        `Team ${i + 1}: enter strokes from 1 to 10 for hole${holes.length > 1 ? 's' : ''} ${holes.join(', ')}.`,
      );
    return problems;
  });
}
export function pairSummary(pair) {
  const complete =
    pair.strokes.length === 6 && pair.strokes.every((s) => points(s) !== null);
  const gross = complete ? pair.strokes.reduce((n, s) => n + s, 0) : null;
  const total = complete
    ? pair.strokes.reduce((n, s) => n + points(s), 0)
    : null;
  const warnings = [];
  pair.strokes.forEach((s, h) => {
    const expected = points(s),
      written = pair.writtenPoints?.[h];
    if (expected !== null && Number.isInteger(written) && written !== expected)
      warnings.push(
        `Hole ${h + 1}: ${s} strokes = ${expected} points (card says ${written}).`,
      );
  });
  if (
    complete &&
    Number.isInteger(pair.writtenTotal) &&
    pair.writtenTotal !== total
  )
    warnings.push(
      `Points total: ${total} calculated; card says ${pair.writtenTotal}.`,
    );
  if (
    complete &&
    Number.isInteger(pair.writtenStrokesTotal) &&
    pair.writtenStrokesTotal !== gross
  )
    warnings.push(
      `Gross total: ${gross} calculated; card says ${pair.writtenStrokesTotal}.`,
    );
  return { complete, gross, points: total, warnings };
}
export function teamName(pair) {
  const club = pair.club.trim(),
    colour = pair.colour.trim();
  return colour ? `${club} ${colour}` : club;
}
export function leaderboard(cards, settings = {}) {
  const teams = new Map();
  for (const card of cards) {
    card.pairs.forEach((pair, index) => {
      if (!pair.club.trim()) return;
      // Missing team labels must never silently merge two teams from one club.
      const clubEntries = (settings.leagueStandings ?? []).filter(
        (entry) => nameKey(entry.club) === nameKey(pair.club),
      );
      const official =
        clubEntries.length === 1 &&
        (!nameKey(clubEntries[0].colour) || !nameKey(pair.colour))
          ? clubEntries[0]
          : pair;
      const knownSingle = official !== pair;
      const key =
        nameKey(official.colour) || knownSingle
          ? JSON.stringify([nameKey(official.club), nameKey(official.colour)])
          : JSON.stringify([nameKey(pair.club), card.id, index]);
      if (!teams.has(key))
        teams.set(key, {
          key,
          club: official.club.trim(),
          colour: official.colour.trim(),
          team: teamName(official),
          players: [],
          pairs: 0,
          points: 0,
          strokes: 0,
          cardIds: [],
          unlabelled: !nameKey(official.colour) && !knownSingle,
        });
      const row = teams.get(key);
      if (pair.players.trim() && !row.players.includes(pair.players.trim()))
        row.players.push(pair.players.trim());
      if (!row.cardIds.includes(card.id)) row.cardIds.push(card.id);
      if (card.status !== 'confirmed') return;
      const total = pairSummary(pair);
      if (!total.complete) return;
      row.pairs++;
      row.points += total.points;
      row.strokes += total.gross;
    });
  }
  const rows = [...teams.values()].sort(
    (a, b) =>
      b.points - a.points ||
      a.team.localeCompare(b.team) ||
      a.key.localeCompare(b.key),
  );
  let rank = 0;
  return rows.map((row, i) => {
    if (i === 0 || row.points !== rows[i - 1].points) rank = i + 1;
    return { ...row, rank: row.pairs ? rank : null };
  });
}
export function leagueAwards(matchRows) {
  const ranked = matchRows
    .filter((row) => row.pairs > 0)
    .slice()
    .sort((a, b) => b.points - a.points);
  const awards = new Map();
  for (let first = 0; first < ranked.length;) {
    let end = first + 1;
    while (end < ranked.length && ranked[end].points === ranked[first].points)
      end++;
    let pool = 0;
    for (let place = first; place < end; place++)
      pool += Math.max(6 - place, 0);
    for (let i = first; i < end; i++)
      awards.set(ranked[i].key, pool / (end - first));
    first = end;
  }
  return awards;
}
export function leagueLeaderboard(cards, settings = {}) {
  const match = leaderboard(cards, settings),
    awards = leagueAwards(match);
  const entries = settings.leagueStandings ?? [];
  const rows = entries.map((entry) => ({
    ...entry,
    key: JSON.stringify([nameKey(entry.club), nameKey(entry.colour)]),
    team: teamName(entry),
    today: 0,
    matchRank: null,
    total: entry.startingPoints,
    rank: null,
  }));
  for (const team of match) {
    const sameName = match.filter(
      (other) =>
        nameKey(other.club) === nameKey(team.club) &&
        nameKey(other.colour) === nameKey(team.colour),
    );
    const baseKey = JSON.stringify([nameKey(team.club), nameKey(team.colour)]);
    let row =
      sameName.length === 1
        ? rows.find((entry) => entry.key === baseKey)
        : undefined;
    if (!row) {
      row = {
        key: team.key,
        club: team.club,
        colour: team.colour,
        team: team.team,
        startingPoints: null,
        today: null,
        total: null,
        rank: null,
        matchRank: null,
      };
      rows.push(row);
    }
    row.today = awards.get(team.key) ?? null;
    row.matchRank = team.rank;
    row.total =
      row.startingPoints === null
        ? null
        : row.startingPoints + (row.today ?? 0);
  }
  rows.sort(
    (a, b) =>
      (b.total ?? -Infinity) - (a.total ?? -Infinity) ||
      a.team.localeCompare(b.team),
  );
  const startingComplete =
    rows.length > 0 && rows.every((row) => row.startingPoints !== null);
  let rank = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i === 0 || rows[i].total !== rows[i - 1].total) rank = i + 1;
    rows[i].rank = startingComplete ? rank : null;
  }
  const confirmed = cards.filter((card) => card.status === 'confirmed').length;
  return {
    rows,
    startingComplete,
    provisional:
      confirmed !==
        (settings.expectedCards ?? DEFAULT_SETTINGS.expectedCards) ||
      cards.some((card) => card.status !== 'confirmed'),
  };
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
  if (
    !Array.isArray(raw.leagueStandings ?? []) ||
    (raw.leagueStandings ?? []).length > 100
  )
    throw new Error('Enter up to 100 league teams.');
  const seen = new Set();
  out.leagueStandings = (raw.leagueStandings ?? []).map((entry) => {
    if (!entry || typeof entry !== 'object')
      throw new Error('Invalid league team.');
    const club = text(entry.club),
      colour = text(entry.colour),
      startingPoints = entry.startingPoints;
    if (!club) throw new Error('Each league team needs a club.');
    if (
      startingPoints !== null &&
      (typeof startingPoints !== 'number' ||
        !Number.isFinite(startingPoints) ||
        startingPoints < 0 ||
        startingPoints > 100000)
    )
      throw new Error(
        'Starting league points must be a non-negative number, or blank if unknown.',
      );
    const key = JSON.stringify([nameKey(club), nameKey(colour)]);
    if (seen.has(key))
      throw new Error(
        `${teamName({ club, colour })} is listed twice. Use the team colour to distinguish teams.`,
      );
    seen.add(key);
    return { club, colour, startingPoints };
  });
  return out;
}
