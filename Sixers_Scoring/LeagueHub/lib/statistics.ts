import {
  canLeague,
  points,
  type State,
  type Member,
  type League,
} from './model';
export type StatisticsFilter = { league: string; club: string };
export const ALL_STATISTICS: StatisticsFilter = { league: 'all', club: 'all' };
export function leagueSeriesKey(l: League) {
  return JSON.stringify([
    l.name.trim().toLowerCase(),
    l.region.trim().toLowerCase(),
  ]);
}
export const GENDER_LABELS = {
  boy: 'Boys',
  girl: 'Girls',
  another: 'Another gender',
  'prefer-not-to-say': 'Prefer not to say',
  '': 'Not recorded',
};
const rounded = (n: number) => Math.round(n * 100) / 100;
export function statisticsScope(
  s: State,
  m: Member,
  years: number[],
  filter: StatisticsFilter,
) {
  const leagues = s.leagues.filter(
    (l) =>
      years.includes(l.year) &&
      canLeague(m, l.id) &&
      (filter.league === 'all' || leagueSeriesKey(l) === filter.league),
  );
  const leagueIds = new Set(leagues.map((l) => l.id));
  const teams = s.teams.filter(
    (t) =>
      leagueIds.has(t.leagueId) &&
      (filter.club === 'all' || t.orgId === filter.club),
  );
  const teamIds = new Set(teams.map((t) => t.id));
  return {
    leagues: leagues.filter(
      (l) => filter.club === 'all' || teams.some((t) => t.leagueId === l.id),
    ),
    teams,
    teamIds,
    fixtures: s.fixtures.filter(
      (f) =>
        leagueIds.has(f.leagueId) &&
        (filter.club === 'all' || f.teamIds.some((id) => teamIds.has(id))),
    ),
  };
}
export function statisticsReport(
  s: State,
  m: Member,
  years: number[],
  filter: StatisticsFilter,
) {
  const scope = statisticsScope(s, m, years, filter),
    leagueMap = new Map(scope.leagues.map((l) => [l.id, l]));
  const completed = scope.fixtures.filter((f) => f.status === 'completed');
  const registered = new Set(
    (s.enrollments || [])
      .filter(
        (e) =>
          scope.teamIds.has(e.teamId) &&
          (e.status === 'approved' || !!e.approvedAt),
      )
      .map((e) => e.playerId),
  );
  const played = new Set<string>(),
    counties = new Map<string, { county: string; fixtures: number }>(),
    profile = new Map<number, number>();
  const knownPlayers = new Map(
    s.players.filter((p) => p.dob).map((p) => [p.id, p]),
  );
  let scoreCount = 0,
    scoreSum = 0,
    strokeSum = 0,
    expectedScores = 0,
    invalidScores = 0;
  for (const f of completed) {
    const l = leagueMap.get(f.leagueId)!;
    if (!l) continue;
    const county =
        s.clubs.find((c) => c.id === f.clubId)?.county?.trim() ||
        'Not recorded',
      key = county.toLowerCase();
    const bucket = counties.get(key) || { county, fixtures: 0 };
    bucket.fixtures++;
    counties.set(key, bucket);
    expectedScores +=
      f.teamIds.filter((id) => scope.teamIds.has(id)).length *
      l.pairs *
      l.holes;
    for (const pair of f.pairs.filter((p) => scope.teamIds.has(p.teamId))) {
      pair.players.forEach((id) => {
        played.add(id);
        registered.add(id);
      });
      for (let hole = 1; hole <= l.holes; hole++) {
        const score = f.scores[`${pair.id}:${hole}`];
        if (!score) continue;
        if (
          !Number.isInteger(score.strokes) ||
          score.strokes < 1 ||
          score.strokes > l.maxStrokes
        ) {
          invalidScores++;
          continue;
        }
        const value = points(score.strokes, l.maxStrokes);
        profile.set(value, (profile.get(value) || 0) + 1);
        scoreCount++;
        scoreSum += value;
        strokeSum += score.strokes;
      }
    }
  }
  const earlier = new Set(
    s.fixtures
      .filter(
        (f) =>
          f.status === 'completed' &&
          canLeague(m, f.leagueId) &&
          (s.leagues.find((l) => l.id === f.leagueId)?.year ?? Infinity) <
            Math.min(...years),
      )
      .flatMap((f) => f.pairs.flatMap((p) => p.players)),
  );
  const genderCounts: Record<string, number> = Object.fromEntries(
    Object.keys(GENDER_LABELS).map((k) => [k, 0]),
  );
  const handicapCounts: Record<string, number> = {
    'No handicap recorded': 0,
    'Below 37': 0,
    '37–45': 0,
    'Above 45': 0,
  };
  const parents = new Set<string>();
  let returning = 0;
  for (const id of registered) {
    const p = knownPlayers.get(id),
      gender =
        p?.gender && Object.hasOwn(GENDER_LABELS, p.gender) ? p.gender : '';
    genderCounts[gender]++;
    if (p?.parentId) parents.add(p.parentId);
    if (earlier.has(id)) returning++;
    const handicap = p?.handicap;
    handicapCounts[
      handicap == null
        ? 'No handicap recorded'
        : handicap < 37
          ? 'Below 37'
          : handicap <= 45
            ? '37–45'
            : 'Above 45'
    ]++;
  }
  const gender = Object.entries(GENDER_LABELS).map(([key, name]) => ({
    key,
    name,
    count: genderCounts[key],
    percent: registered.size
      ? rounded((genderCounts[key] * 100) / registered.size)
      : 0,
  }));
  const maxPoints = Math.max(10, ...scope.leagues.map((l) => l.maxStrokes));
  const counts = {
    leagues: scope.leagues.length,
    clubs: new Set(scope.teams.map((t) => t.orgId)).size,
    teams: scope.teams.length,
    registered: registered.size,
    played: played.size,
    families: parents.size,
    pending: (s.enrollments || []).filter(
      (e) => scope.teamIds.has(e.teamId) && e.status === 'pending',
    ).length,
    held: completed.length,
    scheduled: scope.fixtures.filter((f) => f.status === 'scheduled').length,
    live: scope.fixtures.filter((f) => f.status === 'live').length,
    cancelled: scope.fixtures.filter((f) => f.status === 'cancelled').length,
    returning,
    noEarlierPlay: registered.size - returning,
    scoreCount,
    expectedScores,
    missingScores: Math.max(0, expectedScores - scoreCount),
    invalidScores,
    meanPoints: scoreCount ? rounded(scoreSum / scoreCount) : null,
    meanStrokes: scoreCount ? rounded(strokeSum / scoreCount) : null,
    missingGender: genderCounts[''],
    missingCounty: counties.get('not recorded')?.fixtures || 0,
  };
  return {
    years,
    counts,
    gender,
    scoreProfile: Array.from({ length: maxPoints }, (_, i) => ({
      points: maxPoints - i,
      count: profile.get(maxPoints - i) || 0,
    })),
    counties: [...counties.values()].sort(
      (a, b) => b.fixtures - a.fixtures || a.county.localeCompare(b.county),
    ),
    handicaps: Object.entries(handicapCounts).map(([name, count]) => ({
      name,
      count,
    })),
    formats: [
      ...new Set(
        scope.leagues.map(
          (l) =>
            `${l.holes} holes · ${l.pairs} pairs · ${l.maxStrokes} max strokes`,
        ),
      ),
    ],
    fixtures: completed
      .map((f) => ({
        id: f.id,
        date: f.date,
        venue: s.clubs.find((c) => c.id === f.clubId)?.name || f.name,
        county:
          s.clubs.find((c) => c.id === f.clubId)?.county?.trim() ||
          'Not recorded',
        league: leagueMap.get(f.leagueId)?.name || '',
        year: leagueMap.get(f.leagueId)?.year || 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
export function buildStatistics(
  s: State,
  m: Member,
  years: number[],
  filter = ALL_STATISTICS,
) {
  const selected = [...new Set(years)].sort((a, b) => a - b);
  const scope = statisticsScope(s, m, selected, filter);
  const leagueKeys = [...new Set(scope.leagues.map(leagueSeriesKey))];
  const leagueRows = leagueKeys.map((key) => {
    const l = scope.leagues.find((l) => leagueSeriesKey(l) === key)!;
    return {
      key,
      name: l.name,
      region: l.region,
      ...statisticsReport(s, m, selected, { ...filter, league: key }).counts,
    };
  });
  const clubRows = [...new Set(scope.teams.map((t) => t.orgId))].map((id) => ({
    id,
    name: s.orgs.find((o) => o.id === id)?.name || 'Unknown club',
    ...statisticsReport(s, m, selected, { ...filter, club: id }).counts,
  }));
  return {
    overall: statisticsReport(s, m, selected, filter),
    annual: selected.map((year) => ({
      year,
      ...statisticsReport(s, m, [year], filter),
    })),
    leagues: leagueRows.sort((a, b) => a.name.localeCompare(b.name)),
    clubs: clubRows.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
export type Statistics = ReturnType<typeof buildStatistics>;
export function statisticsCsv(
  data: Statistics,
  labels: { league: string; club: string },
) {
  const rows: unknown[][] = [
    [
      'Season / period',
      'League filter',
      'Club filter',
      'Section',
      'Category',
      'Metric',
      'Value',
      'Unit',
    ],
  ];
  const add = (
    period: string,
    section: string,
    category: string,
    metric: string,
    value: unknown,
    unit: string,
  ) =>
    rows.push([
      period,
      labels.league,
      labels.club,
      section,
      category,
      metric,
      value ?? '',
      unit,
    ]);
  for (const report of [
    data.overall,
    ...(data.annual.length > 1 ? data.annual : []),
  ]) {
    const period = report.years.join(', ');
    if (!report.counts.leagues) {
      add(period, 'Availability', 'All', 'No leagues recorded', '', '');
      continue;
    }
    for (const [metric, value] of Object.entries(report.counts))
      add(
        period,
        'Summary',
        'All',
        metric,
        value,
        metric.startsWith('mean') ? 'per pair-hole' : 'count',
      );
    for (const g of report.gender) {
      add(period, 'Gender', g.name, 'Registered players', g.count, 'players');
      add(
        period,
        'Gender',
        g.name,
        'Share of registered players',
        g.percent,
        'percent',
      );
    }
    for (const p of report.scoreProfile)
      add(
        period,
        'Scoring',
        String(p.points),
        'Pair-hole points frequency',
        p.count,
        'pair-holes',
      );
    for (const county of report.counties)
      add(
        period,
        'County',
        county.county,
        'Fixtures held',
        county.fixtures,
        'fixtures',
      );
    for (const bucket of report.handicaps)
      add(
        period,
        'Handicap',
        bucket.name,
        'Registered players',
        bucket.count,
        'players',
      );
  }
  for (const [section, groups] of [
    ['League', data.leagues],
    ['Club', data.clubs],
  ] as const)
    for (const group of groups)
      for (const metric of [
        'registered',
        'played',
        'held',
        'teams',
        'scoreCount',
        'meanPoints',
      ] as const)
        add(
          data.overall.years.join(', '),
          section,
          group.name,
          metric,
          group[metric],
          metric === 'meanPoints' ? 'points per pair-hole' : 'count',
        );
  for (const f of data.overall.fixtures)
    add(
      String(f.year),
      'Completed fixture',
      `${f.venue} · ${f.date}`,
      f.county,
      1,
      'fixture',
    );
  add(
    data.overall.years.join(', '),
    'Definitions',
    'Registration',
    'Approved places or recorded completed-fixture participation; unique children per period. Historical removals without approval evidence may be incomplete.',
    '',
    '',
  );
  add(
    data.overall.years.join(', '),
    'Definitions',
    'Profiles',
    'Gender and handicap use the latest recorded profile, not a historical snapshot. Unknown gender remains in the denominator.',
    '',
    '',
  );
  add(
    data.overall.years.join(', '),
    'Definitions',
    'Scoring',
    'Completed fixtures only; one score per pair per hole, not one score per child. County is the hosting venue county.',
    '',
    '',
  );
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value ?? '');
            if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n')
  );
}
