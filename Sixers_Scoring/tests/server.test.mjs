import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { blankCard } from '../server/scoring.mjs';
const dataPath = await mkdtemp(path.join(tmpdir(), 'sixes-integration-'));
async function boot() {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: '0',
      DATA_PATH: dataPath,
      APP_PASSWORD: 'integration-password-only',
      NODE_ENV: 'production',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Server did not start'));
    }, 10000);
    child.stdout.on('data', (d) => {
      output += d;
      const match = output.match(/http:\/\/localhost:\d+/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error('Server exited ' + code));
    });
  });
  return { child, url };
}
async function stop(child) {
  if (child.exitCode !== null) return;
  const exit = once(child, 'exit');
  child.kill();
  await exit;
}
test('API protects data, validates cards, persists edits and rejects stale writes', async () => {
  let { child, url } = await boot();
  let cookie = '';
  const req = async (endpoint, method = 'GET', data) => {
    const res = await fetch(url + endpoint, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    let body;
    try {
      body = await res.json();
    } catch {}
    return { res, body };
  };
  try {
    assert.equal((await req('/health')).res.status, 200);
    assert.equal((await req('/api/state')).res.status, 401);
    assert.equal((await req('/api/export')).res.status, 401);
    assert.equal(
      (await req('/api/login', 'POST', { password: 'wrong' })).res.status,
      401,
    );
    let login = await req('/api/login', 'POST', {
      password: 'integration-password-only',
    });
    assert.equal(login.res.status, 200);
    assert.match(
      login.res.headers.get('set-cookie'),
      /HttpOnly.*SameSite=Strict.*Secure/,
    );
    cookie = login.res.headers.get('set-cookie').split(';')[0];
    const c = blankCard(1);
    let result = await req('/api/cards/' + c.id, 'PUT', c);
    assert.equal(result.res.status, 200);
    let saved = result.body.card;
    assert.equal(saved.revision, 1);
    result = await req('/api/cards/' + c.id, 'PUT', {
      ...c,
      status: 'confirmed',
      reviewed: true,
      revision: 1,
    });
    assert.equal(result.res.status, 400);
    saved.pairs.forEach((p, i) => {
      p.club = ['Ashbourne', 'Ashbourne', 'Chevin'][i];
      p.colour = ['Orange', 'Black', 'Green'][i];
      p.pairNumber = null;
      p.writtenPoints = Array(6).fill(99);
      p.writtenTotal = 999;
      p.writtenStrokesTotal = 999;
      p.strokes = Array(6).fill(5);
    });
    saved.status = 'confirmed';
    saved.reviewed = false;
    result = await req('/api/cards/' + c.id, 'PUT', saved);
    assert.equal(result.res.status, 200);
    saved = result.body.card;
    let state = (await req('/api/state')).body;
    assert.equal(state.leaderboard[0].club, 'Ashbourne');
    assert.equal(state.leaderboard.length, 3);
    assert.ok(state.leaderboard.some((r) => r.team === 'Ashbourne Orange'));
    assert.ok(state.leaderboard.some((r) => r.team === 'Ashbourne Black'));
    assert.equal(state.leaderboard[0].points, 36);
    assert.equal(state.leaderboard[0].pairs, 1);
    assert.equal(
      (await req('/api/cards/' + c.id, 'PUT', { ...saved, revision: 1 })).res
        .status,
      409,
    );
    const other = blankCard(1);
    assert.equal(
      (await req('/api/cards/' + other.id, 'PUT', other)).res.status,
      409,
    );
    saved.pairs[0].strokes = Array(6).fill(1);
    result = await req('/api/cards/' + c.id, 'PUT', saved);
    assert.equal(result.res.status, 200);
    saved = result.body.card;
    assert.equal((await req('/api/state')).body.leaderboard[0].points, 60);
    const cross = await fetch(url + '/api/settings', {
      method: 'PUT',
      headers: {
        Origin: 'https://untrusted.example',
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(cross.status, 403);
    const leagueSettings = (await req('/api/state')).body.settings;
    const leagueBody = {
      revision: leagueSettings.revision,
      entries: [
        { club: 'Ashbourne', colour: 'Orange', startingPoints: 10.5 },
        { club: 'Ashbourne', colour: 'Black', startingPoints: 20 },
        { club: 'Chevin', colour: 'Green', startingPoints: 30 },
      ],
    };
    assert.equal((await req('/api/league', 'PUT', leagueBody)).res.status, 200);
    assert.equal((await req('/api/league', 'PUT', leagueBody)).res.status, 409);
    assert.equal(
      (await req('/api/state')).body.league.rows.find(
        (r) => r.colour === 'Orange',
      ).total,
      16.5,
    );
    await stop(child);
    ({ child, url } = await boot());
    state = (await req('/api/state')).body;
    assert.equal(state.cards.length, 1);
    assert.equal(state.settings.leagueStandings.length, 3);
    assert.equal(
      state.league.rows.find((r) => r.colour === 'Orange').total,
      16.5,
    );
    assert.equal(state.leaderboard[0].points, 60);
    saved.status = 'draft';
    assert.equal(
      (await req('/api/cards/' + c.id, 'PUT', saved)).res.status,
      200,
    );
    assert.equal((await req('/api/state')).body.leaderboard[0].points, 0);
    const backup = (await req('/api/export')).body;
    assert.equal(backup.cards.length, 1);
    assert.equal(backup.history.length, 4);
  } finally {
    await stop(child);
  }
});
