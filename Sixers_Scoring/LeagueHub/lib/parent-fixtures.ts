import { rosterEligible, type Player, type State } from './model';

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
