'use client';
import { ChildName, ChildAvatar } from './child-avatar';
import { ClubImageSettings } from './club-image';
import { ClubOrganisers } from './invitations';
import { ClubLogo, ClubLogoSettings } from './club-logo';
import { useState } from 'react';
import Image from 'next/image';
import { Plus, ArrowRight, Upload, MapPin, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@/components/ui/pagination';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Field, Pick, Empty, type AppTools } from './widgets';
import {
  canOrg,
  canLeague,
  teamManagers,
  leagueHasTeamSpace,
  type State,
} from '@/lib/model';
import {
  clubMatches,
  filterPlayers,
  playerTeams,
  playedBefore,
  type PlayerFilters,
} from '@/lib/directories';
import { ClubSetup } from './club-setup';
import { Cap } from './parent-portal';
import { TeamRemoval } from './team-replacement';

function Pager({
  total,
  page,
  onChange,
}: {
  total: number;
  page: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / 20));
  if (pages < 2) return null;
  return (
    <Pagination className="directory-pager">
      <PaginationContent>
        <PaginationItem>
          <button
            className="btn small"
            disabled={page === 0}
            onClick={() => onChange(page - 1)}
          >
            Previous
          </button>
        </PaginationItem>
        <PaginationItem>
          <span className="muted">
            Page {page + 1} of {pages}
          </span>
        </PaginationItem>
        <PaginationItem>
          <button
            className="btn small"
            disabled={page >= pages - 1}
            onClick={() => onChange(page + 1)}
          >
            Next
          </button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

function ClubSearch({
  s,
  query,
  county,
  change,
}: {
  s: State;
  query: string;
  county: string;
  change: (query: string, county: string) => void;
}) {
  const counties = [
    ...new Set(
      s.clubs.map((c) => c.county?.trim()).filter((v): v is string => !!v),
    ),
  ].sort();
  return (
    <div className="directory-filters club-filters">
      <Field
        label="Club name, postcode or address"
        value={query}
        onChange={(v) => change(v, county)}
      />
      <div className="field">
        <span>County</span>
        <Pick
          label="County"
          value={county || 'all'}
          onChange={(v) => change(query, v === 'all' ? '' : v)}
          options={[
            { value: 'all', label: 'All counties' },
            ...counties.map((v) => ({ value: v, label: v })),
          ]}
        />
      </div>
      {(query || county) && (
        <button className="text-link" onClick={() => change('', '')}>
          Clear search
        </button>
      )}
    </div>
  );
}

export function AddClubToLeague({
  tools,
  leagueId,
  close,
  browse,
}: {
  tools: AppTools;
  leagueId: string;
  close: () => void;
  browse: () => void;
}) {
  const { s, edit } = tools;
  const [query, setQuery] = useState(''),
    [county, setCounty] = useState(''),
    [page, setPage] = useState(0);
  const league = s.leagues.find((l) => l.id === leagueId);
  const clubs = s.orgs
    .filter((o) => clubMatches(s, o.id, query, county))
    .sort((a, b) => a.name.localeCompare(b.name));
  const current = Math.min(page, Math.max(0, Math.ceil(clubs.length / 20) - 1));
  return (
    <Dialog open onOpenChange={(v) => !v && close()}>
      <DialogContent className="editor-dialog">
        <DialogHeader>
          <DialogTitle>Add a club to {league?.name}</DialogTitle>
          <DialogDescription>
            Choose a club, then create its team for the {league?.year} league. A
            club can enter more than one team.
          </DialogDescription>
        </DialogHeader>
        {!leagueHasTeamSpace(s, leagueId) && (
          <p className="notice">
            This league is full. All six team places have been filled.
          </p>
        )}
        <ClubSearch
          s={s}
          query={query}
          county={county}
          change={(q, c) => {
            setQuery(q);
            setCounty(c);
            setPage(0);
          }}
        />
        <div className="directory-pick-list">
          {clubs.slice(current * 20, current * 20 + 20).map((o) => {
            const count = s.teams.filter(
              (t) =>
                !t.withdrawnAt && t.orgId === o.id && t.leagueId === leagueId,
            ).length;
            return (
              <button
                className="directory-pick"
                key={o.id}
                disabled={tools.busy || !leagueHasTeamSpace(s, leagueId)}
                onClick={() => {
                  close();
                  edit('team', { orgId: o.id, leagueId, name: '' });
                }}
              >
                <span>
                  <strong>{o.name}</strong>
                  <small>
                    {count
                      ? `${count} team${count === 1 ? '' : 's'} already in this league · Add another`
                      : 'Add its first team to this league'}
                  </small>
                </span>
                <ArrowRight size={18} />
              </button>
            );
          })}
          {!clubs.length && (
            <p className="notice">
              No clubs match this search. Clear the filters or add the club to
              the directory first.
            </p>
          )}
        </div>
        <Pager total={clubs.length} page={current} onChange={setPage} />
        <button className="text-link club-directory-link" onClick={browse}>
          <span>Manage clubs or add a missing club</span>
          <ArrowRight size={15} />
        </button>
      </DialogContent>
    </Dialog>
  );
}

export function ClubsDirectory({
  tools,
  openTeam,
  openLeague,
}: {
  tools: AppTools;
  openTeam: (id: string) => void;
  openLeague: (id: string) => void;
}) {
  const { s, me, edit, busy } = tools;
  const [removingTeam, setRemovingTeam] = useState('');
  const [query, setQuery] = useState(''),
    [county, setCounty] = useState(''),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState(''),
    [setup, setSetup] = useState<'add' | 'import' | null>(null);
  const clubs = s.orgs
    .filter((o) => clubMatches(s, o.id, query, county))
    .sort((a, b) => a.name.localeCompare(b.name));
  const current = Math.min(page, Math.max(0, Math.ceil(clubs.length / 20) - 1));
  const club = s.orgs.find((o) => o.id === selected);
  const assignable = s.leagues
    .filter((l) => canLeague(me, l.id) && leagueHasTeamSpace(s, l.id))
    .sort((a, b) => b.year - a.year || a.name.localeCompare(b.name));
  return (
    <>
      <div className="season-heading">
        <div>
          <span className="eyebrow">
            {me.role === 'organiser' ? 'YOUR CLUB' : 'CLUB DIRECTORY'}
          </span>
          <h1>{me.role === 'organiser' ? 'My club' : 'Clubs'}</h1>
          <p>
            {me.role === 'organiser'
              ? 'Your club details and teams.'
              : 'Find a club, manage its details and add its teams to leagues.'}
          </p>
        </div>
        {me.role === 'admin' && (
          <div className="row wrap">
            <button
              className="btn"
              disabled={busy}
              onClick={() => setSetup('import')}
            >
              <Upload size={16} />
              Import clubs
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => setSetup('add')}
            >
              <Plus size={16} />
              Add a club
            </button>
          </div>
        )}
      </div>
      <ClubSearch
        s={s}
        query={query}
        county={county}
        change={(q, c) => {
          setQuery(q);
          setCounty(c);
          setPage(0);
        }}
      />
      <output className="muted mb-4 block">
        {clubs.length} club{clubs.length === 1 ? '' : 's'} found
      </output>
      {s.clubs.some((c) =>
        ['queued', 'working', 'identifying', 'cleaning'].includes(
          c.logoStatus || '',
        ),
      ) && (
        <p className="logo-progress" role="status">
          Finding and preparing club logos in the background ·{' '}
          {
            s.clubs.filter((c) =>
              ['queued', 'working', 'identifying', 'cleaning'].includes(
                c.logoStatus || '',
              ),
            ).length
          }{' '}
          remaining
        </p>
      )}
      <section className="card directory-table mobile-directory">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Club</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>League entries</TableHead>
              <TableHead>
                <span className="sr-only">Open club</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clubs.slice(current * 20, current * 20 + 20).map((o) => {
              const venues = s.clubs.filter((c) => c.orgId === o.id),
                teams = s.teams.filter(
                  (t) => !t.withdrawnAt && t.orgId === o.id,
                );
              return (
                <TableRow key={o.id}>
                  <TableCell>
                    <button
                      className="text-link"
                      onClick={() => setSelected(o.id)}
                    >
                      <ClubLogo club={venues[0]} workspace={tools.workspace} />
                      <span>{o.name}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    {venues
                      .map(
                        (c) =>
                          [c.county, c.postcode].filter(Boolean).join(' · ') ||
                          c.address,
                      )
                      .filter(Boolean)
                      .join(' / ') || 'Location not recorded'}
                  </TableCell>
                  <TableCell>
                    {teams.length} team{teams.length === 1 ? '' : 's'} across{' '}
                    {new Set(teams.map((t) => t.leagueId)).size} league entries
                  </TableCell>
                  <TableCell>
                    <button
                      className="btn small"
                      onClick={() => setSelected(o.id)}
                    >
                      View club
                      <ArrowRight size={15} />
                    </button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
      {!clubs.length && (
        <Empty
          title={
            s.orgs.length
              ? 'No clubs match these filters'
              : 'Your club directory is empty'
          }
        >
          {s.orgs.length
            ? 'Try another name, postcode or address, or clear the county filter.'
            : 'Add or import your clubs to start assigning teams to leagues.'}
        </Empty>
      )}
      <Pager total={clubs.length} page={current} onChange={setPage} />
      {club && (
        <Dialog open onOpenChange={(v) => !v && setSelected('')}>
          <DialogContent className="editor-dialog">
            <DialogHeader>
              <DialogTitle>{club.name}</DialogTitle>
              <DialogDescription>
                Club details, venues and league teams across seasons.
              </DialogDescription>
            </DialogHeader>
            {!!assignable.length && (
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => {
                  setSelected('');
                  edit('team', {
                    orgId: club.id,
                    leagueId: assignable[0].id,
                    name: '',
                  });
                }}
              >
                <Plus size={16} />
                Add team to a league
              </button>
            )}
            {!assignable.length &&
              ['admin', 'league-admin'].includes(me.role) && (
                <p className="notice">
                  {s.leagues.some((l) => canLeague(me, l.id))
                    ? 'Your leagues are full. Each league can have a maximum of six teams.'
                    : 'Create a league from Overview before adding a team.'}
                </p>
              )}
            <h3>Teams & leagues</h3>
            {s.teams
              .filter((t) => !t.withdrawnAt && t.orgId === club.id)
              .sort(
                (a, b) =>
                  (s.leagues.find((l) => l.id === b.leagueId)?.year || 0) -
                  (s.leagues.find((l) => l.id === a.leagueId)?.year || 0),
              )
              .map((t) => {
                const l = s.leagues.find((l) => l.id === t.leagueId);
                return (
                  <div className="season-team-row" key={t.id}>
                    <Cap color={t.color} label={`${t.cap} cap`} size={35} />
                    <div>
                      <strong>{t.name}</strong>
                      <p>
                        <button
                          className="text-link"
                          onClick={() => {
                            setSelected('');
                            openLeague(t.leagueId);
                          }}
                        >
                          {l?.name} · {l?.year}
                        </button>
                      </p>
                    </div>
                    <div className="row wrap">
                      {canLeague(me, t.leagueId) && (
                        <button
                          className="league-icon-button"
                          disabled={busy}
                          aria-label={`Remove ${t.name} from ${l?.name}`}
                          title="Remove team"
                          onClick={() => {
                            setSelected('');
                            setRemovingTeam(t.id);
                          }}
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                      {canLeague(me, t.leagueId) && (
                        <button
                          className="text-link"
                          onClick={() => {
                            setSelected('');
                            edit('team', t);
                          }}
                        >
                          Edit team
                        </button>
                      )}
                      {canOrg(s, me, t.orgId) && (
                        <button
                          className="btn small"
                          onClick={() => {
                            setSelected('');
                            openTeam(t.id);
                          }}
                        >
                          Manage players
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            {!s.teams.some((t) => t.orgId === club.id) && (
              <p className="muted">No teams assigned to a league yet.</p>
            )}
            {canOrg(s, me, club.id) && (
              <ClubOrganisers
                tools={tools}
                orgId={club.id}
                onInvite={() => {
                  setSelected('');
                  edit('invite', { role: 'organiser', orgIds: [club.id] });
                }}
              />
            )}
            <h3>Venues & contact details</h3>
            {s.clubs
              .filter((c) => c.orgId === club.id)
              .map((c) => (
                <section className="club-detail-venue" key={c.id}>
                  <h3>{c.name}</h3>
                  {canOrg(s, me, club.id) && (
                    <ClubLogoSettings club={c} tools={tools} />
                  )}
                  {canOrg(s, me, club.id) && (
                    <ClubImageSettings club={c} tools={tools} />
                  )}
                  <p>
                    <MapPin size={15} />
                    {[c.address, c.county, c.postcode]
                      .filter(Boolean)
                      .join(', ') || 'Address not recorded'}
                  </p>
                  {c.instructions && <p>{c.instructions}</p>}
                  <p className="muted">
                    {c.safeGolf
                      ? 'SafeGolf accredited'
                      : 'SafeGolf accreditation not recorded'}
                  </p>
                  {c.welfareName && (
                    <p>
                      Welfare: {c.welfareName}{' '}
                      {c.welfareEmail && (
                        <a
                          className="text-link"
                          href={`mailto:${c.welfareEmail}`}
                        >
                          {c.welfareEmail}
                        </a>
                      )}
                    </p>
                  )}
                  {canOrg(s, me, club.id) && (
                    <button
                      className="btn small"
                      onClick={() => {
                        setSelected('');
                        edit('club', c);
                      }}
                    >
                      Edit venue details
                    </button>
                  )}
                </section>
              ))}
            <div className="row wrap">
              {canOrg(s, me, club.id) && (
                <button
                  className="btn"
                  onClick={() => {
                    setSelected('');
                    edit('club', { orgId: club.id });
                  }}
                >
                  Add venue
                </button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
      {removingTeam && (
        <TeamRemoval
          tools={tools}
          teamId={removingTeam}
          close={() => {
            setSelected(
              s.teams.find((t) => t.id === removingTeam)?.orgId || '',
            );
            setRemovingTeam('');
          }}
        />
      )}
      {setup && (
        <ClubSetup mode={setup} tools={tools} close={() => setSetup(null)} />
      )}
    </>
  );
}

const defaultFilters: PlayerFilters = {
  query: '',
  league: 'all',
  club: 'all',
  team: 'all',
  care: 'all',
  handicap: 'all',
  history: 'all',
  year: new Date().getFullYear(),
};
export function PlayersDirectory({
  tools,
  upload,
  openTeam,
}: {
  tools: AppTools;
  upload: (id: string, file: File) => Promise<void>;
  openTeam: (id: string) => void;
}) {
  const { s, me, edit, busy } = tools;
  const [filters, setFilters] = useState(defaultFilters),
    [showFilters, setShowFilters] = useState(false),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState('');
  const change = (key: keyof PlayerFilters, value: string | number) => {
    setFilters((f) => ({
      ...f,
      [key]: value,
      ...(key === 'league'
        ? {
            team: 'all',
            year: s.leagues.find((l) => l.id === value)?.year || f.year,
          }
        : {}),
      ...(key === 'club' ? { team: 'all' } : {}),
    }));
    setPage(0);
  };
  const players = filterPlayers(s, filters).filter(
      (p) =>
        me.role !== 'organiser' ||
        me.orgIds.includes(p.orgId) ||
        s.enrollments?.some(
          (e) =>
            e.playerId === p.id &&
            ['pending', 'approved'].includes(e.status) &&
            s.teams.some(
              (t) => t.id === e.teamId && me.orgIds.includes(t.orgId),
            ),
        ),
    ),
    current = Math.min(page, Math.max(0, Math.ceil(players.length / 20) - 1));
  const teams = s.teams.filter(
    (t) =>
      (me.role !== 'organiser' || me.orgIds.includes(t.orgId)) &&
      (filters.league === 'all' || t.leagueId === filters.league) &&
      (filters.club === 'all' || t.orgId === filters.club),
  );
  const pick = (
    key: keyof PlayerFilters,
    label: string,
    options: { value: string; label: string }[],
  ) => (
    <label className="field">
      <span>{label}</span>
      <Pick
        label={label}
        value={String(filters[key])}
        onChange={(v) => change(key, key === 'year' ? Number(v) : v)}
        options={options}
      />
    </label>
  );
  const p = s.players.find((p) => p.id === selected && !!p.dob),
    parent = s.members.find((m) => m.id === p?.parentId);
  return (
    <>
      <div className="season-heading">
        <div>
          <span className="eyebrow">PLAYERS & FAMILIES</span>
          <h1>Find a player or family</h1>
          <p>
            Registrations, team places and the details your role can access.
          </p>
        </div>
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => edit('player')}
        >
          <Plus size={16} />
          Register a child
        </button>
      </div>
      <div className="directory-filters player-filters">
        <Field
          label="Player or parent name, email or phone"
          value={filters.query}
          onChange={(v) => change('query', v)}
        />
        <button
          className="btn mobile-filter-toggle"
          aria-expanded={showFilters}
          aria-controls="player-filter-fields"
          onClick={() => setShowFilters((v) => !v)}
        >
          {showFilters ? 'Hide filters' : 'Show filters'}
          {[
            filters.league,
            filters.club,
            filters.team,
            filters.care,
            filters.handicap,
            filters.history,
          ].filter((v) => v !== 'all').length
            ? ` · ${[filters.league, filters.club, filters.team, filters.care, filters.handicap, filters.history].filter((v) => v !== 'all').length} active`
            : ''}
        </button>
        <div
          id="player-filter-fields"
          className="directory-filter-fields"
          data-expanded={showFilters}
        >
          {pick('league', 'League & season', [
            { value: 'all', label: 'All leagues & seasons' },
            ...s.leagues.map((l) => ({
              value: l.id,
              label: `${l.name} · ${l.year}`,
            })),
          ])}
          {pick('club', 'Club', [
            { value: 'all', label: 'All clubs' },
            ...s.orgs.map((o) => ({ value: o.id, label: o.name })),
          ])}
          {pick('team', 'Team', [
            { value: 'all', label: 'All teams' },
            ...teams.map((t) => ({
              value: t.id,
              label: `${t.name} · ${s.leagues.find((l) => l.id === t.leagueId)?.year}`,
            })),
          ])}
          {pick('care', 'Safeguarding & consent', [
            { value: 'all', label: 'All players' },
            { value: 'support', label: 'Additional support recorded' },
            { value: 'diet', label: 'Dietary requirements recorded' },
            { value: 'photo', label: 'No photo publication consent' },
          ])}
          {pick('handicap', 'Handicap', [
            { value: 'all', label: 'Any handicap status' },
            { value: 'held', label: 'Has a handicap' },
            { value: 'none', label: 'No handicap yet' },
            { value: 'review', label: 'Below 37 · eligibility review' },
          ])}
          {pick('history', 'Previous participation', [
            { value: 'all', label: 'Any participation history' },
            { value: 'returning', label: 'Played in an earlier season' },
            { value: 'unrecorded', label: 'No earlier play recorded' },
          ])}
          {pick(
            'year',
            'History before season',
            [
              ...new Set([
                new Date().getFullYear(),
                filters.year,
                ...s.leagues.map((l) => l.year),
              ]),
            ]
              .sort((a, b) => b - a)
              .map((y) => ({ value: String(y), label: String(y) })),
          )}
        </div>
      </div>
      <div className="section-top">
        <output className="muted">
          {players.length} player{players.length === 1 ? '' : 's'} found
        </output>
        <button
          className="text-link"
          onClick={() => {
            setFilters(defaultFilters);
            setPage(0);
          }}
        >
          Clear filters
        </button>
      </div>
      {filters.history !== 'all' && (
        <p className="notice mb-4">
          Participation uses completed fixtures recorded before {filters.year}{' '}
          in the leagues you can access. Missing history does not mean a child
          has never played.
        </p>
      )}
      <section className="card directory-table mobile-directory player-directory">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>Club & team</TableHead>
              <TableHead>Parent / guardian</TableHead>
              <TableHead>Handicap</TableHead>
              <TableHead>
                <span className="sr-only">Family details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {players.slice(current * 20, current * 20 + 20).map((p) => {
              const parent = s.members.find((m) => m.id === p.parentId);
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <button
                      className="text-link"
                      onClick={() => setSelected(p.id)}
                    >
                      <ChildName
                        player={p}
                        workspace={tools.workspace}
                        view={tools.view}
                      />
                    </button>
                  </TableCell>
                  <TableCell>
                    {playerTeams(s, p).map((t) => (
                      <div className="row" key={t.id}>
                        <Cap color={t.color} label={`${t.cap} cap`} size={26} />
                        <span>
                          {t.name}
                          <small className="directory-subline">
                            {s.orgs.find((o) => o.id === t.orgId)?.name} ·{' '}
                            {s.leagues.find((l) => l.id === t.leagueId)?.name} ·{' '}
                            {s.leagues.find((l) => l.id === t.leagueId)?.year} ·{' '}
                            {s.enrollments?.find(
                              (e) => e.teamId === t.id && e.playerId === p.id,
                            )?.status || 'Registered'}
                          </small>
                        </span>
                      </div>
                    ))}
                    {!playerTeams(s, p).length && (
                      <span>
                        {s.orgs.find((o) => o.id === p.orgId)?.name ||
                          'No club'}{' '}
                        · No current team request or place
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {parent?.name || 'Contact not recorded'}
                  </TableCell>
                  <TableCell data-label="Handicap">
                    {p.handicap ?? 'Not yet held'}
                  </TableCell>
                  <TableCell>
                    <button
                      className="btn small"
                      onClick={() => setSelected(p.id)}
                    >
                      Family details
                    </button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
      {!players.length && (
        <Empty title="No players match these filters">
          Clear the filters or try another league, club or family name.
        </Empty>
      )}
      <Pager total={players.length} page={current} onChange={setPage} />
      {p && (
        <Dialog open onOpenChange={(v) => !v && setSelected('')}>
          <DialogContent className="editor-dialog">
            <DialogHeader>
              <DialogTitle>{p.name}</DialogTitle>
              <DialogDescription>
                Private family and care information, available to authorised
                staff.
              </DialogDescription>
            </DialogHeader>
            <div className="row">
              <ChildAvatar
                player={p}
                workspace={tools.workspace}
                view={tools.view}
                size={72}
              />
              <div>
                <p>
                  Born{' '}
                  {new Date(p.dob + 'T12:00:00').toLocaleDateString('en-GB')}
                </p>
                <p>Handicap: {p.handicap ?? 'Not yet held'}</p>
                <p>
                  {playedBefore(s, p, filters.year)
                    ? `Played before the ${filters.year} season`
                    : `No play before ${filters.year} recorded in accessible leagues`}
                </p>
              </div>
            </div>
            <section className="club-detail-venue">
              <h3>Parent / guardian</h3>
              <p>{parent?.name || 'Not recorded'}</p>
              {parent?.email && (
                <p>
                  <a className="text-link" href={`mailto:${parent.email}`}>
                    {parent.email}
                  </a>
                </p>
              )}
              {parent?.phone && (
                <p>
                  <a className="text-link" href={`tel:${parent.phone}`}>
                    {parent.phone}
                  </a>
                </p>
              )}
              <p>
                Other registered children:{' '}
                {s.players
                  .filter(
                    (c) =>
                      c.id !== p.id && c.parentId === p.parentId && !!c.dob,
                  )
                  .map((c) => c.name)
                  .join(', ') || 'None visible'}
              </p>
            </section>
            <section className="club-detail-venue">
              <h3>Care, consent & emergency contact</h3>
              <p>Diet: {p.diet || 'None recorded'}</p>
              <p>Additional support: {p.care || 'None recorded'}</p>
              <p>
                {p.photoConsent
                  ? 'Photo publication permitted'
                  : 'No photo publication consent'}
              </p>
              <p>
                Emergency contact: {p.emergencyName || 'Not recorded'}{' '}
                {p.emergencyPhone && (
                  <a className="text-link" href={`tel:${p.emergencyPhone}`}>
                    {p.emergencyPhone}
                  </a>
                )}
              </p>
            </section>
            <h3>Team places & requests</h3>
            {playerTeams(s, p).map((t) => (
              <div className="season-team-row" key={t.id}>
                <Cap color={t.color} label={`${t.cap} cap`} size={32} />
                <div>
                  <strong>{t.name}</strong>
                  <p>
                    {s.leagues.find((l) => l.id === t.leagueId)?.name} ·{' '}
                    {s.leagues.find((l) => l.id === t.leagueId)?.year} ·{' '}
                    {
                      s.enrollments?.find(
                        (e) => e.teamId === t.id && e.playerId === p.id,
                      )?.status
                    }
                  </p>
                </div>
                {teamManagers(s, t.id).includes(me.id) && (
                  <button
                    className="text-link"
                    onClick={() => {
                      setSelected('');
                      openTeam(t.id);
                    }}
                  >
                    Manage team
                  </button>
                )}
              </div>
            ))}
            {(p.parentId === me.id || canOrg(s, me, p.orgId)) && (
              <div className="row wrap">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setSelected('');
                    edit('player', p);
                  }}
                >
                  Edit details
                </button>
                <label className="text-link upload">
                  Identification photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    aria-label={`Upload identification photo for ${p.name}`}
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(p.id, file);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
