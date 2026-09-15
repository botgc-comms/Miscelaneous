import test from 'node:test';
import assert from 'node:assert/strict';
const origin = 'http://localhost:3000';
test('league map API requires admin access and returns only club/league geography', async () => {
  assert.equal((await fetch(origin + '/api/league-map?year=2027')).status, 401);
  const signin = await fetch(origin + '/signin-with-chatgpt?return_to=/', {
    redirect: 'manual',
  });
  const cookie = signin.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const call = (path) => fetch(origin + path, { headers: { Cookie: cookie } });
  const staff = await (await call('/api/workspace?view=admin')).json();
  const query = `workspace=${encodeURIComponent(staff.workspace)}&year=2027&scope=all`;
  assert.equal(
    (await call(`/api/league-map?${query}&view=parent`)).status,
    403,
  );
  assert.equal(
    (await call(`/api/league-map?${query}&view=organiser`)).status,
    403,
  );
  assert.equal(
    (
      await call(
        `/api/league-map?workspace=${encodeURIComponent(staff.workspace)}&year=bad&view=admin`,
      )
    ).status,
    400,
  );
  const response = await call(`/api/league-map?${query}&view=admin`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), [
    'clubs',
    'leagues',
    'lookupUnavailable',
  ]);
  assert.ok(body.leagues.every((l) => l.year === 2027));
  assert.ok(body.clubs.every((c) => !('players' in c) && !('members' in c)));
});
