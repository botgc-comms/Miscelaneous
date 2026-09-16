import {
  AppError,
  capOrder,
  leagueAcceptsRegistrations,
  type State,
} from './model';

/** Add fictional club organisers without modifying real memberships or sending invitations. */
export function addTestOrganisers(s: State, clubIds: string[], count: number) {
  if (!Array.isArray(clubIds) || !clubIds.length || clubIds.length > 200)
    throw new AppError('Choose between 1 and 200 clubs for test organisers.');
  if (!Number.isInteger(count) || count < 1 || count > 5)
    throw new AppError('Choose between 1 and 5 test organisers per club.');
  const clubs = clubIds.map((id) => {
    const club = s.clubs.find((c) => c.id === id);
    if (!club || !s.orgs.some((o) => o.id === club.orgId))
      throw new AppError(
        'A selected club no longer exists. Choose the clubs again.',
      );
    return club;
  });
  let added = 0;
  for (const orgId of new Set(clubs.map((c) => c.orgId))) {
    const prefix = `test-organisers-v1:${orgId}:`;
    const existing = s.members.filter(
      (m) =>
        m.id.startsWith(prefix) &&
        m.role === 'organiser' &&
        m.orgIds.includes(orgId),
    ).length;
    const clubName = clubs.find((c) => c.orgId === orgId)!.name;
    let index = 0;
    for (let n = existing; n < count; n++) {
      while (s.members.some((m) => m.id === `${prefix}${index}`)) index++;
      s.members.push({
        id: `${prefix}${index}`,
        name: `${clubName} organiser ${index + 1} (Test)`,
        email: `organiser-${encodeURIComponent(orgId)}-${index + 1}@example.invalid`,
        phone: '',
        role: 'organiser',
        orgIds: [orgId],
        leagueIds: [],
      });
      index++;
      added++;
    }
  }
  return added;
}

