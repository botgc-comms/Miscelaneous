import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const output = path.resolve('work/tests');
await mkdir(output, { recursive: true });
for (const name of [
  'model',
  'support',
  'starting-allocations',
  'demo-data',
  'season-emails',
  'email-template',
  'passwords',
  'season-planning',
  'invitations',
  'club-logos',
  'test-families',
  'team-priority',
  'parent-fixtures',
  'league-map',
  'postcodes',
  'lineup-planner',
  'statistics',
  'club-images',
  'demo',
  'club-import',
  'league-import',
  'directories',
  'journey-context',
  'shared-records',
  'remembered-login',
]) {
  const input = await readFile(`lib/${name}.ts`, 'utf8');
  const js = ts
    .transpileModule(input, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace("from './model'", "from './model.mjs'")
    .replace("from './support'", "from './support.mjs'")
    .replace(
      "from './starting-allocations'",
      "from './starting-allocations.mjs'",
    )
    .replace("from './club-images'", "from './club-images.mjs'")
    .replace("from './test-families'", "from './test-families.mjs'")
    .replace("from './league-map'", "from './league-map.mjs'")
    .replace("from './demo'", "from './demo.mjs'")
    .replace("from './season-planning'", "from './season-planning.mjs'");
  await writeFile(path.join(output, `${name}.mjs`), js);
}
const {
  applyAction,
  points,
  fixtureResults,
  leagueStandings,
  projectState,
  canHost,
  canManageTeam,
  readiness,
  emptyState,
  upgradeState,
  rosterEligible,
  leagueAcceptsRegistrations,
  leagueHasTeamSpace,
  availableCaps,
  capOrder,
  CAP_COLOURS,
  responsibleForLeague,
  selectionKey,
  selectionConfirmed,
  fixtureScoringOpen,
} = await import(pathToFileURL(path.join(output, 'model.mjs')));
const { demoState, demoUser } = await import(
  pathToFileURL(path.join(output, 'demo.mjs'))
);
const { suggestFixtures, planningKey } = await import(
  pathToFileURL(path.join(output, 'season-planning.mjs'))
);
const admin = demoUser;
const { eventEmails } = await import(
  pathToFileURL(path.join(output, 'season-emails.mjs'))
);
const { incidentReportHtml } = await import(
  pathToFileURL(path.join(output, 'support.mjs'))
);
function supportSetup() {
  const s = demoState();
  const org = s.members.find((m) => m.id === 'demo-organiser');
  const team = s.teams.find((t) => org.orgIds.includes(t.orgId));
  const league = s.leagues.find((l) => l.id === team.leagueId);
  league.adminId = admin.id;
  const assistant = {
    id: 'support-assistant',
    name: 'Assigned assistant',
    email: 'assistant@example.invalid',
    role: 'league-admin',
    orgIds: [],
    leagueIds: [],
  };
  const outsider = {
    ...assistant,
    id: 'other-admin',
    email: 'other@example.invalid',
  };
  s.members.push(assistant, outsider);
  league.assistantId = assistant.id;
  const action = {
    type: 'support-create',
    kind: 'support',
    orgId: team.orgId,
    leagueId: league.id,
    subject: 'Fixture help',
    message: 'Please help with our starting slots.',
  };
  return { s, org, assistant, outsider, action };
}
test('support routes to assigned admins, keeps a conversation and resolves/reopens', () => {
  const { s, org, assistant, action } = supportSetup();
  let next = applyAction(s, org, action);
  const ticketId = next.supportTickets[0].id;
  assert.equal(s.supportTickets?.length || 0, 0);
  assert.deepEqual(
    next.notifications
      .filter((n) => n.supportTicketId === ticketId)
      .map((n) => n.recipient)
      .sort(),
    [admin.id, assistant.id].sort(),
  );
  assert.ok(projectState(next, org).members.some((m) => m.id === assistant.id));
  next = applyAction(next, assistant, {
    type: 'support-reply',
    ticketId,
    message: 'Here is how to do it.',
    authorId: 'spoof',
  });
  assert.equal(next.supportTickets[0].status, 'waiting');
  assert.equal(next.supportTickets[0].messages.at(-1).authorId, assistant.id);
  next = applyAction(next, org, { type: 'support-read', ticketId });
  assert.ok(
    next.notifications
      .filter((n) => n.recipient === org.id && n.supportTicketId === ticketId)
      .every((n) => n.readAt),
  );
  next = applyAction(next, org, {
    type: 'support-status',
    ticketId,
    status: 'resolved',
  });
  assert.equal(next.supportTickets[0].status, 'resolved');
  next = applyAction(next, org, {
    type: 'support-reply',
    ticketId,
    message: 'One more question',
  });
  assert.equal(next.supportTickets[0].status, 'open');
});
test('support excludes parents, unrelated admins, other organisers and revoked club memberships', () => {
  const { s, org, assistant, outsider, action } = supportSetup();
  const next = applyAction(s, org, { ...action, organiserId: outsider.id });
  const ticket = next.supportTickets[0];
  assert.equal(ticket.organiserId, org.id);
  for (const m of [
    s.members.find((m) => m.role === 'parent'),
    outsider,
    { ...org, id: 'same-club-other' },
    { ...org, orgIds: [] },
  ]) {
    assert.equal(projectState(next, m).supportTickets.length, 0);
    for (const type of ['support-read', 'support-reply', 'support-status'])
      assert.throws(() =>
        applyAction(next, m, {
          type,
          ticketId: ticket.id,
          message: 'No',
          status: 'resolved',
        }),
      );
  }
  assert.equal(projectState(next, assistant).supportTickets.length, 1);
  assert.equal(projectState(next, admin).supportTickets.length, 1);
  assert.throws(() =>
    applyAction(s, org, {
      ...action,
      orgId: s.orgs.find((o) => !org.orgIds.includes(o.id)).id,
    }),
  );
  assert.throws(() =>
    applyAction(s, outsider, { ...action, organiserId: org.id }),
  );
});
test('incident fields are validated and private details never enter notification emails or general activity', () => {
  const { s, org, action } = supportSetup();
  const incident = {
    involved: 'Sensitive person <script>alert(1)</script>',
    handledBy: 'QA responder',
    date: '2026-09-16',
    venue: 'QA venue',
    location: 'QA green',
    nature: 'Private injury details',
    before: 'Private events before',
    after: 'Private first aid action',
  };
  const report = {
    ...action,
    kind: 'incident',
    incident,
    message: '',
    subject: 'Private incident title',
  };
  assert.throws(() =>
    applyAction(s, org, {
      ...report,
      incident: { ...incident, date: '2026-02-30' },
    }),
  );
  assert.throws(() =>
    applyAction(s, org, { ...report, incident: { ...incident, nature: '' } }),
  );
  const next = applyAction(s, org, report),
    ticket = next.supportTickets[0];
  const emails = eventEmails(
    s,
    next,
    'test-workspace',
    'https://example.invalid',
  );
  assert.equal(emails.length, 2);
  for (const email of emails) {
    assert.equal(
      new URL(email.message.action.url).searchParams.get('ticket'),
      ticket.id,
    );
    assert.equal(email.message.action.label, 'Read and reply');
  }
  assert.doesNotMatch(
    JSON.stringify([emails, next.activity]),
    /Sensitive person|Private injury|Private incident title/,
  );
  const html = incidentReportHtml(ticket, 'QA <club>');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Welfare officer signature'));
  assert.ok(!html.includes('<script>'));
});
test('Foundation admins can initiate support and requests without assigned league staff have a fallback', () => {
  const { s, org, action } = supportSetup();
  const next = applyAction(s, admin, { ...action, organiserId: org.id });
  assert.equal(next.supportTickets[0].status, 'waiting');
  assert.ok(
    next.notifications.some(
      (n) =>
        n.recipient === org.id &&
        n.supportTicketId === next.supportTickets[0].id,
    ),
  );
  const general = applyAction(s, org, { ...action, leagueId: '' });
  assert.ok(
    general.notifications.some(
      (n) => n.recipient === admin.id && n.supportTicketId,
    ),
  );
  s.members = s.members.filter(
    (m) => !['admin', 'league-admin'].includes(m.role),
  );
  assert.throws(
    () => applyAction(s, org, { ...action, leagueId: '' }),
    /administrator must be assigned/,
  );
});
test('test organisers are additive, club-scoped, repeatable and admin-only', () => {
  const before = demoState();
  const club = before.clubs[0];
  const action = {
    type: 'add-test-organisers',
    clubIds: [club.id, club.id],
    count: 2,
  };
  const next = applyAction(before, admin, action);
  const added = next.members.filter((m) =>
    m.id.startsWith('test-organisers-v1:'),
  );
  assert.equal(added.length, 2);
  assert.ok(
    added.every(
      (m) =>
        m.role === 'organiser' &&
        m.name.endsWith('(Test)') &&
        m.email.endsWith('@example.invalid'),
    ),
  );
  for (const m of added) {
    assert.deepEqual(m.orgIds, [club.orgId]);
    assert.deepEqual(m.leagueIds, []);
  }
  assert.deepEqual(
    next.members.filter((m) => !m.id.startsWith('test-organisers-v1:')),
    before.members,
  );
  assert.deepEqual(next.invites, before.invites);
  assert.deepEqual(next.players, before.players);
  assert.deepEqual(applyAction(next, admin, action).members, next.members);
  assert.equal(
    applyAction(next, admin, { ...action, count: 3 }).members.length,
    next.members.length + 1,
  );
  assert.deepEqual(
    applyAction(next, admin, { ...action, count: 1 }).members,
    next.members,
  );
  assert.throws(() =>
    applyAction(before, { ...admin, role: 'organiser' }, action),
  );
  assert.throws(() => applyAction(before, admin, { ...action, count: 6 }));
  assert.throws(() =>
    applyAction(before, admin, { ...action, clubIds: [club.id, 'missing'] }),
  );
  assert.deepEqual(before, demoState());
});
const { normalisePostcode, mapInputs, mapData, leagueEnvelope } = await import(
  pathToFileURL(path.join(output, 'league-map.mjs'))
);
const { lookupPostcodes } = await import(
  pathToFileURL(path.join(output, 'postcodes.mjs'))
);

test('league map follows season/responsibility and maps shared-club teams without family data', () => {
  const s = upgradeState(demoState());
  const team = s.teams[0],
    league = s.leagues.find((l) => l.id === team.leagueId),
    club = s.clubs.find((c) => c.orgId === team.orgId);
  league.adminId = admin.id;
  club.postcode = 'de150ps';
  s.teams.push({
    ...team,
    id: 'second-map-team',
    name: 'Second team',
    cap: 'Orange',
    color: '#ed8b23',
  });
  s.teams.push({ ...team, id: 'removed-map-team', withdrawnAt: '2026-01-01' });
  const input = mapInputs(s, admin, league.year, 'mine');
  assert.ok(input.leagues.some((l) => l.id === league.id));
  const mapped = mapData(input, {
    'DE15 0PS': { latitude: 52.819, longitude: -1.613 },
  });
  const home = mapped.clubs.find((c) => c.id === club.id);
  assert.ok(home.teams.some((t) => t.id === 'second-map-team'));
  assert.ok(!home.teams.some((t) => t.id === 'removed-map-team'));
  assert.equal(home.position.latitude, 52.819);
  assert.ok(mapped.leagues.find((l) => l.id === league.id).area.length >= 48);
  assert.equal('players' in mapped, false);
  assert.equal('members' in mapped, false);
  assert.equal(mapInputs(s, admin, 2099, 'all').clubs.length, 0);
  const assistant = {
    ...admin,
    id: 'map-assistant',
    role: 'league-admin',
    leagueIds: [],
  };
  league.assistantId = assistant.id;
  assert.equal(mapInputs(s, assistant, league.year, 'mine').leagues.length, 1);
  for (const role of ['organiser', 'parent'])
    assert.throws(
      () => mapInputs(s, { ...admin, role }, league.year, 'all'),
      /Foundation administrators/,
    );
  assert.throws(() => mapInputs(s, admin, 0, 'all'), /season/);
});

test('map envelopes contain points and have rounded margins for single, collinear and scattered clubs', () => {
  for (const points of [
    [{ latitude: 53, longitude: -1 }],
    [
      { latitude: 53, longitude: -1 },
      { latitude: 53, longitude: -2 },
    ],
    [
      { latitude: 52, longitude: -1 },
      { latitude: 53, longitude: -2 },
      { latitude: 54, longitude: -1 },
      { latitude: 53, longitude: -1.5 },
    ],
  ]) {
    const hull = leagueEnvelope(points);
    assert.ok(hull.length >= 48);
    for (const p of points) {
      let inside = false;
      for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
        const [yi, xi] = hull[i],
          [yj, xj] = hull[j];
        if (
          yi > p.latitude !== yj > p.latitude &&
          p.longitude < ((xj - xi) * (p.latitude - yi)) / (yj - yi) + xi
        )
          inside = !inside;
      }
      assert.ok(inside, 'every club must be inside its league boundary');
    }
    assert.ok(
      Math.min(...hull.map((p) => p[0])) <
        Math.min(...points.map((p) => p.latitude)) - 0.02,
    );
  }
  assert.deepEqual(leagueEnvelope([]), []);
  assert.equal(normalisePostcode(' de15 0ps '), 'DE15 0PS');
  assert.equal(normalisePostcode('unknown'), '');
});

test('postcode lookup deduplicates, caches, preserves partial results and never fabricates missing positions', async () => {
  const records = new Map();
  let requests = 0;
  const cache = {
    match: async (r) => records.get(r.url)?.clone(),
    put: async (r, response) => {
      records.set(r.url, response.clone());
    },
  };
  const fetcher = async (url, options) => {
    requests++;
    assert.equal(url, 'https://api.postcodes.io/postcodes');
    assert.deepEqual(JSON.parse(options.body).postcodes.sort(), [
      'DE15 0PS',
      'SW1A 2AA',
    ]);
    return Response.json({
      result: [
        { query: 'DE150PS', result: { latitude: 52.819, longitude: -1.613 } },
        { query: 'SW1A 2AA', result: null },
      ],
    });
  };
  const first = await lookupPostcodes(
    ['DE150PS', 'de15 0ps', 'SW1A 2AA', ''],
    'https://test.example',
    cache,
    fetcher,
  );
  assert.equal(first.unavailable, false);
  assert.equal(first.positions['SW1A 2AA'], null);
  await lookupPostcodes(
    ['DE150PS', 'SW1A 2AA'],
    'https://test.example',
    cache,
    fetcher,
  );
  assert.equal(requests, 1);
  const failed = await lookupPostcodes(
    ['DE15 0PS', 'BT1 5GS'],
    'https://test.example',
    cache,
    async () => {
      throw new Error('offline');
    },
  );
  assert.equal(failed.unavailable, true);
  assert.ok(failed.positions['DE15 0PS']);
  assert.equal(failed.positions['BT1 5GS'], undefined);
  const input = {
    leagues: [],
    clubs: [
      { id: 'a', name: 'No postcode', postcode: '', teams: [], editable: true },
      {
        id: 'b',
        name: 'Invalid postcode',
        postcode: 'XYZ',
        teams: [],
        editable: true,
      },
      {
        id: 'c',
        name: 'Not found',
        postcode: 'SW1A 2AA',
        teams: [],
        editable: true,
      },
      {
        id: 'd',
        name: 'Offline',
        postcode: 'BT1 5GS',
        teams: [],
        editable: true,
      },
    ],
  };
  assert.deepEqual(
    mapData(input, first.positions, true).clubs.map((c) => c.issue),
    [
      'Postcode needed',
      'Check postcode',
      'Postcode not found',
      'Location lookup unavailable',
    ],
  );
});
const { teamPriority, londonDay } = await import(
  pathToFileURL(path.join(output, 'team-priority.mjs'))
);
const { familyFixtures, parentFixtureSections } = await import(
  pathToFileURL(path.join(output, 'parent-fixtures.mjs'))
);

