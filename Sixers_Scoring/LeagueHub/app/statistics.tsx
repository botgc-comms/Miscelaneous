'use client';
import { useEffect, useMemo, useState } from 'react';
import { Download, ArrowRight } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  buildStatistics,
  leagueSeriesKey,
  statisticsCsv,
  ALL_STATISTICS,
  type StatisticsFilter,
  type Statistics,
} from '@/lib/statistics';
import { canLeague, emptyState } from '@/lib/model';
import { Pick, type AppTools } from './widgets';
const colors = ['#00816b', '#9657c9', '#e57c28', '#2475d0', '#91a19a'];
const number = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number | null)[][];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {headers.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            {r.map((v, j) => (
              <TableCell key={j}>{v === null ? '—' : v}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
function GenderChart({
  report,
  title,
}: {
  report: Statistics['overall'];
  title: string;
}) {
  const total = report.counts.registered;
  return (
    <div className="stats-gender">
      <h3>{title}</h3>
      {total ? (
        <ChartContainer
          className="stats-donut"
          config={{ count: { label: 'Registered players', color: '#00816b' } }}
        >
          <PieChart accessibilityLayer>
            <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
            <Pie
              data={report.gender.filter((g) => g.count)}
              dataKey="count"
              nameKey="name"
              innerRadius={58}
              outerRadius={88}
              paddingAngle={2}
            >
              {report.gender
                .filter((g) => g.count)
                .map((g) => (
                  <Cell
                    key={g.key}
                    fill={
                      colors[report.gender.findIndex((v) => v.key === g.key)]
                    }
                  />
                ))}
            </Pie>
          </PieChart>
        </ChartContainer>
      ) : (
        <p className="stats-empty">No registered players recorded.</p>
      )}
      <ul className="stats-legend">
        {report.gender.map((g, i) => (
          <li key={g.key}>
            <span className="stats-swatch" style={{ background: colors[i] }} />
            <span>{g.name}</span>
            <strong>
              {g.count} <small>({g.percent}%)</small>
            </strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function StatisticsPage({
  tools,
  initialYear,
}: {
  tools: AppTools;
  initialYear: string;
}) {
  const { s, me } = tools;
  const startYear =
    Number(initialYear) ||
    Math.max(
      new Date().getFullYear(),
      ...s.leagues.filter((l) => canLeague(me, l.id)).map((l) => l.year),
    );
  const [year, setYear] = useState(startYear),
    [mode, setMode] = useState('season'),
    [comparison, setComparison] = useState(startYear - 1),
    [filter, setFilter] = useState<StatisticsFilter>(ALL_STATISTICS),
    [countyDetail, setCountyDetail] = useState('');
  const accessible = s.leagues.filter((l) => canLeague(me, l.id));
  const yearOptions = [
    ...new Set([
      ...accessible.map((l) => l.year),
      year,
      comparison,
      ...Array.from({ length: 6 }, (_, i) => new Date().getFullYear() + 1 - i),
    ]),
  ].sort((a, b) => b - a);
  const years =
    mode === 'five'
      ? Array.from({ length: 5 }, (_, i) => year - i)
      : mode === 'compare'
        ? [year, comparison]
        : [year];
  const requestKey = JSON.stringify([
    tools.workspace,
    tools.view,
    years,
    filter,
  ]);
  const [response, setResponse] = useState<{
      key: string;
      data: Statistics;
    } | null>(null),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    const query = new URLSearchParams({
      workspace: tools.workspace,
      view: tools.view,
      years: years.join(','),
      league: filter.league,
      club: filter.club,
    });
    void fetch(`/api/statistics?${query}`, { signal: controller.signal })
      .then(async (r) => {
        const data = (await r.json()) as any;
        if (!r.ok) throw new Error(data.error);
        if (!controller.signal.aborted) setResponse({ key: requestKey, data });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [requestKey, reload]);
  const loaded = response?.key === requestKey;
  const fallback = useMemo(
    () => buildStatistics(emptyState(), me, years, filter),
    [requestKey],
  );
  const data = loaded ? response.data : fallback;
  const primary = data.annual.find((a) => a.year === year)!,
    previous =
      mode === 'compare'
        ? data.annual.find((a) => a.year === comparison)
        : undefined;
  const shown = mode === 'five' ? data.overall : primary;
  const leagueOptions = [
    ...new Map(
      accessible
        .filter(
          (l) => years.includes(l.year) || leagueSeriesKey(l) === filter.league,
        )
        .map((l) => [
          leagueSeriesKey(l),
          { value: leagueSeriesKey(l), label: `${l.name} · ${l.region}` },
        ]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));
  const clubIds = new Set(
    s.teams
      .filter((t) =>
        accessible.some(
          (l) =>
            l.id === t.leagueId &&
            years.includes(l.year) &&
            (filter.league === 'all' || leagueSeriesKey(l) === filter.league),
        ),
      )
      .map((t) => t.orgId),
  );
  const clubs = s.orgs
    .filter((o) => clubIds.has(o.id) || o.id === filter.club)
    .sort((a, b) => a.name.localeCompare(b.name));
  const labels = {
    league:
      leagueOptions.find((l) => l.value === filter.league)?.label ||
      'All leagues',
    club: s.orgs.find((o) => o.id === filter.club)?.name || 'All clubs',
  };
  const resetPeriod = (newYear: number, newMode = mode) => {
    setYear(newYear);
    setMode(newMode);
    if (comparison === newYear) setComparison(newYear - 1);
    setCountyDetail('');
  };
  const barsConfig = {
    current: {
      label: mode === 'five' ? `${year - 4}–${year}` : String(year),
      color: '#00816b',
    },
    previous: { label: String(comparison), color: '#e57c28' },
  };
  const scoreRows = Array.from(
    {
      length: Math.max(
        shown.scoreProfile.length,
        previous?.scoreProfile.length || 0,
      ),
    },
    (_, i) => {
      const points =
        Math.max(
          shown.scoreProfile.length,
          previous?.scoreProfile.length || 0,
        ) - i;
      return {
        points,
        current:
          shown.scoreProfile.find((p) => p.points === points)?.count || 0,
        previous:
          previous?.scoreProfile.find((p) => p.points === points)?.count || 0,
      };
    },
  );
  const countyNames = [
    ...new Map(
      [...shown.counties, ...(previous?.counties || [])].map((c) => [
        c.county.toLowerCase(),
        c.county,
      ]),
    ).values(),
  ];
  const countyRows = countyNames
    .map((name) => ({
      name,
      current:
        shown.counties.find(
          (c) => c.county.toLowerCase() === name.toLowerCase(),
        )?.fixtures || 0,
      previous:
        previous?.counties.find(
          (c) => c.county.toLowerCase() === name.toLowerCase(),
        )?.fixtures || 0,
    }))
    .sort((a, b) => b.current + b.previous - (a.current + a.previous));
  const change = (key: keyof StatisticsFilter, value: string) => {
    setFilter((old) => ({
      ...old,
      [key]: value,
      ...(key === 'league' ? { club: 'all' } : {}),
    }));
    setCountyDetail('');
  };
  function download() {
    const url = URL.createObjectURL(
      new Blob([statisticsCsv(data, labels)], {
        type: 'text/csv;charset=utf-8',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `golfsixes-statistics-${[...years].sort((a, b) => a - b).join('-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const metric = (
    label: string,
    key: 'registered' | 'played' | 'held' | 'meanPoints',
    hint: string,
  ) => {
    const value = shown.counts.leagues ? shown.counts[key] : null,
      old = previous?.counts.leagues ? previous.counts[key] : null,
      diff =
        value !== null && old != null
          ? Math.round((value - old) * 100) / 100
          : null;
    return (
      <article className="card stats-metric">
        <span>{label}</span>
        <strong>{number(value)}</strong>
        {previous && (
          <small>
            {comparison}: {number(old ?? null)}
            {diff !== null ? ` · ${diff > 0 ? '+' : ''}${number(diff)}` : ''}
          </small>
        )}
        <p>{hint}</p>
      </article>
    );
  };
  return (
    <div className="statistics-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">FOUNDATION · SEASON INSIGHTS</span>
          <h1>Statistics</h1>
          <p>Participation, scoring and where the league is being played.</p>
        </div>
        <div className="actions">
          <button
            className="btn"
            disabled={!loaded}
            onClick={() => {
              setResponse(null);
              setReload((n) => n + 1);
            }}
          >
            Refresh figures
          </button>
          <button className="btn primary" disabled={!loaded} onClick={download}>
            <Download size={16} />
            Download filtered CSV
          </button>
        </div>
      </div>
      <section className="card stats-filters" aria-label="Statistics filters">
        <label className="field">
          <span>View</span>
          <Pick
            label="Statistics period"
            value={mode}
            onChange={(v) => resetPeriod(year, v)}
            options={[
              { value: 'season', label: 'One season' },
              { value: 'compare', label: 'Compare two seasons' },
              { value: 'five', label: 'Five-year trend' },
            ]}
          />
        </label>
        <label className="field">
          <span>{mode === 'five' ? 'Five years ending' : 'Season'}</span>
          <Pick
            label="Season year"
            value={String(year)}
            onChange={(v) => resetPeriod(Number(v))}
            options={yearOptions.map((y) => ({
              value: String(y),
              label: String(y),
            }))}
          />
        </label>
        {mode === 'compare' && (
          <label className="field">
            <span>Compare with</span>
            <Pick
              label="Comparison season"
              value={String(comparison)}
              onChange={(v) => {
                setComparison(Number(v));
                setCountyDetail('');
              }}
              options={yearOptions
                .filter((y) => y !== year)
                .map((y) => ({ value: String(y), label: String(y) }))}
            />
          </label>
        )}
        <label className="field">
          <span>League</span>
          <Pick
            label="Filter league"
            value={filter.league}
            onChange={(v) => change('league', v)}
            options={[{ value: 'all', label: 'All leagues' }, ...leagueOptions]}
          />
        </label>
        <label className="field">
          <span>Club</span>
          <Pick
            label="Filter club"
            value={filter.club}
            onChange={(v) => change('club', v)}
            options={[
              { value: 'all', label: 'All clubs' },
              ...clubs.map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
        </label>
      </section>
      {!loaded ? (
        <p
          className={error ? 'error' : 'notice'}
          role={error ? 'alert' : 'status'}
        >
          {error || 'Loading season statistics…'}
          {error && (
            <button
              className="btn small"
              onClick={() => setReload((v) => v + 1)}
            >
              Try again
            </button>
          )}
        </p>
      ) : (
        <>
          <div className="stats-scope">
            <p>
              <strong>
                {mode === 'five'
                  ? `${year - 4}–${year}`
                  : mode === 'compare'
                    ? `${year} compared with ${comparison}`
                    : year}
              </strong>{' '}
              · {labels.league} · {labels.club}
            </p>
            {(filter.club !== 'all' || filter.league !== 'all') && (
              <button
                className="text-link"
                onClick={() => {
                  setFilter(ALL_STATISTICS);
                  setCountyDetail('');
                }}
              >
                Clear league and club filters
              </button>
            )}
          </div>
          {me.role === 'league-admin' && (
            <p className="notice">
              Statistics include the leagues assigned to you.
            </p>
          )}
          {!data.overall.counts.leagues && (
            <p className="notice">
              No leagues are recorded for this selection. Choose another season
              or clear the filters.
            </p>
          )}
          {data.overall.counts.leagues > 0 &&
            data.annual.some((a) => !a.counts.leagues) && (
              <p className="notice">
                No leagues recorded for{' '}
                {data.annual
                  .filter((a) => !a.counts.leagues)
                  .map((a) => a.year)
                  .join(', ')}{' '}
                in this selection. These years are not treated as
                zero-participation seasons.
              </p>
            )}
          <div className="stats-metrics">
            {metric(
              'Registered players',
              'registered',
              mode === 'five'
                ? 'Unique children across these five years.'
                : 'Unique children with an approved place or recorded participation.',
            )}
            {metric(
              'Children who played',
              'played',
              'Appeared in at least one completed fixture.',
            )}
            {metric('Fixtures held', 'held', 'Completed fixtures only.')}
            {metric(
              'Average points per hole',
              'meanPoints',
              'One recorded score per pair per hole.',
            )}
          </div>
          <p className="stats-context">
            {shown.counts.clubs} clubs · {shown.counts.teams} team entries ·{' '}
            {shown.counts.families} families · {shown.counts.pending}{' '}
            applications waiting · {shown.counts.returning} players with earlier
            recorded participation
          </p>
          <div className="stats-grid">
            <section className="card stats-panel">
              <h2>Who is taking part?</h2>
              <p>
                Percentage of registered players. Unrecorded and undisclosed
                gender remain included.
              </p>
              <div className="stats-gender-grid">
                <GenderChart
                  report={shown}
                  title={mode === 'five' ? `${year - 4}–${year}` : String(year)}
                />
                {previous && (
                  <GenderChart report={previous} title={String(comparison)} />
                )}
              </div>
            </section>
            <section className="card stats-panel">
              <h2>Points scored per hole</h2>
              <p>
                How often pairs scored each number of points in completed
                fixtures.
              </p>
              {shown.counts.scoreCount || previous?.counts.scoreCount ? (
                <ChartContainer config={barsConfig} className="stats-chart">
                  <BarChart accessibilityLayer data={scoreRows}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="points"
                      label={{
                        value: 'Points',
                        position: 'insideBottom',
                        offset: -3,
                      }}
                      height={40}
                    />
                    <YAxis allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="current"
                      fill="var(--color-current)"
                      radius={[4, 4, 0, 0]}
                    />
                    {previous && (
                      <Bar
                        dataKey="previous"
                        fill="var(--color-previous)"
                        radius={[4, 4, 0, 0]}
                      />
                    )}
                  </BarChart>
                </ChartContainer>
              ) : (
                <p className="stats-empty">
                  Scoring profiles appear after a fixture is completed.
                </p>
              )}
              {previous && (
                <div className="stats-series-key">
                  <span style={{ color: colors[0] }}>● {year}</span>
                  <span style={{ color: colors[2] }}>● {comparison}</span>
                </div>
              )}
              <details>
                <summary>View score frequencies</summary>
                <DataTable
                  headers={[
                    'Points',
                    mode === 'five' ? 'Selected years' : String(year),
                    ...(previous ? [String(comparison)] : []),
                  ]}
                  rows={scoreRows.map((r) => [
                    r.points,
                    r.current,
                    ...(previous ? [r.previous] : []),
                  ])}
                />
              </details>
            </section>
            <section className="card stats-panel">
              <h2>Fixtures held by county</h2>
              <p>
                The hosting venue’s county. Select a county below to see its
                fixtures.
              </p>
              {countyRows.length ? (
                <ChartContainer
                  config={barsConfig}
                  className="stats-chart"
                  style={{
                    height: Math.max(240, Math.min(12, countyRows.length) * 38),
                  }}
                >
                  <BarChart
                    accessibilityLayer
                    data={countyRows.slice(0, 12)}
                    layout="vertical"
                  >
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={125}
                      tick={{ fontSize: 11 }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="current"
                      fill="var(--color-current)"
                      radius={[0, 4, 4, 0]}
                    />
                    {previous && (
                      <Bar
                        dataKey="previous"
                        fill="var(--color-previous)"
                        radius={[0, 4, 4, 0]}
                      />
                    )}
                  </BarChart>
                </ChartContainer>
              ) : (
                <p className="stats-empty">
                  No completed fixtures in this selection.
                </p>
              )}
              {previous && (
                <div className="stats-series-key">
                  <span style={{ color: colors[0] }}>● {year}</span>
                  <span style={{ color: colors[2] }}>● {comparison}</span>
                </div>
              )}
              {countyRows.length > 12 && (
                <p className="muted">
                  Chart shows the 12 counties with the most fixtures. All county
                  totals are available below.
                </p>
              )}
              {!!countyRows.length && (
                <Pick
                  label="Show fixtures in a county"
                  value={countyDetail || 'all'}
                  onChange={(v) => setCountyDetail(v === 'all' ? '' : v)}
                  options={[
                    {
                      value: 'all',
                      label: 'Choose a county to see its fixtures',
                    },
                    ...countyRows.map((c) => ({
                      value: c.name,
                      label: c.name,
                    })),
                  ]}
                />
              )}
              <details>
                <summary>All county totals</summary>
                <DataTable
                  headers={[
                    'County',
                    mode === 'five' ? 'Selected years' : String(year),
                    ...(previous ? [String(comparison)] : []),
                  ]}
                  rows={countyRows.map((c) => [
                    c.name,
                    c.current,
                    ...(previous ? [c.previous] : []),
                  ])}
                />
              </details>
            </section>
            <section className="card stats-panel">
              <h2>
                {data.annual.length > 1
                  ? 'Participation over time'
                  : 'Fixture progress'}
              </h2>
              <p>
                {data.annual.length > 1
                  ? 'Children are counted once within each season. Years with no leagues recorded are left blank.'
                  : 'Scheduled, live, completed and cancelled fixtures.'}
              </p>
              {data.annual.length > 1 ? (
                <ChartContainer
                  className="stats-chart"
                  config={{
                    registered: {
                      label: 'Registered players',
                      color: '#00816b',
                    },
                    played: { label: 'Children who played', color: '#9657c9' },
                  }}
                >
                  <LineChart
                    accessibilityLayer
                    data={data.annual.map((a) => ({
                      year: a.year,
                      registered: a.counts.leagues ? a.counts.registered : null,
                      played: a.counts.leagues ? a.counts.played : null,
                    }))}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="year" />
                    <YAxis allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line
                      type="linear"
                      dataKey="registered"
                      stroke="var(--color-registered)"
                      strokeWidth={3}
                    />
                    <Line
                      type="linear"
                      dataKey="played"
                      stroke="var(--color-played)"
                      strokeWidth={3}
                    />
                  </LineChart>
                </ChartContainer>
              ) : (
                <ChartContainer
                  className="stats-chart"
                  config={{ count: { label: 'Fixtures', color: '#00816b' } }}
                >
                  <BarChart
                    accessibilityLayer
                    data={[
                      { name: 'Scheduled', count: shown.counts.scheduled },
                      { name: 'Live', count: shown.counts.live },
                      { name: 'Held', count: shown.counts.held },
                      { name: 'Cancelled', count: shown.counts.cancelled },
                    ]}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="count"
                      fill="var(--color-count)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              )}
              {data.annual.length > 1 && (
                <div className="stats-series-key">
                  <span style={{ color: colors[0] }}>● Registered players</span>
                  <span style={{ color: colors[1] }}>
                    ● Children who played
                  </span>
                </div>
              )}
              <details>
                <summary>Season figures</summary>
                <DataTable
                  headers={[
                    'Season',
                    'Registered',
                    'Played',
                    'Fixtures held',
                    'Average points',
                  ]}
                  rows={data.annual.map((a) => [
                    a.year,
                    a.counts.leagues ? a.counts.registered : null,
                    a.counts.leagues ? a.counts.played : null,
                    a.counts.leagues ? a.counts.held : null,
                    a.counts.meanPoints,
                  ])}
                />
              </details>
            </section>
          </div>
          {countyDetail && (
            <section className="card stats-panel">
              <div className="row justify-between">
                <h2>Fixtures held in {countyDetail}</h2>
                <button
                  className="text-link"
                  onClick={() => setCountyDetail('')}
                >
                  Close list
                </button>
              </div>
              <DataTable
                headers={['Date', 'Venue', 'League', 'Season']}
                rows={data.overall.fixtures
                  .filter(
                    (f) =>
                      f.county.toLowerCase() === countyDetail.toLowerCase(),
                  )
                  .map((f) => [f.date, f.venue, f.league, f.year])}
              />
            </section>
          )}
          <div className="stats-grid stats-breakdowns">
            {(['leagues', 'clubs'] as const).map((group) => (
              <section className="card stats-panel" key={group}>
                <h2>Explore {group}</h2>
                <p>
                  {years.length > 1
                    ? 'Unique players across the selected seasons. '
                    : ''}
                  Select a {group === 'leagues' ? 'league' : 'club'} to filter
                  all charts.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {group === 'leagues' ? 'League' : 'Club'}
                      </TableHead>
                      <TableHead>Registered</TableHead>
                      <TableHead>Played</TableHead>
                      <TableHead>Held</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data[group].map((row: any) => (
                      <TableRow key={row.key || row.id}>
                        <TableCell>
                          <button
                            className="text-link"
                            onClick={() =>
                              change(
                                group === 'leagues' ? 'league' : 'club',
                                row.key || row.id,
                              )
                            }
                          >
                            {row.name}
                            <ArrowRight size={13} />
                          </button>
                          {row.region && (
                            <small className="muted">{row.region}</small>
                          )}
                        </TableCell>
                        <TableCell>{row.registered}</TableCell>
                        <TableCell>{row.played}</TableCell>
                        <TableCell>{row.held}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!data[group].length && (
                  <p className="muted">
                    No {group} recorded for this selection.
                  </p>
                )}
              </section>
            ))}
          </div>
          <section className="card stats-panel">
            <h2>Handicaps and data completeness</h2>
            <div className="stats-quality">
              <div>
                <h3>Latest recorded handicap</h3>
                <DataTable
                  headers={['Handicap', 'Registered players']}
                  rows={shown.handicaps.map((h) => [h.name, h.count])}
                />
              </div>
              <div>
                <p>
                  <strong>{shown.counts.missingGender}</strong> registered
                  players have no gender recorded.
                </p>
                <p>
                  <strong>{shown.counts.missingCounty}</strong> completed
                  fixtures have no hosting county recorded.
                </p>
                <p>
                  <strong>
                    {shown.counts.scoreCount} of {shown.counts.expectedScores}
                  </strong>{' '}
                  expected pair-hole scores are available.
                  {shown.counts.invalidScores > 0
                    ? ` ${shown.counts.invalidScores} invalid scores were excluded.`
                    : ''}
                </p>
                {data.overall.formats.length > 1 && (
                  <p className="notice">
                    These leagues use different scoring formats. Raw points may
                    not be directly comparable.
                  </p>
                )}
              </div>
            </div>
          </section>
          <details className="card stats-panel stats-definitions">
            <summary>How these figures are counted</summary>
            <p>
              A registration means an approved team place or evidence of playing
              in a completed fixture. A child is counted once per season, league
              or club selection, even if they moved teams. Multi-year totals
              count each child once across the period, so annual figures may add
              up to more than the total.
            </p>
            <p>
              Team entries include teams that later withdrew. Earlier removed
              registrations without approval history may be incomplete.
              Returning players means there is an earlier completed-fixture
              appearance in the records you can access; it does not identify
              everyone new to golf.
            </p>
            <p>
              Gender and handicap use the latest profile, rather than a snapshot
              from each season. County comes from the hosting venue; a club
              filter counts that club’s fixtures and pair scores, including away
              fixtures. Leagues are matched by name and region across seasons.
            </p>
            <p>
              CSV downloads contain the filtered totals, chart data, league and
              club breakdowns, and completed fixtures. They contain no
              children’s names, contact details or care notes.
            </p>
          </details>
        </>
      )}
    </div>
  );
}
