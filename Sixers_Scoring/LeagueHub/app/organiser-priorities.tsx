'use client';
import { useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { teamPriority } from '@/lib/team-priority';
import { canHost, type Team } from '@/lib/model';
import { Cap } from './parent-portal';
import { TeamRoster } from './team-roster';
import { OrganiserFixtures } from './organiser-fixtures';
import { dateLabel, type AppTools } from './widgets';

export function OrganiserPriorities({
  tools,
  teams,
  openLeague,
  openFixture,
}: {
  tools: AppTools;
  teams: Team[];
  openLeague: (id: string, page?: string) => void;
  openFixture: (id: string) => void;
}) {
  const [active, setActive] = useState<{
    teamId: string;
    target: 'roster' | 'preparation';
  } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const priorities = teams
    .map((team) => ({ team, priority: teamPriority(tools.s, team) }))
    .sort((a, b) => a.priority.urgency - b.priority.urgency);
  const selected = teams.find((t) => t.id === active?.teamId);
  function show(teamId: string, target: 'roster' | 'preparation') {
    setActive({ teamId, target });
    requestAnimationFrame(() => {
      panel.current?.focus({ preventScroll: true });
      panel.current?.scrollIntoView({ block: 'start' });
    });
  }
  return (
    <>
      <div className="team-priorities">
        {priorities.map(({ team, priority: p }) => {
          const league = tools.s.leagues.find((l) => l.id === team.leagueId)!;
          const fixture = tools.s.fixtures.find((f) => f.id === p.fixtureId);
          return (
            <section
              className="card team-priority"
              key={team.id}
              aria-labelledby={`priority-${team.id}`}
            >
              <div className="team-priority-identity">
                <Cap color={team.color} label={`${team.cap} caps`} size={40} />
                <div>
                  <h2 id={`priority-${team.id}`}>
                    {fixture && p.target === 'preparation'
                      ? `${dateLabel(fixture.date)} · ${tools.s.clubs.find((c) => c.id === fixture.clubId)?.name || fixture.name}`
                      : team.name}
                  </h2>
                  <p>
                    {fixture && p.target === 'preparation'
                      ? `${team.name} · `
                      : ''}
                    {league.name} · {league.year}
                  </p>
                </div>
              </div>
              <div className="team-priority-task">
                <span
                  className={`team-phase ${p.urgency === 0 ? 'is-live' : ''}`}
                >
                  {p.stage}
                </span>
                <h3>{p.title}</h3>
                {fixture && p.target === 'roster' && (
                  <p className="team-priority-fixture">
                    {dateLabel(fixture.date)} ·{' '}
                    {tools.s.clubs.find((c) => c.id === fixture.clubId)?.name ||
                      fixture.name}
                  </p>
                )}
                <p>{p.detail}</p>
              </div>
              <button
                className="btn primary"
                aria-label={`${p.action} for ${team.name}`}
                onClick={() => {
                  if (p.target === 'results' && p.fixtureId)
                    openFixture(p.fixtureId);
                  else if (p.target === 'fixtures') openLeague(team.leagueId);
                  else
                    show(
                      team.id,
                      p.target === 'roster' ? 'roster' : 'preparation',
                    );
                }}
              >
                {p.action}
                <ArrowRight size={17} />
              </button>
              {fixture &&
                p.target === 'preparation' &&
                canHost(tools.s, tools.me, fixture) && (
                  <div className="team-priority-host">
                    <p>
                      <strong>You’re hosting this fixture.</strong> Organise
                      starting holes, tee times and joining instructions for
                      every team.
                    </p>
                    <button
                      className="btn"
                      onClick={() => openFixture(fixture.id)}
                    >
                      Manage the hosted fixture <ArrowRight size={17} />
                    </button>
                  </div>
                )}
            </section>
          );
        })}
      </div>
      {selected && active && (
        <div
          className="team-priority-workspace"
          ref={panel}
          tabIndex={-1}
          aria-label={`${selected.name}: ${active.target === 'roster' ? 'team registration' : 'fixture preparation'}`}
        >
          {active.target === 'roster' ? (
            <TeamRoster
              key={selected.id}
              tools={tools}
              teamId={selected.id}
              openLeague={openLeague}
            />
          ) : (
            <>
              <OrganiserFixtures
                key={selected.id}
                tools={tools}
                teams={[selected]}
                openFixture={openFixture}
              />
              <details className="organiser-squad-section">
                <summary>Team registration & player details</summary>
                <TeamRoster
                  key={selected.id}
                  tools={tools}
                  teamId={selected.id}
                  openLeague={openLeague}
                />
              </details>
            </>
          )}
        </div>
      )}
    </>
  );
}