test('parents can see and answer the published season before selections, even when registration is closed', () => {
  const { s, f, team } = planningState();
  const child = s.players.find((p) => rosterEligible(s, p.id, team.id));
  const parent = {
    ...admin,
    id: child.parentId,
    role: 'parent',
    orgIds: [],
    leagueIds: [],
  };
  const league = s.leagues.find((l) => l.id === team.leagueId);
  league.fixturesConfirmedAt = '2027-06-01';
  league.registrationOpen = false;
  team.enrollmentOpen = false;
  s.fixtures = Array.from({ length: 6 }, (_, i) => ({
    ...f,
    id: `published-${i}`,
    status: 'scheduled',
    pairs: [],
    teamIds: [team.id],
  }));
  const projected = projectState(s, parent);
  const events = familyFixtures(
    [{ workspace: 'season', state: projected }],
    [child],
  );
  assert.equal(events.length, 6);
  assert.ok(events.every((e) => e.published && e.kids[0].id === child.id));
  const available = applyAction(s, parent, {
    type: 'availability',
    fixtureId: 'published-5',
    playerId: child.id,
    status: 'yes',
  });
  assert.equal(
    projectState(available, parent).availability.find(
      (a) => a.fixtureId === 'published-5' && a.playerId === child.id,
    ).status,
    'yes',
  );
  const changed = applyAction(available, parent, {
    type: 'availability',
    fixtureId: 'published-5',
    playerId: child.id,
    status: 'no',
  });
  assert.equal(
    changed.availability.find(
      (a) => a.fixtureId === 'published-5' && a.playerId === child.id,
    ).status,
    'no',
  );
  const unrelated = structuredClone(s);
  unrelated.enrollments = [];
  assert.equal(
    familyFixtures([{ workspace: 'other', state: unrelated }], [child]).length,
    0,
  );
  delete league.fixturesConfirmedAt;
  assert.ok(
    familyFixtures([{ workspace: 'draft', state: s }], [child]).every(
      (e) => !e.published,
    ),
  );
});

test('organiser priorities are per team, keep registration visible, and put matchday first', () => {
  const { s, f, team } = planningState();
  const l = s.leagues.find((l) => l.id === team.leagueId);
  l.registrationOpen = true;
  l.fixturesConfirmedAt = '2027-05-01';
  team.enrollmentOpen = true;
  f.status = 'scheduled';
  f.date = '2027-07-01';
  s.fixtures = [f];
  const other = { ...team, id: 'closed-team', enrollmentOpen: false };
  s.teams.push(other);
  assert.equal(teamPriority(s, team, '2027-06-01').target, 'roster');
  assert.equal(
    teamPriority(s, other, '2027-06-01').title,
    'Waiting for your first fixture',
  );
  assert.equal(teamPriority(s, team, '2027-07-01').stage, 'Matchday · today');
  f.status = 'live';
  assert.equal(teamPriority(s, team, '2027-07-02').stage, 'Matchday · live');
  f.status = 'cancelled';
  team.enrollmentOpen = false;
  assert.equal(teamPriority(s, team, '2027-06-01').target, 'fixtures');
  f.status = 'completed';
  assert.equal(teamPriority(s, team, '2027-07-02').target, 'results');
  assert.equal(londonDay(new Date('2027-06-30T23:30:00Z')), '2027-07-01');
});

test('fixture priority advances from selection to confirmations and flags changed availability', () => {
  const { s, f, team } = planningState();
  s.leagues.find((l) => l.id === team.leagueId).fixturesConfirmedAt =
    '2027-05-01';
  team.enrollmentOpen = false;
  f.status = 'scheduled';
  f.date = '2027-07-01';
  s.fixtures = [f];
  f.pairs = [];
  assert.equal(
    teamPriority(s, team, '2027-06-25').action,
    'Choose players & pairs',
  );
  const required = s.leagues.find((l) => l.id === team.leagueId).pairs;
  f.pairs = Array.from({ length: required }, (_, i) => ({
    id: `priority-pair-${i}`,
    teamId: team.id,
    players: [`plan-${i * 2}`, `plan-${i * 2 + 1}`],
    slotId: '',
  }));
  assert.equal(
    teamPriority(s, team, '2027-06-25').title,
    'Ask families to confirm their child can still play',
  );
  s.fixtureConfirmations = f.pairs.flatMap((p) =>
    p.players.map((playerId) => ({
      fixtureId: f.id,
      playerId,
      selection: selectionKey(f, playerId),
      confirmedAt: '2027-06-01',
    })),
  );
  assert.equal(
    teamPriority(s, team, '2027-06-25').title,
    'Your team is ready for the next fixture',
  );
  s.availability.find(
    (a) => a.fixtureId === f.id && a.playerId === 'plan-0',
  ).status = 'no';
  assert.equal(
    teamPriority(s, team, '2027-06-25').action,
    'Update the line-up',
  );
});
test('season confirmation is explicit, scoped, retry-safe and independent of player registration', () => {
  const { s, f, team } = planningState();
  const league = s.leagues.find((l) => l.id === team.leagueId);
  delete league.fixturesConfirmedAt;
  league.registrationOpen = true;
  team.enrollmentOpen = true;
  f.status = 'scheduled';
  f.date = '2027-07-01';
  f.pairs = [];
  s.fixtures = [f];
  assert.equal(teamPriority(s, team, '2027-06-30').target, 'roster');
  const action = { type: 'fixtures-confirm', leagueId: league.id };
  assert.throws(
    () => applyAction(s, { ...admin, role: 'parent' }, action),
    /permission/,
  );
  assert.throws(
    () => applyAction({ ...s, fixtures: [] }, admin, action),
    /Create your fixtures/,
  );
  const confirmed = applyAction(s, admin, action, '2027-06-01T12:00:00Z');
  assert.equal(
    confirmed.leagues.find((l) => l.id === league.id).fixturesConfirmedAt,
    '2027-06-01T12:00:00Z',
  );
  assert.equal(
    confirmed.teams.find((t) => t.id === team.id).enrollmentOpen,
    true,
  );
  assert.equal(
    confirmed.leagues.find((l) => l.id === league.id).registrationOpen,
    true,
  );
  assert.ok(
    confirmed.notifications.some((n) =>
      /season fixtures are confirmed/.test(n.text),
    ),
  );
  const again = applyAction(confirmed, admin, action);
  assert.equal(again.notifications.length, confirmed.notifications.length);
  assert.equal(teamPriority(confirmed, team, '2027-06-01').target, 'roster');
  assert.equal(
    teamPriority(confirmed, team, '2027-06-24').target,
    'preparation',
  );
  assert.equal(teamPriority(confirmed, team, '2027-06-24').urgency, 1);
  assert.equal(
    teamPriority(confirmed, team, '2027-07-01').stage,
    'Matchday · today',
  );
  const updated = applyAction(confirmed, admin, {
    type: 'fixture',
    ...f,
    date: '2027-07-02',
  });
  assert.ok(
    updated.leagues.find((l) => l.id === league.id).fixturesConfirmedAt,
  );
  assert.ok(updated.notifications.some((n) => /Fixture updated/.test(n.text)));
  assert.equal(updated.fixtures[0].date, '2027-07-02');
});

test('fictional families are additive, retry-safe, scoped to the selected league, and administrator only', () => {
  const s = upgradeState(demoState());
  // Use empty squads to exercise the complete seed without altering original children.
  s.enrollments = [];
  s.teams[0].enrollmentOpen = false;
  const before = structuredClone(s);
  const action = {
    type: 'add-test-families',
    leagueName: s.leagues[0].name,
    year: s.leagues[0].year,
  };
  s.leagues.push({ ...s.leagues[0], id: 'duplicate-league' });
  before.leagues.push({ ...before.leagues[0], id: 'duplicate-league' });
  assert.throws(() => applyAction(s, admin, action), /uniquely/);
  action.teamName = s.teams[0].name;
  const next = applyAction(s, admin, action);
  assert.equal(next.players.length - s.players.length, 48);
  assert.equal(next.members.length - s.members.length, 30);
  for (const key of [
    'players',
    'members',
    'leagues',
    'teams',
    'clubs',
    'fixtures',
  ])
    assert.deepEqual(next[key].slice(0, s[key].length), before[key]);
  assert.equal(
    next.enrollments.filter((e) => e.status === 'pending').length,
    10,
  );
  assert.ok(
    next.enrollments
      .filter((e) => e.teamId === s.teams[0].id)
      .every((e) => e.status === 'approved'),
  );
  const again = applyAction(next, admin, action);
  for (const key of ['players', 'members', 'enrollments', 'availability'])
    assert.deepEqual(again[key], next[key]);
  assert.throws(
    () =>
      applyAction(
        s,
        s.members.find((m) => m.role === 'organiser'),
        action,
      ),
    /permission/,
  );
  assert.throws(
    () => applyAction(s, admin, { ...action, leagueName: 'Unknown' }),
    /uniquely/,
  );
});
const { suggestLineup, participation, moveLineupPlayer, selectionCandidates } =
  await import(pathToFileURL(path.join(output, 'lineup-planner.mjs')));

function planningState() {
  const s = upgradeState(demoState());
  const f = structuredClone(s.fixtures[0]);
  f.id = 'planning';
  f.status = 'scheduled';
  f.date = '2027-07-20';
  f.pairs = [];
  f.scores = {};
  f.results = [];
  s.fixtures = [f];
  const team = s.teams[0];
  s.leagues[0].pairs = 2;
  const template = s.players[0];
  s.players = Array.from({ length: 6 }, (_, i) => ({
    ...template,
    id: `plan-${i}`,
    name: `Child ${i}`,
    parentId: `parent-${i}`,
    orgId: team.orgId,
  }));
  s.enrollments = s.players.map((p) => ({
    id: `entry-${p.id}`,
    playerId: p.id,
    teamId: team.id,
    status: 'approved',
    requestedAt: '2027-01-01',
  }));
  s.availability = s.players.map((p) => ({
    fixtureId: f.id,
    playerId: p.id,
    status: 'yes',
    updatedAt: '2027-01-01',
  }));
  return { s, f, team };
}

test('selection board moves and swaps players without duplicates and ranks availability first', () => {
  const original = {
    pairs: [
      ['a', 'b'],
      ['c', ''],
    ],
    reserves: ['d'],
  };
  const swapped = moveLineupPlayer(original, 'a', { pair: 1, slot: 0 });
  assert.deepEqual(swapped.pairs, [
    ['c', 'b'],
    ['a', ''],
  ]);
  const promoted = moveLineupPlayer(swapped, 'd', { pair: 1, slot: 1 });
  assert.deepEqual(promoted.reserves, []);
  const reserve = moveLineupPlayer(promoted, 'b', 'reserves');
  assert.deepEqual(reserve.pairs[0], ['c', '']);
  assert.deepEqual(reserve.reserves, ['b']);
  assert.deepEqual(moveLineupPlayer(reserve, 'b', 'reserves'), reserve);
  assert.deepEqual(moveLineupPlayer(reserve, 'b', 'pool').reserves, []);
  assert.deepEqual(original, {
    pairs: [
      ['a', 'b'],
      ['c', ''],
    ],
    reserves: ['d'],
  });
  const { s, f, team } = planningState();
  s.availability = [
    { fixtureId: f.id, playerId: 'plan-0', status: 'no' },
    { fixtureId: f.id, playerId: 'plan-1', status: 'unsure' },
    { fixtureId: f.id, playerId: 'plan-3', status: 'yes' },
  ];
  f.pairs = [{ id: 'other', teamId: 'other-team', players: ['plan-5'] }];
  s.reserves = [{ fixtureId: f.id, teamId: 'other-team', playerId: 'plan-4' }];
  assert.deepEqual(
    selectionCandidates(s, f, team.id).map((p) => p.id),
    ['plan-3', 'plan-2', 'plan-1', 'plan-0'],
  );
});

test('pairs and reserves submit together and invalid reserves do not partially change selections', () => {
  const { s, f, team } = planningState();
  const action = {
    type: 'lineup',
    fixtureId: f.id,
    teamId: team.id,
    pairs: [
      ['plan-0', 'plan-1'],
      ['plan-2', 'plan-3'],
    ],
    reserveIds: ['plan-4'],
  };
  const before = structuredClone(s);
  assert.throws(
    () => applyAction(s, admin, { ...action, reserveIds: ['plan-0'] }),
    /distinct reserves/,
  );
  s.availability.find((a) => a.playerId === 'plan-4').status = 'no';
  assert.throws(() => applyAction(s, admin, action), /unavailable player/);
  assert.deepEqual(s.fixtures[0].pairs, before.fixtures[0].pairs);
  s.availability.find((a) => a.playerId === 'plan-4').status = 'yes';
  const first = applyAction(s, admin, action);
  assert.equal(
    first.reserves.find((r) => r.playerId === 'plan-4').teamId,
    team.id,
  );
  assert.equal(first.fixtures[0].pairs.flatMap((p) => p.players).length, 4);
  assert.ok(first.notifications.some((n) => /named as a reserve/.test(n.text)));
  const promoted = applyAction(first, admin, {
    ...action,
    pairs: [
      ['plan-4', 'plan-1'],
      ['plan-2', 'plan-3'],
    ],
    reserveIds: ['plan-0'],
  });
  assert.equal(
    promoted.reserves.some((r) => r.playerId === 'plan-4'),
    false,
  );
  assert.ok(promoted.reserves.some((r) => r.playerId === 'plan-0'));
  const cleared = applyAction(promoted, admin, { ...action, reserveIds: [] });
  assert.equal(
    cleared.reserves.filter((r) => r.fixtureId === f.id && r.teamId === team.id)
      .length,
    0,
  );
});

test('suggestions rotate within this league and account for earlier planned appearances', () => {
  const { s, f, team } = planningState();
  const old = {
    ...structuredClone(f),
    id: 'old',
    status: 'completed',
    date: '2027-06-01',
    pairs: [
      {
        id: 'oldpair',
        teamId: team.id,
        players: ['plan-0', 'plan-1'],
        slotId: '',
      },
    ],
  };
  s.fixtures.push(old, {
    ...structuredClone(old),
    id: 'other-league',
    leagueId: 'other',
    pairs: [
      {
        id: 'else',
        teamId: 'otherteam',
        players: ['plan-2', 'plan-3'],
        slotId: '',
      },
    ],
  });
  assert.deepEqual(
    new Set(suggestLineup(s, f, team.id).pairs.flat()),
    new Set(['plan-2', 'plan-3', 'plan-4', 'plan-5']),
  );
  assert.equal(participation(s, f, 'plan-2').played, 0);
  old.status = 'scheduled';
  assert.equal(participation(s, f, 'plan-0').planned, 1);
  assert.ok(!suggestLineup(s, f, team.id).pairs.flat().includes('plan-0'));
});

test('suggestions leave vacancies for unknown or unavailable children and exclude other teams', () => {
  const { s, f, team } = planningState();
  s.availability = s.availability.slice(0, 3);
  s.availability[2].status = 'no';
  f.pairs = [
    { id: 'other', teamId: s.teams[1].id, players: ['plan-1'], slotId: '' },
  ];
  const result = suggestLineup(s, f, team.id);
  assert.equal(result.shortfall, 3);
  assert.deepEqual(result.pairs.flat().filter(Boolean), ['plan-0']);
});

test('suggestions vary previous partners but keep selected siblings paired', () => {
  const { s, f, team } = planningState();
  s.availability = s.availability.slice(0, 4);
  s.fixtures.push({
    ...structuredClone(f),
    id: 'old',
    status: 'completed',
    date: '2027-06-01',
    pairs: [
      { id: 'a', teamId: team.id, players: ['plan-0', 'plan-1'], slotId: '' },
      { id: 'b', teamId: team.id, players: ['plan-2', 'plan-3'], slotId: '' },
    ],
  });
  assert.deepEqual(suggestLineup(s, f, team.id).pairs[0], ['plan-0', 'plan-2']);
  s.players[1].parentId = s.players[0].parentId;
  assert.deepEqual(suggestLineup(s, f, team.id).pairs[0], ['plan-0', 'plan-1']);
});

