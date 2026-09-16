'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { LocateFixed, Map as MapIcon } from 'lucide-react';
import { CheckField, Pick, type AppTools } from './widgets';
import { canOrg } from '@/lib/model';
import type { LeagueMapData, MapClub } from '@/lib/league-map';
import 'leaflet/dist/leaflet.css';
import './league-map.css';

const uk: [[number, number], [number, number]] = [
  [49.8, -8.6],
  [60.9, 2],
];
function textElement(tag: string, text: string, className = '') {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = className;
  return el;
}

function MapCanvas({
  data,
  openLeague,
}: {
  data: LeagueMapData;
  openLeague: (id: string) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const instance = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.FeatureGroup | null>(null);
  const library = useRef<typeof Leaflet | null>(null);
  const navigate = useRef(openLeague);
  navigate.current = openLeague;
  const fit = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    import('leaflet')
      .then((L) => {
        if (cancelled || !node.current) return;
        library.current = L;
        const map = L.map(node.current, {
          scrollWheelZoom: false,
          minZoom: 4,
          maxZoom: 17,
          zoomSnap: 0.25,
          zoomAnimation: !matchMedia('(prefers-reduced-motion: reduce)')
            .matches,
        });
        instance.current = map;
        map.fitBounds(uk);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
        })
          .on('tileerror', () =>
            setError(
              'Some background map tiles could not load. Your league areas and club list are still available.',
            ),
          )
          .addTo(map);
        L.control.scale({ imperial: true, metric: true }).addTo(map);
        layer.current = L.featureGroup().addTo(map);
        observer = new ResizeObserver(() => {
          map.invalidateSize();
          fit.current();
        });
        observer.observe(node.current);
        setReady(true);
      })
      .catch(() =>
        setError(
          'The map could not load. You can still use the club list below.',
        ),
      );
    return () => {
      cancelled = true;
      observer?.disconnect();
      instance.current?.remove();
      instance.current = null;
      layer.current = null;
    };
  }, []);
  useEffect(() => {
    const L = library.current,
      map = instance.current,
      group = layer.current;
    if (!ready || !L || !map || !group) return;
    group.clearLayers();
    for (const league of data.leagues) {
      if (!league.area.length) continue;
      const polygon = L.polygon(league.area, {
        color: league.color,
        weight: 2,
        fillColor: league.color,
        fillOpacity: 0.16,
        smoothFactor: 0.2,
        lineJoin: 'round',
      }).addTo(group);
      const label = textElement('span', league.name);
      label.style.color = league.color;
      polygon.bindTooltip(label, {
        permanent: true,
        direction: 'center',
        className: 'league-area-label',
      });
      const popup = textElement('div', '', 'map-popup');
      popup.appendChild(textElement('strong', league.name));
      popup.appendChild(
        textElement(
          'p',
          `${league.mappedTeamCount} of ${league.teamCount} teams mapped`,
        ),
      );
      const button = textElement('button', 'View league fixtures →');
      button.addEventListener('click', () => navigate.current(league.id));
      popup.appendChild(button);
      polygon.bindPopup(popup);
    }
    // Co-located clubs/teams share an accessible pin; no markers hide one another.
    const locations = new Map<string, MapClub[]>();
    for (const club of data.clubs.filter((c) => c.position)) {
      const key = `${club.position!.latitude}:${club.position!.longitude}`;
      locations.set(key, [...(locations.get(key) || []), club]);
    }
    for (const clubs of locations.values()) {
      const p = clubs[0].position!;
      const teams = [
        ...new Map(
          clubs.flatMap((c) => c.teams).map((t) => [t.id, t]),
        ).values(),
      ];
      const symbol = textElement(
        'span',
        teams.length > 1 ? String(teams.length) : '',
        'league-pin-dot',
      );
      symbol.style.backgroundColor =
        teams.length === 1 ? teams[0].color : '#173e36';
      const title = `${clubs.map((c) => c.name).join(', ')}: ${teams.map((t) => t.name).join(', ')}`;
      const marker = L.marker([p.latitude, p.longitude], {
        title,
        alt: title,
        keyboard: true,
        icon: L.divIcon({
          html: symbol,
          className: 'league-pin',
          iconSize: [36, 44],
          iconAnchor: [18, 38],
          popupAnchor: [0, -35],
        }),
      }).addTo(group);
      const popup = textElement('div', '', 'map-popup');
      for (const club of clubs) {
        popup.appendChild(textElement('strong', club.name));
        popup.appendChild(textElement('p', club.postcode));
        for (const team of club.teams) {
          const row = textElement('div', '', 'map-popup-team');
          const dot = textElement('span', '', 'map-cap-dot');
          dot.style.backgroundColor = team.color;
          row.appendChild(dot);
          row.appendChild(
            textElement('span', `${team.name} · ${team.cap} caps`),
          );
          popup.appendChild(row);
          popup.appendChild(
            textElement(
              'p',
              data.leagues.find((l) => l.id === team.leagueId)?.name || '',
              'map-popup-league',
            ),
          );
        }
      }
      marker.bindPopup(popup, { maxWidth: 300 });
    }
    fit.current = () => {
      const bounds = group.getBounds();
      map.fitBounds(bounds.isValid() ? bounds : uk, {
        padding: [30, 30],
        maxZoom: 12,
        animate: false,
      });
    };
    fit.current();
  }, [data, ready]);
  return (
    <div className="league-map-surface">
      <div className="league-map-actions">
        <button className="btn" disabled={!ready} onClick={() => fit.current()}>
          <LocateFixed size={17} />
          Fit leagues
        </button>
        <button
          className="btn"
          disabled={!ready}
          onClick={() => instance.current?.fitBounds(uk, { animate: false })}
        >
          <MapIcon size={17} />
          UK view
        </button>
      </div>
      {error && (
        <p className="notice" role="status">
          {error}
        </p>
      )}
      <div
        ref={node}
        className="league-map-canvas"
        aria-label="Map of league areas and participating clubs. Use arrow keys to pan and plus or minus to zoom."
      />
    </div>
  );
}

