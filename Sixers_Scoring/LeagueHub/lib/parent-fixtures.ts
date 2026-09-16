import { rosterEligible, type Player, type State } from './model';

/** Parent home priorities use saved line-ups; unsaved organiser drafts stay local. */
export function parentFixtureSections<
  T extends {
    f: State['fixtures'][number];
    kids: Player[];
    published: boolean;
  },
>(events: T[], today: string) {
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
  const upcoming = current.filter((e) => e.f.status === 'scheduled');
  const selected = upcoming.filter(playing);
  return {
    upcoming,
    selected,
    other: upcoming.filter((e) => !playing(e)),
    live: current.filter((e) => e.f.status === 'live' && playing(e)),
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