test('confirmation belongs to the parent and exact selection; withdrawal clears it', () => {
  let { s, f, team } = planningState();
  const parent = {
    ...admin,
    id: 'parent-0',
    role: 'parent',
    orgIds: [team.orgId],
  };
  f.pairs = [
    { id: 'pair', teamId: team.id, players: ['plan-0', 'plan-1'], slotId: '' },
  ];
  const action = {
    type: 'fixture-confirm',
    fixtureId: f.id,
    playerId: 'plan-0',
    selection: selectionKey(f, 'plan-0'),
  };
  assert.throws(
    () => applyAction(s, { ...parent, id: 'stranger' }, action),
    /permission/,
  );
  s = applyAction(s, parent, action);
  assert.ok(selectionConfirmed(s, s.fixtures[0], 'plan-0'));
  const changed = structuredClone(s);
  changed.fixtures[0].arrival = '08:30';
  assert.equal(
    selectionConfirmed(changed, changed.fixtures[0], 'plan-0'),
    false,
  );
  assert.throws(
    () => applyAction(changed, parent, action),
    /selection has changed/,
  );
  s = applyAction(s, parent, {
    type: 'availability',
    fixtureId: f.id,
    playerId: 'plan-0',
    status: 'no',
  });
  assert.equal(s.fixtureConfirmations.length, 0);
  assert.ok(!s.fixtures[0].pairs[0].players.includes('plan-0'));
});

test('fixture conversations persist with notifications and are private to the family and team managers', () => {
  let { s, f, team } = planningState();
  const parent = {
    ...admin,
    id: 'parent-0',
    role: 'parent',
    orgIds: [team.orgId],
  };
  const manager = s.members.find((m) => m.role === 'organiser');
  const action = {
    type: 'fixture-message',
    fixtureId: f.id,
    teamId: team.id,
    playerId: 'plan-0',
    text: 'Please keep the siblings together.',
  };
  s = applyAction(s, parent, action);
  assert.equal(s.fixtureMessages[0].authorId, parent.id);
  assert.ok(
    s.notifications.some(
      (n) => n.recipient === manager.id && n.fixtureId === f.id,
    ),
  );
  assert.equal(projectState(s, parent).fixtureMessages.length, 1);
  assert.equal(
    projectState(s, { ...parent, id: 'parent-1' }).fixtureMessages.length,
    0,
  );
  assert.equal(
    projectState(s, { ...manager, orgIds: ['org-1'] }).fixtureMessages.length,
    0,
  );
  assert.throws(
    () => applyAction(s, { ...parent, id: 'parent-1' }, action),
    /permission/,
  );
  assert.throws(
    () => applyAction(s, manager, { ...action, text: 'x'.repeat(2001) }),
    /2000/,
  );
  s = applyAction(s, manager, {
    ...action,
    text: 'Yes, we can pair them together.',
  });
  assert.equal(s.fixtureMessages.length, 2);
  assert.ok(s.notifications.some((n) => n.recipient === parent.id));
});

test('organiser can allocate a club application to another club team in the same league only', () => {
  const { s, team } = planningState();
  s.enrollments[0].status = 'pending';
  s.enrollments[0].clubRequest = true;
  const manager = s.members.find((m) => m.role === 'organiser');
  const target = s.teams.find(
    (t) => t.orgId === team.orgId && t.id !== team.id,
  );
  const action = {
    type: 'enrollment-decision',
    id: s.enrollments[0].id,
    decision: 'approve',
    teamId: target.id,
  };
  const next = applyAction(s, manager, action);
  assert.equal(next.enrollments[0].teamId, target.id);
  assert.equal(next.enrollments[0].status, 'approved');
  assert.throws(
    () => applyAction(s, manager, { ...action, teamId: s.teams[1].id }),
    /same league/,
  );
});

test('login help is visible and manageable only by the Foundation and the named club organiser', () => {
  const s = upgradeState(demoState());
  s.loginHelpRequests = [
    {
      id: 'help-a',
      orgId: 'org-0',
      name: 'Parent asking',
      phone: '07700900999',
      email: 'contact@example.com',
      reason: 'forgot-email',
      status: 'new',
      requestedAt: '2026-09-12T00:00:00Z',
    },
    {
      id: 'help-b',
      orgId: 'org-1',
      name: 'Other club parent',
      phone: '07700900888',
      email: '',
      reason: 'lost-email',
      status: 'new',
      requestedAt: '2026-09-12T00:00:00Z',
    },
  ];
  const organiser = {
    ...admin,
    id: 'org-staff',
    role: 'organiser',
    orgIds: ['org-0'],
  };
  assert.deepEqual(
    projectState(s, organiser).loginHelpRequests.map((r) => r.id),
    ['help-a'],
  );
  assert.equal(
    projectState(s, { ...admin, role: 'parent' }).loginHelpRequests.length,
    0,
  );
  assert.equal(
    projectState(s, {
      ...admin,
      role: 'league-admin',
      leagueIds: s.leagues.map((l) => l.id),
    }).loginHelpRequests.length,
    0,
  );
  assert.equal(projectState(s, admin).loginHelpRequests.length, 2);
  assert.throws(
    () =>
      applyAction(s, organiser, {
        type: 'login-help-status',
        id: 'help-b',
        status: 'resolved',
      }),
    /permission/,
  );
  assert.throws(
    () =>
      applyAction(
        s,
        { ...admin, role: 'parent' },
        { type: 'login-help-status', id: 'help-a', status: 'resolved' },
      ),
    /permission/,
  );
  const contacted = applyAction(s, organiser, {
    type: 'login-help-status',
    id: 'help-a',
    status: 'contacted',
  });
  assert.equal(contacted.loginHelpRequests[0].status, 'contacted');
  assert.equal(contacted.loginHelpRequests[0].updatedBy, organiser.id);
  const resolved = applyAction(contacted, admin, {
    type: 'login-help-status',
    id: 'help-a',
    status: 'resolved',
  });
  assert.equal(resolved.loginHelpRequests[0].status, 'resolved');
  assert.deepEqual(resolved.members, s.members);
  assert.deepEqual(resolved.players, s.players);
  assert.throws(
    () =>
      applyAction(s, admin, {
        type: 'login-help-status',
        id: 'help-a',
        status: 'reset-password',
      }),
    /status/,
  );
});

test('remembered login stores only the opted-in email and can be cleared or unavailable', async () => {
  const { rememberedEmail, rememberEmail } = await import(
    pathToFileURL(path.join(output, 'remembered-login.mjs'))
  );
  const old = globalThis.localStorage,
    values = new Map();
  try {
    globalThis.localStorage = {
      getItem: (k) => values.get(k),
      setItem: (k, v) => values.set(k, v),
      removeItem: (k) => values.delete(k),
    };
    assert.equal(rememberedEmail(), '');
    rememberEmail(' Parent@Example.com ');
    assert.equal(rememberedEmail(), 'parent@example.com');
    assert.equal(values.size, 1);
    rememberEmail('');
    assert.equal(values.size, 0);
    globalThis.localStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    assert.equal(rememberedEmail(), '');
    assert.doesNotThrow(() => rememberEmail('test@example.com'));
  } finally {
    globalThis.localStorage = old;
  }
});

function statisticsExample() {
  const s = emptyState();
  s.members = [admin];
  s.orgs = [
    { id: 'a', name: 'Club A' },
    { id: 'b', name: 'Club B' },
  ];
  s.clubs = [
    { id: 'venue-a', orgId: 'a', name: 'Venue A', county: 'Staffordshire' },
    { id: 'venue-b', orgId: 'b', name: 'Venue B', county: '' },
  ];
  s.leagues = [
    { id: 'north26', name: 'North', region: 'Midlands', year: 2026 },
    { id: 'north27', name: 'North', region: 'Midlands', year: 2027 },
    { id: 'south27', name: 'South', region: 'South', year: 2027 },
  ].map((l) => ({
    ...l,
    holes: 2,
    pairs: 1,
    maxStrokes: 10,
    tiePolicy: 'countback',
    status: 'active',
  }));
  s.teams = [
    ['a26', 'a', 'north26'],
    ['b26', 'b', 'north26'],
    ['a27', 'a', 'north27'],
    ['b27', 'b', 'north27'],
    ['south', 'b', 'south27'],
  ].map(([id, orgId, leagueId]) => ({
    id,
    orgId,
    leagueId,
    name: id,
    cap: 'Green',
    color: '#00816b',
  }));
  s.players = ['boy', 'girl', '', 'prefer-not-to-say', 'another'].map(
    (gender, i) => ({
      id: `p${i + 1}`,
      name: `PRIVATE CHILD ${i + 1}`,
      parentId: `family-${i % 2}`,
      dob: '2017-06-01',
      handicap: i ? null : 40,
      gender,
      care: 'PRIVATE CARE',
      emergencyPhone: 'PRIVATE PHONE',
    }),
  );
  s.enrollments = [
    ['p1', 'a26', 'removed'],
    ['p2', 'a26', 'approved'],
    ['p1', 'a27', 'approved'],
    ['p1', 'b27', 'removed'],
    ['p3', 'b27', 'approved'],
    ['p4', 'b27', 'approved'],
    ['p5', 'a27', 'pending'],
    ['p5', 'south', 'approved'],
  ].map(([playerId, teamId, status], i) => ({
    id: `e${i}`,
    playerId,
    teamId,
    status,
    ...(status !== 'pending' ? { approvedAt: '2026-01-01' } : {}),
    requestedAt: '2026-01-01',
  }));
  const fixture = (id, leagueId, clubId, teamIds, year) => ({
    id,
    leagueId,
    clubId,
    teamIds,
    date: `${year}-06-01`,
    name: id,
    status: 'completed',
    pairs: [
      { id: `${id}a`, teamId: teamIds[0], players: ['p1', 'p2'] },
      {
        id: `${id}b`,
        teamId: teamIds[1],
        players: year === 2027 ? ['p3', 'p4'] : [],
      },
    ],
    scores: Object.fromEntries(
      [2, 3, 10, 1].map((strokes, i) => [
        `${id}${i < 2 ? 'a' : 'b'}:${(i % 2) + 1}`,
        { strokes },
      ]),
    ),
    results: [],
  });
  s.fixtures = [
    fixture('f26', 'north26', 'venue-a', ['a26', 'b26'], 2026),
    fixture('f27', 'north27', 'venue-b', ['a27', 'b27'], 2027),
  ];
  s.fixtures.push(
    { ...s.fixtures[1], id: 'live', status: 'live' },
    { ...s.fixtures[1], id: 'cancelled', status: 'cancelled' },
    { ...s.fixtures[1], id: 'scheduled', status: 'scheduled' },
  );
  return s;
}
test('season statistics deduplicate children and score each pair-hole once, excluding unfinished fixtures', async () => {
  const { buildStatistics, leagueSeriesKey } = await import(
    pathToFileURL(path.join(output, 'statistics.mjs'))
  );
  const s = statisticsExample(),
    filter = { league: leagueSeriesKey(s.leagues[0]), club: 'all' };
  const data = buildStatistics(s, admin, [2027], filter),
    r = data.overall;
  assert.equal(r.counts.registered, 4);
  assert.equal(r.counts.played, 4);
  assert.equal(r.counts.pending, 1);
  assert.equal(r.counts.returning, 2);
  assert.equal(r.counts.held, 1);
  assert.equal(r.counts.live, 1);
  assert.equal(r.counts.scheduled, 1);
  assert.equal(r.counts.cancelled, 1);
  assert.equal(r.counts.scoreCount, 4);
  assert.equal(r.counts.meanPoints, 7);
  assert.equal(
    r.scoreProfile.reduce((sum, p) => sum + p.count, 0),
    4,
  );
  assert.equal(r.gender.find((g) => g.key === 'boy').percent, 25);
  assert.equal(r.gender.find((g) => g.key === '').count, 1);
  assert.equal(r.gender.find((g) => g.key === 'prefer-not-to-say').count, 1);
  assert.equal(r.counties[0].county, 'Not recorded');
  assert.equal(r.counts.missingCounty, 1);
  const club = buildStatistics(s, admin, [2027], {
    ...filter,
    club: 'a',
  }).overall;
  assert.equal(club.counts.registered, 2);
  assert.equal(club.counts.held, 1);
  assert.equal(club.counts.scoreCount, 2);
  assert.equal(club.counts.meanPoints, 8.5);
  assert.equal(
    club.counties[0].county,
    'Not recorded',
    'Away venue determines the county',
  );
});
test('comparisons match leagues across seasons and five-year totals distinguish missing seasons and unique children', async () => {
  const { buildStatistics, leagueSeriesKey } = await import(
    pathToFileURL(path.join(output, 'statistics.mjs'))
  );
  const s = statisticsExample();
  const data = buildStatistics(s, admin, [2023, 2024, 2025, 2026, 2027], {
    league: leagueSeriesKey(s.leagues[0]),
    club: 'all',
  });
  assert.equal(data.overall.counts.registered, 4);
  assert.equal(data.annual.find((a) => a.year === 2026).counts.registered, 2);
  assert.equal(data.annual.find((a) => a.year === 2027).counts.registered, 4);
  assert.equal(data.annual[0].counts.leagues, 0);
  assert.equal(data.annual[0].counts.meanPoints, null);
  assert.equal(data.overall.counts.held, 2);
  assert.equal(data.leagues.length, 1);
  const restricted = buildStatistics(
    s,
    { ...admin, role: 'league-admin', leagueIds: ['north26'] },
    [2026, 2027],
  );
  assert.equal(restricted.overall.counts.registered, 2);
  assert.equal(restricted.annual[1].counts.leagues, 0);
  assert.equal(
    buildStatistics(s, { ...admin, role: 'parent' }, [2027]).overall.counts
      .registered,
    0,
  );
});
test('statistics exports match filtered chart totals, label missing data and escape spreadsheet formulas without exporting family data', async () => {
  const { buildStatistics, statisticsCsv } = await import(
    pathToFileURL(path.join(output, 'statistics.mjs'))
  );
  const { csvRows } = await import(
    pathToFileURL(path.join(output, 'league-import.mjs'))
  );
  const s = statisticsExample();
  s.orgs[0].name = '=HYPERLINK("https://example.com")';
  const data = buildStatistics(s, admin, [2025, 2027], {
      league: 'all',
      club: 'a',
    }),
    csv = statisticsCsv(data, { league: 'All leagues', club: s.orgs[0].name });
  assert.ok(!/PRIVATE CHILD|PRIVATE CARE|PRIVATE PHONE|family-/.test(csv));
  const rows = csvRows(csv);
  assert.ok(
    rows.some((r) => r[0] === '2025' && r[5] === 'No leagues recorded'),
  );
  const scoreRows = rows.filter((r) => r[0] === '2027' && r[3] === 'Scoring');
  assert.equal(
    scoreRows.reduce((sum, r) => sum + Number(r[6]), 0),
    data.overall.counts.scoreCount,
  );
  assert.ok(rows.slice(1).every((r) => r[2].startsWith("'=HYPERLINK")));
});

