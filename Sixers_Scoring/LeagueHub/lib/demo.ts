import {
  emptyState,
  CAP_COLOURS,
  fixtureResults,
  type State,
  type Member,
  type Fixture,
} from './model';
export const demoUser: Member = {
  id: 'demo-admin',
  name: 'Jamie Davies',
  email: 'jamie@example.com',
  phone: '07700 900123',
  role: 'admin',
  leagueIds: [],
  orgIds: [],
};
export function demoState(): State {
  const s = emptyState();
  s.members = [
    demoUser,
    {
      id: 'demo-organiser',
      name: 'Alex Morgan',
      email: 'alex@example.com',
      phone: '07700 900124',
      role: 'organiser',
      leagueIds: [],
      orgIds: ['org-0'],
    },
    {
      id: 'demo-parent',
      name: 'Sam Taylor',
      email: 'sam@example.com',
      phone: '07700 900125',
      role: 'parent',
      leagueIds: [],
      orgIds: ['org-0'],
    },
  ];
  s.leagues = [
    {
      id: 'surrey',
      name: 'Surrey Juniors',
      region: 'England · South East',
      year: 2026,
      holes: 6,
      pairs: 3,
      maxStrokes: 10,
      tiePolicy: 'average',
      status: 'active',
    },
  ];
  const names = [
    'Pinewood',
    'Oaklands',
    'Meadowbrook',
    'West Hill',
    'Brookfield',
    'Pinewood',
  ];
  const first = [
    'Oliver',
    'Amelia',
    'Noah',
    'Isla',
    'Leo',
    'Freya',
    'Theo',
    'Maya',
  ];
  const last = [
    'Taylor',
    'Patel',
    'Wilson',
    'James',
    'Clarke',
    'Lewis',
    'Hall',
    'Evans',
  ];
  for (let i = 0; i < 5; i++) {
    s.orgs.push({ id: `org-${i}`, name: `${names[i]} Juniors` });
    s.clubs.push({
      id: `club-${i}`,
      orgId: `org-${i}`,
      name: `${names[i]} Golf Club`,
      address: `${10 + i} Fairway Lane, Surrey, GU${i + 1} 1AB`,
      instructions:
        'Follow the junior golf signs from the main car park. Meet beside the practice putting green. Trainers are welcome.',
      welfareName: i === 0 ? 'Alex Morgan' : 'Club welfare officer',
      welfareEmail: `welfare-${i}@example.com`,
      safeGolf: true,
    });
    for (let j = 0; j < (i === 0 ? 16 : 8); j++)
      s.players.push({
        id: `player-${i}-${j}`,
        orgId: `org-${i}`,
        name: `${first[j % 8]} ${last[(j + i) % 8]}`,
        dob: `${2015 + (j % 3)}-0${1 + (j % 8)}-12`,
        handicap: j % 3 ? null : 45 + (j % 8),
        parentId:
          i === 0 && [0, 1].includes(j) ? 'demo-parent' : `parent-${i}-${j}`,
        diet: j === 1 ? 'No nuts' : '',
        care: j === 2 ? 'Benefits from a quiet briefing before play.' : '',
        photoConsent: j % 4 !== 0,
        emergencyName: `${last[(j + i) % 8]} family`,
        emergencyPhone: '07700 900126',
        consentAt: '2026-04-01T09:00:00Z',
      });
  }
  for (let i = 0; i < 6; i++)
    s.teams.push({
      id: `team-${i}`,
      leagueId: 'surrey',
      orgId: `org-${i === 5 ? 0 : i}`,
      name: `${names[i]} ${CAP_COLOURS[i].cap}`,
      color: CAP_COLOURS[i].color,
      cap: CAP_COLOURS[i].cap,
    });
  for (let round = 0; round < 8; round++) {
    const f: Fixture = {
      id: `fixture-${round}`,
      leagueId: 'surrey',
      clubId: `club-${round % 5}`,
      name: `Round ${round + 1} · ${names[round % 5]}`,
      date: [
        '2026-06-07',
        '2026-07-05',
        '2026-08-02',
        '2026-09-13',
        '2026-09-20',
        '2026-09-27',
        '2026-10-04',
        '2026-10-11',
      ][round],
      arrival: '09:00',
      start: '09:30',
      registration: true,
      format: round % 2 ? 'shotgun' : 'tee-times',
      foodBefore: 'Water and fruit by the practice green.',
      foodAfter:
        'Sandwiches and squash after play. Please tell us about dietary requirements.',
      instructions:
        'Meet your chaperone by the putting green for a short welcome. Bring your team cap, water bottle and a big smile.',
      status: round < 3 ? 'completed' : round === 3 ? 'live' : 'scheduled',
      teamIds: s.teams.map((t) => t.id),
      pairs: [],
      slots: [],
      scores: {},
      results: [],
    };
    if (round <= 3) {
      for (let slot = 0; slot < 9; slot++)
        f.slots.push({
          id: `slot-${round}-${slot}`,
          label:
            f.format === 'shotgun'
              ? `Hole ${(slot % 6) + 1}${slot >= 6 ? ' B' : ''}`
              : `${9 + Math.floor((30 + slot * 10) / 60)}:${String((30 + slot * 10) % 60).padStart(2, '0')}`,
          capacity: 2,
        });
      for (let t = 0; t < 6; t++)
        for (let p = 0; p < 3; p++) {
          const pid = `pair-${round}-${t}-${p}`;
          f.pairs.push({
            id: pid,
            teamId: `team-${t}`,
            players: [
              `player-${t === 5 ? 0 : t}-${(t === 5 ? 8 : 0) + p * 2}`,
              `player-${t === 5 ? 0 : t}-${(t === 5 ? 8 : 0) + p * 2 + 1}`,
            ],
            slotId: `slot-${round}-${Math.floor(t / 2) * 3 + p}`,
          });
          for (
            let hole = 1;
            hole <= (round === 3 ? 2 + ((t + p) % 3) : 6);
            hole++
          )
            f.scores[`${pid}:${hole}`] = {
              strokes: 3 + ((t + p + hole + round) % 5),
              version: 1,
              by: 'demo-parent',
              at: '2026-09-13T09:45:00Z',
            };
        }
    }
    if (round < 3) f.results = fixtureResults(s, f);
    s.fixtures.push(f);
  }
  s.activity = [
    {
      id: 'a1',
      by: 'demo-admin',
      text: 'Round 4 is live — scores are coming in',
      at: '2026-09-13T09:30:00Z',
    },
    {
      id: 'a2',
      by: 'demo-admin',
      text: 'All six teams submitted their pairings',
      at: '2026-09-12T16:00:00Z',
    },
    {
      id: 'a3',
      by: 'demo-admin',
      text: 'Round 3 results finalised',
      at: '2026-08-02T12:00:00Z',
    },
  ];
  return s;
}
