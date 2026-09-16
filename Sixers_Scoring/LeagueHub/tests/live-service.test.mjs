import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const root = resolve('work/live-service-tests');
await mkdir(root, { recursive: true });
for (const name of [
  'model',
  'support',
  'starting-allocations',
  'season-planning',
  'club-images',
  'test-families',
  'demo',
  'demo-data',
  'passwords',
  'email-template',
  'season-emails',
  'accounts',
  'identity',
  'email',
  'email-outbox',
  'team-priority',
]) {
  let js = ts.transpileModule(await readFile(`lib/${name}.ts`, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  js = js
    .replace(/from '\.\/(.*?)'/g, (_, n) => `from './${n}.mjs'`)
    .replaceAll("from 'cloudflare:workers'", "from './bindings.mjs'")
    .replaceAll("from 'next/headers'", "from './headers.mjs'")
    .replaceAll("from '@/app/chatgpt-auth'", "from './chatgpt.mjs'");
  await writeFile(join(root, name + '.mjs'), js);
}
const storageJs = ts.transpileModule(
  await readFile('runtime/node-bindings.ts', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
await writeFile(join(root, 'storage.mjs'), storageJs);
await writeFile(
  join(root, 'bindings.mjs'),
  'export const env=globalThis.testEnv;',
);
await writeFile(
  join(root, 'headers.mjs'),
  'export const cookies=async()=>({get:k=>globalThis.testCookies[k]?{value:globalThis.testCookies[k]}:undefined});',
);
await writeFile(
  join(root, 'chatgpt.mjs'),
  'export const getChatGPTUser=async()=>null;',
);
await writeFile(
  join(root, 'server.mjs'),
  'export const db=()=>globalThis.testDB;export const json=body=>Response.json(body);',
);
const load = (n) => import(pathToFileURL(join(root, n + '.mjs')));
globalThis.testEnv = {
  GOLFSIXES_RUNTIME: 'node',
  RESEND_API_KEY: 'test',
  AUTH_FROM_EMAIL: 'GolfSixes <hello@golfsixesleague.co.uk>',
  GOLFSIXES_PUBLIC_ORIGIN: 'https://golfsixesleague.co.uk',
  EMAIL_DELIVERY_ENABLED: 'true',
};
globalThis.testCookies = {};
const { createStorage } = await load('storage');
const storage = createStorage(join(root, 'data-' + Date.now()));
globalThis.testDB = storage.DB;
globalThis.testEnv.DB = storage.DB;
const { passwordHash, passwordMatches } = await load('passwords');
const { accountAction } = await load('accounts');
const { currentIdentity, digest } = await load('identity');
const { demoState, demoUser } = await load('demo');
const { scheduledEmails, eventEmails } = await load('season-emails');
const { renderEmail } = await load('email-template');
const { editDemoData } = await load('demo-data');
const { queueStatement, runEmailWorker } = await load('email-outbox');
let mail = [];
globalThis.fetch = async (url, opts) => {
  assert.equal(url, 'https://api.resend.com/emails');
  mail.push({ headers: opts.headers, body: JSON.parse(opts.body) });
  return Response.json({ id: 'message-' + mail.length });
};
const code = () => mail.at(-1).body.text.match(/\b[0-9]{6}\b/)[0];
const state = demoState();
state.members[0] = {
  ...demoUser,
  id: 'existing-admin',
  email: 'owner@club.co.uk',
};
await storage.DB.prepare('INSERT INTO workspaces VALUES (?,?,?,?,?,?,?)')
  .bind(
    'live',
    'Live',
    'existing-admin',
    0,
    0,
    JSON.stringify(state),
    new Date().toISOString(),
  )
  .run();
test('verified registration preserves the existing admin identity; passwords and codes cannot be replayed', async () => {
  const response = await accountAction({
    type: 'register',
    name: 'Owner',
    email: 'owner@club.co.uk',
    password: 'three good golfing words',
  });
  const challenge = (await response.json()).challenge;
  assert.equal(
    await storage.DB.prepare('SELECT * FROM accounts').first(),
    null,
  );
  await assert.rejects(
    accountAction({ type: 'account-verify', challenge, code: 'xxxxxx' }),
  );
  const actual = code();
  const verified = await accountAction({
    type: 'account-verify',
    challenge,
    code: actual,
  });
  assert.equal(verified.status, 200);
  const account = await storage.DB.prepare('SELECT * FROM accounts').first();
  assert.equal(account.user_id, 'existing-admin');
  assert.ok(!account.password_hash.includes('golfing'));
  assert.equal(
    await passwordMatches('three good golfing words', account.password_hash),
    true,
  );
  await assert.rejects(
    accountAction({ type: 'account-verify', challenge, code: actual }),
  );
  await assert.rejects(
    accountAction({
      type: 'password',
      email: account.email,
      password: 'wrong',
    }),
  );
  const login = await accountAction({
    type: 'password',
    email: account.email,
    password: 'three good golfing words',
  });
  assert.equal(login.status, 200);
  globalThis.testCookies.golfsixes_session = login.headers
    .get('set-cookie')
    .match(/golfsixes_session=([^;]+)/)[1];
  assert.equal((await currentIdentity()).userId, 'existing-admin');
});
test('password reset requires proof, revokes old sessions and replaces the password', async () => {
  const r = await accountAction({
    type: 'reset',
    email: 'owner@club.co.uk',
    password: 'another long golfing phrase',
  });
  const c = (await r.json()).challenge;
  assert.equal((await currentIdentity()).userId, 'existing-admin');
  await accountAction({ type: 'account-verify', challenge: c, code: code() });
  assert.equal(await currentIdentity(), null);
  await assert.rejects(
    accountAction({
      type: 'password',
      email: 'owner@club.co.uk',
      password: 'three good golfing words',
    }),
  );
  assert.equal(
    (
      await accountAction({
        type: 'password',
        email: 'owner@club.co.uk',
        password: 'another long golfing phrase',
      })
    ).status,
    200,
  );
});
test('old preview sessions do not authenticate on the live service', async () => {
  await storage.DB.prepare(
    'INSERT INTO sessions(hash,email,name,user_id,expires,method) VALUES (?,?,?,?,?,?)',
  )
    .bind(
      await digest('preview-token'),
      'owner@club.co.uk',
      'Owner',
      'existing-admin',
      new Date(Date.now() + 60000).toISOString(),
      'preview',
    )
    .run();
  globalThis.testCookies.golfsixes_session = 'preview-token';
  assert.equal(await currentIdentity(), null);
  globalThis.testEnv.PRIVATE_PREVIEW = 'true';
  assert.equal((await currentIdentity()).userId, 'existing-admin');
  delete globalThis.testEnv.PRIVATE_PREVIEW;
});
test('reminders target unanswered families, selected children and their own organisers', () => {
  const s = demoState();
  s.leagues[0].fixturesConfirmedAt = '2026-09-01';
  const f = s.fixtures.find((f) => f.status === 'scheduled');
  f.date = '2026-10-01';
  const emails = scheduledEmails(
    s,
    'live',
    'https://golfsixesleague.co.uk',
    '2026-09-17',
  );
  assert.ok(emails.some((e) => e.recipient === 'sam@example.com'));
  const children = s.players.filter((p) => p.parentId === 'demo-parent');
  s.availability = children.map((p) => ({
    fixtureId: f.id,
    playerId: p.id,
    status: 'yes',
  }));
  assert.equal(
    scheduledEmails(
      s,
      'live',
      'https://golfsixesleague.co.uk',
      '2026-09-17',
    ).filter((e) => e.recipient === 'sam@example.com').length,
    0,
  );
  f.pairs = [
    {
      id: 'p',
      teamId: s.teams[0].id,
      players: children.map((p) => p.id),
      slotId: '',
    },
  ];
  const tomorrow = scheduledEmails(
    s,
    'live',
    'https://golfsixesleague.co.uk',
    '2026-09-30',
  );
  assert.equal(
    tomorrow.filter((e) => e.recipient === 'sam@example.com').length,
    1,
  );
  assert.ok(tomorrow[0].message.action.url.includes('fixture='));
  assert.equal(
    scheduledEmails(s, 'live', 'https://golfsixesleague.co.uk', '2026-10-02')
      .length,
    0,
  );
  delete s.leagues[0].fixturesConfirmedAt;
  assert.equal(
    scheduledEmails(s, 'live', 'https://golfsixesleague.co.uk', '2026-09-30')
      .length,
    0,
  );
});
test('HTML emails escape content and suppress unsafe action links', () => {
  const email = renderEmail({
    subject: 'Test',
    heading: '<img src=x onerror=alert(1)>',
    paragraphs: ['A & B'],
    action: { label: 'Click', url: 'javascript:alert(1)' },
  });
  assert.ok(email.html.includes('&lt;img'));
  assert.ok(!email.html.includes('href="javascript:'));
  assert.ok(email.text.includes('A & B'));
});
test('demo record editing is rejected in live mode and supports new availability samples in demo', () => {
  const s = demoState();
  assert.throws(() =>
    editDemoData(s, demoUser, {
      collection: 'availability',
      records: [],
      removeIds: [],
    }),
  );
  s.demoSandbox = true;
  const n = editDemoData(s, demoUser, {
    collection: 'availability',
    records: [
      {
        id: 'a',
        fixtureId: 'fixture-4',
        playerId: 'player-0-0',
        status: 'yes',
      },
    ],
    removeIds: [],
  });
  assert.equal(n.availability[0].status, 'yes');
  assert.throws(() =>
    editDemoData(s, demoUser, {
      collection: '__proto__',
      records: [],
      removeIds: [],
    }),
  );
});
test('outbox suppresses fictional recipients, deduplicates sends and honours the delivery switch', async () => {
  const p = {
    id: 'event:live:one',
    recipient: 'family@club.co.uk',
    message: {
      subject: 'Your season',
      heading: 'Hello',
      paragraphs: ['A fixture update.'],
    },
  };
  await queueStatement(p, 'live', 0).run();
  await queueStatement(p, 'live', 0).run();
  await queueStatement(
    { ...p, id: 'event:live:test', recipient: 'parent@example.invalid' },
    'live',
    0,
  ).run();
  const start = mail.length;
  globalThis.testEnv.EMAIL_DELIVERY_ENABLED = 'false';
  await runEmailWorker();
  assert.equal(mail.length, start);
  globalThis.testEnv.EMAIL_DELIVERY_ENABLED = 'true';
  await runEmailWorker();
  assert.equal(mail.length, start + 1);
  await runEmailWorker();
  assert.equal(mail.length, start + 1);
  assert.equal(mail.at(-1).headers['Idempotency-Key'], p.id);
  const suppressed = await storage.DB.prepare(
    'SELECT status FROM email_outbox WHERE id=?',
  )
    .bind('event:live:test')
    .first();
  assert.equal(suppressed.status, 'suppressed');
});
test.after(() => storage.close());