test('club image discovery ranks sharing images, handles entities and lazy images, and skips logos', async () => {
  const { clubImageCandidates, clubWebsite } = await import(
    pathToFileURL(path.join(output, 'club-images.mjs'))
  );
  assert.deepEqual(
    clubImageCandidates(
      `<img src="/logo.png" width="900"><img data-src="/fairway.jpg" width="1000"><meta content="/course.jpg?a=1&amp;b=2" property="og:image"><img src="/tiny.png" width="20">`,
      'https://golfclub.co.uk/',
    ),
    [
      'https://golfclub.co.uk/course.jpg?a=1&b=2',
      'https://golfclub.co.uk/fairway.jpg',
    ],
  );
  assert.equal(clubWebsite('golfclub.co.uk'), 'https://golfclub.co.uk/');
  for (const value of [
    'https://127.0.0.1',
    'https://2130706433',
    'https://[::1]',
    'https://host.local',
    'https://user:pass@golfclub.co.uk',
    'file:///secret',
    'https://golfclub.co.uk:8443',
  ])
    assert.throws(() => clubWebsite(value));
});
test('club image fetches reject private DNS, validate redirects, bound downloads and only accept raster photos', async () => {
  const { fetchPublic, boundedBody, imageType, discoverClubImage } =
    await import(pathToFileURL(path.join(output, 'club-images.mjs')));
  const signal = AbortSignal.timeout(5000);
  const dns = () =>
    Response.json({ Answer: [{ type: 1, data: '93.184.216.34' }] });
  await assert.rejects(
    fetchPublic('https://golfclub.co.uk', signal, async () =>
      Response.json({ Answer: [{ type: 1, data: '10.0.0.1' }] }),
    ),
    /public address/,
  );
  await assert.rejects(
    fetchPublic('https://golfclub.co.uk', signal, async (url) =>
      String(url).includes('dns-query')
        ? dns()
        : new Response('', {
            status: 302,
            headers: { location: 'http://169.254.169.254/secret' },
          }),
    ),
    /public club website/,
  );
  await assert.rejects(
    boundedBody(new Response(new Uint8Array(100)), 50),
    /too large/,
  );
  assert.equal(
    imageType(new TextEncoder().encode('<svg>malicious</svg>')),
    undefined,
  );
  const bytes = new Uint8Array(6000);
  bytes.set([255, 216, 255, 192, 0, 17, 8, 2, 118, 4, 176]);
  const mock = async (url) =>
    String(url).includes('dns-query')
      ? dns()
      : String(url).endsWith('.jpg')
        ? new Response(bytes)
        : new Response('<meta property="og:image" content="/course.jpg">', {
            headers: { 'content-type': 'text/html' },
          });
  const result = await discoverClubImage(
    'https://golfclub.co.uk',
    signal,
    mock,
  );
  assert.equal(result.type, 'image/jpeg');
  assert.equal(result.bytes.length, 6000);
  assert.equal(result.source, 'https://golfclub.co.uk/course.jpg');
});
test('club websites enqueue images and edits preserve manual photos; only club staff can change them', () => {
  let s = emptyState();
  s.members = [admin];
  s = applyAction(s, admin, {
    type: 'club-import',
    clubs: [{ name: 'Photo Club', website: 'golfclub.co.uk' }],
  });
  let club = s.clubs[0];
  assert.equal(club.website, 'https://golfclub.co.uk/');
  assert.equal(club.imageStatus, 'pending');
  s = applyAction(s, admin, {
    type: 'club-image-set',
    clubId: club.id,
    imageKey: 'stored-photo',
  });
  club = s.clubs[0];
  const job = club.imageJobId;
  s = applyAction(s, admin, {
    ...club,
    type: 'club',
    address: 'Club Lane',
    welfareName: 'New contact',
  });
  assert.equal(s.clubs[0].imageKey, 'stored-photo');
  assert.equal(s.clubs[0].imageJobId, job);
  assert.throws(
    () =>
      applyAction(
        s,
        { ...admin, role: 'parent' },
        { type: 'club-image-clear', clubId: club.id },
      ),
    /permission/,
  );
  s = applyAction(s, admin, { type: 'club-image-clear', clubId: club.id });
  assert.equal(s.clubs[0].imageKey, undefined);
  assert.notEqual(s.clubs[0].imageJobId, job);
  assert.throws(
    () =>
      applyAction(s, admin, {
        ...club,
        type: 'club',
        address: 'Club Lane',
        website: 'http://localhost',
      }),
    /public club website/,
  );
});

test('Excel workbooks decode numeric seasons and multiple worksheets for league import', async () => {
  const { zipSync, strToU8 } = await import('fflate');
  const { default: readExcel } = await import('read-excel-file/universal');
  const { leagueImportRows } = await import(
    pathToFileURL(path.join(output, 'league-import.mjs'))
  );
  const sheet = (name) =>
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>league</t></is></c><c r="B1" t="inlineStr"><is><t>year</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>${name}</t></is></c><c r="B2"><v>2027</v></c></row></sheetData></worksheet>`;
  const zip = zipSync(
    Object.fromEntries(
      Object.entries({
        '[Content_Types].xml':
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
        '_rels/.rels':
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml':
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="North" sheetId="1" r:id="rId1"/><sheet name="South" sheetId="2" r:id="rId2"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels':
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': sheet('North'),
        'xl/worksheets/sheet2.xml': sheet('South'),
      }).map(([name, xml]) => [name, strToU8(xml)]),
    ),
  );
  const sheets = await readExcel(zip.buffer);
  assert.deepEqual(
    sheets.map((s) => s.sheet),
    ['North', 'South'],
  );
  assert.deepEqual(leagueImportRows(sheets[1].data), [
    { league: 'South', year: '2027' },
  ]);
});

test('spreadsheet imports multiple leagues atomically, reuses clubs and teams, and validates caps and staff', async () => {
  const { csvRows, leagueImportRows } = await import(
    pathToFileURL(path.join(output, 'league-import.mjs'))
  );
  const rows = leagueImportRows(
    csvRows(
      'league,year,region,club,team,cap\r\nNorth,2027,North,"Burton, Trent",Blue squad,Blue\r\nSouth,2027,South,"Burton, Trent",Green squad,\r\n',
    ),
  );
  const source = emptyState();
  source.members = [admin];
  const imported = applyAction(source, admin, { type: 'league-import', rows });
  assert.equal(imported.leagues.length, 2);
  assert.equal(imported.orgs.length, 1);
  assert.equal(imported.teams.length, 2);
  assert.ok(
    imported.leagues.every(
      (l) =>
        l.tiePolicy === 'countback' &&
        l.squadSize === 12 &&
        l.adminId === admin.id,
    ),
  );
  assert.equal(imported.teams[0].cap, 'Royal blue');
  assert.equal(imported.teams[1].cap, 'Red');
  const again = applyAction(imported, admin, { type: 'league-import', rows });
  assert.equal(again.teams.length, 2);
  assert.throws(
    () =>
      applyAction(source, admin, {
        type: 'league-import',
        rows: [rows[0], { ...rows[0], team: 'Duplicate blue' }],
      }),
    /Row 3.*already used/,
  );
  assert.equal(source.leagues.length, 0);
  assert.throws(
    () =>
      applyAction(source, admin, {
        type: 'league-import',
        rows: [{ ...rows[0], admin_email: 'missing@example.com' }],
      }),
    /account not found/,
  );
  assert.throws(
    () =>
      applyAction(imported, admin, {
        type: 'league-import',
        rows: [{ ...rows[0], holes: 9 }],
      }),
    /Conflicting holes/,
  );
});

test('caps use first free colour, canonical spelling and league-wide uniqueness', () => {
  assert.deepEqual(
    CAP_COLOURS.map((c) => c.cap),
    ['Red', 'Green', 'Royal blue', 'Navy', 'Orange', 'Black'],
  );
  let s = emptyState();
  s.members = [admin];
  s = applyAction(s, admin, {
    type: 'league-import',
    rows: [
      { league: 'Caps', year: 2027, club: 'Club', team: 'One' },
      { league: 'Caps', year: 2027, club: 'Club', team: 'Two' },
    ],
  });
  assert.deepEqual(
    s.teams.map((t) => t.cap),
    ['Red', 'Green'],
  );
  const t = s.teams[0];
  for (const cap of ['Purple', 'Yellow'])
    assert.throws(
      () =>
        applyAction(s, admin, {
          type: 'team',
          orgId: t.orgId,
          leagueId: t.leagueId,
          name: 'Invalid colour',
          cap,
        }),
      /six league cap colours/,
    );
  assert.throws(
    () =>
      applyAction(s, admin, {
        type: 'team',
        orgId: t.orgId,
        leagueId: t.leagueId,
        name: 'Duplicate',
        cap: 'gReEn',
        color: '#123456',
      }),
    /already used/,
  );
  assert.equal(availableCaps(s, t.leagueId)[0].cap, 'Royal blue');
  assert.deepEqual(
    [...s.teams]
      .reverse()
      .sort(capOrder)
      .map((t) => t.cap),
    ['Red', 'Green'],
  );
});

test('legacy blue becomes royal blue without changing team identity or silently reallocating other colours', () => {
  const s = demoState();
  s.teams[0].cap = 'Blue';
  s.teams[0].color = '#2475d0';
  s.teams[1].cap = 'Purple';
  s.teams[1].color = '#9657c9';
  const before = structuredClone(s);
  upgradeState(s);
  assert.deepEqual(s.teams[0], {
    ...before.teams[0],
    cap: 'Royal blue',
    color: CAP_COLOURS.find((c) => c.cap === 'Royal blue').color,
  });
  assert.deepEqual(s.teams[1], before.teams[1]);
  assert.deepEqual(s.players, before.players);
  assert.deepEqual(s.fixtures, before.fixtures);
  assert.equal(
    availableCaps(s, s.teams[0].leagueId).some((c) => c.cap === 'Royal blue'),
    false,
  );
  assert.throws(
    () =>
      applyAction(s, admin, {
        type: 'team',
        ...s.teams[1],
        cap: 'rOyAl BlUe',
      }),
    /already used/,
  );
});

test('league administrator and assistant assignments control default responsibility and scoped rights', () => {
  let s = emptyState();
  const lead = { ...admin, id: 'lead', role: 'league-admin', leagueIds: [] },
    assistant = { ...lead, id: 'assistant' };
  s.members = [admin, lead, assistant];
  s = applyAction(s, admin, {
    type: 'league',
    name: 'Assignments',
    region: 'North',
    year: 2027,
    holes: 6,
    pairs: 3,
    maxStrokes: 10,
    adminId: lead.id,
    assistantId: assistant.id,
  });
  const l = s.leagues[0];
  assert.ok(responsibleForLeague(lead, l));
  assert.ok(responsibleForLeague(assistant, l));
  assert.equal(responsibleForLeague(admin, l), false);
  assert.ok(
    s.members.find((m) => m.id === assistant.id).leagueIds.includes(l.id),
  );
  assert.throws(
    () => applyAction(s, admin, { ...l, type: 'league', assistantId: lead.id }),
    /different people/,
  );
  s = applyAction(s, admin, { ...l, type: 'league', assistantId: '' });
  assert.equal(
    s.members.find((m) => m.id === assistant.id).leagueIds.length,
    0,
  );
});

test('countback compares last 3, then 2, then 1 scoring holes, and averages unresolved ties', () => {
  const s = demoState(),
    l = s.leagues[0];
  l.tiePolicy = 'countback';
  l.holes = 6;
  const f = {
    ...s.fixtures[0],
    leagueId: l.id,
    teamIds: ['a', 'b'],
    pairs: [
      { id: 'a', teamId: 'a', players: [], slotId: '' },
      { id: 'b', teamId: 'b', players: [], slotId: '' },
    ],
    scores: {},
  };
  const rank = (a, b) => {
    f.scores = {};
    for (const [id, values] of [
      ['a', a],
      ['b', b],
    ])
      values.forEach(
        (strokes, i) => (f.scores[`${id}:${i + 1}`] = { strokes }),
      );
    return fixtureResults(s, f);
  };
  for (const [a, b] of [
    [
      [6, 6, 6, 4, 4, 4],
      [4, 4, 4, 6, 6, 6],
    ],
    [
      [5, 5, 5, 6, 4, 4],
      [5, 5, 5, 4, 5, 5],
    ],
    [
      [5, 5, 5, 5, 6, 4],
      [5, 5, 5, 5, 4, 6],
    ],
  ]) {
    const r = rank(a, b);
    assert.equal(r[0].teamId, 'a');
    assert.equal(r[0].rank, 1);
    assert.equal(r[1].rank, 2);
  }
  assert.ok(
    rank([5, 5, 5, 5, 5, 5], [5, 5, 5, 5, 5, 5]).every(
      (r) => r.rank === 1 && r.leaguePoints === 1.5,
    ),
  );
  assert.equal(
    rank([1, 1, 1, 7, 7, 7], [7, 7, 7, 2, 2, 2])[0].teamId,
    'a',
    'Total takes precedence',
  );
});

test('closing team entry requires pending decisions and survives team edits', () => {
  let s = upgradeState(demoState());
  const t = s.teams[0];
  s.enrollments.push({
    id: 'pending-close',
    teamId: t.id,
    playerId: s.players[0].id,
    status: 'pending',
    requestedAt: '2027-01-01',
  });
  assert.throws(
    () =>
      applyAction(s, admin, {
        type: 'team-directory',
        teamId: t.id,
        open: false,
      }),
    /remaining applications/,
  );
  s.enrollments = s.enrollments.filter((e) => e.status !== 'pending');
  s = applyAction(s, admin, {
    type: 'team-directory',
    teamId: t.id,
    open: false,
  });
  s = applyAction(s, admin, { ...t, type: 'team', name: 'Edited' });
  assert.equal(s.teams.find((v) => v.id === t.id).enrollmentOpen, false);
});

test('team replacement preserves historical results and removes memberships and future selections atomically', () => {
  let s = upgradeState(demoState());
  const t = s.teams[0];
  const live = s.fixtures.find(
    (f) => f.status === 'live' && f.teamIds.includes(t.id),
  );
  assert.throws(
    () => applyAction(s, admin, { type: 'team-remove', teamId: t.id }),
    /live fixture/,
  );
  if (live) live.status = 'scheduled';
  const historical = structuredClone(
    s.fixtures.filter((f) => f.status === 'completed'),
  );
  const next = applyAction(s, admin, {
    type: 'team-replace',
    teamId: t.id,
    orgId: s.orgs[1].id,
    name: 'Replacement',
  });
  const replacement = next.teams.at(-1);
  assert.ok(next.teams.find((v) => v.id === t.id).withdrawnAt);
  assert.equal(replacement.cap, t.cap);
  assert.deepEqual(
    next.fixtures.filter((f) => f.status === 'completed'),
    historical,
  );
  assert.ok(
    next.fixtures
      .filter((f) => f.status === 'scheduled')
      .every(
        (f) =>
          !f.teamIds.includes(t.id) && !f.pairs.some((p) => p.teamId === t.id),
      ),
  );
  assert.ok(
    next.enrollments
      .filter((e) => e.teamId === t.id)
      .every((e) => !['pending', 'approved'].includes(e.status)),
  );
  assert.equal(next.players.length, s.players.length);
  assert.throws(
    () =>
      applyAction(s, admin, {
        type: 'team-replace',
        teamId: t.id,
        orgId: 'missing',
        name: 'Bad replacement',
      }),
    /organisation/,
  );
  assert.ok(!s.teams.find((v) => v.id === t.id).withdrawnAt);
});

test('staff registration requires Foundation approval and grants only the requested club', () => {
  let s = upgradeState(demoState());
  const parent = s.members.find((m) => m.id === 'demo-parent');
  parent.orgIds = ['org-1'];
  s.accessRequests = [
    {
      id: 'access-test',
      userId: parent.id,
      name: parent.name,
      email: parent.email,
      phone: parent.phone,
      role: 'organiser',
      orgId: 'org-0',
      status: 'pending',
      requestedAt: new Date().toISOString(),
    },
  ];
  assert.throws(
    () =>
      applyAction(s, parent, {
        type: 'access-request-decision',
        id: 'access-test',
        decision: 'approve',
      }),
    /permission/,
  );
  assert.equal(
    projectState(
      s,
      s.members.find((m) => m.id === 'demo-organiser'),
    ).accessRequests.length,
    0,
  );
  s = applyAction(s, admin, {
    type: 'access-request-decision',
    id: 'access-test',
    decision: 'approve',
  });
  const joined = s.members.find((m) => m.id === parent.id);
  assert.equal(joined.role, 'organiser');
  assert.deepEqual(joined.orgIds, ['org-0']);
  assert.equal(s.accessRequests[0].status, 'approved');
  assert.throws(
    () =>
      applyAction(s, admin, {
        type: 'access-request-decision',
        id: 'access-test',
        decision: 'approve',
      }),
    /already/,
  );
  s.accessRequests.push({
    ...s.accessRequests[0],
    id: 'admin-test',
    userId: 'new-admin',
    role: 'admin',
    orgId: '',
    status: 'pending',
  });
  s = applyAction(s, admin, {
    type: 'access-request-decision',
    id: 'admin-test',
    decision: 'reject',
  });
  assert.ok(!s.members.some((m) => m.id === 'new-admin'));
});

test('organiser view of an admin account is restricted to its assigned club', () => {
  let s = upgradeState(demoState());
  s.fixtures = [];
  s = applyAction(s, admin, { type: 'organiser-club', orgId: 'org-0' });
  const saved = s.members.find((m) => m.id === admin.id);
  assert.equal(saved.role, 'admin');
  assert.equal(saved.organiserOrgId, 'org-0');
  const scoped = {
    ...saved,
    role: 'organiser',
    orgIds: [saved.organiserOrgId],
    leagueIds: [],
  };
  s.players.find((p) => p.id === 'player-1-0').parentId = admin.id;
  assert.equal(canManageTeam(s, scoped, 'team-0'), true);
  assert.equal(canManageTeam(s, scoped, 'team-1'), false);
  const projected = projectState(s, scoped);
  assert.deepEqual(
    projected.orgs.map((o) => o.id),
    ['org-0'],
  );
  assert.ok(projected.clubs.every((c) => c.orgId === 'org-0'));
  assert.ok(
    projected.enrollments.every(
      (e) => s.teams.find((t) => t.id === e.teamId).orgId === 'org-0',
    ),
  );
  assert.ok(projected.players.every((p) => p.orgId === 'org-0'));
  assert.equal(
    projected.members.find((m) => m.id === admin.id).role,
    'organiser',
  );
  const external = s.enrollments.find((e) => e.teamId === 'team-1');
  assert.throws(
    () =>
      applyAction(s, scoped, { type: 'enrollment-remove', id: external.id }),
    /permission/,
  );
  assert.throws(
    () => applyAction(s, scoped, { type: 'organiser-club', orgId: 'org-1' }),
    /permission/,
  );
  assert.throws(
    () =>
      applyAction(
        s,
        s.members.find((m) => m.id === 'demo-organiser'),
        { type: 'organiser-club', orgId: 'org-1' },
      ),
    /permission/,
  );
  const unassigned = projectState(s, { ...scoped, orgIds: [] });
  assert.equal(unassigned.leagues.length, 0);
  assert.equal(unassigned.orgs.length, 0);
  assert.equal(unassigned.enrollments.length, 0);
});
test('fixtures can be created and updated before host accreditation and welfare details are recorded', () => {
  let s = demoState();
  const source = s.fixtures[0];
  const club = s.clubs.find((c) => c.id === source.clubId);
  club.safeGolf = false;
  club.welfareName = '';
  club.welfareEmail = '';
  s = applyAction(s, admin, {
    ...source,
    id: undefined,
    type: 'fixture',
    name: undefined,
    date: '2027-04-06',
  });
  const created = s.fixtures.at(-1);
  assert.ok(created);
  assert.equal(created.name, `${club.name} · 6 Apr 2027`);
  assert.equal(created.status, 'scheduled');
  s = applyAction(s, admin, {
    ...created,
    type: 'fixture',
    instructions: 'Updated arrival instructions',
    date: '2027-04-13',
  });
  assert.equal(
    s.fixtures.find((f) => f.id === created.id).instructions,
    'Updated arrival instructions',
  );
  assert.equal(s.clubs.find((c) => c.id === club.id).safeGolf, false);
  assert.equal(
    s.fixtures.find((f) => f.id === created.id).name,
    `${club.name} · 13 Apr 2027`,
  );
});
test('six-team capacity counts teams rather than clubs and still permits existing team edits', () => {
  let s = demoState();
  const leagueId = s.leagues[0].id,
    orgId = s.orgs[0].id;
  s.teams = s.teams.filter((t) => t.leagueId !== leagueId);
  for (let n = 0; n < 6; n++) {
    assert.equal(leagueHasTeamSpace(s, leagueId), true);
    s = applyAction(s, admin, {
      type: 'team',
      orgId,
      leagueId,
      name: `Team ${n}`,
      cap: CAP_COLOURS[n].cap,
      color: `#00000${n}`,
    });
  }
  assert.equal(leagueHasTeamSpace(s, leagueId), false);
  for (const club of [orgId, s.orgs[1].id])
    assert.throws(
      () =>
        applyAction(s, admin, {
          type: 'team',
          orgId: club,
          leagueId,
          name: 'Seventh',
          cap: 'Extra',
          color: '#ffffff',
        }),
      /maximum of six teams/,
    );
  const team = s.teams.find((t) => t.leagueId === leagueId);
  s = applyAction(s, admin, { ...team, type: 'team', name: 'Updated team' });
  assert.equal(s.teams.find((t) => t.id === team.id).name, 'Updated team');
  assert.equal(leagueHasTeamSpace(s, 'missing'), false);
});
test('all role links and old parent URLs use ordinary shared records', async () => {
  const { roleHref, staffJourney, parentJourney } = await import(
    pathToFileURL(path.join(output, 'journey-context.mjs'))
  );
  const previous = staffJourney(true, 'demo-user');
  for (const search of [
    '?role=parent',
    '?role=parent&demo=0',
    '?role=parent&demo=1&stage=new',
    '?role=parent&code=123456',
  ])
    assert.deepEqual(parentJourney(search, previous), {
      demo: false,
      stage: 'ready',
    });
  assert.equal(roleHref('parent', previous), '/?role=parent&view=parent');
  assert.equal(
    new URLSearchParams(roleHref('admin', previous).split('?')[1]).get(
      'workspace',
    ),
    'demo-user',
  );
});
test('adopting existing staff records preserves club/team IDs and entered children without assigning seeded families to the owner', async () => {
  const { adoptWorkspace, hasCustomSetup } = await import(
    pathToFileURL(path.join(output, 'shared-records.mjs'))
  );
  const old = demoState(),
    original = JSON.stringify(old);
  old.orgs.push({ id: 'burton-entered', name: 'Burton on Trent Golf Club' });
  old.players.push({ ...old.players[0], id: 'entered-child', name: 'Seth' });
  const owner = {
    userId: 'actual-owner',
    displayName: 'Parent',
    email: 'parent@example.test',
  };
  const next = adoptWorkspace(old, owner);
  assert.ok(hasCustomSetup(old));
  assert.deepEqual(next.teams, old.teams);
  assert.deepEqual(next.orgs, old.orgs);
  assert.equal(
    next.players.find((p) => p.id === 'entered-child').parentId,
    owner.userId,
  );
  assert.equal(
    next.players.find((p) => p.id === old.players[0].id).parentId,
    old.players[0].parentId,
  );
  assert.equal(next.members.find((m) => m.id === owner.userId).role, 'admin');
  assert.deepEqual(adoptWorkspace(next, owner), next);
  assert.equal(
    JSON.parse(original).members.some((m) => m.id === owner.userId),
    false,
  );
});
const { clubMatches, filterPlayers, playedBefore } = await import(
  pathToFileURL(path.join(output, 'directories.mjs'))
);
const directoryFilters = {
  query: '',
  league: 'all',
  club: 'all',
  team: 'all',
  care: 'all',
  handicap: 'all',
  history: 'all',
  year: 2027,
};