export function LeagueMapPage({
  tools,
  year,
  setYear,
  scope,
  setScope,
  openLeague,
}: {
  tools: AppTools;
  year: string;
  setYear: (year: string) => void;
  scope: string;
  setScope: (scope: string) => void;
  openLeague: (id: string) => void;
}) {
  const [data, setData] = useState<LeagueMapData | null>(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState('all');
  // Refresh for actual geographic/league changes, not every score or availability update.
  const signature = JSON.stringify([
    tools.s.leagues,
    tools.s.teams,
    tools.s.clubs.map(({ id, orgId, name, postcode, address }) => ({
      id,
      orgId,
      name,
      postcode,
      address,
    })),
  ]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    const q = new URLSearchParams({
      workspace: tools.workspace,
      view: tools.view,
      year,
      scope,
    });
    fetch(`/api/league-map?${q}`, { signal: controller.signal })
      .then(async (r) => {
        const body = (await r.json()) as LeagueMapData & { error?: string };
        if (!r.ok)
          throw new Error(body.error || 'Could not load the league map.');
        if (!controller.signal.aborted) setData(body);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [tools.workspace, tools.view, year, scope, signature, retry]);
  const selectedId = data?.leagues.some((l) => l.id === selected)
    ? selected
    : 'all';
  const visible = useMemo(
    () =>
      data && {
        ...data,
        leagues: data.leagues.filter(
          (l) => selectedId === 'all' || l.id === selectedId,
        ),
        clubs: data.clubs
          .map((c) => ({
            ...c,
            teams: c.teams.filter(
              (t) => selectedId === 'all' || t.leagueId === selectedId,
            ),
          }))
          .filter((c) => c.teams.length),
      },
    [data, selectedId],
  );
  const years = [
    ...new Set([Number(year), ...tools.s.leagues.map((l) => l.year)]),
  ].sort((a, b) => b - a);
  const missing = visible?.clubs.filter((c) => !c.position) || [];
  return (
    <div className="league-map-page">
      <div className="season-heading">
        <div>
          <span className="eyebrow">YOUR SEASON · ON THE MAP</span>
          <h1>League map</h1>
          <p>See where your leagues play. Select a pin to see its teams.</p>
        </div>
      </div>
      <div className="league-map-filters">
        <Pick
          label="Season"
          value={year}
          onChange={setYear}
          options={years.map((y) => ({
            value: String(y),
            label: `${y} season`,
          }))}
        />
        <Pick
          label="League"
          value={selectedId}
          onChange={setSelected}
          options={[
            { value: 'all', label: 'All visible leagues' },
            ...(data?.leagues || []).map((l) => ({
              value: l.id,
              label: l.name,
            })),
          ]}
        />
        <CheckField
          checked={scope === 'mine'}
          onChange={(v) => setScope(v ? 'mine' : 'all')}
        >
          Show only my leagues
        </CheckField>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}{' '}
          <button className="text-link" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        </p>
      )}
      {!data && !error && (
        <p className="notice" role="status">
          Locating your clubs…
        </p>
      )}
      {visible && (
        <>
          {!visible.leagues.length && (
            <p className="notice">
              {scope === 'mine'
                ? 'No leagues are assigned to you for this season. Untick “Show only my leagues” to explore other leagues.'
                : 'No leagues have been created for this season yet.'}
            </p>
          )}
          {visible.lookupUnavailable && (
            <p className="notice" role="status">
              Some club locations could not be looked up just now.{' '}
              <button
                className="text-link"
                onClick={() => setRetry((n) => n + 1)}
              >
                Try again
              </button>
            </p>
          )}
          <MapCanvas data={visible} openLeague={openLeague} />
          <p className="league-map-note">
            Shading shows each league’s club locations with a 3 km margin, not
            an official boundary. Teams at the same postcode share a pin.
          </p>
          <div className="league-map-key" aria-label="League colours">
            {visible.leagues.map((l) => (
              <button
                key={l.id}
                onClick={() => setSelected(l.id)}
                aria-label={`Focus on ${l.name}`}
              >
                <span style={{ backgroundColor: l.color }} />
                <strong>{l.name}</strong>
                <span>
                  {l.mappedTeamCount} / {l.teamCount} teams mapped
                </span>
              </button>
            ))}
          </div>
          {!!missing.length && (
            <details className="map-missing" open>
              <summary>
                {missing.length}{' '}
                {missing.length === 1 ? 'club needs' : 'clubs need'} a location
              </summary>
              <ul>
                {missing.map((c) => {
                  const club = tools.s.clubs.find((club) => club.id === c.id);
                  return (
                    <li key={c.id}>
                      <div>
                        <strong>{c.name}</strong>
                        <p>
                          {c.issue}
                          {c.postcode ? ` · ${c.postcode}` : ''}
                        </p>
                      </div>
                      {club && canOrg(tools.s, tools.me, club.orgId) && (
                        <button
                          className="text-link"
                          onClick={() => tools.edit('club', club)}
                        >
                          Edit club
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
          {!!visible.clubs.length && (
            <details className="map-club-list">
              <summary>Clubs & teams ({visible.clubs.length} clubs)</summary>
              <ul>
                {visible.clubs.map((c) => (
                  <li key={c.id}>
                    <strong>{c.name}</strong>
                    <span>
                      {c.postcode || 'No postcode'}
                      {!c.position ? ' · Not mapped' : ''}
                    </span>
                    <div>
                      {c.teams.map((t) => (
                        <p key={t.id}>
                          <span
                            className="map-cap-dot"
                            style={{ backgroundColor: t.color }}
                          />
                          {t.name} · {t.cap} caps ·{' '}
                          {
                            visible.leagues.find((l) => l.id === t.leagueId)
                              ?.name
                          }
                        </p>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="league-map-credit">
            Postcode locations:{' '}
            <a
              href="https://postcodes.io/docs/licences/"
              target="_blank"
              rel="noreferrer"
            >
              Postcodes.io · data licences and attribution
            </a>
            .
          </p>
        </>
      )}
    </div>
  );
}
