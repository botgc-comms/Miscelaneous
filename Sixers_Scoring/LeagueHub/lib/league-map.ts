import {
  capOrder,
  requireThat,
  responsibleForLeague,
  type Member,
  type State,
} from './model';

export type MapPosition = { latitude: number; longitude: number };
export type MapTeam = {
  id: string;
  name: string;
  cap: string;
  color: string;
  leagueId: string;
};
export type MapClub = {
  id: string;
  name: string;
  postcode: string;
  editable: boolean;
  teams: MapTeam[];
  position?: MapPosition;
  issue?: string;
};
export type MapLeague = {
  id: string;
  name: string;
  year: number;
  color: string;
  teamCount: number;
  mappedTeamCount: number;
  area: [number, number][];
};
export type LeagueMapData = {
  leagues: MapLeague[];
  clubs: MapClub[];
  lookupUnavailable: boolean;
};
const colors = [
  '#007e68',
  '#7155b5',
  '#ce641a',
  '#2168b3',
  '#bd4269',
  '#817015',
  '#117d92',
  '#a14620',
];

export function normalisePostcode(value: string) {
  const compact = value.toUpperCase().replace(/\s/g, '');
  return /^(?:[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}|GIR0AA)$/.test(compact)
    ? compact.slice(0, -3) + ' ' + compact.slice(-3)
    : '';
}

export function mapInputs(s: State, me: Member, year: number, scope: string) {
  requireThat(
    ['admin', 'league-admin'].includes(me.role),
    'The league map is available to Foundation administrators.',
    403,
  );
  requireThat(
    Number.isInteger(year) && year >= 2020 && year <= 2100,
    'Choose a season year.',
  );
  requireThat(['mine', 'all'].includes(scope), 'Choose which leagues to show.');
  const all = s.leagues
    .filter((l) => l.year === year)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const leagues = all
    .filter((l) => scope === 'all' || responsibleForLeague(me, l))
    .map((l) => ({
      id: l.id,
      name: l.name,
      year: l.year,
      color: colors[all.indexOf(l) % colors.length],
    }));
  const teams = s.teams
    .filter((t) => !t.withdrawnAt && leagues.some((l) => l.id === t.leagueId))
    .sort(capOrder);
  const clubs: MapClub[] = [];
  for (const orgId of new Set(teams.map((t) => t.orgId))) {
    const orgTeams = teams
      .filter((t) => t.orgId === orgId)
      .map(({ id, name, cap, color, leagueId }) => ({
        id,
        name,
        cap,
        color,
        leagueId,
      }));
    const venues = s.clubs.filter((c) => c.orgId === orgId);
    if (!venues.length)
      clubs.push({
        id: `org:${orgId}`,
        name: s.orgs.find((o) => o.id === orgId)?.name || 'Club details needed',
        postcode: '',
        editable: false,
        teams: orgTeams,
      });
    for (const c of venues) {
      const fromAddress =
        c.address.match(
          /\b(?:[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|GIR\s*0AA)\b/i,
        )?.[0] || '';
      clubs.push({
        id: c.id,
        name: c.name,
        postcode: c.postcode?.trim() || fromAddress,
        editable: true,
        teams: orgTeams,
      });
    }
  }
  return { leagues, clubs };
}

/** Smooth convex support curve; every club remains inside a minimum 3 km margin. */
export function leagueEnvelope(
  points: MapPosition[],
  marginKm = 3,
): [number, number][] {
  if (!points.length) return [];
  const unique = [
    ...new Map(points.map((p) => [`${p.latitude}:${p.longitude}`, p])).values(),
  ];
  const latitude = unique.reduce((n, p) => n + p.latitude, 0) / unique.length;
  const longitude = unique.reduce((n, p) => n + p.longitude, 0) / unique.length;
  const lonScale = 111.32 * Math.cos((latitude * Math.PI) / 180);
  const local = unique.map((p) => [
    (p.longitude - longitude) * lonScale,
    (p.latitude - latitude) * 111.32,
  ]);
  const radius = Math.max(...local.map(([x, y]) => Math.hypot(x, y)));
  const softness = Math.max(0.8, Math.min(3, radius * 0.15));
  // A smooth maximum of support distances avoids straight triangular sides.
  // h + h'' = margin + softness*entropy + variance/softness > 0, so the curve stays convex.
  return Array.from({ length: 240 }, (_, i) => {
    const angle = (i * 2 * Math.PI) / 240,
      nx = Math.cos(angle),
      ny = Math.sin(angle);
    const distances = local.map(([x, y]) => x * nx + y * ny);
    const max = Math.max(...distances);
    const weights = distances.map((d) => Math.exp((d - max) / softness));
    const total = weights.reduce((a, b) => a + b, 0);
    const support = max + softness * Math.log(total) + marginKm;
    const derivative =
      local.reduce(
        (sum, [x, y], j) => sum + weights[j] * (-x * ny + y * nx),
        0,
      ) / total;
    return [
      latitude + (support * ny + derivative * nx) / 111.32,
      longitude + (support * nx - derivative * ny) / lonScale,
    ];
  });
}
export function mapData(
  input: ReturnType<typeof mapInputs>,
  positions: Record<string, MapPosition | null>,
  lookupUnavailable = false,
): LeagueMapData {
  const clubs = input.clubs.map((c) => {
    const postcode = normalisePostcode(c.postcode);
    const position = positions[postcode];
    return {
      ...c,
      ...(position
        ? { position }
        : {
            issue: !c.postcode
              ? 'Postcode needed'
              : !postcode
                ? 'Check postcode'
                : position === null
                  ? 'Postcode not found'
                  : 'Location lookup unavailable',
          }),
    };
  });
  return {
    clubs,
    lookupUnavailable,
    leagues: input.leagues.map((l) => {
      const members = clubs.filter((c) =>
        c.teams.some((t) => t.leagueId === l.id),
      );
      const mapped = members.filter((c) => c.position);
      return {
        ...l,
        teamCount: new Set(
          members.flatMap((c) =>
            c.teams.filter((t) => t.leagueId === l.id).map((t) => t.id),
          ),
        ).size,
        mappedTeamCount: new Set(
          mapped.flatMap((c) =>
            c.teams.filter((t) => t.leagueId === l.id).map((t) => t.id),
          ),
        ).size,
        area: leagueEnvelope(mapped.map((c) => c.position!)),
      };
    }),
  };
}
