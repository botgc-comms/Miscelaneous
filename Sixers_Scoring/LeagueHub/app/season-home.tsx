'use client';
import { useState } from 'react';
import { Plus, ArrowRight, Users, Flag, Trash2, Settings2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Field, Pick, CheckField, type AppTools } from './widgets';
import {
  canLeague,
  leagueHasTeamSpace,
  MAX_LEAGUE_TEAMS,
  leagueAcceptsRegistrations,
  teamManagers,
  capOrder,
  responsibleForLeague,
  organiserClubs,
} from '@/lib/model';
import { AddClubToLeague } from './staff-directories';
import { Cap } from './parent-portal';
import { AccessRequests } from './access-requests';
import { LoginHelpQueue } from './login-help-queue';
import { LeagueImport } from './league-import';
import { TeamRemoval } from './team-replacement';
import { Progress } from '@/components/ui/progress';
import { OrganiserPriorities } from './organiser-priorities';
import { OrganiserHome } from './organiser-home';
export function SeasonHome({
  tools,
  openTeam,
  navigate,
  openLeague,
  year,
  setYear,
  openFixture,
  scope,
  setScope,
}: {
  tools: AppTools;
  openTeam: (id: string) => void;
  navigate: (page: string) => void;
  openLeague: (id: string, page?: string) => void;
  year: string;
  setYear: (year: string) => void;
  openFixture: (id: string) => void;
  scope: string;
  setScope: (scope: string) => void;
}) {
  const { s, me, busy, edit } = tools;
  const foundation = me.role === 'admin' || me.role === 'league-admin';
  const [importing, setImporting] = useState(false),
    [removeTeam, setRemoveTeam] = useState('');
  const [addingSeason, setAddingSeason] = useState(false),
    [nextYear, setNextYear] = useState(String(new Date().getFullYear() + 1)),
    [addLeague, setAddLeague] = useState('');
  const years = [
    ...new Set([Number(year), ...s.leagues.map((l) => l.year)]),
  ].sort((a, b) => b - a);
  const leagues = s.leagues.filter(
    (l) =>
      l.year === Number(year) &&
      (!foundation || scope === 'all' || responsibleForLeague(me, l)),
  );
  const teams = s.teams
    .filter(
      (t) =>
        !t.withdrawnAt &&
        leagues.some((l) => l.id === t.leagueId) &&
        teamManagers(s, t.id).includes(me.id),
    )
    .sort(capOrder);
  const hasSeasonLeagues = s.leagues.some((l) => l.year === Number(year));
  const running = leagues.some((l) => !!l.fixturesConfirmedAt);
  if (!foundation)
    return (
      <OrganiserHome
        tools={tools}
        year={year}
        setYear={setYear}
        navigate={navigate}
        openLeague={openLeague}
        openFixture={openFixture}
      />
    );
  return (
    <div className="season-home">
      <div className="season-heading">
        <div>
          <span className="eyebrow">
            {foundation
              ? running
                ? 'FOUNDATION · YOUR SEASON'
                : 'FOUNDATION · SEASON SETUP'
              : 'YOUR CLUB · YOUR TEAMS'}
          </span>
          <h1>
            {foundation
              ? running
                ? `Your ${year} season.`
                : `Let’s build the ${year} season.`
              : 'What needs doing now?'}
          </h1>
          <p>
            {foundation
              ? 'Manage your leagues, their fixtures and the clubs taking part.'
              : 'Each team has its own next step. Start with the task shown below.'}
          </p>
        </div>
        <div className="row wrap">
          <Pick
            label="Season"
            value={year}
            onChange={setYear}
            options={years.map((y) => ({
              value: String(y),
              label: `${y} season`,
            }))}
          />
          {me.role === 'admin' && (
            <button className="btn" onClick={() => setAddingSeason(true)}>
              Start another season
            </button>
          )}
        </div>
      </div>
      <LoginHelpQueue tools={tools} />
      {foundation ? (
        <>
          <AccessRequests tools={tools} />
          <div className="league-overview-heading">
            <h2>
              {year} leagues <span className="muted">({leagues.length})</span>
            </h2>
            <div className="league-overview-controls">
              <div className="row wrap">
                {me.role === 'admin' && (
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() =>
                      edit('league', {
                        year: Number(year),
                        name: '',
                        region: '',
                        registrationOpen: true,
                      })
                    }
                  >
                    <Plus size={17} />
                    Add a league
                  </button>
                )}
                {me.role === 'admin' && (
                  <button className="btn" onClick={() => setImporting(true)}>
                    Import leagues
                  </button>
                )}
              </div>
              <CheckField
                checked={scope === 'mine'}
                onChange={(checked) => setScope(checked ? 'mine' : 'all')}
              >
                Show only my leagues
              </CheckField>
            </div>
          </div>
          {!leagues.length && (
            <section className="season-empty">
              <Flag size={30} />
              <h2>
                {scope === 'mine' && hasSeasonLeagues
                  ? `No leagues assigned to you for ${year}.`
                  : `No leagues for ${year} yet.`}
              </h2>
              <p>
                {me.role === 'admin'
                  ? scope === 'mine' && hasSeasonLeagues
                    ? 'View all leagues to assign an administrator and assistant in League settings, or create a new league.'
                    : 'Create your first league, then find clubs to add their teams.'
                  : 'Leagues assigned to you by the Foundation will appear here.'}
              </p>
              {scope === 'mine' && hasSeasonLeagues && (
                <button className="btn" onClick={() => setScope('all')}>
                  View all leagues
                </button>
              )}
            </section>
          )}
          <div className="season-leagues">
            {leagues.map((l) => {
              const leagueTeams = s.teams
                .filter((t) => !t.withdrawnAt && t.leagueId === l.id)
                .sort(capOrder);
              const canEdit = canLeague(me, l.id);
              const leagueFixtures = s.fixtures.filter(
                (f) => f.leagueId === l.id,
              );
              const openTeams = leagueTeams.filter(
                (t) => t.enrollmentOpen !== false,
              );
              const allFull =
                leagueTeams.length > 0 &&
                leagueTeams.every(
                  (t) =>
                    (s.enrollments || []).filter(
                      (e) => e.teamId === t.id && e.status === 'approved',
                    ).length >= (l.squadSize || 12),
                );
              const registrationOpen =
                leagueAcceptsRegistrations(l) && openTeams.length > 0;
              const nextStep = !leagueTeams.length
                ? 'Add clubs to give this league its teams.'
                : l.fixturesConfirmedAt
                  ? 'The season fixtures are confirmed. Organisers can prepare their teams, and player registration can continue.'
                  : leagueFixtures.length
                    ? 'Review and confirm the season fixture list. You can keep registering players afterwards.'
                    : registrationOpen && allFull
                      ? 'Teams are full. Close registration for each team when its players are confirmed, then plan fixtures.'
                      : !registrationOpen && !leagueFixtures.length
                        ? 'Registration is closed. Next, plan your fixtures using the clubs’ hosting availability.'
                        : registrationOpen
                          ? `${openTeams.length} of ${leagueTeams.length} teams have registration open. Review their players below; you can plan fixtures alongside registration.`
                          : 'Registration is closed. Your fixtures are ready to manage.';
              return (
                <section className="card league-summary" key={l.id}>
                  <div className="league-card-heading">
                    <div>
                      <span className="eyebrow">
                        {l.year}
                        {l.region.trim().toLowerCase() !==
                        l.name.trim().toLowerCase()
                          ? ` · ${l.region}`
                          : ''}
                      </span>
                      <h2>{l.name}</h2>
                    </div>
                    {canEdit && (
                      <button
                        className="league-icon-button"
                        disabled={busy}
                        onClick={() => edit('league', l)}
                        aria-label={`Settings for ${l.name}`}
                        title="League settings"
                      >
                        <Settings2 size={19} />
                      </button>
                    )}
                  </div>
                  <p className="muted">
                    {new Set(leagueTeams.map((t) => t.orgId)).size}{' '}
                    {new Set(leagueTeams.map((t) => t.orgId)).size === 1
                      ? 'club'
                      : 'clubs'}{' '}
                    · {leagueTeams.length} of {MAX_LEAGUE_TEAMS} team places ·{' '}
                    {leagueFixtures.length} fixtures
                  </p>
                  <p className="league-responsibility">
                    Admin:{' '}
                    {s.members.find((p) => p.id === l.adminId)?.name ||
                      'Not assigned'}{' '}
                    · Assistant:{' '}
                    {s.members.find((p) => p.id === l.assistantId)?.name ||
                      'Not assigned'}
                  </p>
                  <p className="league-next-step">
                    <strong>Next step</strong>
                    {nextStep}
                  </p>
                  <details
                    className="league-teams-disclosure"
                    key={`${l.id}-${registrationOpen && !allFull}`}
                    open={registrationOpen && !allFull}
                  >
                    <summary>
                      {leagueTeams.length} teams{' '}
                      <span>
                        {registrationOpen
                          ? allFull
                            ? 'All teams full'
                            : 'Player registration in progress'
                          : 'Registration closed'}
                      </span>
                    </summary>
                    <div className="season-team-list league-teams-grid">
                      {leagueTeams.map((t) => {
                        const registered = (s.enrollments || []).filter(
                          (e) => e.teamId === t.id && e.status === 'approved',
                        ).length;
                        const waiting = (s.enrollments || []).filter(
                          (e) => e.teamId === t.id && e.status === 'pending',
                        ).length;
                        const target = l.squadSize || 12;
                        return (
                          <div
                            className="season-team-row league-team-row"
                            key={t.id}
                          >
                            <Cap
                              color={t.color}
                              label={`${t.cap} cap`}
                              size={40}
                            />
                            <div>
                              {canEdit ? (
                                <button
                                  className="league-team-name"
                                  onClick={() => openTeam(t.id)}
                                  aria-label={`View players for ${t.name}`}
                                >
                                  {t.name}
                                </button>
                              ) : (
                                <strong>{t.name}</strong>
                              )}
                              <p>
                                {s.orgs.find((o) => o.id === t.orgId)?.name} ·{' '}
                                {t.cap} caps
                              </p>
                              {canEdit && (
                                <div className="registration-progress">
                                  <Progress
                                    value={registered}
                                    max={target}
                                    aria-label={`${t.name}: ${registered} of ${target} players registered`}
                                    style={{ color: t.color }}
                                  />
                                  <span>
                                    {registered} of {target} registered
                                    {waiting ? ` · ${waiting} applying` : ''}
                                  </span>
                                </div>
                              )}
                              <div className="team-entry-control">
                                <small className="muted">
                                  {t.enrollmentOpen === false ||
                                  !leagueAcceptsRegistrations(l)
                                    ? 'Registration closed'
                                    : registered >= target
                                      ? 'Team full · registration open'
                                      : 'Registration open'}
                                </small>
                                {canEdit &&
                                  (waiting && t.enrollmentOpen !== false ? (
                                    <button
                                      className="team-entry-link"
                                      onClick={() => openTeam(t.id)}
                                    >
                                      Review applications to close
                                    </button>
                                  ) : (
                                    <button
                                      className="team-entry-link"
                                      disabled={
                                        busy ||
                                        (t.enrollmentOpen === false &&
                                          !leagueAcceptsRegistrations(l))
                                      }
                                      aria-label={`${t.enrollmentOpen === false ? 'Reopen' : 'Close'} registration for ${t.name}`}
                                      title={
                                        t.enrollmentOpen === false &&
                                        !leagueAcceptsRegistrations(l)
                                          ? 'Allow parents to enter children in League settings first.'
                                          : undefined
                                      }
                                      onClick={() =>
                                        tools.act({
                                          type: 'team-directory',
                                          teamId: t.id,
                                          open: t.enrollmentOpen === false,
                                        })
                                      }
                                    >
                                      {t.enrollmentOpen === false
                                        ? 'Reopen registration'
                                        : 'Close registration'}
                                    </button>
                                  ))}
                              </div>
                            </div>
                            <div className="league-team-actions">
                              {canEdit &&
                                leagueTeams.find((v) => v.orgId === t.orgId)
                                  ?.id === t.id &&
                                !s.members.some(
                                  (m) =>
                                    (m.role === 'organiser' &&
                                      m.orgIds.includes(t.orgId)) ||
                                    organiserClubs(m).includes(t.orgId),
                                ) &&
                                (s.invites.some(
                                  (i) =>
                                    i.role === 'organiser' &&
                                    i.orgIds.includes(t.orgId) &&
                                    !i.acceptedAt &&
                                    !i.revoked &&
                                    Date.parse(i.expires) > Date.now(),
                                ) ? (
                                  <small className="muted">
                                    Organiser invitation pending
                                  </small>
                                ) : (
                                  <button
                                    className="btn small"
                                    onClick={() =>
                                      edit('invite', {
                                        role: 'organiser',
                                        orgIds: [t.orgId],
                                      })
                                    }
                                  >
                                    Invite junior organiser
                                  </button>
                                ))}
                              {canEdit && (
                                <button
                                  className="league-icon-button league-team-delete"
                                  disabled={busy}
                                  onClick={() => setRemoveTeam(t.id)}
                                  aria-label={`Remove ${t.name} from ${l.name}`}
                                  title="Remove team from league"
                                >
                                  <Trash2 size={18} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {!leagueTeams.length && (
                        <p className="muted">No teams assigned yet.</p>
                      )}
                    </div>
                  </details>
                  <div className="row wrap mt-5">
                    <button
                      className="btn primary"
                      onClick={() => openLeague(l.id)}
                    >
                      {leagueFixtures.length
                        ? 'View fixtures'
                        : 'Plan fixtures'}
                      <ArrowRight size={16} />
                    </button>
                    <button
                      className="btn"
                      disabled={
                        busy || !canEdit || !leagueHasTeamSpace(s, l.id)
                      }
                      onClick={() => setAddLeague(l.id)}
                    >
                      <Plus size={16} />
                      {leagueHasTeamSpace(s, l.id)
                        ? 'Add a club'
                        : 'League full'}
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
          {addLeague && (
            <AddClubToLeague
              tools={tools}
              leagueId={addLeague}
              close={() => setAddLeague('')}
              browse={() => {
                setAddLeague('');
                navigate('Clubs');
              }}
            />
          )}
          {importing && (
            <LeagueImport tools={tools} close={() => setImporting(false)} />
          )}
          {removeTeam && (
            <TeamRemoval
              tools={tools}
              teamId={removeTeam}
              close={() => setRemoveTeam('')}
            />
          )}
        </>
      ) : (
        <>
          {!!teams.length && (
            <OrganiserPriorities
              tools={tools}
              teams={teams}
              openFixture={openFixture}
              openLeague={openLeague}
            />
          )}
          {!teams.length && (
            <section className="season-empty">
              <Users size={30} />
              <h2>Your teams will appear here.</h2>
              <p>
                The Foundation administrator approves your club’s participation
                and assigns its teams to leagues. Once assigned, parents can
                find them and request places.
              </p>
              <button
                className="btn"
                onClick={() => navigate('People & access')}
              >
                Find my league contacts
              </button>
            </section>
          )}
        </>
      )}
      {addingSeason && (
        <Dialog open onOpenChange={(open) => !open && setAddingSeason(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Which season are you preparing?</DialogTitle>
              <DialogDescription>
                You can start next year’s leagues now. Your existing clubs will
                be available.
              </DialogDescription>
            </DialogHeader>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                setYear(nextYear);
                setAddingSeason(false);
              }}
            >
              <Field
                label="Season year"
                type="number"
                min={2020}
                max={2100}
                required
                value={nextYear}
                onChange={setNextYear}
              />
              <button className="btn primary">
                Prepare this season
                <ArrowRight size={16} />
              </button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