test('club search handles county, address tokens and postcodes without spaces; venue edits preserve location fields', async () => {
  const { parseClubCsv } = await import(
    pathToFileURL(path.join(output, 'club-import.mjs'))
  );
  const clubs = parseClubCsv(
    'club_name,address,county,postcode\nBurton-on-Trent,43 Ashby Road,Staffordshire,DE15 0PS',
  );
  let s = applyAction(demoState(), admin, { type: 'club-import', clubs });
  let c = s.clubs.find((c) => c.name === 'Burton-on-Trent');
  assert.equal(c.county, 'Staffordshire');
  assert.equal(c.postcode, 'DE15 0PS');
  for (const query of [
    'burton on trent',
    'DE150PS',
    'ashby 43',
    'Staffordshire',
  ])
    assert.equal(clubMatches(s, c.orgId, query), true);
  assert.equal(clubMatches(s, c.orgId, '', 'Derbyshire'), false);
  const { county, postcode, ...legacyEdit } = c;
  s = applyAction(s, admin, {
    ...legacyEdit,
    type: 'club',
    instructions: 'New entrance',
  });
  c = s.clubs.find((v) => v.id === c.id);
  assert.equal(c.county, 'Staffordshire');
  assert.equal(c.postcode, 'DE15 0PS');
});

test('player league and team filters use the same active enrolment, not all teams at their club', () => {
  const s = upgradeState(demoState()),
    p = s.players[0],
    original = s.teams.find((t) => t.orgId === p.orgId);
  s.leagues.push({ ...s.leagues[0], id: 'other-league', name: 'Other league' });
  s.teams.push({ ...original, id: 'other-team', leagueId: 'other-league' });
  s.enrollments = s.enrollments.filter((e) => e.playerId !== p.id);
  s.enrollments.push({
    id: 'active',
    playerId: p.id,
    teamId: original.id,
    status: 'approved',
    requestedAt: '',
  });
  const contains = (filters) =>
    filterPlayers(s, { ...directoryFilters, ...filters }).some(
      (v) => v.id === p.id,
    );
  assert.equal(contains({ league: original.leagueId }), true);
  assert.equal(contains({ league: 'other-league' }), false);
  assert.equal(contains({ team: 'other-team' }), false);
  s.enrollments.push({
    id: 'pending',
    playerId: p.id,
    teamId: 'other-team',
    status: 'pending',
    requestedAt: '',
  });
  assert.equal(contains({ league: 'other-league' }), true);
  assert.equal(contains({ league: 'other-league', team: original.id }), false);
  s.enrollments.find((e) => e.id === 'pending').status = 'removed';
  assert.equal(contains({ league: 'other-league' }), false);
});

test('family search, care and handicap filters combine; redacted players never appear', () => {
  const s = upgradeState(demoState()),
    p = s.players[0];
  const parent = s.members.find((m) => m.id === p.parentId);
  parent.email = 'specific-parent@example.test';
  p.care = 'Additional support';
  p.diet = 'Nut allergy';
  p.handicap = 40;
  const filtered = filterPlayers(s, {
    ...directoryFilters,
    query: parent.email,
    care: 'support',
    handicap: 'held',
  });
  assert.ok(filtered.some((v) => v.id === p.id));
  assert.ok(
    !filterPlayers(s, {
      ...directoryFilters,
      query: parent.email,
      handicap: 'none',
    }).some((v) => v.id === p.id),
  );
  p.dob = '';
  assert.ok(!filterPlayers(s, directoryFilters).some((v) => v.id === p.id));
});

test('previous participation requires a completed fixture in an earlier season', () => {
  const s = upgradeState(demoState()),
    p = s.players[0];
  s.fixtures = [];
  const f = {
    ...demoState().fixtures[0],
    leagueId: s.leagues[0].id,
    status: 'scheduled',
    pairs: [
      {
        id: 'history-pair',
        teamId: s.teams[0].id,
        players: [p.id],
        slotId: '',
      },
    ],
  };
  s.fixtures.push(f);
  assert.equal(playedBefore(s, p, 2027), false);
  f.status = 'completed';
  s.leagues[0].year = 2026;
  assert.equal(playedBefore(s, p, 2027), true);
  assert.equal(playedBefore(s, p, 2026), false);
  assert.ok(
    filterPlayers(s, { ...directoryFilters, history: 'returning' }).some(
      (v) => v.id === p.id,
    ),
  );
});

test('scoped Foundation admins can browse other leagues and clubs without gaining access to their families or editing rights', () => {
  let s = upgradeState(demoState());
  s = applyAction(s, admin, {
    type: 'club-import',
    clubs: [
      { name: 'Not yet assigned', address: 'Somewhere', county: 'Derbyshire' },
    ],
  });
  const club = s.orgs.find((o) => o.name === 'Not yet assigned');
  const restricted = {
    ...admin,
    id: 'scoped',
    role: 'league-admin',
    leagueIds: [],
    orgIds: [],
  };
  const projected = projectState(s, restricted);
  assert.ok(projected.orgs.some((o) => o.id === club.id));
  assert.ok(projected.clubs.some((c) => c.orgId === club.id));
  assert.equal(projected.players.length, 0);
  assert.equal(projected.leagues.length, s.leagues.length);
  assert.ok(!projected.members.some((m) => m.role === 'parent'));
  assert.throws(
    () =>
      applyAction(s, restricted, {
        type: 'team',
        orgId: club.id,
        leagueId: s.leagues[0].id,
        name: 'Unauthorised',
        cap: 'Blue',
        color: '#abcdef',
      }),
    /permission/,
  );
});
const parent = () => demoState().members.find((m) => m.id === 'demo-parent');
const organiser = () =>
  demoState().members.find((m) => m.id === 'demo-organiser');
const scoreAction = {
  type: 'score',
  fixtureId: 'fixture-3',
  pairId: 'pair-3-0-0',
  hole: 1,
  strokes: 4,
  expectedVersion: 1,
};
test('official strokes convert to points at both boundaries', () => {
  assert.equal(points(1), 10);
  assert.equal(points(10), 1);
  assert.equal(points(6), 5);
});
test('fixture rankings reward highest game points and conserve league points for average ties', () => {
  const s = demoState(),
    f = s.fixtures[3];
  const r = fixtureResults(s, f);
  assert.equal(
    r.reduce((n, v) => n + v.leaguePoints, 0),
    21,
  );
  assert.ok(r[0].points >= r[1].points);
  const tied = structuredClone(f);
  tied.scores = {};
  const tr = fixtureResults(s, tied);
  assert.ok(tr.every((v) => v.rank === 1 && v.leaguePoints === 3.5));
});
test('only completed fixtures contribute to league standings', () => {
  const s = demoState();
  assert.ok(leagueStandings(s, 'surrey').every((t) => t.played === 3));
  s.fixtures[3].results = fixtureResults(s, s.fixtures[3]);
  assert.ok(leagueStandings(s, 'surrey').every((t) => t.played === 3));
});
test('parent can score own pair, and immutable input is retained', () => {
  const s = demoState();
  const next = applyAction(s, parent(), scoreAction);
  assert.equal(next.fixtures[3].scores['pair-3-0-0:1'].strokes, 4);
  assert.equal(next.fixtures[3].scores['pair-3-0-0:1'].version, 2);
  assert.equal(s.fixtures[3].scores['pair-3-0-0:1'].version, 1);
});
test('second parent of a pair can use the same card', () => {
  const s = demoState();
  const second = { ...parent(), id: 'second-parent' };
  s.players.find((p) => p.id === 'player-0-1').parentId = second.id;
  const next = applyAction(s, second, scoreAction);
  assert.equal(next.fixtures[3].scores['pair-3-0-0:1'].by, second.id);
});
test('concurrent stale edits to one hole fail explicitly', () => {
  const next = applyAction(demoState(), parent(), scoreAction);
  assert.throws(
    () => applyAction(next, parent(), scoreAction),
    (e) => e.status === 409,
  );
});
test('independent hole updates preserve each other', () => {
  const next = applyAction(demoState(), parent(), scoreAction);
  const another = applyAction(next, parent(), {
    ...scoreAction,
    hole: 2,
    strokes: 5,
  });
  assert.equal(another.fixtures[3].scores['pair-3-0-0:1'].strokes, 4);
  assert.equal(another.fixtures[3].scores['pair-3-0-0:2'].strokes, 5);
});
test('parent cannot write a different pair score or administrative settings', () => {
  assert.throws(
    () =>
      applyAction(demoState(), parent(), {
        ...scoreAction,
        pairId: 'pair-3-1-0',
      }),
    (e) => e.status === 403,
  );
  assert.throws(
    () =>
      applyAction(demoState(), parent(), {
        type: 'league',
        ...demoState().leagues[0],
        name: 'Changed',
      }),
    (e) => e.status === 403,
  );
});
test('score values and hole bounds are enforced', () => {
  for (const change of [
    { strokes: 0 },
    { strokes: 11 },
    { strokes: 3.5 },
    { hole: 0 },
    { hole: 7 },
  ])
    assert.throws(() =>
      applyAction(demoState(), parent(), { ...scoreAction, ...change }),
    );
});
test('completed scorecards are locked', () =>
  assert.throws(
    () =>
      applyAction(demoState(), admin, {
        ...scoreAction,
        fixtureId: 'fixture-0',
        pairId: 'pair-0-0-0',
      }),
    /Completed or cancelled/,
  ));
