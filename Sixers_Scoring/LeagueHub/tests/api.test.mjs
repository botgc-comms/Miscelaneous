import test from 'node:test';
import assert from 'node:assert/strict';
const origin = 'http://localhost:3000';
const signin = await fetch(origin + '/signin-with-chatgpt?return_to=/', {
  redirect: 'manual',
});
const cookie = signin.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie, 'Local sign-in must be available');

test('parents can request club login help before sign-in without exposing accounts or granting access', async () => {
  const staff = await call('/api/workspace?view=admin');
  const workspace = staff.body.workspace,
    club = staff.body.state.orgs[0];
  const directory = await fetch(
    origin + '/api/login-help?q=' + encodeURIComponent(club.name),
  );
  assert.equal(directory.status, 200);
  const choices = (await directory.json()).clubs;
  assert.ok(choices.some((c) => c.id === club.id && c.workspace === workspace));
  assert.deepEqual(Object.keys(choices[0]).sort(), ['id', 'name', 'workspace']);
  const phone = '077' + String(Date.now()).slice(-8),
    payload = {
      workspace,
      orgId: club.id,
      name: 'Login help integration parent',
      phone,
      email: 'new-contact@example.com',
      reason: 'forgot-email',
      consent: true,
    };
  const submit = (body) =>
    fetch(origin + '/api/login-help', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal((await submit({ ...payload, consent: false })).status, 400);
  const sent = await submit(payload);
  assert.equal(sent.status, 200, await sent.clone().text());
  assert.deepEqual(await sent.json(), { ok: true });
  assert.equal((await submit(payload)).status, 200);
  const saved = (
    await call('/api/workspace?workspace=' + workspace + '&view=admin')
  ).body.state;
  const requests = saved.loginHelpRequests.filter((r) => r.phone === phone);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].status, 'new');
  assert.equal(saved.members.length, staff.body.state.members.length);
  assert.equal(saved.players.length, staff.body.state.players.length);
  const parent = (
    await call('/api/workspace?workspace=' + workspace + '&view=parent')
  ).body.state;
  assert.equal(parent.loginHelpRequests.length, 0);
  assert.equal(
    (
      await call('/api/workspace', {
        workspace,
        view: 'parent',
        action: {
          type: 'login-help-status',
          id: requests[0].id,
          status: 'resolved',
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call('/api/workspace', {
        workspace,
        view: 'admin',
        action: {
          type: 'login-help-status',
          id: requests[0].id,
          status: 'resolved',
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(origin + '/api/login-help', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://other.example',
        },
        body: JSON.stringify(payload),
      })
    ).status,
    403,
  );
});

test('statistics aggregates saved seasons for Foundation admins without disclosing family records', async () => {
  const staff = await call('/api/workspace?view=admin');
  const workspace = staff.body.workspace;
  const year = staff.body.state.leagues[0].year;
  const path = `/api/statistics?workspace=${encodeURIComponent(workspace)}&years=${year}`;
  const report = await call(path + '&view=admin');
  assert.equal(report.status, 200, JSON.stringify(report.body));
  assert.equal(
    report.body.overall.counts.leagues,
    staff.body.state.leagues.filter((l) => l.year === year).length,
  );
  assert.equal(report.body.annual.length, 1);
  assert.equal(
    report.body.overall.gender.reduce((sum, g) => sum + g.count, 0),
    report.body.overall.counts.registered,
  );
  const privateKeys = new Set([
    'playerId',
    'parentId',
    'email',
    'phone',
    'dob',
    'care',
    'safeguarding',
    'medical',
    'members',
    'enrollments',
  ]);
  const inspect = (value) => {
    if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        assert.ok(!privateKeys.has(key), `Private field: ${key}`);
        inspect(child);
      }
  };
  inspect(report.body);
  assert.equal((await call(path + '&view=parent')).status, 403);
  assert.equal((await call(path + '&view=organiser')).status, 403);
  assert.equal((await fetch(origin + path)).status, 401);
  assert.equal(
    (
      await call(
        `/api/statistics?workspace=${encodeURIComponent(workspace)}&view=admin&years=wrong`,
      )
    ).status,
    400,
  );
});

test('club course photos persist in storage, are shared with signed-in parents and restrict editing', async () => {
  const staff = await call('/api/workspace?view=admin'),
    workspace = staff.body.workspace;
  const club = staff.body.state.clubs[0];
  const form = new FormData();
  form.set('workspace', workspace);
  form.set('view', 'admin');
  form.set('clubId', club.id);
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  form.set('photo', new Blob([png], { type: 'image/png' }), 'course.png');
  let r = await fetch(origin + '/api/club-image', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
  assert.equal(r.status, 200, await r.clone().text());
  let state = (await call('/api/workspace?view=admin')).body.state;
  assert.equal(state.clubs.find((c) => c.id === club.id).imageStatus, 'manual');
  const path = `/api/club-image?workspace=${encodeURIComponent(workspace)}&clubId=${club.id}`;
  r = await fetch(origin + path, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal((await r.arrayBuffer()).byteLength, png.length);
  assert.equal((await fetch(origin + path)).status, 401);
  const forged = await call('/api/workspace', {
    workspace,
    view: 'admin',
    action: { type: 'club-image-set', clubId: club.id, imageKey: 'other-file' },
  });
  assert.equal(forged.status, 400);
  const denied = await call('/api/workspace', {
    workspace,
    view: 'parent',
    action: { type: 'club-image-clear', clubId: club.id },
  });
  assert.equal(denied.status, 403);
  const removed = await call('/api/workspace', {
    workspace,
    view: 'admin',
    action: { type: 'club-image-clear', clubId: club.id },
  });
  assert.equal(removed.status, 200);
  assert.equal(
    (await fetch(origin + path, { headers: { Cookie: cookie } })).status,
    404,
  );
});

test('spreadsheet import, closed entry codes and team replacement use the shared database', async () => {
  const staff = await call('/api/workspace?view=admin'),
    workspace = staff.body.workspace;
  const league = `Import integration ${Date.now()}`;
  const act = (action) =>
    call('/api/workspace', { workspace, view: 'admin', action });
  let r = await act({
    type: 'league-import',
    rows: [
      {
        league,
        year: 2029,
        club: 'Integration import club',
        team: 'Import Green',
      },
      {
        league,
        year: 2029,
        club: 'Integration import club',
        team: 'Import Blue',
      },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const current = (await call('/api/workspace?view=admin')).body.state;
  const l = current.leagues.find((l) => l.name === league),
    teams = current.teams.filter((t) => t.leagueId === l.id),
    team = teams[0];
  assert.equal(l.tiePolicy, 'countback');
  assert.deepEqual(
    teams.map((t) => t.cap),
    ['Green', 'Blue'],
  );
  let directory = (await call('/api/parent')).body.directory;
  assert.ok(directory.some((d) => d.team.id === team.id));
  const issued = await call('/api/team-code', {
    workspace,
    view: 'admin',
    teamId: team.id,
  });
  assert.equal(issued.status, 200);
  r = await act({ type: 'team-directory', teamId: team.id, open: false });
  assert.equal(r.status, 200);
  directory = (await call('/api/parent')).body.directory;
  assert.ok(!directory.some((d) => d.team.id === team.id));
  const lookup = await call(`/api/team-code?code=${issued.body.code}`);
  assert.equal(lookup.status, 400);
  assert.match(lookup.body.error, /closed/);
  r = await act({ type: 'team-directory', teamId: team.id, open: true });
  assert.equal(r.status, 200);
  assert.ok(
    (await call('/api/parent')).body.directory.some(
      (d) => d.team.id === team.id,
    ),
  );
  r = await act({
    type: 'team-replace',
    teamId: team.id,
    orgId: team.orgId,
    name: 'Replacement Green',
  });
  assert.equal(r.status, 200);
  directory = (await call('/api/parent')).body.directory;
  assert.ok(!directory.some((d) => d.team.id === team.id));
  assert.ok(
    directory.some(
      (d) =>
        d.league.id === l.id &&
        d.team.name === 'Replacement Green' &&
        d.team.cap === 'Green',
    ),
  );
});
test('shared parent directory matches staff teams, including a full six-team league', async () => {
  const staff = await call('/api/workspace?view=admin');
  assert.equal(staff.status, 200);
  const state = staff.body.state;
  const expected = state.teams.filter((t) => {
    const l = state.leagues.find((l) => l.id === t.leagueId);
    return (
      !t.withdrawnAt &&
      t.enrollmentOpen !== false &&
      l &&
      (l.registrationOpen ?? l.year >= new Date().getFullYear())
    );
  });
  const parent = await call('/api/parent?demo=1&stage=league');
  assert.equal(parent.status, 200);
  assert.equal(parent.body.seasons[0].workspace, staff.body.workspace);
  assert.deepEqual(
    parent.body.directory
      .filter((d) => d.workspace === staff.body.workspace)
      .map((d) => d.team.id)
      .sort(),
    expected.map((t) => t.id).sort(),
  );
  for (const entry of parent.body.directory.filter(
    (d) => d.workspace === staff.body.workspace,
  ))
    assert.equal(
      entry.team.name,
      state.teams.find((t) => t.id === entry.team.id).name,
    );
  const full = state.leagues.find(
    (l) => expected.filter((t) => t.leagueId === l.id).length === 6,
  );
  assert.ok(full, 'A full league must remain available for parent enrolment');
  const rejected = await call('/api/workspace', {
    workspace: staff.body.workspace,
    view: 'admin',
    action: {
      type: 'team',
      leagueId: full.id,
      orgId: state.orgs[0].id,
      name: 'Seventh team',
      color: '#abcdef',
      cap: 'Extra',
    },
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /maximum of six teams/);
});
async function call(path, body, headers = {}) {
  const r = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Cookie: cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: r.status,
    body: r.headers.get('content-type')?.includes('json')
      ? await r.json()
      : await r.text(),
  };
}
test('API rejects anonymous reads and forged identity headers', async () => {
  const r = await fetch(origin + '/api/workspace', {
    headers: {
      'oai-authenticated-user-id': 'local_seedy',
      'oai-authenticated-user-email': 'seedy@sites.test',
    },
  });
  assert.equal(r.status, 401);
});
test('staff uses ordinary records and parent projection is private', async () => {
  const a = await call('/api/workspace');
  assert.equal(a.status, 200);
  assert.ok(a.body.state.leagues.some((l) => l.id === 'surrey'));
  const p = await call('/api/workspace?view=parent');
  assert.equal(p.status, 200);
  assert.equal(p.body.me.role, 'parent');
  assert.equal(a.body.demo, false);
  assert.ok(
    p.body.state.players
      .filter((p) => p.dob)
      .every((child) => child.parentId === p.body.me.id),
  );
});
test('API enforces role permissions, score persistence and optimistic concurrency', async () => {
  const initial = await call('/api/workspace?view=admin');
  const f = initial.body.state.fixtures.find((f) => f.id === 'fixture-3');
  const key = 'pair-3-0-0:1';
  const original = f.scores[key];
  const action = {
    type: 'score',
    fixtureId: f.id,
    pairId: 'pair-3-0-0',
    hole: 1,
    strokes: 4,
    expectedVersion: original.version,
  };
  const first = await call('/api/workspace', { view: 'admin', action });
  assert.equal(first.status, 200);
  const clash = await call('/api/workspace', { view: 'admin', action });
  assert.equal(clash.status, 409);
  const read = await call('/api/workspace?view=admin');
  const persisted = read.body.state.fixtures.find((f) => f.id === 'fixture-3')
    .scores[key];
  assert.equal(persisted.strokes, 4);
  assert.equal(persisted.version, original.version + 1);
  const restore = await call('/api/workspace', {
    view: 'admin',
    action: {
      ...action,
      strokes: original.strokes,
      expectedVersion: persisted.version,
    },
  });
  assert.equal(restore.status, 200);
  const forbidden = await call('/api/workspace', {
    view: 'parent',
    action: { type: 'organisation', name: 'Not allowed' },
  });
  assert.equal(forbidden.status, 403);
});
test('API rejects cross-site mutations', async () => {
  const r = await call(
    '/api/workspace',
    { action: { type: 'profile', name: 'Test', phone: '' } },
    { Origin: 'https://untrusted.example' },
  );
  assert.equal(r.status, 403);
});
test('private photos require authentication', async () => {
  const r = await fetch(
    origin + '/api/photo?workspace=demo-local_seedy&playerId=player-0-0',
  );
  assert.equal(r.status, 401);
});
test('invalid invitations and missing workspace return controlled errors', async () => {
  assert.equal((await call('/api/invite?token=invalid')).status, 404);
  assert.equal(
    (await call('/api/workspace?workspace=unknown-workspace')).status,
    404,
  );
});

test('parent accounts can register independently; child enrollment, codes and review persist', async () => {
  const auth = await call('/api/auth');
  assert.equal(auth.status, 200);
  assert.equal(auth.body.emailReady, false);
  const offline = await call('/api/auth', {
    type: 'start',
    email: `parent-${Date.now()}@example.test`,
    name: 'Parent',
  });
  assert.equal(offline.status, 503);
  let a = await call('/api/parent?demo=1&stage=new');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const childName = 'Journey test ' + Date.now();
  const child = {
    type: 'child',
    demo: true,
    stage: 'new',
    expectedRevision: a.body.revision,
    name: childName,
    dob: '2016-05-12',
    gender: 'girl',
    handicap: '',
    emergencyName: 'Test Parent',
    emergencyPhone: '07000000000',
    diet: 'Nut allergy',
    care: '',
    photoConsent: false,
    consent: true,
  };
  const saved = await call('/api/parent', child);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const p = saved.body.family.children.find((p) => p.name === childName);
  assert.ok(p);
  assert.equal(p.gender, 'girl');
  const stale = await call('/api/parent', child);
  assert.equal(stale.status, 409);
  const { workspace, team } = saved.body.directory[0];
  const code = await call('/api/team-code', {
    workspace,
    view: 'admin',
    teamId: team.id,
  });
  assert.equal(code.status, 200);
  assert.match(code.body.code, /^\d{6}$/);
  const found = await call('/api/team-code?code=' + code.body.code);
  assert.equal(found.body.team.id, team.id);
  const requested = await call('/api/parent', {
    type: 'request-team',
    demo: true,
    stage: 'new',
    workspace,
    teamId: team.id,
    playerId: p.id,
    code: code.body.code,
    preference: 'Please keep siblings together.',
    consent: true,
  });
  assert.equal(requested.status, 200, JSON.stringify(requested.body));
  const e = requested.body.seasons
    .find((s) => s.workspace === workspace)
    .state.enrollments.find((e) => e.playerId === p.id);
  assert.equal(e.status, 'pending');
  assert.equal(e.preference, 'Please keep siblings together.');
  const forbidden = await call('/api/workspace', {
    workspace,
    view: 'parent',
    action: { type: 'enrollment-decision', id: e.id, decision: 'approve' },
  });
  assert.equal(forbidden.status, 403);
  const approved = await call('/api/workspace', {
    workspace,
    view: 'admin',
    action: { type: 'enrollment-decision', id: e.id, decision: 'approve' },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.ok(
    approved.body.state.enrollments.find((v) => v.id === e.id).approvedAt,
  );
  const current = approved.body.state;
  const fixture = current.fixtures.find((f) => f.teamIds.includes(team.id));
  if (fixture) {
    const message = {
      type: 'fixture-message',
      fixtureId: fixture.id,
      teamId: team.id,
      playerId: p.id,
      text: 'Can we discuss the pairing?',
    };
    const sent = await call('/api/workspace', {
      workspace,
      view: 'parent',
      action: message,
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const reply = await call('/api/workspace', {
      workspace,
      view: 'admin',
      action: { ...message, text: 'Yes, I will review it.' },
    });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    const fresh = await call('/api/parent');
    const messages = fresh.body.seasons
      .find((s) => s.workspace === workspace)
      .state.fixtureMessages.filter(
        (m) => m.playerId === p.id && m.fixtureId === fixture.id,
      );
    assert.deepEqual(
      messages.map((m) => m.text),
      ['Can we discuss the pairing?', 'Yes, I will review it.'],
    );
  }
  a = await call('/api/parent?demo=1&stage=new');
  assert.equal(
    a.body.seasons[0].state.enrollments.find((v) => v.id === e.id).status,
    'approved',
  );
  const edit = await call('/api/parent', {
    ...child,
    id: p.id,
    expectedRevision: a.body.revision,
    name: childName + ' edited',
    care: 'Updated support note',
    gender: 'prefer-not-to-say',
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const snapshot = edit.body.seasons.find(
    (s) => s.workspace === workspace,
  ).state;
  assert.equal(
    snapshot.players.find((v) => v.id === p.id).care,
    'Updated support note',
  );
  assert.equal(snapshot.players.find((v) => v.id === p.id).name, childName);
  assert.equal(
    snapshot.players.find((v) => v.id === p.id).gender,
    'prefer-not-to-say',
  );
  const change = snapshot.profileChanges.find(
    (v) => v.playerId === p.id && v.status === 'pending',
  );
  assert.ok(change);
  const legacy = await call('/api/workspace', {
    workspace,
    view: 'parent',
    action: { ...child, type: 'player', id: p.id, orgId: team.orgId },
  });
  assert.equal(legacy.status, 403);
  const reviewed = await call('/api/workspace', {
    workspace,
    view: 'admin',
    action: { type: 'profile-review', id: change.id, decision: 'approve' },
  });
  assert.equal(reviewed.status, 200);
  assert.equal(
    reviewed.body.state.players.find((v) => v.id === p.id).name,
    childName + ' edited',
  );
  await call('/api/team-code', {
    workspace,
    view: 'admin',
    teamId: team.id,
    revoke: code.body.code,
  });
  const revoked = await call('/api/team-code?code=' + code.body.code);
  assert.equal(revoked.status, 404);
});

test('normal, demo=0 and every old example URL return the identical family and club directory', async () => {
  const base = await call('/api/parent?demo=0&stage=ready');
  assert.equal(base.status, 200);
  for (const suffix of [
    '',
    '?demo=1&stage=league',
    '?demo=1&stage=new',
    '?demo=1&stage=pending',
    '?demo=1&stage=ready',
    '?demo=1&stage=matchday',
    '?demo=1&stage=between',
  ]) {
    const r = await call('/api/parent' + suffix);
    assert.equal(r.status, 200);
    assert.equal(r.body.demo, false);
    assert.deepEqual(r.body.family.children, base.body.family.children);
    assert.deepEqual(r.body.clubs, base.body.clubs);
    assert.deepEqual(r.body.directory, base.body.directory);
  }
});

test('future league teams are automatically discoverable without codes and organisers see both leagues', async () => {
  let root = await call('/api/workspace');
  const workspace = root.body.workspace;
  const assignment = await call('/api/workspace', {
    workspace,
    view: 'organiser',
    action: { type: 'organiser-club', orgId: 'org-0' },
  });
  assert.equal(assignment.status, 200);
  assert.deepEqual(assignment.body.me.orgIds, ['org-0']);
  const unique = 'Setup ' + Date.now(),
    year = new Date().getFullYear() + 1;
  const leagues = [];
  for (const county of ['Staffordshire', 'Derbyshire']) {
    const r = await call('/api/workspace', {
      workspace,
      view: 'admin',
      action: {
        type: 'league',
        name: unique + ' ' + county,
        region: 'Midlands',
        year,
        holes: 6,
        pairs: 3,
        maxStrokes: 10,
        tiePolicy: 'average',
        registrationOpen: true,
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    leagues.push(
      r.body.state.leagues.find((l) => l.name === unique + ' ' + county),
    );
  }
  const teams = [];
  for (const l of leagues) {
    const r = await call('/api/workspace', {
      workspace,
      view: 'admin',
      action: {
        type: 'team',
        orgId: 'org-0',
        leagueId: l.id,
        name: unique + ' team',
        cap: 'Blue',
        color: '#123456',
      },
    });
    assert.equal(r.status, 200);
    teams.push(r.body.state.teams.find((t) => t.leagueId === l.id));
  }
  let family = await call('/api/parent?demo=1&stage=league');
  assert.equal(family.status, 200, JSON.stringify(family.body));
  assert.ok(
    teams.every((t) =>
      family.body.directory.some(
        (c) => c.team.id === t.id && c.league.year === year,
      ),
    ),
  );
  const child = family.body.family.children[0];
  const r = await call('/api/parent', {
    type: 'request-team',
    demo: true,
    stage: 'league',
    workspace,
    teamId: teams[0].id,
    playerId: child.id,
    consent: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const organiser = await call(
    '/api/workspace?workspace=' + workspace + '&view=organiser',
  );
  assert.deepEqual(
    organiser.body.state.orgs.map((o) => o.id),
    ['org-0'],
  );
  assert.ok(
    organiser.body.state.leagues.every((l) =>
      organiser.body.state.teams.some(
        (t) => t.leagueId === l.id && t.orgId === 'org-0',
      ),
    ),
  );
  assert.ok(
    organiser.body.state.enrollments.every((e) =>
      organiser.body.state.teams.some(
        (t) => t.id === e.teamId && t.orgId === 'org-0',
      ),
    ),
  );
  const deniedCodes = await call(
    '/api/team-code?workspace=' + workspace + '&view=organiser&teamId=team-1',
  );
  assert.equal(deniedCodes.status, 403);
  const deniedCreate = await call('/api/team-code', {
    workspace,
    view: 'organiser',
    teamId: 'team-1',
  });
  assert.equal(deniedCreate.status, 403);
  assert.ok(
    teams.every((t) => organiser.body.state.teams.some((v) => v.id === t.id)),
  );
  const registration = organiser.body.state.enrollments.find(
    (e) => e.teamId === teams[0].id && e.playerId === child.id,
  );
  assert.equal(registration.status, 'pending');
  const approved = await call('/api/workspace', {
    workspace,
    view: 'organiser',
    action: {
      type: 'enrollment-decision',
      id: registration.id,
      decision: 'approve',
    },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  await call('/api/workspace', {
    workspace,
    view: 'admin',
    action: { ...leagues[0], type: 'league', registrationOpen: false },
  });
  family = await call('/api/parent?demo=1&stage=league');
  assert.ok(!family.body.directory.some((c) => c.team.id === teams[0].id));
  assert.ok(family.body.directory.some((c) => c.team.id === teams[1].id));
  const closed = await call('/api/parent', {
    type: 'request-team',
    demo: true,
    stage: 'league',
    workspace,
    teamId: teams[0].id,
    playerId: family.body.family.children[1].id,
    consent: true,
  });
  assert.equal(closed.status, 400);
});

test('parents can find a registered home club before its teams are open, without receiving private club data', async () => {
  const initial = await call('/api/parent?demo=1&stage=league');
  const workspace = initial.body.seasons[0].workspace;
  const name = 'Home Club ' + Date.now();
  const created = await call('/api/workspace', {
    workspace,
    view: 'admin',
    action: {
      type: 'club-import',
      clubs: [
        {
          name,
          address: 'Private address not in directory',
          county: 'Staffordshire',
          postcode: 'DE15 0PS',
          instructions: 'Private venue notes',
        },
      ],
    },
  });
  assert.equal(created.status, 200);
  const saved = await call(
    `/api/workspace?workspace=${encodeURIComponent(workspace)}&view=admin`,
  );
  const venue = saved.body.state.clubs.find((c) => c.name === name);
  assert.equal(venue.county, 'Staffordshire');
  assert.equal(venue.postcode, 'DE15 0PS');
  const r = await call('/api/parent?demo=1&stage=league');
  assert.equal(r.status, 200);
  const club = r.body.clubs.find((c) => c.name === name);
  assert.ok(club);
  assert.deepEqual(Object.keys(club).sort(), [
    'id',
    'name',
    'venues',
    'workspace',
  ]);
  assert.ok(!r.body.directory.some((c) => c.organisation.id === club.id));
  assert.ok(r.body.clubs.some((c) => c.workspace === workspace));
});
