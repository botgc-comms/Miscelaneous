import { rosterEligible, type Player, type State } from './model';

type FamilyEvent = {
  f: State['fixtures'][number];
  kids: Player[];
  published: boolean;
};

/** Match-day scorecards take priority for families with a saved selection. */
export function parentShowsScorecard(event: FamilyEvent, today: string) {
  const selected = event.kids.some((child) =>
    event.f.pairs.some((pair) => pair.players.includes(child.id)),
  );
  return (
    selected &&
    event.f.date <= today &&
    (event.f.status === 'live' ||
      event.f.status === 'completed' ||
      (event.published &&
        event.f.status === 'scheduled' &&
        event.f.date <= today))
  );
}

/** Parent home priorities use saved line-ups; unsaved organiser drafts stay local. */
export function parentFixtureSections<T extends FamilyEvent>(
  events: T[],
  today: string,
) {
  const current = events
    .filter(
      ({ f }) => f.date >= today && ['scheduled', 'live'].includes(f.status),
    )
    .sort(
      (a, b) =>
        a.f.date.localeCompare(b.f.date) || a.f.start.localeCompare(b.f.start),
    );
  const playing = (event: T) =>
    event.kids.some((p) =>
      event.f.pairs.some((pair) => pair.players.includes(p.id)),
    );
  const matchday = current
    .filter((event) => parentShowsScorecard(event, today))
    .sort(
      (a, b) => Number(b.f.status === 'live') - Number(a.f.status === 'live'),
    );
  const upcoming = current.filter((e) => !matchday.includes(e));
  const selected = upcoming.filter(playing);
  return {
    matchday,
    upcoming,
    selected,
    other: upcoming.filter((e) => !playing(e)),
    live: current.filter(
      (e) => e.f.status === 'live' && e.f.date <= today && playing(e),
    ),
  };
}

/** Include the whole team's fixture list, before individual line-ups are chosen. */
export function familyFixtures<T extends { workspace: string; state: State }>(
  seasons: T[],
  children: Player[],
) {
  return seasons.flatMap((season) =>
    season.state.fixtures
      .map((f) => ({
        season,
        f,
        published: !!season.state.leagues.find((l) => l.id === f.leagueId)
          ?.fixturesConfirmedAt,
        kids: children.filter((p) =>
          f.teamIds.some(
            (id) =>
              !season.state.teams.find((t) => t.id === id)?.withdrawnAt &&
              rosterEligible(season.state, p.id, id),
          ),
        ),
      }))
      .filter((event) => event.kids.length),
  );
}