test('parent projection redacts other children and invitation secrets', () => {
  const s = demoState();
  s.invites.push({
    id: 'inv',
    hash: 'SECRET',
    role: 'parent',
    orgIds: ['org-0'],
    leagueIds: [],
    email: '',
    expires: '2030-01-01',
    revoked: false,
  });
  const p = projectState(s, parent());
  assert.equal(p.players.filter((p) => p.dob).length, 2);
  const other = p.players.find((p) => p.id === 'player-1-1');
  assert.equal(other.dob, '');
  assert.equal(other.care, '');
  assert.equal(other.emergencyPhone, '');
  assert.equal(other.photoKey, undefined);
  assert.ok(!JSON.stringify(p).includes('SECRET'));
});
test('host can access participating care details but not unrelated reserves', () => {
  const s = demoState();
  s.fixtures.forEach((f) => {
    if (f.status === 'live') f.clubId = 'club-0';
  });
  const o = projectState(s, organiser());
  assert.ok(o.players.find((p) => p.id === 'player-1-1')?.dob);
  assert.ok(!o.players.find((p) => p.id === 'player-1-7')?.dob);
});
test('league administrator cannot host another league through a shared organisation', () => {
  const s = demoState();
  const m = {
    ...admin,
    role: 'league-admin',
    leagueIds: ['surrey'],
    orgIds: [],
  };
  const other = {
    ...s.fixtures[3],
    leagueId: 'another-league',
    clubId: 'club-0',
  };
  assert.equal(canHost(s, m, other), false);
});
test('pairings reject repeated players and non-roster players', () => {
  const s = demoState();
  const base = {
    type: 'lineup',
    fixtureId: 'fixture-4',
    teamId: 'team-0',
    pairs: [
      ['player-0-0', 'player-0-0'],
      ['player-0-2', 'player-0-3'],
      ['player-0-4', 'player-0-5'],
    ],
  };
  assert.throws(
    () => applyAction(s, organiser(), base),
    /only be selected once/,
  );
  base.pairs[0][1] = 'player-1-0';
  assert.throws(() => applyAction(s, organiser(), base), /approved/);
});
test('a player cannot be entered in both cap-colour teams', () => {
  let s = demoState();
  const pairs = [
    ['player-0-0', 'player-0-1'],
    ['player-0-2', 'player-0-3'],
    ['player-0-4', 'player-0-5'],
  ];
  s = applyAction(s, admin, {
    type: 'lineup',
    fixtureId: 'fixture-4',
    teamId: 'team-0',
    pairs,
  });
  assert.throws(
    () =>
      applyAction(s, admin, {
        type: 'lineup',
        fixtureId: 'fixture-4',
        teamId: 'team-5',
        pairs,
      }),
    /another team/,
  );
});
const { suggestStartingAllocations, startingPairsKey, validateStartSettings } =
  await import(pathToFileURL(path.join(output, 'starting-allocations.mjs')));
const starts = {
  format: 'shotgun',
  holes: [1, 2, 3, 4, 5, 6],
  firstTime: '14:00',
  intervalMinutes: 10,
  capacity: 3,
};
test('starting suggestions maximise group sizes, allocate every pair once and never leave a pair alone', () => {
  const s = demoState(),
    base = s.fixtures[3];
  for (let capacity = 2; capacity <= 6; capacity++)
    for (let n = 2; n <= 36; n++) {
      const f = {
        ...base,
        pairs: Array.from({ length: n }, (_, i) => ({
          ...base.pairs[i % base.pairs.length],
          id: 'qa-' + i,
        })),
      };
      const settings = { ...starts, capacity, format: 'tee-times', holes: [1] };
      if (capacity === 2 && n % 2) {
        assert.throws(
          () => suggestStartingAllocations(f, s.teams, settings),
          /alone/,
        );
        continue;
      }
      const r = suggestStartingAllocations(f, s.teams, settings);
      assert.equal(Object.keys(r.assignments).length, n);
      assert.equal(r.slots.length, Math.ceil(n / capacity));
      const sizes = r.slots.map(
        (slot) =>
          Object.values(r.assignments).filter((id) => id === slot.id).length,
      );
      assert.ok(sizes.every((size) => size >= 2 && size <= capacity));
      assert.equal(
        sizes.reduce((a, b) => a + b, 0),
        n,
      );
    }
});
test('suggestions mix teams and clubs, advance shotgun holes and use configured tee intervals', () => {
  const s = demoState(),
    f = s.fixtures[3];
  // Six teams, including two clubs with two teams each.
  const teams = s.teams.map((t, i) => ({
    ...t,
    orgId: ['a', 'b', 'c', 'd', 'a', 'b'][i],
  }));
  const shot = suggestStartingAllocations(f, teams, starts);
  assert.equal(shot.slots.length, 6);
  assert.deepEqual(
    shot.slots.map((v) => v.startHole),
    [1, 2, 3, 4, 5, 6],
  );
  assert.ok(
    shot.slots.every((v) => v.startTime === '14:00' && v.capacity === 3),
  );
  for (const slot of shot.slots) {
    const pairs = f.pairs.filter((p) => shot.assignments[p.id] === slot.id);
    assert.equal(new Set(pairs.map((p) => p.teamId)).size, 3);
    assert.equal(
      new Set(pairs.map((p) => teams.find((t) => t.id === p.teamId).orgId))
        .size,
      3,
    );
  }
  const tee = suggestStartingAllocations(f, teams, {
    ...starts,
    format: 'tee-times',
    holes: [10],
    firstTime: '13:48',
    intervalMinutes: 8,
    capacity: 4,
  });
  assert.deepEqual(
    tee.slots.map((v) => v.startTime),
    ['13:48', '13:56', '14:04', '14:12', '14:20'],
  );
  assert.ok(tee.slots.every((v) => v.startHole === 10));
  assert.deepEqual(
    tee.slots.map(
      (slot) => f.pairs.filter((p) => tee.assignments[p.id] === slot.id).length,
    ),
    [4, 4, 4, 4, 2],
  );
});
test('invalid or impossible starting settings explain the problem without creating a partial allocation', () => {
  const s = demoState(),
    f = s.fixtures[3],
    snapshot = JSON.stringify(f);
  assert.throws(
    () => suggestStartingAllocations(f, s.teams, { ...starts, holes: [1, 2] }),
    /starting holes/,
  );
  assert.throws(
    () =>
      suggestStartingAllocations(f, s.teams, {
        ...starts,
        format: 'tee-times',
        holes: [1],
        firstTime: '23:50',
      }),
    /next day/,
  );
  assert.throws(
    () => validateStartSettings({ ...starts, holes: [1, 1] }),
    /different starting holes/,
  );
  assert.throws(
    () => validateStartSettings({ ...starts, capacity: 1 }),
    /2 and 6/,
  );
  assert.throws(
    () =>
      suggestStartingAllocations(
        { ...f, pairs: [f.pairs[0]] },
        s.teams,
        starts,
      ),
    /two pairs/,
  );
  assert.equal(JSON.stringify(f), snapshot);
});
test('saved starting settings persist, reject lone pairs and stale selections, and remain host-only', () => {
  const s = demoState(),
    f = s.fixtures[3];
  f.status = 'scheduled';
  f.arrival = '13:30';
  const result = suggestStartingAllocations(f, s.teams, starts);
  const action = {
    type: 'slots',
    fixtureId: f.id,
    settings: starts,
    expectedPairsKey: startingPairsKey(f),
    slots: result.slots,
    assignments: result.assignments,
  };
  const next = applyAction(s, admin, action),
    saved = next.fixtures.find((v) => v.id === f.id);
  assert.deepEqual(saved.startSettings, starts);
  assert.equal(saved.format, 'shotgun');
  assert.equal(saved.start, '14:00');
  assert.throws(
    () => applyAction(s, organiser(), action),
    /permission|cannot|authorised|access|allowed/i,
  );
  const onlyOne = {
    ...action,
    assignments: { [f.pairs[0].id]: result.slots[0].id },
  };
  assert.throws(() => applyAction(s, admin, onlyOne), /alone/);
  assert.throws(
    () => applyAction(s, admin, { ...action, expectedPairsKey: 'old' }),
    /selections changed/,
  );
  assert.throws(
    () =>
      applyAction(s, admin, {
        ...action,
        slots: result.slots.map((v) => ({ ...v, startHole: 1 })),
      }),
    /unique|different/,
  );
  const edited = applyAction(next, admin, {
    type: 'fixture',
    ...saved,
    fixtureId: undefined,
    instructions: 'Updated directions',
  });
  assert.deepEqual(
    edited.fixtures.find((v) => v.id === f.id).startSettings,
    starts,
  );
});
test('slot capacity is enforced and an incomplete fixture cannot start', () => {
  const s = demoState();
  assert.ok(readiness(s, s.fixtures[4]).length);
  assert.throws(() =>
    applyAction(s, admin, { type: 'start', fixtureId: 'fixture-4' }),
  );
  s.fixtures[3].status = 'scheduled';
  assert.throws(
    () =>
      applyAction(s, admin, {
        type: 'slots',
        fixtureId: 'fixture-3',
        slots: [{ id: 'one', label: 'Hole 1', capacity: 2 }],
        assignments: Object.fromEntries(
          s.fixtures[3].pairs.map((p) => [p.id, 'one']),
        ),
      }),
    /capacity/,
  );
});
test('finalisation requires complete cards and reopening removes league points', () => {
  let s = demoState();
  assert.throws(
    () => applyAction(s, admin, { type: 'finalise', fixtureId: 'fixture-3' }),
    /Complete/,
  );
  const f = s.fixtures[3];
  for (const p of f.pairs)
    for (let h = 1; h <= 6; h++)
      f.scores[`${p.id}:${h}`] = {
        strokes: 5,
        version: 1,
        by: admin.id,
        at: '2026-09-13',
      };
  s = applyAction(s, admin, { type: 'finalise', fixtureId: f.id });
  assert.equal(s.fixtures[3].status, 'completed');
  assert.ok(leagueStandings(s, 'surrey').every((t) => t.played === 4));
  s = applyAction(s, admin, { type: 'reopen', fixtureId: f.id });
  assert.ok(leagueStandings(s, 'surrey').every((t) => t.played === 3));
});
test('scoring format locks once a fixture starts', () =>
  assert.throws(
    () =>
      applyAction(demoState(), admin, {
        type: 'league',
        ...demoState().leagues[0],
        holes: 9,
      }),
    /locked/,
  ));
test('registration records non-publication consent by default and validates DOB', () => {
  const a = {
    type: 'player',
    orgId: 'org-0',
    name: 'Test Child',
    dob: '2017-01-02',
    handicap: '',
    emergencyName: 'Test Parent',
    emergencyPhone: '07700 900100',
    consent: true,
  };
  const s = applyAction(demoState(), parent(), a);
  const p = s.players.at(-1);
  assert.equal(p.parentId, 'demo-parent');
  assert.equal(p.handicap, null);
  assert.equal(p.photoConsent, false);
  assert.throws(() =>
    applyAction(demoState(), parent(), { ...a, dob: '2030-01-01' }),
  );
  assert.throws(() =>
    applyAction(demoState(), parent(), { ...a, consent: false }),
  );
});
test('organisers cannot grant themselves overall administration', () =>
  assert.throws(
    () =>
      applyAction(demoState(), organiser(), {
        type: 'invite',
        role: 'admin',
        orgIds: [],
        leagueIds: [],
        email: 'attacker@example.com',
      }),
    (e) => e.status === 403,
  ));
test('new workspace can build a configurable league and a joint-club team', () => {
  let s = emptyState();
  s.members = [admin];
  s = applyAction(s, admin, {
    type: 'league',
    name: 'Test League',
    region: 'Test',
    year: 2026,
    holes: 4,
    pairs: 2,
    maxStrokes: 8,
    tiePolicy: 'shared',
  });
  s = applyAction(s, admin, {
    type: 'organisation',
    name: 'Two clubs together',
  });
  for (const name of ['Club A', 'Club B'])
    s = applyAction(s, admin, {
      type: 'club',
      orgId: s.orgs[0].id,
      name,
      address: 'Test postcode',
      instructions: 'Meet at reception',
      safeGolf: true,
      welfareName: 'Welfare Officer',
      welfareEmail: 'welfare@example.com',
    });
  s = applyAction(s, admin, {
    type: 'team',
    orgId: s.orgs[0].id,
    leagueId: s.leagues[0].id,
    name: 'Together Green',
    cap: 'Green',
    color: '#00816b',
  });
  assert.equal(s.clubs.length, 2);
  assert.equal(s.teams.length, 1);
  assert.equal(s.leagues[0].pairs, 2);
});

test('enrollment approval is organiser scoped and gates the team roster', () => {
  let s = upgradeState(demoState());
  const p = s.players.find((p) => p.id === 'player-0-0');
  s.fixtures.forEach((f) => {
    if (f.status === 'live') f.status = 'scheduled';
  });
  s.enrollments = s.enrollments.filter((e) => e.playerId !== p.id);
  s.enrollments.push({
    id: 'request',
    playerId: p.id,
    teamId: 'team-0',
    status: 'pending',
    requestedAt: new Date().toISOString(),
  });
  assert.equal(rosterEligible(s, p.id, 'team-0'), false);
  assert.throws(
    () =>
      applyAction(s, parent(), {
        type: 'enrollment-decision',
        id: 'request',
        decision: 'approve',
      }),
    /permission/,
  );
  s = applyAction(s, organiser(), {
    type: 'enrollment-decision',
    id: 'request',
    decision: 'approve',
  });
  assert.equal(rosterEligible(s, p.id, 'team-0'), true);
  assert.ok(
    s.notifications.some(
      (n) => n.recipient === p.parentId && n.text.includes('approved'),
    ),
  );
  assert.throws(
    () =>
      applyAction(s, organiser(), {
        type: 'enrollment-decision',
        id: 'request',
        decision: 'approve',
      }),
    /already/,
  );
});

test('unavailability withdraws a selected child, not their partner or past results', () => {
  let s = upgradeState(demoState());
  const f = s.fixtures.find((f) => f.id === 'fixture-3');
  f.status = 'scheduled';
  const pair = f.pairs[0],
    pid = pair.players[0],
    partner = pair.players[1];
  const p = s.players.find((p) => p.id === pid),
    m = s.members.find((m) => m.id === p.parentId);
  s.enrollments = s.enrollments.filter((e) => e.playerId !== pid);
  s.enrollments.push({
    id: 'ready',
    playerId: pid,
    teamId: pair.teamId,
    status: 'approved',
    requestedAt: '',
  });
  const past = JSON.stringify(
    s.fixtures.filter((f) => f.status === 'completed'),
  );
  s = applyAction(s, m, {
    type: 'availability',
    fixtureId: f.id,
    playerId: pid,
    status: 'no',
  });
  assert.deepEqual(s.fixtures.find((v) => v.id === f.id).pairs[0].players, [
    partner,
  ]);
  assert.equal(
    JSON.stringify(s.fixtures.filter((f) => f.status === 'completed')),
    past,
  );
  assert.ok(s.notifications.some((n) => n.text.includes('replacement')));
  assert.throws(
    () =>
      applyAction(s, m, {
        type: 'reserve',
        fixtureId: f.id,
        teamId: pair.teamId,
        playerId: pid,
        selected: true,
      }),
    /permission/,
  );
  assert.throws(
    () =>
      applyAction(s, admin, {
        type: 'reserve',
        fixtureId: f.id,
        teamId: pair.teamId,
        playerId: pid,
        selected: true,
      }),
    /unavailable/,
  );
});

test('transfers remove future selections and retain only one approved team in a league', () => {
  let s = upgradeState(demoState());
  s.fixtures.forEach((f) => {
    if (f.status === 'live') f.status = 'scheduled';
  });
  const e = s.enrollments.find((e) => e.playerId === 'player-0-0');
  s = applyAction(s, admin, {
    type: 'enrollment-transfer',
    id: e.id,
    teamId: 'team-1',
  });
  assert.equal(
    s.enrollments.filter(
      (v) => v.playerId === e.playerId && v.status === 'approved',
    ).length,
    1,
  );
  assert.equal(rosterEligible(s, e.playerId, 'team-1'), true);
  assert.equal(rosterEligible(s, e.playerId, 'team-0'), false);
  assert.ok(
    s.fixtures
      .filter((f) => f.status === 'scheduled')
      .every((f) =>
        f.pairs
          .filter((p) => p.teamId === 'team-0')
          .every((p) => !p.players.includes(e.playerId)),
      ),
  );
});

