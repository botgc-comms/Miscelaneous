'use client';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  teamManagers,
  capOrder,
  leagueAcceptsRegistrations,
} from '@/lib/model';
import { Field, Pick, type AppTools } from './widgets';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import { TeamRoster } from './team-roster';
import { Cap } from './parent-portal';

export default function FamilyReview({
  tools,
  initialTeamId = '',
  initialYear = '',
}: {
  tools: AppTools;
  initialTeamId?: string;
  initialYear?: string;
}) {
  const { s, me } = tools;
  const teams = s.teams
    .filter((t) => !t.withdrawnAt && teamManagers(s, t.id).includes(me.id))
    .sort(capOrder);
  const initialLeague = s.leagues.find(
    (l) => l.id === teams.find((t) => t.id === initialTeamId)?.leagueId,
  );
  const [year, setYear] = useState(
    String(
      initialLeague?.year ||
        initialYear ||
        Math.max(new Date().getFullYear(), ...s.leagues.map((l) => l.year)),
    ),
  );
  const [leagueId, setLeague] = useState('all'),
    [query, setQuery] = useState(''),
    [expanded, setExpanded] = useState(initialTeamId),
    [focused, setFocused] = useState(initialTeamId);
  const leagues = s.leagues.filter(
    (l) => String(l.year) === year && teams.some((t) => t.leagueId === l.id),
  );
  const shown = teams.filter(
    (t) =>
      leagues.some((l) => l.id === t.leagueId) &&
      (leagueId === 'all' || t.leagueId === leagueId) &&
      `${t.name} ${s.orgs.find((o) => o.id === t.orgId)?.name}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const focusedTeam = teams.find((t) => t.id === focused);
  if (focusedTeam)
    return (
      <div className="team-directory">
        <button className="text-link mb-5" onClick={() => setFocused('')}>
          ← All teams & players
        </button>
        <div className="page-heading">
          <div>
            <h1>{focusedTeam.name}</h1>
            <p>
              {s.orgs.find((o) => o.id === focusedTeam.orgId)?.name} ·{' '}
              {s.leagues.find((l) => l.id === focusedTeam.leagueId)?.name} ·{' '}
              {focusedTeam.cap} caps
            </p>
          </div>
        </div>
        <TeamRoster teamId={focusedTeam.id} tools={tools} embedded />
      </div>
    );
  return (
    <div className="team-directory">
      <div className="page-heading">
        <div>
          <h1>Teams & players</h1>
          <p>Choose a team to review requests and manage its players.</p>
        </div>
      </div>
      <div className="team-directory-filters">
        <Pick
          label="Season"
          value={year}
          onChange={(v) => {
            setYear(v);
            setLeague('all');
            setExpanded('');
          }}
          options={[...new Set([Number(year), ...s.leagues.map((l) => l.year)])]
            .sort((a, b) => b - a)
            .map((y) => ({ value: String(y), label: `${y} season` }))}
        />
        <Pick
          label="League"
          value={leagueId}
          onChange={(v) => {
            setLeague(v);
            setExpanded('');
          }}
          options={[
            { value: 'all', label: 'All leagues' },
            ...leagues.map((l) => ({ value: l.id, label: l.name })),
          ]}
        />
        <Field label="Find a club or team" value={query} onChange={setQuery} />
      </div>
      {s.orgs
        .filter((o) => shown.some((t) => t.orgId === o.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((o) => (
          <section className="team-directory-club" key={o.id}>
            <h2>{o.name}</h2>
            {shown
              .filter((t) => t.orgId === o.id)
              .map((t) => {
                const l = leagues.find((l) => l.id === t.leagueId)!;
                const entries = (s.enrollments || []).filter(
                  (e) => e.teamId === t.id,
                );
                const approved = entries.filter(
                  (e) => e.status === 'approved',
                ).length;
                const pending = entries.filter(
                  (e) => e.status === 'pending',
                ).length;
                const open =
                  t.enrollmentOpen !== false && leagueAcceptsRegistrations(l);
                return (
                  <Collapsible
                    key={t.id}
                    open={expanded === t.id}
                    onOpenChange={(v) => setExpanded(v ? t.id : '')}
                  >
                    <CollapsibleTrigger
                      className="team-directory-row"
                      aria-label={`${t.name}, ${l.name}: ${approved} players${open && pending ? `, ${pending} requests` : ''}`}
                    >
                      <Cap color={t.color} label={`${t.cap} caps`} size={32} />
                      <span className="team-directory-name">
                        <strong>{t.name}</strong>
                        <small>
                          {l.name} · {t.cap} caps
                        </small>
                      </span>
                      <span className="team-directory-counts">
                        <span>{approved} players</span>
                        {open && pending > 0 && (
                          <span className="team-request-count">
                            {pending} {pending === 1 ? 'request' : 'requests'}
                          </span>
                        )}
                      </span>
                      <ChevronDown
                        size={18}
                        className="team-directory-chevron"
                      />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="team-directory-detail">
                      <TeamRoster
                        key={t.id}
                        teamId={t.id}
                        tools={tools}
                        embedded
                      />
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
          </section>
        ))}
      {!shown.length && <p className="notice">No teams match these filters.</p>}
    </div>
  );
}
