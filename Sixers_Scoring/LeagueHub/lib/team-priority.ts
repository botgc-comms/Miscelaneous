import {
  leagueAcceptsRegistrations,
  rosterEligible,
  selectionConfirmed,
  type State,
  type Team,
} from './model';

export function londonDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** A team's next task is derived from its own registration and fixture records. */
export function teamPriority(s: State, t: Team, today = londonDay()) {
  const league = s.leagues.find((l) => l.id === t.leagueId)!;
  const registered = s.players.filter((p) =>
    rosterEligible(s, p.id, t.id),
  ).length;
  const pending = (s.enrollments || []).filter(
    (e) => e.teamId === t.id && e.status === 'pending',
  ).length;
  const fixtures = s.fixtures.filter(
    (f) =>
      !!league.fixturesConfirmedAt &&
      f.leagueId === t.leagueId &&
      f.teamIds.includes(t.id),
  );
  const next = fixtures
    .filter(
      (f) =>
        f.status === 'live' || (f.status === 'scheduled' && f.date >= today),
    )
    .sort(
      (a, b) =>
        Number(b.status === 'live') - Number(a.status === 'live') ||
        a.date.localeCompare(b.date) ||
        a.start.localeCompare(b.start),
    )[0];
  const entryOpen =
    t.enrollmentOpen !== false && leagueAcceptsRegistrations(league);
  const base = {
    registered,
    pending,
    entryOpen,
    fixtureId: next?.id,
    stage: 'Team registration',
    title: '',
    detail: '',
    action: '',
    target: 'roster' as 'roster' | 'preparation' | 'fixtures' | 'results',
    urgency: 3,
  };
  if (!league.fixturesConfirmedAt)
    return {
      ...base,
      title: pending
        ? `Review ${pending} player ${pending === 1 ? 'request' : 'requests'}`
        : entryOpen
          ? 'Invite and register your players'
          : 'Keep your team details up to date',
      detail:
        'Your administrator is still agreeing the fixtures. For now, focus on your club details and player registrations.',
      action: pending ? 'Review player requests' : 'Manage team registration',
      urgency: pending ? 2 : 3,
    };
  const daysUntil = next
    ? Math.round(
        (Date.parse(next.date + 'T12:00:00Z') -
          Date.parse(today + 'T12:00:00Z')) /
          86400000,
      )
    : Infinity;
  if (next?.status === 'live')
    return {
      ...base,
      stage: 'Matchday · live',
      title: 'Follow today’s scoring',
      detail: 'Play is underway. Scores update as families enter them.',
      action: 'See live scores',
      target: 'preparation' as const,
      urgency: 0,
    };
  if (next?.date === today)
    return {
      ...base,
      stage: 'Matchday · today',
      title: 'Get ready for today’s play',
      detail: 'Check your pairs and family confirmations before the start.',
      action: 'Check today’s team',
      target: 'preparation' as const,
      urgency: 1,
    };
  const selectedNow =
    next?.pairs.filter((p) => p.teamId === t.id).flatMap((p) => p.players) ||
    [];
  const teamReady =
    !!next &&
    selectedNow.length >= league.pairs * 2 &&
    selectedNow.every(
      (id) =>
        selectionConfirmed(s, next, id) &&
        !s.availability?.some(
          (a) =>
            a.fixtureId === next.id && a.playerId === id && a.status === 'no',
        ),
    );
  if (entryOpen && (daysUntil > 7 || (teamReady && pending > 0)))
    return {
      ...base,
      stage: 'Fixtures confirmed · Team registration',
      title: pending
        ? `Review ${pending} player ${pending === 1 ? 'request' : 'requests'}`
        : registered >= (league.squadSize || 12)
          ? 'Your squad is full'
          : 'Add players to your team',
      detail: `${registered} of ${league.squadSize || 12} players registered. ${pending ? 'Allocate places and check for siblings.' : registered >= (league.squadSize || 12) ? 'Check the squad, then close registration when you’re happy.' : 'Share joining instructions with families, then approve their requests.'}`,
      action: pending ? 'Review player requests' : 'Manage team registration',
      urgency: pending ? 2 : 3,
    };
  if (next) {
    const selected = [
      ...new Set(
        next.pairs.filter((p) => p.teamId === t.id).flatMap((p) => p.players),
      ),
    ];
    const available = s.players.filter(
      (p) =>
        rosterEligible(s, p.id, t.id) &&
        s.availability?.some(
          (a) =>
            a.fixtureId === next.id &&
            a.playerId === p.id &&
            a.status === 'yes',
        ),
    ).length;
    const unavailable = selected.filter((id) =>
      s.availability?.some(
        (a) =>
          a.fixtureId === next.id && a.playerId === id && a.status === 'no',
      ),
    ).length;
    const confirmed = selected.filter((id) =>
      selectionConfirmed(s, next, id),
    ).length;
    const needed = league.pairs * 2;
    return {
      ...base,
      stage: 'Fixture preparation',
      target: 'preparation' as const,
      urgency:
        daysUntil <= 7
          ? unavailable || selected.length < needed
            ? 1
            : confirmed < selected.length
              ? 2
              : 4
          : 4,
      title: unavailable
        ? 'A selected player can no longer play'
        : daysUntil > 7
          ? 'Fixtures confirmed — plan ahead when you’re ready'
          : selected.length < needed
            ? 'Choose players for the next fixture'
            : confirmed < selected.length
              ? 'Check family confirmations'
              : 'Your team is ready for the next fixture',
      detail: `${daysUntil > 7 ? 'No urgent fixture task yet. ' : daysUntil > 0 ? `${daysUntil} days to go. ` : ''}${available} available · ${selected.length} of ${needed} selected · ${confirmed} confirmed`,
      action: unavailable
        ? 'Update the line-up'
        : selected.length < needed
          ? 'Choose players & pairs'
          : 'Review the team',
    };
  }
  const last = fixtures
    .filter((f) => f.status === 'completed')
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return {
    ...base,
    stage: 'Between fixtures',
    title: last
      ? 'No more fixtures scheduled'
      : 'Waiting for your first fixture',
    detail:
      'You can still manage players and registrations. Your next confirmed fixture will appear here.',
    action: last ? 'View latest results' : 'View league fixtures',
    target: last ? ('results' as const) : ('fixtures' as const),
    fixtureId: last?.id,
    urgency: 4,
  };
}
