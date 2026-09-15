import { rosterEligible, type State, type Fixture, type Player } from './model';

export function participation(s: State, f: Fixture, playerId: string) {
  const fixtures = s.fixtures.filter(
    (v) =>
      v.id !== f.id &&
      v.leagueId === f.leagueId &&
      v.pairs.some((p) => p.players.includes(playerId)),
  );
  return {
    played: fixtures.filter((v) => v.status === 'completed').length,
    planned: fixtures.filter(
      (v) => ['scheduled', 'live'].includes(v.status) && v.date <= f.date,
    ).length,
  };
}
export function availabilityFor(s: State, f: Fixture, playerId: string) {
  return (
    s.availability?.find((a) => a.fixtureId === f.id && a.playerId === playerId)
      ?.status || 'unconfirmed'
  );
}
export type LineupDraft = { pairs: string[][]; reserves: string[] };
export type LineupDestination =
  | { pair: number; slot: number }
  | 'reserves'
  | 'pool';

/** Move once; occupied pair slots swap when moving from another pair. */
export function moveLineupPlayer(
  draft: LineupDraft,
  playerId: string,
  destination: LineupDestination,
): LineupDraft {
  const next = {
    pairs: draft.pairs.map((p) => [...p]),
    reserves: draft.reserves.filter((id) => id !== playerId),
  };
  let source: { pair: number; slot: number } | undefined;
  draft.pairs.forEach((pair, i) =>
    pair.forEach((id, j) => {
      if (id === playerId) source = { pair: i, slot: j };
    }),
  );
  next.pairs = next.pairs.map((p) =>
    p.map((id) => (id === playerId ? '' : id)),
  );
  if (destination === 'reserves') next.reserves.push(playerId);
  else if (destination !== 'pool') {
    const displaced = next.pairs[destination.pair]?.[destination.slot];
    if (!next.pairs[destination.pair] || ![0, 1].includes(destination.slot))
      return draft;
    next.pairs[destination.pair][destination.slot] = playerId;
    if (displaced && source) next.pairs[source.pair][source.slot] = displaced;
  }
  return next;
}

export function selectionCandidates(s: State, f: Fixture, teamId: string) {
  const elsewhere = new Set([
    ...f.pairs.filter((p) => p.teamId !== teamId).flatMap((p) => p.players),
    ...(s.reserves || [])
      .filter((r) => r.fixtureId === f.id && r.teamId !== teamId)
      .map((r) => r.playerId),
  ]);
  const rank = { yes: 0, unconfirmed: 1, unsure: 2, no: 3 };
  return s.players
    .filter((p) => rosterEligible(s, p.id, teamId) && !elsewhere.has(p.id))
    .sort(
      (a, b) =>
        rank[availabilityFor(s, f, a.id)] - rank[availabilityFor(s, f, b.id)] ||
        participation(s, f, a.id).played - participation(s, f, b.id).played ||
        a.name.localeCompare(b.name),
    );
}
export function siblingSelections(s: State, f: Fixture, p: Player) {
  if (!p.parentId) return [];
  return s.fixtures
    .filter((v) => v.date === f.date && v.status !== 'cancelled')
    .flatMap((v) =>
      v.pairs.flatMap((pair) =>
        pair.players
          .filter((id) => id !== p.id)
          .flatMap((id) => {
            const sibling = s.players.find(
              (c) => c.id === id && c.parentId === p.parentId,
            );
            return sibling
              ? [{ name: sibling.name, teamId: pair.teamId, fixtureId: v.id }]
              : [];
          }),
      ),
    );
}
/** A reviewable suggestion: confirmed availability first, fair rotation, then family logistics and varied partners. */
export function suggestLineup(s: State, f: Fixture, teamId: string) {
  const league = s.leagues.find((l) => l.id === f.leagueId)!;
  const elsewhere = new Set(
    f.pairs.filter((p) => p.teamId !== teamId).flatMap((p) => p.players),
  );
  const roster = s.players.filter((p) => rosterEligible(s, p.id, teamId));
  const candidates = roster.filter(
    (p) => availabilityFor(s, f, p.id) === 'yes' && !elsewhere.has(p.id),
  );
  const selected: Player[] = [];
  while (candidates.length && selected.length < league.pairs * 2) {
    candidates.sort((a, b) => {
      const ac = participation(s, f, a.id),
        bc = participation(s, f, b.id);
      const family = (p: Player) =>
        p.parentId && selected.some((v) => v.parentId === p.parentId) ? 1 : 0;
      return (
        ac.played + ac.planned - (bc.played + bc.planned) ||
        ac.played - bc.played ||
        family(b) - family(a) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
      );
    });
    selected.push(candidates.shift()!);
  }
  const remaining = [...selected];
  const pairs: string[][] = [];
  const previous = (a: Player, b: Player) =>
    s.fixtures.filter(
      (v) =>
        v.id !== f.id &&
        v.leagueId === f.leagueId &&
        v.status !== 'cancelled' &&
        v.date <= f.date &&
        v.pairs.some(
          (p) => p.players.includes(a.id) && p.players.includes(b.id),
        ),
    ).length;
  while (remaining.length) {
    const first = remaining.shift()!;
    remaining.sort((a, b) => {
      const sibling = (p: Player) =>
        !!first.parentId && p.parentId === first.parentId ? 1 : 0;
      return (
        sibling(b) - sibling(a) ||
        previous(first, a) - previous(first, b) ||
        a.name.localeCompare(b.name)
      );
    });
    pairs.push([first.id, remaining.shift()?.id || '']);
  }
  while (pairs.length < league.pairs) pairs.push(['', '']);
  return { pairs, shortfall: Math.max(0, league.pairs * 2 - selected.length) };
}