test('profile review does not allow parents to approve themselves or see another family changes', () => {
  let s = upgradeState(demoState());
  const p = s.players.find((p) => p.id === 'player-0-0');
  s.profileChanges = [
    {
      id: 'change',
      playerId: p.id,
      proposed: { ...p, name: 'Updated Name' },
      status: 'pending',
      requestedAt: '',
    },
    {
      id: 'private',
      playerId: 'player-1-0',
      proposed: {
        ...s.players.find((p) => p.id === 'player-1-0'),
        care: 'Private',
      },
      status: 'pending',
      requestedAt: '',
    },
  ];
  assert.throws(
    () =>
      applyAction(s, parent(), {
        type: 'profile-review',
        id: 'change',
        decision: 'approve',
      }),
    /permission/,
  );
  assert.equal(projectState(s, parent()).profileChanges.length, 1);
  s = applyAction(s, admin, {
    type: 'profile-review',
    id: 'change',
    decision: 'approve',
  });
  assert.equal(s.players.find((v) => v.id === p.id).name, 'Updated Name');
});

test('organisers can assign unselected club registrations but cannot claim another club child', () => {
  let s = upgradeState(demoState());
  const p = s.players.find((p) => p.id === 'player-0-7');
  s.enrollments = s.enrollments.filter((e) => e.playerId !== p.id);
  s = applyAction(s, organiser(), {
    type: 'enrollment-add',
    teamId: 'team-0',
    playerId: p.id,
  });
  assert.equal(rosterEligible(s, p.id, 'team-0'), true);
  assert.throws(
    () =>
      applyAction(s, organiser(), {
        type: 'enrollment-add',
        teamId: 'team-0',
        playerId: 'player-1-7',
      }),
    /permission/,
  );
  assert.throws(
    () =>
      applyAction(s, organiser(), {
        type: 'enrollment-add',
        teamId: 'team-0',
        playerId: p.id,
      }),
    /already/,
  );
});

test('Foundation controls team admission; one club can enter multiple leagues in a future season', () => {
  let s = demoState();
  const year = new Date().getFullYear() + 1;
  for (const name of ['Staffordshire', 'Derbyshire'])
    s = applyAction(s, admin, {
      type: 'league',
      name,
      region: 'Midlands',
      year,
      holes: 6,
      pairs: 3,
      maxStrokes: 10,
      tiePolicy: 'average',
      registrationOpen: true,
    });
  const leagues = s.leagues.filter((l) => l.year === year);
  const base = {
    type: 'team',
    orgId: 'org-0',
    name: 'Club blue team',
    cap: 'Blue',
    color: '#123456',
  };
  assert.throws(
    () => applyAction(s, organiser(), { ...base, leagueId: leagues[0].id }),
    /permission/,
  );
  for (const l of leagues)
    s = applyAction(s, admin, { ...base, leagueId: l.id });
  assert.equal(
    s.teams.filter(
      (t) => t.orgId === 'org-0' && leagues.some((l) => l.id === t.leagueId),
    ).length,
    2,
  );
  assert.ok(
    s.teams
      .filter((t) => leagues.some((l) => l.id === t.leagueId))
      .every((t) => t.approvedBy === admin.id && t.approvedAt),
  );
  assert.ok(leagues.every(leagueAcceptsRegistrations));
  s = applyAction(s, admin, {
    ...leagues[0],
    type: 'league',
    registrationOpen: false,
  });
  assert.equal(
    leagueAcceptsRegistrations(s.leagues.find((l) => l.id === leagues[0].id)),
    false,
  );
});

test('club CSV handles quoted commas and multiline instructions; imports skip duplicate clubs atomically', async () => {
  const { parseClubCsv } = await import(
    pathToFileURL(path.join(output, 'club-import.mjs'))
  );
  const clubs = parseClubCsv(
    'club_name,address,instructions\r\n"Test, Golf Club","Road, Town","Gate one\nUse visitor parking"\r\nSecond Club,,',
  );
  assert.equal(clubs[0].name, 'Test, Golf Club');
  assert.equal(clubs[0].instructions, 'Gate one\nUse visitor parking');
  let s = applyAction(demoState(), admin, {
    type: 'club-import',
    clubs: [...clubs, clubs[0]],
  });
  assert.equal(s.orgs.filter((o) => o.name === 'Test, Golf Club').length, 1);
  assert.ok(s.clubs.find((c) => c.name === 'Second Club'));
  assert.throws(() => parseClubCsv('address\nSomewhere'), /club_name/);
  assert.throws(
    () => applyAction(s, organiser(), { type: 'club-import', clubs }),
    /permission/,
  );
  const before = JSON.stringify(s);
  assert.throws(
    () =>
      applyAction(s, admin, {
        type: 'club-import',
        clubs: [{ name: 'Would be added' }, { name: '' }],
      }),
    /required/,
  );
  assert.equal(JSON.stringify(s), before);
});

function planningSeason() {
  let s = emptyState();
  s.members = [admin];
  s = applyAction(s, admin, {
    type: 'league-import',
    rows: Array.from({ length: 6 }, (_, i) => ({
      league: 'Setup test',
      year: 2027,
      club: 'Club ' + i,
      team: 'Team ' + i,
    })),
  });
  const leagueId = s.leagues[0].id;
  const dates = Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(2027, 3, 4 + i * 14)).toISOString().slice(0, 10),
  );
  const organisers = s.clubs.map((club, i) => ({
    ...admin,
    id: 'organiser-' + i,
    role: 'organiser',
    orgIds: [club.orgId],
    leagueIds: [],
  }));
  s.members.push(...organisers);
  for (const [i, club] of s.clubs.entries())
    s = applyAction(s, organisers[i], {
      type: 'hosting-offer',
      clubId: club.id,
      leagueId,
      capacity: 2,
      dates,
      shotgun: 'yes',
      presentation: i === 5 ? 'yes' : 'no',
      food: 'yes',
      notes: '',
    });
  s = applyAction(s, admin, {
    type: 'fixture-planning',
    leagueId,
    count: 12,
    start: dates[0],
    end: dates.at(-1),
    minGap: 7,
  });
  return { s, leagueId, organisers, dates };
}

test('club confirmation allows partial details and hosting offers are league scoped and organiser protected', () => {
  const { s, leagueId, organisers, dates } = planningSeason();
  const club = s.clubs[0];
  const confirmed = applyAction(s, organisers[0], {
    type: 'club-confirm',
    clubId: club.id,
  });
  assert.equal(confirmed.clubs[0].confirmedBy, organisers[0].id);
  assert.ok(confirmed.clubs[0].confirmedAt);
  assert.equal(confirmed.clubs[0].safeGolf, false);
  assert.deepEqual(confirmed.fixtures, []);
  assert.throws(
    () =>
      applyAction(s, organisers[1], { type: 'club-confirm', clubId: club.id }),
    /permission/,
  );
  const action = {
    type: 'hosting-offer',
    clubId: club.id,
    leagueId,
    capacity: 1,
    dates,
    shotgun: 'unsure',
    presentation: 'no',
    food: 'no',
  };
  assert.throws(() => applyAction(s, organisers[1], action), /permission/);
  assert.throws(
    () => applyAction(s, organisers[0], { ...action, dates: ['2029-01-01'] }),
    /season/,
  );
  assert.throws(
    () => applyAction(s, organisers[0], { ...action, capacity: 4 }),
    /Hosting capacity/,
  );
  const cannotHost = applyAction(s, organisers[0], { ...action, capacity: 0 });
  assert.equal(
    cannotHost.hostingOffers.find((o) => o.clubId === club.id).dates.length,
    0,
  );
  assert.equal(projectState(s, organisers[0]).hostingOffers.length, 1);
  assert.equal(
    projectState(s, { ...organisers[0], role: 'parent' }).hostingOffers.length,
    0,
  );
  assert.equal(s.fixtures.length, 0);
});

test('suggestions fairly allocate twelve fixtures to six clubs, space dates, and finish at a presentation host', () => {
  const { s, leagueId, organisers } = planningSeason();
  const settings = s.leagues[0].fixturePlanning;
  const plan = suggestFixtures(s, leagueId, settings);
  assert.equal(plan.complete, true, plan.warnings.join(' '));
  assert.equal(plan.fixtures.length, 12);
  assert.equal(plan.fixtures.at(-1).clubId, s.clubs[5].id);
  for (const club of s.clubs)
    assert.equal(plan.fixtures.filter((f) => f.clubId === club.id).length, 2);
  for (let i = 1; i < 12; i++) {
    assert.notEqual(plan.fixtures[i].clubId, plan.fixtures[i - 1].clubId);
    assert.equal(
      Date.parse(plan.fixtures[i].date) - Date.parse(plan.fixtures[i - 1].date),
      14 * 86400000,
    );
  }
  assert.deepEqual(s.fixtures, []);
  const action = {
    type: 'fixture-plan-apply',
    leagueId,
    planningKey: planningKey(s, leagueId),
    arrival: '13:30',
    start: '14:00',
  };
  assert.throws(() => applyAction(s, organisers[0], action), /permission/);
  const created = applyAction(s, admin, action);
  assert.equal(created.fixtures.length, 12);
  assert.ok(
    created.fixtures.every(
      (f) => f.format === 'shotgun' && f.teamIds.length === 6,
    ),
  );
  assert.match(created.fixtures.at(-1).instructions, /presentation evening/);
  assert.throws(() => applyAction(created, admin, action), /changed/);
  assert.equal(suggestFixtures(created, leagueId, settings).complete, false);
});

test('fixture planning allows an unconfirmed presentation, rejects stale proposals and avoids venue bookings', () => {
  const { s, leagueId } = planningSeason();
  const settings = s.leagues[0].fixturePlanning;
  const key = planningKey(s, leagueId);
  s.hostingOffers[0].notes = 'Updated arrangements';
  assert.throws(
    () =>
      applyAction(s, admin, {
        type: 'fixture-plan-apply',
        leagueId,
        planningKey: key,
        arrival: '13:30',
        start: '14:00',
      }),
    /changed/,
  );
  for (const o of s.hostingOffers) o.presentation = 'no';
  const incomplete = suggestFixtures(s, leagueId, settings);
  assert.equal(incomplete.complete, true);
  assert.equal(incomplete.presentationConfirmed, false);
  assert.ok(incomplete.warnings.some((w) => /presentation/.test(w)));
  const provisional = applyAction(s, admin, {
    type: 'fixture-plan-apply',
    leagueId,
    planningKey: planningKey(s, leagueId),
    arrival: '13:30',
    start: '14:00',
  });
  assert.equal(provisional.fixtures.length, 12);
  assert.ok(
    provisional.fixtures.every(
      (f) => !f.instructions.includes('presentation evening'),
    ),
  );
  s.hostingOffers[5].presentation = 'yes';
  const beforeBooking = planningKey(s, leagueId);
  s.fixtures.push({
    id: 'other-league',
    leagueId: 'elsewhere',
    clubId: s.clubs[0].id,
    date: settings.start,
    status: 'scheduled',
  });
  assert.notEqual(planningKey(s, leagueId), beforeBooking);
  const plan = suggestFixtures(s, leagueId, settings);
  assert.equal(
    plan.fixtures.some(
      (f) => f.clubId === s.clubs[0].id && f.date === settings.start,
    ),
    false,
  );
  assert.deepEqual(
    s.fixtures.map((f) => f.id),
    ['other-league'],
  );
});

test('planner reserves the final presentation host and fills a wider window without skipping needed dates', () => {
  const { s, leagueId } = planningSeason();
  const plan = suggestFixtures(s, leagueId, {
    ...s.leagues[0].fixturePlanning,
    start: '2027-04-01',
    end: '2027-09-30',
  });
  assert.equal(plan.complete, true, plan.warnings.join(' '));
  assert.equal(plan.fixtures.length, 12);
  assert.equal(plan.fixtures.at(-1).clubId, s.clubs[5].id);
});

test('planner creates the available shorter list within each club capacity and spacing', () => {
  const { s, leagueId, dates } = planningSeason();
  s.hostingOffers = s.hostingOffers.slice(0, 3);
  s.hostingOffers[0].capacity = 1;
  s.hostingOffers[2].presentation = 'yes';
  const settings = s.leagues[0].fixturePlanning;
  const plan = suggestFixtures(s, leagueId, settings);
  assert.equal(plan.complete, false);
  assert.equal(plan.fixtures.length, 5);
  assert.equal(plan.presentationConfirmed, true);
  for (const offer of s.hostingOffers)
    assert.equal(
      plan.fixtures.filter((f) => f.clubId === offer.clubId).length,
      offer.capacity,
    );
  const created = applyAction(s, admin, {
    type: 'fixture-plan-apply',
    leagueId,
    planningKey: planningKey(s, leagueId),
    arrival: '13:30',
    start: '14:00',
  });
  assert.equal(created.fixtures.length, 5);
  assert.equal(s.fixtures.length, 0);
  // A narrow date window also returns usable fixtures instead of zero.
  const narrow = suggestFixtures(s, leagueId, { ...settings, end: dates[1] });
  assert.equal(narrow.fixtures.length, 2);
  assert.ok(narrow.fixtures.every((f) => f.date <= dates[1]));
  s.hostingOffers.forEach((o) => {
    o.dates = [];
  });
  assert.equal(suggestFixtures(s, leagueId, settings).fixtures.length, 0);
  assert.throws(
    () =>
      applyAction(s, admin, {
        type: 'fixture-plan-apply',
        leagueId,
        planningKey: planningKey(s, leagueId),
        arrival: '13:30',
        start: '14:00',
      }),
    /No fixtures/,
  );
});

test('fixture drafts support alternatives and create exactly the edited dates with validation', () => {
  const { s, leagueId, dates, organisers } = planningSeason();
  const settings = s.leagues[0].fixturePlanning;
  const first = suggestFixtures(s, leagueId, settings);
  const other = suggestFixtures(s, leagueId, settings, {
    variant: 1,
    previous: first.fixtures,
  });
  assert.equal(other.fixtures.length, first.fixtures.length);
  assert.notDeepEqual(other.fixtures, first.fixtures);
  assert.deepEqual(
    other,
    suggestFixtures(s, leagueId, settings, {
      variant: 1,
      previous: first.fixtures,
    }),
  );
  const edited = [other.fixtures[4], other.fixtures[0]];
  const action = {
    type: 'fixture-plan-apply',
    leagueId,
    planningKey: planningKey(s, leagueId),
    fixtures: edited,
    arrival: '13:30',
    start: '14:00',
  };
  const created = applyAction(s, admin, action);
  assert.deepEqual(
    created.fixtures.map(({ clubId, date }) => ({ clubId, date })),
    [...edited].sort((a, b) => a.date.localeCompare(b.date)),
  );
  assert.equal(s.fixtures.length, 0);
  assert.throws(() => applyAction(s, organisers[0], action), /permission/);
  for (const fixtures of [
    [edited[0], edited[0]],
    [
      { clubId: s.clubs[0].id, date: dates[0] },
      { clubId: s.clubs[0].id, date: dates[1] },
      { clubId: s.clubs[0].id, date: dates[2] },
    ],
    [{ clubId: 'unknown', date: dates[0] }],
    [{ clubId: s.clubs[0].id, date: '2027-01-01' }],
    [null],
  ])
    assert.throws(() => applyAction(s, admin, { ...action, fixtures }));
  const booked = structuredClone(s);
  booked.fixtures.push({
    id: 'booked',
    leagueId: 'elsewhere',
    clubId: edited[0].clubId,
    date: edited[0].date,
    status: 'scheduled',
  });
  assert.throws(
    () =>
      applyAction(booked, admin, {
        ...action,
        planningKey: planningKey(booked, leagueId),
      }),
    /venue booking/,
  );
});

