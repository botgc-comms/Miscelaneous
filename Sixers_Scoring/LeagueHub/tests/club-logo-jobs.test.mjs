import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { readFile, writeFile } from 'node:fs/promises';
const source = ts
  .transpileModule(await readFile('lib/club-logo-jobs.ts', 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replace(
    /from '\.\/(.*?)'/g,
    (_, n) =>
      `from './${n === 'server' ? 'logo-test-server' : n === 'assistant-provider' ? 'logo-test-provider' : n === 'club-images' ? 'logo-test-images' : n}.mjs'`,
  );
await writeFile('work/tests/club-logo-jobs.mjs', source);
await writeFile(
  'work/tests/logo-test-server.mjs',
  `export const db=()=>globalThis.logoDB;export const files=()=>globalThis.logoFiles;`,
);
await writeFile(
  'work/tests/logo-test-provider.mjs',
  `export const assistantConnected=()=>true;export const responseRequest=(...a)=>globalThis.logoResponse(...a);`,
);
await writeFile(
  'work/tests/logo-test-images.mjs',
  `export {boundedBody,imageType} from './club-images.mjs';export const fetchPublic=(...a)=>globalThis.logoFetch(...a);`,
);
const { queueLogos, processLogos, updateLogo, logoRows } =
  await import('../work/tests/club-logo-jobs.mjs');
const sql = new DatabaseSync(':memory:');
sql.exec(await readFile('drizzle/0003_striped_bloodscream.sql', 'utf8'));
const stmt = (q, v = []) => ({
  bind: (...a) => stmt(q, a),
  first: async () => sql.prepare(q).get(...v) || null,
  all: async () => ({ results: sql.prepare(q).all(...v) }),
  run: async () => ({
    meta: { changes: Number(sql.prepare(q).run(...v).changes) },
  }),
});
globalThis.logoDB = { prepare: stmt };
const blobs = new Map();
globalThis.logoFiles = {
  put: async (k, v) => blobs.set(k, v),
  get: async (k) =>
    blobs.has(k)
      ? { arrayBuffer: async () => new Uint8Array(blobs.get(k)).buffer }
      : null,
};
const club = {
  id: 'club',
  name: 'Example Golf Club',
  website: 'https://club.co.uk/',
};
const row = async () => JSON.parse((await logoRows('w'))[0].data);
const age = () =>
  sql.prepare("UPDATE club_logos SET data=json_set(data,'$.updated',0)").run();
test('logo selection and cleanup are durable and use separate storage from the workspace', async () => {
  sql.exec('DELETE FROM club_logos');
  let calls = 0;
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  globalThis.logoFetch = async (url) => ({
    url,
    response: new Response(
      url.endsWith('logo.png') ? png : '<img src="/logo.png" alt="Club logo">',
    ),
  });
  globalThis.logoResponse = async (path, body) => {
    calls++;
    if (body) return { id: calls === 1 ? 'select' : 'clean' };
    return path === '/select'
      ? {
          status: 'completed',
          output: [{ content: [{ type: 'output_text', text: '{"index":0}' }] }],
        }
      : {
          status: 'completed',
          output: [
            {
              type: 'image_generation_call',
              result: Buffer.from(png).toString('base64'),
            },
          ],
        };
  };
  await processLogos('w', [club]);
  assert.equal((await row()).status, 'identifying');
  age();
  await processLogos('w', [club]);
  assert.equal((await row()).status, 'cleaning');
  assert.ok((await row()).original);
  age();
  await processLogos('w', [club]);
  assert.equal((await row()).status, 'ready');
  assert.notEqual((await row()).key, (await row()).original);
  assert.equal(calls, 4);
});
test('manual removal is retained across subsequent queue scans', async () => {
  await updateLogo('w', club, { status: 'none', key: undefined });
  await queueLogos('w', [club]);
  await processLogos('w', [club]);
  assert.equal((await row()).status, 'none');
  assert.equal((await row()).key, undefined);
});
test('changed website queues a new job and discards stale logo association', async () => {
  await queueLogos('w', [{ ...club, website: 'https://newclub.co.uk/' }]);
  assert.equal((await row()).status, 'queued');
  assert.equal((await row()).key, undefined);
});
test('an upload during a running job wins over the background result', async () => {
  sql.exec('DELETE FROM club_logos');
  await queueLogos('w', [club]);
  globalThis.logoResponse = async () => {
    await updateLogo('w', club, { status: 'manual', key: 'manual-image' });
    return { id: 'obsolete-response' };
  };
  await processLogos('w', [club]);
  assert.equal((await row()).status, 'manual');
  assert.equal((await row()).key, 'manual-image');
});
test('failed cleanup keeps the original logo available', async () => {
  await updateLogo('w', club, {
    status: 'cleaning',
    responseId: 'fail',
    original: 'original-image',
    key: 'original-image',
  });
  age();
  globalThis.logoResponse = async () => ({ status: 'failed' });
  await processLogos('w', [club]);
  assert.equal((await row()).status, 'ready');
  assert.equal((await row()).key, 'original-image');
});

test('a homepage gets its own deadline and an unavailable first image does not hide later candidates', async () => {
  sql.exec('DELETE FROM club_logos');
  const signals = [];
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  globalThis.logoFetch = async (url, signal) => {
    signals.push(signal);
    if (url.endsWith('/'))
      return {
        url,
        response: new Response(
          '<div id="main-logo"><img src="/missing.png"><img src="/identity.png"></div>',
        ),
      };
    if (url.endsWith('missing.png')) throw new Error('Download timed out');
    return { url, response: new Response(png) };
  };
  globalThis.logoResponse = async () => ({ id: 'selected' });
  await processLogos('w', [club]);
  const data = await row();
  assert.equal(data.status, 'identifying');
  assert.equal(data.candidates.length, 1);
  assert.ok(data.candidates[0].url.endsWith('identity.png'));
  assert.equal(data.candidateFailures[0].reason, 'Download timed out');
  assert.notEqual(signals[0], signals[1]);
  assert.notEqual(signals[1], signals[2]);
});

test('previous failed searches retry once after discovery upgrade, with explicit download failures', async () => {
  sql.exec('DELETE FROM club_logos');
  await queueLogos('w', [club]);
  await updateLogo('w', club, { status: 'unavailable', discoveryVersion: 1 });
  await queueLogos('w', [club]);
  assert.equal((await row()).status, 'queued');
  globalThis.logoFetch = async (url) => {
    if (url.endsWith('/'))
      return {
        url,
        response: new Response(
          '<div class="logo"><img src="/identity.png"></div>',
        ),
      };
    throw new Error('Website unavailable');
  };
  await processLogos('w', [club]);
  assert.match(
    (await row()).message,
    /Found 1 possible logo image, but could not download/,
  );
  await queueLogos('w', [club]);
  assert.equal((await row()).status, 'unavailable');
  await updateLogo('w', club, {
    status: 'manual',
    key: 'chosen',
    discoveryVersion: 1,
  });
  await queueLogos('w', [club]);
  assert.equal((await row()).key, 'chosen');
});
