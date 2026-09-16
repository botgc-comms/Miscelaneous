import type { State } from './model';

export type HostingOffer = {
  clubId: string;
  leagueId: string;
  capacity: number;
  dates: string[];
  shotgun: 'yes' | 'no' | 'unsure';
  presentation: 'yes' | 'no' | 'unsure';
  food: 'yes' | 'no' | 'unsure';
  notes: string;
  updatedAt: string;
  updatedBy: string;
};
export type FixturePlanSettings = {
  count: number;
  start: string;
  end: string;
  minGap: number;
};
export type PlannedFixture = { clubId: string; date: string };
export const fixtureChoiceKey = (f: PlannedFixture) => `${f.clubId}:${f.date}`;
export const sortFixtureDraft = (fixtures: PlannedFixture[]) =>
  [...fixtures].sort(
    (a, b) => a.date.localeCompare(b.date) || a.clubId.localeCompare(b.clubId),
  );

export function availableHostingDates(
  s: State,
  leagueId: string,
  settings: FixturePlanSettings,
) {
  const clubIds = new Set(hostingClubs(s, leagueId).map((c) => c.id));
  return sortFixtureDraft(
    (s.hostingOffers || [])
      .filter(
        (o) =>
          o.leagueId === leagueId && o.capacity > 0 && clubIds.has(o.clubId),
      )
      .flatMap((o) =>
        [...new Set(o.dates)]
          .filter(
            (date) =>
              date >= settings.start &&
              date <= settings.end &&
              !s.fixtures.some(
                (f) =>
                  f.status !== 'cancelled' &&
                  f.clubId === o.clubId &&
                  f.date === date,
              ),
          )
          .map((date) => ({ clubId: o.clubId, date })),
      ),
  );
}

// Shared by the draft editor and the server: create exactly the reviewed list,
// while rechecking the offers and bookings at the point of creation.
export function reviewFixtureDraft(
  s: State,
  leagueId: string,
  settings: FixturePlanSettings,
  draft: PlannedFixture[],
) {
  const fixtures = sortFixtureDraft(draft);
  const available = new Set(
    availableHostingDates(s, leagueId, settings).map(fixtureChoiceKey),
  );
  const errors: string[] = [],
    warnings: string[] = [];
  const counts = new Map<string, number>();
  if (
    s.fixtures.some((f) => f.leagueId === leagueId && f.status !== 'cancelled')
  )
    errors.push(
      'This league already has fixtures. Manage those fixtures before creating another draft.',
    );
  if (fixtures.length > 36)
    errors.push('A draft can contain up to 36 fixtures.');
  for (const [i, f] of fixtures.entries()) {
    if (!available.has(fixtureChoiceKey(f)))
      errors.push(
        'Choose a date offered by a participating club within the season window, with no existing venue booking.',
      );
    counts.set(f.clubId, (counts.get(f.clubId) || 0) + 1);
    if (
      i &&
      dayNumber(f.date) - dayNumber(fixtures[i - 1].date) < settings.minGap
    )
      errors.push(`Keep at least ${settings.minGap} days between fixtures.`);
    if (i && f.clubId === fixtures[i - 1].clubId)
      warnings.push('The same club hosts consecutive fixtures.');
  }
  for (const [clubId, count] of counts) {
    const capacity =
      s.hostingOffers?.find(
        (o) => o.clubId === clubId && o.leagueId === leagueId,
      )?.capacity || 0;
    if (count > capacity)
      errors.push(
        `${s.clubs.find((c) => c.id === clubId)?.name || 'This club'} has offered to host ${capacity} fixture${capacity === 1 ? '' : 's'}. Remove or replace one of its fixtures first.`,
      );
  }
  const presentationConfirmed =
    !!fixtures.length &&
    s.hostingOffers?.some(
      (o) =>
        o.leagueId === leagueId &&
        o.clubId === fixtures.at(-1)!.clubId &&
        o.presentation === 'yes',
    ) === true;
  if (fixtures.length && !presentationConfirmed)
    warnings.push(
      'Confirm a presentation evening with the last host, or choose a host that has offered one.',
    );
  return {
    fixtures,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    presentationConfirmed,
  };
}
export const dayNumber = (date: string) =>
  Date.parse(date + 'T12:00:00Z') / 86400000;
