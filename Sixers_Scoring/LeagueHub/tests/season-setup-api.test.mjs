import test from 'node:test';
import assert from 'node:assert/strict';

const origin = 'http://localhost:3000';
const signin = await fetch(origin + '/signin-with-chatgpt?return_to=/', {
  redirect: 'manual',
});
const cookie = signin.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie, 'Local development sign-in is required');
async function post(path, body, headers = {}) {
  const response = await fetch(origin + path, {
    method: 'POST',
    headers: {
      cookie,
      Origin: origin,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let bodyResult;
  try {
    bodyResult = JSON.parse(text);
  } catch {
    bodyResult = { error: text };
  }
  return { status: response.status, body: bodyResult };
}

test('season setup previews on the server, creates only after review, and protects parent invitation sending', async () => {
  const created = await post('/api/workspace', {
    action: { type: 'create-workspace', name: 'Season setup API test' },
  });
  assert.equal(created.status, 200);
  const workspace = created.body.workspace;
  const act = (action, view = 'admin') =>
    post('/api/workspace', { workspace, view, action });
  let result = await act({
    type: 'league-import',
    rows: ['North', 'South'].map((club) => ({
      league: 'Setup test',
      year: 2027,
      club,
      team: club,
    })),
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const { leagues, clubs, teams } = result.body.state;
  const leagueId = leagues[0].id;
  const dates = ['2027-04-04', '2027-04-18', '2027-05-02', '2027-05-16'];
  for (const club of clubs) {
    result = await act({
      type: 'hosting-offer',
      clubId: club.id,
      leagueId,
      capacity: 2,
      dates,
      shotgun: 'yes',
      presentation: 'yes',
      food: 'no',
      notes: '',
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.state.fixtures.length, 0);
  }
  const planning = {
    type: 'fixture-planning',
    leagueId,
    count: 4,
    start: dates[0],
    end: dates.at(-1),
    minGap: 7,
  };
  assert.equal((await act(planning, 'parent')).status, 403);
  result = await act(planning);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.fixtureProposal.complete, true);
  assert.equal(result.body.fixtureProposal.fixtures.length, 4);
  assert.equal(result.body.state.fixtures.length, 0);
  const refresh = {
    type: 'fixture-plan-suggest',
    leagueId,
    planningKey: result.body.fixtureProposal.key,
    variant: 1,
    previous: result.body.fixtureProposal.fixtures,
  };
  assert.equal((await act(refresh, 'parent')).status, 403);
  const alternative = await act(refresh);
  assert.equal(alternative.status, 200, JSON.stringify(alternative.body));
  assert.equal(alternative.body.state.fixtures.length, 0);
  assert.deepEqual(alternative.body.state.leagues, result.body.state.leagues);
  assert.equal((await act({ ...refresh, planningKey: 'old' })).status, 409);
  const selected = alternative.body.fixtureProposal.fixtures.slice(0, 2);
  const apply = {
    type: 'fixture-plan-apply',
    leagueId,
    planningKey: result.body.fixtureProposal.key,
    arrival: '13:30',
    start: '14:00',
    fixtures: selected,
  };
  const saved = await act(apply);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(
    saved.body.state.fixtures.map(({ clubId, date }) => ({ clubId, date })),
    selected,
  );
  assert.equal((await act(apply)).status, 409);
  const confirmation = { type: 'fixtures-confirm', leagueId };
  assert.equal((await act(confirmation, 'parent')).status, 403);
  const published = await act(confirmation);
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.ok(
    published.body.state.leagues.find((l) => l.id === leagueId)
      .fixturesConfirmedAt,
  );
  assert.equal(published.body.state.teams[0].enrollmentOpen, true);
  const repeat = await act(confirmation);
  assert.equal(
    repeat.body.state.leagues.find((l) => l.id === leagueId)
      .fixturesConfirmedAt,
    published.body.state.leagues.find((l) => l.id === leagueId)
      .fixturesConfirmedAt,
  );
  const invitation = {
    workspace,
    view: 'admin',
    teamId: teams[0].id,
    email: 'test@example.com',
  };
  assert.equal(
    (
      await post('/api/parent-invitation', invitation, {
        Origin: 'https://untrusted.example',
      })
    ).status,
    403,
  );
  assert.equal(
    (await post('/api/parent-invitation', { ...invitation, view: 'parent' }))
      .status,
    403,
  );
  assert.equal(
    (await post('/api/parent-invitation', { ...invitation, email: 'invalid' }))
      .status,
    400,
  );
  const closed = await act({
    type: 'team-directory',
    teamId: teams[0].id,
    open: false,
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal((await post('/api/parent-invitation', invitation)).status, 400);
});
