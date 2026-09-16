import type { State, Player } from './model';

export function searchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
export function clubMatches(
  s: State,
  orgId: string,
  query: string,
  county = '',
) {
  const venues = s.clubs.filter((c) => c.orgId === orgId);
  const address = venues
    .map((c) =>
      [c.name, c.address, c.county, c.postcode].filter(Boolean).join(' '),
    )
    .join(' ');
  const haystack = searchText(
    `${s.orgs.find((o) => o.id === orgId)?.name || ''} ${address}`,
  );
  const tokens = searchText(query).split(' ').filter(Boolean);
  // A postcode can be entered with or without its space.
  return (
    tokens.every(
      (t) => haystack.includes(t) || haystack.replace(/ /g, '').includes(t),
    ) &&
    (!county ||
      venues.some((c) => searchText(c.county || '') === searchText(county)))
  );
}
export function playerTeams(s: State, p: Player) {
  return s.teams.filter((t) =>
    s.enrollments
      ? s.enrollments.some(
          (e) =>
            e.playerId === p.id &&
            e.teamId === t.id &&
            ['approved', 'pending'].includes(e.status),
        )
      : t.orgId === p.orgId,
  );
}
export function playedBefore(s: State, p: Player, beforeYear: number) {
  return s.fixtures.some(
    (f) =>
      f.status === 'completed' &&
      (s.leagues.find((l) => l.id === f.leagueId)?.year ?? Infinity) <
        beforeYear &&
      f.pairs.some((pair) => pair.players.includes(p.id)),
  );
}
export type PlayerFilters = {
  query: string;
  league: string;
  club: string;
  team: string;
  care: string;
  handicap: string;
  history: string;
  year: number;
};
export function filterPlayers(s: State, filters: PlayerFilters) {
  return s.players
    .filter((p) => {
      if (!p.dob) return false; // Redacted matchday names are not family-directory records.
      const parent = s.members.find((m) => m.id === p.parentId);
      const text = searchText(
        [p.name, parent?.name, parent?.email, parent?.phone, p.emergencyName]
          .filter(Boolean)
          .join(' '),
      );
      if (
        !searchText(filters.query)
          .split(' ')
          .every((t) => text.includes(t))
      )
        return false;
      // Match all affiliation filters against the same team, never just the club's leagues.
      const affiliation = filters.league !== 'all' || filters.team !== 'all';
      if (
        affiliation &&
        !playerTeams(s, p).some(
          (t) =>
            (filters.league === 'all' || t.leagueId === filters.league) &&
            (filters.club === 'all' || t.orgId === filters.club) &&
            (filters.team === 'all' || t.id === filters.team),
        )
      )
        return false;
      if (
        !affiliation &&
        filters.club !== 'all' &&
        p.orgId !== filters.club &&
        !playerTeams(s, p).some((t) => t.orgId === filters.club)
      )
        return false;
      if (filters.care === 'support' && !p.care.trim()) return false;
      if (filters.care === 'diet' && !p.diet.trim()) return false;
      if (filters.care === 'photo' && p.photoConsent) return false;
      if (filters.handicap === 'held' && p.handicap === null) return false;
      if (filters.handicap === 'none' && p.handicap !== null) return false;
      if (
        filters.handicap === 'review' &&
        (p.handicap === null || p.handicap >= 37)
      )
        return false;
      const returning = playedBefore(s, p, filters.year);
      if (filters.history === 'returning' && !returning) return false;
      if (filters.history === 'unrecorded' && returning) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