export function hostingClubs(s: State, leagueId: string) {
  return s.clubs.filter((c) =>
    s.teams.some(
      (t) => !t.withdrawnAt && t.leagueId === leagueId && t.orgId === c.orgId,
    ),
  );
}
export function planningKey(s: State, leagueId: string) {
  const clubIds = new Set(hostingClubs(s, leagueId).map((c) => c.id));
  return JSON.stringify({
    league: s.leagues.find((l) => l.id === leagueId),
    clubs: hostingClubs(s, leagueId).map((c) => ({ id: c.id, orgId: c.orgId })),
    teams: s.teams
      .filter((t) => !t.withdrawnAt && t.leagueId === leagueId)
      .map((t) => t.id),
    offers: s.hostingOffers?.filter((o) => o.leagueId === leagueId) || [],
    fixtures: s.fixtures
      .filter(
        (f) =>
          (f.leagueId === leagueId || clubIds.has(f.clubId)) &&
          f.status !== 'cancelled',
      )
      .map((f) => ({ id: f.id, clubId: f.clubId, date: f.date })),
  });
}
export function suggestFixtures(
  s: State,
  leagueId: string,
  settings: FixturePlanSettings,
  options: { variant?: number; previous?: PlannedFixture[] } = {},
) {
  const clubs = hostingClubs(s, leagueId);
  const offers = (s.hostingOffers || []).filter(
    (o) =>
      o.leagueId === leagueId &&
      o.capacity > 0 &&
      clubs.some((c) => c.id === o.clubId),
  );
  const candidates = offers
    .flatMap((o) =>
      [...new Set(o.dates)]
        .filter(
          (date) =>
            date >= settings.start &&
            date <= settings.end &&
            !s.fixtures.some(
              (f) =>
                f.status !== 'cancelled' &&
                f.clubId === o.clubId &&
                f.date === date,
            ),
        )
        .map((date) => ({ clubId: o.clubId, date })),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.clubId.localeCompare(b.clubId),
    );
  const warnings: string[] = [];
  if (
    s.fixtures.some((f) => f.leagueId === leagueId && f.status !== 'cancelled')
  )
    return {
      fixtures: [] as PlannedFixture[],
      warnings: [
        'This league already has fixtures. Edit those fixtures individually; suggestions never replace an existing schedule.',
      ],
      complete: false,
      presentationConfirmed: false,
    };
  const missing = clubs.filter(
    (c) =>
      !s.hostingOffers?.some(
        (o) => o.leagueId === leagueId && o.clubId === c.id,
      ),
  );
  if (missing.length)
    warnings.push(
      `Waiting for hosting information from ${missing.map((c) => c.name).join(', ')}.`,
    );
  // Try achievable list lengths, longest first. Capacity, offered dates and
  // minimum spacing remain firm; a presentation host is preferred, not a
  // reason to throw away otherwise useful fixtures.
  type Search = {
    fixtures: PlannedFixture[];
    counts: Record<string, number>;
    score: number;
  };
  const dates = [...new Set(candidates.map((c) => c.date))];
  const days = new Map(dates.map((date) => [date, dayNumber(date)]));
  const startDay = dayNumber(settings.start),
    endDay = dayNumber(settings.end);
  const offerByClub = new Map(offers.map((offer) => [offer.clubId, offer]));
  const orgByClub = new Map(clubs.map((club) => [club.id, club.orgId]));
  const lastOfferedDay = new Map<string, number>();
  for (const candidate of candidates)
    lastOfferedDay.set(candidate.clubId, days.get(candidate.date)!);
  const roomAfter = new Map(
    dates.map((date) => {
      let last = dayNumber(date),
        count = 0;
      for (const next of dates)
        if (dayNumber(next) - last >= settings.minGap) {
          count++;
          last = dayNumber(next);
        }
      return [date, count];
    }),
  );
  function search(targetCount: number, requirePresentation: boolean) {
    let beam: Search[] = [{ fixtures: [], counts: {}, score: 0 }];
    const gap = (endDay - startDay) / Math.max(1, targetCount - 1);
    for (let round = 0; round < targetCount; round++) {
      const expanded: Search[] = [];
      for (const state of beam) {
        const nextChoices: Search[] = [];
        for (const candidate of candidates) {
          const offer = offerByClub.get(candidate.clubId)!;
          const candidateDay = days.get(candidate.date)!;
          const previous = state.fixtures.at(-1);
          const used = state.counts[candidate.clubId] || 0;
          if (
            used >= offer.capacity ||
            (previous &&
              candidateDay - days.get(previous.date)! < settings.minGap)
          )
            continue;
          if (
            requirePresentation &&
            round === targetCount - 1 &&
            offer.presentation !== 'yes'
          )
            continue;
          const remaining = targetCount - round - 1;
          if ((roomAfter.get(candidate.date) || 0) < remaining) continue;
          if (
            requirePresentation &&
            remaining &&
            !offers.some(
              (host) =>
                host.presentation === 'yes' &&
                (state.counts[host.clubId] || 0) +
                  (host.clubId === candidate.clubId ? 1 : 0) <
                  host.capacity &&
                (lastOfferedDay.get(host.clubId) ?? -Infinity) - candidateDay >=
                  remaining * settings.minGap,
            )
          )
            continue;
          if (
            endDay - candidateDay <
            (targetCount - round - 1) * settings.minGap
          )
            continue;
          const target = startDay + round * gap;
          const sameHost =
            previous &&
            orgByClub.get(previous.clubId) === orgByClub.get(candidate.clubId);
          nextChoices.push({
            fixtures: [...state.fixtures, candidate],
            counts: { ...state.counts, [candidate.clubId]: used + 1 },
            score:
              state.score +
              Math.abs(candidateDay - target) / Math.max(gap, 1) +
              used * 6 +
              (sameHost ? 30 : 0) +
              (offer.shotgun === 'yes' ? 0 : 0.25) +
              (options.variant ? variation(candidate, options.variant) * 2 : 0),
          });
        }
        nextChoices.sort((a, b) => a.score - b.score);
        expanded.push(...nextChoices.slice(0, 16));
      }
      if (!expanded.length) return null;
      expanded.sort((a, b) => a.score - b.score);
      beam = expanded.slice(0, 160);
    }
    const previousKey = JSON.stringify(
      sortFixtureDraft(options.previous || []),
    );
    return (
      beam.find((b) => JSON.stringify(b.fixtures) !== previousKey) || beam[0]
    );
  }
  const offeredCapacity = offers.reduce((n, o) => n + o.capacity, 0);
  const upperBound = Math.min(
    settings.count,
    offeredCapacity,
    dates.length,
    dates.length ? 1 + (roomAfter.get(dates[0]) || 0) : 0,
  );
  let best: Search = { fixtures: [], counts: {}, score: 0 };
  for (let count = upperBound; count > 0; count--) {
    const found =
      (offers.some((o) => o.presentation === 'yes')
        ? search(count, true)
        : null) || search(count, false);
    if (found) {
      best = found;
      break;
    }
  }
  const complete = best.fixtures.length === settings.count;
  const presentationConfirmed =
    !!best.fixtures.length &&
    offerByClub.get(best.fixtures.at(-1)!.clubId)?.presentation === 'yes';
  if (!best.fixtures.length)
    warnings.push(
      'No usable hosting dates fall within this season window. Adjust the dates above or ask clubs to share more availability.',
    );
  else if (!complete)
    warnings.push(
      `You can create these ${best.fixtures.length} fixtures now and add more later. The target is ${settings.count}; the clubs’ hosting limits, available dates and minimum gap allow this shorter list.`,
    );
  if (best.fixtures.length && !presentationConfirmed)
    warnings.push(
      'The last fixture still needs a presentation evening confirmed. You can create the fixtures now and agree this with the host afterwards.',
    );
  if (
    best.fixtures.some(
      (f, i, all) =>
        i > 0 &&
        clubs.find((c) => c.id === f.clubId)?.orgId ===
          clubs.find((c) => c.id === all[i - 1].clubId)?.orgId,
    )
  )
    warnings.push(
      'The available dates lead to consecutive fixtures at the same club. Review these with the organisers.',
    );
  return { fixtures: best.fixtures, warnings, complete, presentationConfirmed };
}

function variation(f: PlannedFixture, seed: number) {
  let hash = seed | 0;
  for (const c of fixtureChoiceKey(f))
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}