test('test-family top-ups reach the requested total, extend old samples and preserve existing records', () => {
  const s = upgradeState(demoState());
  s.enrollments = s.enrollments.slice(0, 1);
  const league = s.leagues[0];
  const seed = {
    type: 'add-test-families',
    leagueName: league.name,
    year: league.year,
  };
  const sampled = applyAction(s, admin, seed);
  const filled = applyAction(sampled, admin, { ...seed, targetSize: 12 });
  for (const t of filled.teams.filter(
    (t) => t.leagueId === league.id && !t.withdrawnAt,
  )) {
    const count = new Set(
      filled.enrollments
        .filter(
          (e) =>
            e.teamId === t.id && ['approved', 'pending'].includes(e.status),
        )
        .map((e) => e.playerId),
    ).size;
    assert.equal(count, 12);
  }
  for (const key of ['players', 'members', 'enrollments', 'fixtures', 'teams'])
    assert.deepEqual(filled[key].slice(0, sampled[key].length), sampled[key]);
  const newPlayers = filled.players.slice(sampled.players.length);
  assert.ok(newPlayers.length > 0);
  assert.ok(
    newPlayers.every(
      (p) =>
        p.name.endsWith('(Test)') &&
        !p.name.includes('undefined') &&
        Number.isFinite(Date.parse(p.dob)),
    ),
  );
  assert.ok(
    filled.enrollments
      .slice(sampled.enrollments.length)
      .every((e) => e.status === 'approved'),
  );
  const repeated = applyAction(filled, admin, { ...seed, targetSize: 12 });
  for (const key of ['players', 'members', 'enrollments', 'availability'])
    assert.deepEqual(repeated[key], filled[key]);
  const smaller = applyAction(filled, admin, { ...seed, targetSize: 6 });
  assert.deepEqual(smaller.players, filled.players);
  assert.throws(
    () => applyAction(s, admin, { ...seed, targetSize: 13 }),
    /test squad target/,
  );
});

test('parent overview prioritises saved selections and hides all past, completed and cancelled fixtures', () => {
  const { s, f, team } = planningState();
  const child = s.players.find((p) => rosterEligible(s, p.id, team.id));
  const event = (id, date, status, selected = false) => ({
    f: {
      ...f,
      id,
      date,
      status,
      pairs: selected
        ? [{ id: 'pair', teamId: team.id, players: [child.id], slotId: '' }]
        : [],
    },
    kids: [child],
    published: true,
  });
  const events = [
    event('old-live', '2026-09-15', 'live', true),
    event('old-scheduled', '2026-09-15', 'scheduled', true),
    event('selected', '2026-09-18', 'scheduled', true),
    event('availability', '2026-09-17', 'scheduled'),
    event('done', '2026-09-16', 'completed', true),
    event('cancelled', '2026-09-19', 'cancelled', true),
    event('today', '2026-09-16', 'live', true),
  ];
  const result = parentFixtureSections(events, '2026-09-16');
  assert.deepEqual(
    result.selected.map((e) => e.f.id),
    ['selected'],
  );
  assert.deepEqual(
    result.other.map((e) => e.f.id),
    ['availability'],
  );
  assert.deepEqual(
    result.live.map((e) => e.f.id),
    ['today'],
  );
  assert.deepEqual(
    result.upcoming.map((e) => e.f.id),
    ['availability', 'selected'],
  );
});

test('published match-day scorecards take priority without needing a manual start', async () => {
  const { parentShowsScorecard } = await import(
    pathToFileURL(path.join(output, 'parent-fixtures.mjs'))
  );
  const { s, f, team } = planningState();
  const child = s.players.find((p) => rosterEligible(s, p.id, team.id));
  const event = (
    id,
    date,
    selected = true,
    published = true,
    status = 'scheduled',
  ) => ({
    f: {
      ...f,
      id,
      date,
      status,
      pairs: selected
        ? [{ id: 'pair', teamId: team.id, players: [child.id], slotId: '' }]
        : [],
    },
    kids: [child],
    published,
  });
  const today = event('ashbourne', '2026-09-19');
  const later = event('later', '2026-09-26');
  const notSelected = event('unselected', '2026-09-19', false);
  const draft = event('unpublished', '2026-09-19', true, false);
  const list = [
    later,
    today,
    notSelected,
    draft,
    event('cancelled', '2026-09-19', true, true, 'cancelled'),
  ];
  assert.equal(parentShowsScorecard(today, '2026-09-18'), false);
  assert.equal(parentShowsScorecard(today, '2026-09-19'), true);
  assert.equal(parentShowsScorecard(notSelected, '2026-09-19'), false);
  assert.equal(parentShowsScorecard(draft, '2026-09-19'), false);
  const result = parentFixtureSections(list, '2026-09-19');
  assert.deepEqual(
    result.matchday.map((e) => e.f.id),
    ['ashbourne'],
  );
  assert.ok(result.upcoming.every((e) => e.f.id !== 'ashbourne'));
  assert.ok(result.selected.includes(later));
  assert.ok(result.other.includes(notSelected));
  const liveWithoutSelection = {
    ...notSelected,
    f: { ...notSelected.f, status: 'live' },
  };
  const unselectedSections = parentFixtureSections(
    [liveWithoutSelection],
    '2026-09-19',
  );
  assert.deepEqual(unselectedSections.matchday, []);
  assert.deepEqual(unselectedSections.other, [liveWithoutSelection]);
  assert.equal(
    parentShowsScorecard(today, '2026-09-20'),
    true,
    'A direct link still permits late score entry',
  );
  assert.deepEqual(parentFixtureSections(list, '2026-09-20').matchday, []);
  assert.equal(
    today.f.status,
    'scheduled',
    'Viewing a simulated date must not start a real fixture',
  );
});

test('scoring opens automatically by London date and the first valid score starts the fixture', () => {
  const s = upgradeState(demoState());
  const f = s.fixtures.find((v) => v.id === scoreAction.fixtureId);
  f.status = 'scheduled';
  f.date = '2026-09-19';
  s.leagues.find((l) => l.id === f.leagueId).fixturesConfirmedAt =
    '2026-09-01T12:00:00Z';
  delete s.demoToday;
  assert.equal(fixtureScoringOpen(s, f, '2026-09-18'), false);
  assert.equal(fixtureScoringOpen(s, f, '2026-09-19'), true);
  assert.throws(
    () =>
      applyAction(
        s,
        parent(),
        { ...scoreAction, pairId: 'pair-3-1-0' },
        '2026-09-19T12:00:00Z',
      ),
    /assigned parents|permission|score this/i,
  );
  assert.equal(
    f.status,
    'scheduled',
    'Unauthorised scoring must not start play',
  );
  assert.throws(
    () =>
      applyAction(
        s,
        parent(),
        { ...scoreAction, today: '2026-09-19', demoToday: '2026-09-19' },
        '2026-09-18T12:00:00Z',
      ),
    /Scoring opens/,
  );
  // 23:30 UTC is already 19 September in the UK's summer time.
  const next = applyAction(s, parent(), scoreAction, '2026-09-18T23:30:00Z');
  const changed = next.fixtures.find((v) => v.id === f.id);
  assert.equal(changed.status, 'live');
  assert.equal(
    changed.scores[`${scoreAction.pairId}:1`].strokes,
    scoreAction.strokes,
  );
  assert.equal(f.status, 'scheduled');
  const preview = applyAction(
    s,
    parent(),
    scoreAction,
    '2026-09-17T12:00:00Z',
    '2026-09-19',
  );
  assert.equal(preview.fixtures.find((v) => v.id === f.id).status, 'live');
  assert.equal(
    preview.demoToday,
    undefined,
    'A trusted viewing date must not become shared workspace data',
  );
  assert.equal(
    preview.fixtures.find((v) => v.id === f.id).scores[
      `${scoreAction.pairId}:1`
    ].at,
    '2026-09-17T12:00:00Z',
  );
  assert.throws(
    () =>
      applyAction(
        s,
        parent(),
        { ...scoreAction, expectedVersion: 999 },
        '2026-09-19T12:00:00Z',
      ),
    /Another scorer/,
  );
  assert.equal(f.status, 'scheduled');
  for (const status of ['completed', 'cancelled']) {
    f.status = status;
    assert.equal(fixtureScoringOpen(s, f, '2026-09-19'), false);
    assert.throws(
      () => applyAction(s, parent(), scoreAction, '2026-09-19T12:00:00Z'),
      /Scoring opens/,
    );
  }
  f.status = 'scheduled';
  delete s.leagues.find((l) => l.id === f.leagueId).fixturesConfirmedAt;
  assert.throws(
    () => applyAction(s, parent(), scoreAction, '2026-09-19T12:00:00Z'),
    /Scoring opens/,
  );
});

test('selected child withdrawal alerts their own club organiser rather than the unrelated fixture host', () => {
  let s = upgradeState(demoState());
  const f = s.fixtures.find((f) => f.id === 'fixture-3');
  f.status = 'scheduled';
  const pair = f.pairs[0],
    pid = pair.players[0],
    team = s.teams.find((t) => t.id === pair.teamId);
  const child = s.players.find((p) => p.id === pid),
    parent = s.members.find((m) => m.id === child.parentId);
  s.members.push({
    id: 'own-club-manager',
    name: 'Own club',
    email: 'own@example.invalid',
    role: 'organiser',
    orgIds: [team.orgId],
    leagueIds: [],
  });
  s.members.push({
    id: 'other-host-manager',
    name: 'Host',
    email: 'host@example.invalid',
    role: 'organiser',
    orgIds: ['different-host-org'],
    leagueIds: [],
  });
  s.clubs.push({
    id: 'different-host',
    orgId: 'different-host-org',
    name: 'Host club',
    address: '',
    instructions: 'Meet at the clubhouse',
    welfareName: '',
    welfareEmail: '',
    safeGolf: false,
  });
  f.clubId = 'different-host';
  s.enrollments = s.enrollments.filter((e) => e.playerId !== pid);
  s.enrollments.push({
    id: 'approved-child',
    playerId: pid,
    teamId: team.id,
    status: 'approved',
    requestedAt: '',
  });
  s.notifications = [];
  const updated = applyAction(s, parent, {
    type: 'availability',
    fixtureId: f.id,
    playerId: pid,
    status: 'no',
  });
  assert.ok(
    updated.notifications.some(
      (n) =>
        n.recipient === 'own-club-manager' &&
        n.fixtureId === f.id &&
        n.text.includes('replacement'),
    ),
  );
  assert.ok(
    !updated.notifications.some((n) => n.recipient === 'other-host-manager'),
  );
  assert.ok(
    !updated.fixtures
      .find((x) => x.id === f.id)
      .pairs.some((p) => p.players.includes(pid)),
  );
});

test('host allocates every visiting pair, visitors cannot alter starts, and tee times retain their holes', () => {
  const s = demoState();
  const f = s.fixtures.find((f) => f.id === 'fixture-4');
  const hostOrg = s.clubs.find((c) => c.id === f.clubId).orgId;
  const host = { ...organiser(), id: 'hosting-organiser', orgIds: [hostOrg] };
  const visiting = {
    ...organiser(),
    orgIds: [s.orgs.find((o) => o.id !== hostOrg).id],
  };
  const action = {
    type: 'slots',
    fixtureId: f.id,
    slots: [
      {
        id: 'slot-test',
        label: '14:10 · Hole 3',
        startTime: '14:10',
        startHole: 3,
        capacity: 2,
      },
    ],
    assignments: {},
  };
  assert.equal(canHost(s, host, f), true);
  assert.equal(canHost(s, visiting, f), false);
  assert.throws(
    () => applyAction(s, visiting, action),
    /permission|authoris|access/i,
  );
  for (const member of [host, admin]) {
    const next = applyAction(s, member, action);
    assert.equal(
      next.fixtures.find((x) => x.id === f.id).slots[0].startHole,
      3,
    );
    assert.equal(
      next.fixtures.find((x) => x.id === f.id).slots[0].startTime,
      '14:10',
    );
  }
  assert.throws(() =>
    applyAction(s, host, {
      ...action,
      slots: [{ ...action.slots[0], startHole: 0 }],
    }),
  );
  assert.throws(() =>
    applyAction(s, host, {
      ...action,
      slots: [{ ...action.slots[0], startTime: '27:99' }],
    }),
  );
});

test('invitation rights allow Foundation admins all roles and organisers only their own clubs', () => {
  const s = demoState();
  const base = {
    type: 'invite',
    email: 'new@example.com',
    hash: 'invitation-hash',
    orgIds: ['org-0'],
    leagueIds: ['surrey'],
  };
  for (const role of ['admin', 'league-admin', 'organiser', 'parent'])
    assert.ok(
      applyAction(s, admin, { ...base, role }).invites.some(
        (i) => i.role === role && i.email === base.email,
      ),
    );
  for (const role of ['organiser', 'parent'])
    assert.ok(
      applyAction(s, organiser(), { ...base, role }).invites.some(
        (i) => i.role === role && i.email === base.email,
      ),
    );
  assert.throws(() => applyAction(s, organiser(), { ...base, role: 'admin' }));
  assert.throws(() =>
    applyAction(s, organiser(), {
      ...base,
      role: 'organiser',
      orgIds: ['org-1'],
    }),
  );
  assert.throws(() =>
    applyAction(
      s,
      { ...organiser(), role: 'parent' },
      { ...base, role: 'parent' },
    ),
  );
});
test('host conversations include the home organiser without exposing private team conversations', () => {
  let { s, f, team } = planningState();
  const parent = {
    ...admin,
    id: 'parent-0',
    role: 'parent',
    orgIds: [team.orgId],
  };
  const manager = s.members.find((m) => m.role === 'organiser');
  const hostOrg = s.orgs.find((o) => o.id !== team.orgId);
  const hostClub = s.clubs.find((c) => c.orgId === hostOrg.id);
  s.fixtures[0].clubId = hostClub.id;
  const host = { ...manager, id: 'fixture-host', orgIds: [hostOrg.id] };
  const outsider = { ...manager, id: 'outsider', orgIds: ['no-access'] };
  s.members.push(parent, host, outsider);
  const action = {
    type: 'fixture-message',
    fixtureId: f.id,
    teamId: team.id,
    playerId: 'plan-0',
    text: 'Where should we park?',
  };
  s = applyAction(s, parent, {
    ...action,
    text: 'Private question for our team.',
  });
  assert.equal(projectState(s, host).fixtureMessages.length, 0);
  const before = structuredClone(s);
  s = applyAction(s, parent, { ...action, audience: 'host' });
  assert.equal(projectState(s, host).fixtureMessages.length, 1);
  assert.equal(projectState(s, manager).fixtureMessages.length, 2);
  assert.equal(projectState(s, outsider).fixtureMessages.length, 0);
  assert.equal(
    projectState(s, { ...parent, id: 'parent-1' }).fixtureMessages.length,
    0,
  );
  const notifications = s.notifications.filter(
    (n) => !before.notifications.some((old) => old.id === n.id),
  );
  assert.ok(notifications.some((n) => n.recipient === host.id));
  assert.ok(notifications.some((n) => n.recipient === manager.id));
  assert.equal(
    notifications.filter((n) => n.recipient === manager.id).length,
    1,
  );
  assert.throws(() => applyAction(s, host, action), /permission/);
  assert.throws(
    () => applyAction(s, outsider, { ...action, audience: 'host' }),
    /permission/,
  );
  assert.throws(
    () =>
      applyAction(
        s,
        { ...parent, id: 'parent-1' },
        { ...action, audience: 'host' },
      ),
    /permission/,
  );
  assert.throws(
    () => applyAction(s, parent, { ...action, audience: 'everyone' }),
    /Choose/,
  );
  const beforeReply = structuredClone(s);
  s = applyAction(s, host, {
    ...action,
    audience: 'host',
    text: 'Use the main clubhouse car park.',
  });
  const replies = s.notifications.filter(
    (n) => !beforeReply.notifications.some((old) => old.id === n.id),
  );
  assert.ok(replies.some((n) => n.recipient === parent.id));
  assert.ok(replies.some((n) => n.recipient === manager.id));
  assert.ok(!replies.some((n) => n.recipient === host.id));
  assert.equal(projectState(s, parent).fixtureMessages.length, 3);
});