/** Explicit, administrator-triggered additive seed. Stable IDs make retries harmless. */
export function addTestFamilies(
  s: State,
  leagueName: string,
  year: number,
  now: string,
  teamName?: string,
  targetSize?: number,
) {
  const matches = s.leagues.filter(
    (l) =>
      l.name === leagueName &&
      l.year === year &&
      (!teamName ||
        s.teams.some(
          (t) => t.leagueId === l.id && !t.withdrawnAt && t.name === teamName,
        )),
  );
  if (matches.length !== 1)
    throw new AppError('Choose one uniquely named league and season.');
  const league = matches[0];
  if (
    targetSize !== undefined &&
    (!Number.isInteger(targetSize) ||
      targetSize < 1 ||
      targetSize > (league.squadSize || 12))
  )
    throw new AppError(
      `Choose a test squad target between 1 and ${league.squadSize || 12}. Existing players will not be removed.`,
    );
  const teams = s.teams
    .filter((t) => t.leagueId === league.id && !t.withdrawnAt)
    .sort(capOrder);
  if (!teams.length) throw new AppError('Add teams to this league first.');
  const surnames = [
    'Bennett',
    'Clarke',
    'Davies',
    'Evans',
    'Foster',
    'Green',
    'Hughes',
    'Iqbal',
    'Jones',
    'Khan',
    'Lewis',
    'Morgan',
    'Nash',
    'Owens',
    'Patel',
    'Reed',
    'Shaw',
    'Turner',
    'Walker',
    'Young',
    'Adams',
    'Brooks',
    'Cooper',
    'Dixon',
    'Edwards',
    'Fletcher',
    'Grant',
    'Hill',
    'Jackson',
    'Kelly',
  ];
  const given = [
    'Oliver',
    'Amelia',
    'Leo',
    'Isla',
    'Noah',
    'Freya',
    'George',
    'Poppy',
  ];
  const parentNames = ['Alex', 'Sam', 'Jamie', 'Taylor', 'Jordan'];
  const families = [0, 0, 1, 1, 2, 3, 4, 4];
  let childrenAdded = 0,
    familiesAdded = 0,
    approvedAdded = 0,
    applicationsAdded = 0;
  for (const [teamIndex, team] of teams.entries()) {
    const batch = `test-families-v1:${league.id}:${team.id}`;
    // A completed seed is never topped up or used to change subsequent user edits.
    if (
      targetSize === undefined &&
      s.players.some((p) => p.id.startsWith(batch + ':'))
    )
      continue;
    const registered = new Set(
      (s.enrollments || [])
        .filter(
          (e) =>
            e.teamId === team.id && ['approved', 'pending'].includes(e.status),
        )
        .map((e) => e.playerId),
    ).size;
    const amount = Math.max(
      0,
      targetSize === undefined
        ? Math.min(8, (league.squadSize || 12) - registered)
        : targetSize - registered,
    );
    const open =
      team.enrollmentOpen !== false && leagueAcceptsRegistrations(league);
    const previousIndexes = s.players
      .filter((p) => p.id.startsWith(batch + ':child:'))
      .map((p) => Number(p.id.split(':').at(-1)))
      .filter(Number.isInteger);
    const offset =
      targetSize === undefined ? 0 : Math.max(-1, ...previousIndexes) + 1;
    for (let added = 0; added < amount; added++) {
      const i = offset + added;
      const familyIndex =
          i < families.length
            ? families[i]
            : 5 + Math.floor((i - families.length) / 2),
        surname = surnames[(teamIndex * 5 + familyIndex) % surnames.length];
      const parentId = `${batch}:family:${familyIndex}`,
        playerId = `${batch}:child:${i}`;
      const parentName = `${parentNames[familyIndex % parentNames.length]} ${surname} (Test)`;
      const phone = `07700900${String((100 + teamIndex * 5 + familyIndex) % 1000).padStart(3, '0')}`;
      if (!s.members.some((m) => m.id === parentId)) {
        s.members.push({
          id: parentId,
          name: parentName,
          email: `golfsixes-test-${teamIndex + 1}-${familyIndex + 1}@example.invalid`,
          phone,
          role: 'parent',
          orgIds: [team.orgId],
          leagueIds: [],
        });
        familiesAdded++;
      }
      s.players.push({
        id: playerId,
        parentId,
        orgId: team.orgId,
        name: `${given[(i + teamIndex * 2) % given.length]} ${surname} (Test)`,
        dob: `${league.year - 8 - (i % 5)}-${String(2 + (i % 10)).padStart(2, '0')}-14`,
        gender: i % 2 ? 'girl' : 'boy',
        handicap: i % 3 === 0 ? null : Math.min(54, 30 + i * 3),
        diet:
          i === 2
            ? 'TEST SCENARIO: nut allergy'
            : i === 4
              ? 'TEST SCENARIO: vegetarian'
              : '',
        care:
          i === 3
            ? 'TEST SCENARIO: benefits from clear instructions and a familiar partner.'
            : '',
        photoConsent: i % 3 !== 0,
        emergencyName: parentName,
        emergencyPhone: phone,
        consentAt: now,
      });
      const status =
        targetSize === undefined && open && i >= 6 ? 'pending' : 'approved';
      s.enrollments ??= [];
      s.enrollments.push({
        id: `${batch}:entry:${i}`,
        playerId,
        teamId: team.id,
        status,
        clubRequest: status === 'pending',
        preference:
          familyIndex === 4
            ? 'TEST REQUEST: please keep these siblings together.'
            : undefined,
        requestedAt: now,
        ...(status === 'approved' ? { approvedAt: now, decidedAt: now } : {}),
      });
      childrenAdded++;
      if (status === 'approved') approvedAdded++;
      else applicationsAdded++;
      if (status === 'approved')
        for (const fixture of s.fixtures.filter(
          (f) => f.status === 'scheduled' && f.teamIds.includes(team.id),
        )) {
          s.availability ??= [];
          if (i < 7)
            s.availability.push({
              fixtureId: fixture.id,
              playerId,
              status: i === 5 ? 'unsure' : 'yes',
              updatedAt: now,
            });
        }
    }
  }
  return { familiesAdded, childrenAdded, approvedAdded, applicationsAdded };
}
