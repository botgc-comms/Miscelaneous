import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const folder = path.resolve('work/tests');
for (const name of ['assistant-plan', 'assistant-server']) {
  const js = ts
    .transpileModule(await readFile(`lib/${name}.ts`, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(
      "await import('./season-emails')",
      '({eventEmails:()=>[]})',
    )
    .replace("await import('cloudflare:workers')", '({env:{}})')
    .replace(
      /from '\.\/(.*?)'/g,
      (_, n) =>
        `from './${n === 'server' ? 'assistant-test-server' : n === 'assistant-provider' ? 'assistant-test-provider' : n}.mjs'`,
    );
  await writeFile(path.join(folder, name + '.mjs'), js);
}
await writeFile(
  path.join(folder, 'assistant-test-server.mjs'),
  `export const db=()=>globalThis.assistantDB;export const context=async(workspace,view)=>globalThis.assistantContext(workspace,view);`,
);
await writeFile(
  path.join(folder, 'assistant-test-provider.mjs'),
  `export const assistantConnected=()=>true;export const startResponse=async(...args)=>{globalThis.assistantStartArgs=args;return {id:'response-test'};};export const responseRequest=async()=>globalThis.assistantResponse;`,
);
const load = (n) => import(pathToFileURL(path.join(folder, n + '.mjs')));
const { demoState, demoUser } = await load('demo');
const { emptyState } = await load('model');
const { assistantContext, parseProposal, applyProposal } =
  await load('assistant-plan');
const { createAssistantJob, decideAssistantJob, assistantStatus } =
  await load('assistant-server');
const sql = new DatabaseSync(':memory:');
sql.exec(
  'CREATE TABLE workspaces(id TEXT PRIMARY KEY,name TEXT,owner TEXT,demo INTEGER,revision INTEGER,data TEXT,updated TEXT);CREATE TABLE families(id TEXT PRIMARY KEY,data TEXT,revision INTEGER);CREATE TABLE assistant_jobs(id TEXT PRIMARY KEY,workspace TEXT,created TEXT,revision INTEGER,data TEXT)',
);
const stmt = (query, values = []) => ({
  bind: (...v) => stmt(query, v),
  first: async () => sql.prepare(query).get(...values) || null,
  all: async () => ({ results: sql.prepare(query).all(...values) }),
  run: async () => ({
    meta: { changes: Number(sql.prepare(query).run(...values).changes) },
  }),
});
globalThis.assistantDB = {
  prepare: stmt,
  batch: async (statements) => {
    sql.exec('BEGIN');
    try {
      const results = [];
      for (const s of statements) results.push(await s.run());
      sql.exec('COMMIT');
      return results;
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  },
};
let role = 'admin';
globalThis.assistantContext = async (id, view) => {
  const row = sql.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
  if (!row) throw new Error('missing workspace');
  const state = JSON.parse(row.data),
    me = {
      ...state.members.find((m) => m.id === 'owner'),
      role: view === 'parent' ? 'parent' : role,
    };
  return { row, state, me, u: { userId: 'owner' } };
};
function setup() {
  sql.exec(
    'DELETE FROM assistant_jobs;DELETE FROM families;DELETE FROM workspaces',
  );
  role = 'admin';
  const state = demoState();
  state.members.push({ ...demoUser, id: 'owner' });
  sql
    .prepare('INSERT INTO workspaces VALUES (?,?,?,?,?,?,?)')
    .run('workspace', 'Test', 'owner', 0, 0, JSON.stringify(state), 'now');
  return state;
}
const getState = () =>
  JSON.parse(
    sql.prepare('SELECT data FROM workspaces WHERE id=?').get('workspace').data,
  );

function answer(message, changes = []) {
  globalThis.assistantResponse = {
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              message,
              changes,
              sources: [],
              warnings: [],
            }),
          },
        ],
      },
    ],
  };
}

test('clarifications accept direct replies and retain the selected conversation without applying data', async () => {
  const before = setup();
  const first = await createAssistantJob(
    'workspace',
    'admin',
    'Create the two Chevin teams',
  );
  answer('Do you mean Chevin Golf Club?');
  const result = await assistantStatus('workspace', 'admin');
  assert.equal(result.jobs.find((j) => j.id === first.id).status, 'replied');
  await assert.rejects(
    () => decideAssistantJob('workspace', 'admin', first.id, 'apply'),
    /no longer ready/,
  );
  const reply = await createAssistantJob(
    'workspace',
    'admin',
    'Yes',
    false,
    [],
    first.id,
  );
  assert.deepEqual(globalThis.assistantStartArgs[3], [
    {
      request: 'Create the two Chevin teams',
      reply: 'Do you mean Chevin Golf Club?',
    },
  ]);
  answer('Which colours?');
  await assistantStatus('workspace', 'admin');
  const next = await createAssistantJob(
    'workspace',
    'admin',
    'Navy and green',
    false,
    [],
    reply.id,
  );
  assert.equal(next.conversation.length, 2);
  assert.equal(next.conversation[0].request, 'Create the two Chevin teams');
  assert.deepEqual(getState(), before);
  await decideAssistantJob('workspace', 'admin', next.id, 'cancel');
  await createAssistantJob('workspace', 'admin', 'A separate request');
  assert.deepEqual(globalThis.assistantStartArgs[3], []);
});

test('reply replaces only the selected proposal atomically and still requires Apply', async () => {
  const before = setup();
  const first = await createAssistantJob('workspace', 'admin', 'Add a club');
  answer('Add Example Golf Club', [
    {
      description: 'Add Example',
      actionJson: JSON.stringify({
        type: 'club-import',
        clubs: [{ name: 'Example Golf Club' }],
      }),
    },
  ]);
  await assistantStatus('workspace', 'admin');
  const reply = await createAssistantJob(
    'workspace',
    'admin',
    'Change its name',
    false,
    [],
    first.id,
  );
  assert.equal(
    JSON.parse(
      sql.prepare('SELECT data FROM assistant_jobs WHERE id=?').get(first.id)
        .data,
    ).status,
    'superseded',
  );
  await assert.rejects(
    () => decideAssistantJob('workspace', 'admin', first.id, 'apply'),
    /no longer ready/,
  );
  await assert.rejects(
    () =>
      createAssistantJob(
        'workspace',
        'admin',
        'Another reply',
        false,
        [],
        first.id,
      ),
    /current assistant task/,
  );
  await assert.rejects(
    () =>
      createAssistantJob(
        'workspace',
        'admin',
        'Answer',
        false,
        [],
        'other-workspace-job',
      ),
    /not be found/,
  );
  assert.deepEqual(getState(), before);
  answer('Add Revised Golf Club', [
    {
      description: 'Add Revised',
      actionJson: JSON.stringify({
        type: 'club-import',
        clubs: [{ name: 'Revised Golf Club' }],
      }),
    },
  ]);
  await assistantStatus('workspace', 'admin');
  assert.deepEqual(getState(), before);
  await decideAssistantJob('workspace', 'admin', reply.id, 'apply');
  assert.ok(getState().clubs.some((c) => c.name === 'Revised Golf Club'));
  assert.equal(
    getState().clubs.some((c) => c.name === 'Example Golf Club'),
    false,
  );
  await decideAssistantJob('workspace', 'admin', reply.id, 'undo');
  assert.deepEqual(getState(), before);
});

test('old clarification tasks unlock automatically and cancelled questions can be continued', async () => {
  setup();
  const first = await createAssistantJob('workspace', 'admin', 'Use Chevin');
  answer('Please confirm this is Chevin Golf Club.');
  await assistantStatus('workspace', 'admin');
  sql
    .prepare(
      "UPDATE assistant_jobs SET data=json_set(data,'$.status','ready') WHERE id=?",
    )
    .run(first.id);
  assert.equal(
    (await assistantStatus('workspace', 'admin')).jobs[0].status,
    'replied',
  );
  sql
    .prepare(
      "UPDATE assistant_jobs SET data=json_set(data,'$.status','cancelled') WHERE id=?",
    )
    .run(first.id);
  const next = await createAssistantJob(
    'workspace',
    'admin',
    'It is',
    false,
    [],
    first.id,
  );
  assert.equal(next.status, 'researching');
  assert.deepEqual(next.conversation, [
    {
      request: 'Use Chevin',
      reply: 'Please confirm this is Chevin Golf Club.',
    },
  ]);
});
test('multiple attachment names persist without storing their contents or changing workspace data', async () => {
  const state = setup();
  const attachments = [
    { name: 'clubs.csv', kind: 'text', data: 'private-test-content' },
    { name: 'clubs.png', kind: 'image', data: 'data:image/png;base64,test' },
  ];
  const job = await createAssistantJob(
    'workspace',
    'admin',
    'Review the attachments',
    false,
    attachments,
  );
  assert.deepEqual(job.attachmentNames, ['clubs.csv', 'clubs.png']);
  const stored = sql
    .prepare('SELECT data FROM assistant_jobs WHERE id=?')
    .get(job.id).data;
  assert.doesNotMatch(stored, /private-test-content|base64/);
  assert.deepEqual(getState(), state);
});

test('assistant context supports administration without sending private contact, care or invitation secrets', () => {
  const s = setup();
  const data = assistantContext(s);
  assert.equal(data.players, undefined);
  assert.equal(data.members, undefined);
  assert.deepEqual(data.fixtures[0].pairs, s.fixtures[0].pairs);
  assert.equal(data.participants[0].name, s.players[0].name);
  assert.equal(data.participants[0].care, undefined);
  assert.equal(data.participants[0].dob, undefined);
  assert.equal(data.staffAndFamilies[0].email, undefined);
  assert.equal(data.invitations[0]?.hash, undefined);
  assert.equal(data.clubs[0].welfareEmail, undefined);
  assert.equal(data.teams[0].approvedBy, undefined);
});
test('unknown writes are rejected and explicit club edits preserve omitted fields', () => {
  const s = setup(),
    me = s.members.at(-1);
  assert.throws(() =>
    parseProposal({
      message: 'x',
      changes: [
        {
          description: 'x',
          actionJson: JSON.stringify({ type: 'run-sql', sql: 'DELETE' }),
        },
      ],
    }),
  );
  const club = s.clubs[0];
  club.welfareName = 'Keep officer';
  club.safeGolf = true;
  const p = parseProposal({
    message: 'Rename',
    changes: [
      {
        description: 'Rename club',
        actionJson: JSON.stringify({
          type: 'club',
          id: club.id,
          name: 'Renamed',
        }),
      },
    ],
  });
  const next = applyProposal(s, me, p);
  assert.equal(next.clubs[0].welfareName, 'Keep officer');
  assert.equal(next.clubs[0].safeGolf, true);
  assert.equal(s.clubs[0].name, club.name);
  const changed = applyProposal(next, me, {
    ...p,
    changes: [
      {
        description: 'Update welfare contact',
        action: {
          type: 'club',
          id: club.id,
          welfareName: 'New officer',
          safeGolf: false,
        },
      },
    ],
  });
  assert.equal(changed.clubs[0].welfareName, 'New officer');
  assert.equal(changed.clubs[0].safeGolf, false);
});
test('reset preview does not mutate, Apply clears, Undo restores exact workspace and unshared family records', async () => {
  const s = setup(),
    child = s.players[0];
  sql.prepare('INSERT INTO families VALUES (?,?,0)').run(
    'owner',
    JSON.stringify({
      children: [child],
      pendingSync: { [child.id]: 'now' },
      registration: { name: 'Owner', parent: true },
    }),
  );
  const preview = await createAssistantJob('workspace', 'admin', 'Reset', true);
  assert.equal(getState().teams.length, s.teams.length);
  assert.equal(preview.before, undefined);
  assert.equal(preview.proposed, undefined);
  assert.equal(preview.familyCopies, undefined);
  await decideAssistantJob('workspace', 'admin', preview.id, 'apply');
  const cleared = getState();
  assert.equal(cleared.clubs.length, 0);
  assert.equal(cleared.players.length, 0);
  assert.deepEqual(
    cleared.members.map((m) => m.id),
    ['owner'],
  );
  assert.equal(
    JSON.parse(sql.prepare('SELECT data FROM families').get().data).children
      .length,
    0,
  );
  await decideAssistantJob('workspace', 'admin', preview.id, 'undo');
  assert.deepEqual(getState(), s);
  assert.equal(
    JSON.parse(sql.prepare('SELECT data FROM families').get().data).children
      .length,
    1,
  );
});
test('reset keeps children linked to another workspace', async () => {
  const s = setup(),
    child = s.players[0],
    other = emptyState();
  other.players = [child];
  sql
    .prepare('INSERT INTO workspaces VALUES (?,?,?,?,?,?,?)')
    .run('other', 'Other', 'another', 0, 0, JSON.stringify(other), 'now');
  sql
    .prepare('INSERT INTO families VALUES (?,?,0)')
    .run('owner', JSON.stringify({ children: [child], pendingSync: {} }));
  const p = await createAssistantJob('workspace', 'admin', 'Reset', true);
  await decideAssistantJob('workspace', 'admin', p.id, 'apply');
  assert.equal(
    JSON.parse(sql.prepare('SELECT data FROM families').get().data).children
      .length,
    1,
  );
});
test('family revision conflicts abort the entire reset batch', async () => {
  const s = setup();
  sql
    .prepare('INSERT INTO families VALUES (?,?,0)')
    .run(
      'owner',
      JSON.stringify({ children: [s.players[0]], pendingSync: {} }),
    );
  const p = await createAssistantJob('workspace', 'admin', 'Reset', true);
  sql.exec('UPDATE families SET revision=revision+1');
  await assert.rejects(
    () => decideAssistantJob('workspace', 'admin', p.id, 'apply'),
    /changed/,
  );
  assert.deepEqual(getState(), s);
  assert.equal(
    JSON.parse(sql.prepare('SELECT data FROM assistant_jobs').get().data)
      .status,
    'ready',
  );
});
test('Apply and Undo are idempotent and cannot overwrite later edits', async () => {
  setup();
  const p = await createAssistantJob('workspace', 'admin', 'Reset', true);
  await decideAssistantJob('workspace', 'admin', p.id, 'apply');
  await decideAssistantJob('workspace', 'admin', p.id, 'apply');
  assert.equal(
    sql.prepare('SELECT revision FROM workspaces').get().revision,
    1,
  );
  sql.exec('UPDATE workspaces SET revision=revision+1');
  await assert.rejects(
    () => decideAssistantJob('workspace', 'admin', p.id, 'undo'),
    /Other changes/,
  );
});
test('stale proposals and unprivileged users cannot mutate data', async () => {
  setup();
  await assert.rejects(
    () => createAssistantJob('workspace', 'parent', 'Reset', true),
    /administrator/,
  );
  const p = await createAssistantJob('workspace', 'admin', 'Reset', true);
  sql.exec('UPDATE workspaces SET revision=revision+1');
  await assert.rejects(
    () => decideAssistantJob('workspace', 'admin', p.id, 'apply'),
    /workspace changed/,
  );
  role = 'organiser';
  await assert.rejects(
    () => assistantStatus('workspace', 'organiser'),
    /administrator/,
  );
});
test('research completes as a preview, cancellation cannot apply, real change supports Undo', async () => {
  const s = setup();
  globalThis.assistantResponse = {
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              message: 'Add a club',
              changes: [
                {
                  description: 'Add Example Golf Club',
                  actionJson: JSON.stringify({
                    type: 'club-import',
                    clubs: [
                      { name: 'Example Golf Club', address: 'Test Road' },
                    ],
                  }),
                },
              ],
              sources: [],
              warnings: [],
            }),
          },
        ],
      },
    ],
  };
  const j = await createAssistantJob('workspace', 'admin', 'Add a club');
  assert.equal(j.status, 'researching');
  const status = await assistantStatus('workspace', 'admin');
  assert.equal(status.jobs[0].status, 'ready');
  assert.deepEqual(getState(), s);
  await decideAssistantJob('workspace', 'admin', j.id, 'apply');
  assert.equal(getState().clubs.length, s.clubs.length + 1);
  await decideAssistantJob('workspace', 'admin', j.id, 'undo');
  assert.deepEqual(getState(), s);
  const j2 = await createAssistantJob('workspace', 'admin', 'Add again');
  await decideAssistantJob('workspace', 'admin', j2.id, 'cancel');
  await assistantStatus('workspace', 'admin');
  await assert.rejects(
    () => decideAssistantJob('workspace', 'admin', j2.id, 'apply'),
    /no longer ready/,
  );
  assert.deepEqual(getState(), s);
});

test('hosting availability through January is reviewable, preserves existing replies and undoes exactly', async () => {
  const initial = setup();
  const league = initial.leagues[0],
    club = initial.clubs[0],
    other = initial.clubs[1];
  initial.hostingOffers = [
    {
      clubId: club.id,
      leagueId: league.id,
      capacity: 1,
      dates: ['2026-09-19'],
      shotgun: 'no',
      presentation: 'no',
      food: 'no',
      notes: 'Existing organiser response',
      updatedAt: '2026-09-01',
      updatedBy: 'organiser',
    },
  ];
  sql
    .prepare('UPDATE workspaces SET data=? WHERE id=?')
    .run(JSON.stringify(initial), 'workspace');
  const before = getState();
  const job = await createAssistantJob(
    'workspace',
    'admin',
    'Add missing test hosting responses through January',
  );
  const actions = [
    {
      type: 'hosting-offer',
      clubId: other.id,
      leagueId: league.id,
      capacity: 2,
      dates: ['2026-09-19', '2026-11-15', '2027-01-30'],
      shotgun: 'yes',
      presentation: 'yes',
      food: 'unsure',
      notes: 'TEST AVAILABILITY — generated by admin',
    },
    { type: 'team-directory', teamId: initial.teams[0].id, open: false },
    {
      type: 'fixture-planning',
      leagueId: league.id,
      count: 6,
      start: '2026-09-15',
      end: '2027-01-31',
      minGap: 14,
    },
  ];
  answer(
    'Review missing test availability and planning settings.',
    actions.map((action) => ({
      description: action.type,
      actionJson: JSON.stringify(action),
    })),
  );
  const status = await assistantStatus('workspace', 'admin');
  const ready = status.jobs.find((j) => j.id === job.id);
  assert.equal(ready.status, 'ready', ready.progress);
  assert.ok(
    ready.changes.some(
      (c) =>
        c.entity === 'hostingOffers' &&
        c.details.some((d) => d.includes('2027-01-30')),
    ),
  );
  assert.ok(
    ready.changes.some(
      (c) =>
        c.entity === 'leagues' &&
        c.details.some((d) => d.includes('2027-01-31')),
    ),
  );
  assert.deepEqual(getState(), before);
  await decideAssistantJob('workspace', 'admin', job.id, 'apply');
  const after = getState();
  assert.deepEqual(after.hostingOffers[0], before.hostingOffers[0]);
  assert.equal(after.hostingOffers[1].updatedBy, 'owner');
  assert.ok(
    after.hostingOffers[1].dates.every((d) =>
      [0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay()),
    ),
  );
  assert.equal(after.teams[0].enrollmentOpen, false);
  assert.equal(after.teams[1].enrollmentOpen, before.teams[1].enrollmentOpen);
  await decideAssistantJob('workspace', 'admin', job.id, 'undo');
  assert.deepEqual(getState(), before);
});

test('assistant access and score actions keep domain permissions and concrete previews', () => {
  const s = setup(),
    me = s.members.find((m) => m.id === 'owner');
  const proposal = (action) =>
    parseProposal({
      message: 'Review',
      changes: [
        { description: action.type, actionJson: JSON.stringify(action) },
      ],
    });
  const organiser = s.members.find((m) => m.role === 'organiser');
  const next = applyProposal(
    s,
    me,
    proposal({
      type: 'member',
      id: organiser.id,
      role: 'organiser',
      orgIds: [s.orgs[0].id, s.orgs[1].id],
      leagueIds: [],
    }),
  );
  assert.equal(
    next.members.find((m) => m.id === organiser.id).orgIds.length,
    2,
  );
  assert.throws(
    () =>
      applyProposal(
        s,
        me,
        proposal({
          type: 'member',
          id: me.id,
          role: 'parent',
          orgIds: [],
          leagueIds: [],
        }),
      ),
    /own access/,
  );
  const fixture = s.fixtures.find((f) => f.status === 'live');
  const action = {
    type: 'score',
    fixtureId: fixture.id,
    pairId: fixture.pairs[0].id,
    hole: 1,
    strokes: 4,
  };
  const scored = applyProposal(s, me, proposal(action));
  assert.equal(
    scored.fixtures.find((f) => f.id === fixture.id).scores[
      `${action.pairId}:1`
    ].strokes,
    4,
  );
  assert.throws(
    () => applyProposal(s, me, proposal({ ...action, hole: 99 })),
    /Hole/,
  );
});

test('assistant previews club test organisers, applies once and undoes exactly', async () => {
  const before = setup();
  const action = {
    type: 'add-test-organisers',
    clubIds: [before.clubs[0].id],
    count: 2,
  };
  const job = await createAssistantJob(
    'workspace',
    'admin',
    'Create two test organisers for this club',
  );
  answer('Two fictional organiser profiles, ready to review.', [
    {
      description: 'Add club test organisers',
      actionJson: JSON.stringify(action),
    },
  ]);
  const status = await assistantStatus('workspace', 'admin');
  const ready = status.jobs.find((j) => j.id === job.id);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.changes.length, 2);
  assert.ok(
    ready.changes.every(
      (c) =>
        c.entity === 'members' && c.details.some((d) => d.startsWith('Club:')),
    ),
  );
  assert.deepEqual(getState(), before);
  await decideAssistantJob('workspace', 'admin', job.id, 'apply');
  const after = getState();
  assert.equal(after.members.length, before.members.length + 2);
  assert.deepEqual(after.invites, before.invites);
  assert.ok(
    !JSON.stringify(assistantContext(after)).includes('@example.invalid'),
  );
  const proposal = {
    message: '',
    sources: [],
    warnings: [],
    changes: [
      { description: '', action: { ...action, email: 'someone@example.com' } },
    ],
  };
  assert.throws(
    () =>
      applyProposal(
        after,
        after.members.find((m) => m.id === 'owner'),
        proposal,
      ),
    /fictional profiles/,
  );
  await decideAssistantJob('workspace', 'admin', job.id, 'undo');
  assert.deepEqual(getState(), before);
});

test('assistant proposes fictional squad top-ups, keeps existing people private, applies and undoes exactly', async () => {
  const before = setup();
  const league = before.leagues[0];
  const action = {
    type: 'add-test-families',
    leagueName: league.name,
    year: league.year,
    targetSize: 12,
  };
  const job = await createAssistantJob(
    'workspace',
    'admin',
    'Use fictional families to fill each team to 12 children',
  );
  answer('Top up the teams with labelled test children.', [
    {
      description:
        'Top up every team to 12 registered children; existing players stay.',
      actionJson: JSON.stringify(action),
    },
  ]);
  const status = await assistantStatus('workspace', 'admin');
  const ready = status.jobs.find((j) => j.id === job.id);
  assert.equal(ready.status, 'ready');
  assert.ok(
    ready.changes.some(
      (c) =>
        c.entity === 'players' &&
        c.name.endsWith('(Test)') &&
        c.details.some((d) => d.startsWith('Team:')),
    ),
  );
  assert.deepEqual(getState(), before);
  await decideAssistantJob('workspace', 'admin', job.id, 'apply');
  const filled = getState();
  for (const t of filled.teams.filter(
    (t) => t.leagueId === league.id && !t.withdrawnAt,
  ))
    assert.equal(
      new Set(
        filled.enrollments
          .filter(
            (e) =>
              e.teamId === t.id && ['approved', 'pending'].includes(e.status),
          )
          .map((e) => e.playerId),
      ).size,
      12,
    );
  const context = assistantContext(filled);
  assert.ok(context.teams.every((t) => typeof t.registeredCount === 'number'));
  assert.equal(context.players, undefined);
  assert.equal(context.members, undefined);
  assert.ok(!JSON.stringify(context).includes('@example.invalid'));
  const malicious = {
    message: 'x',
    changes: [
      {
        description: 'x',
        action: { ...action, players: [{ name: 'Real person' }] },
      },
    ],
    sources: [],
    warnings: [],
  };
  assert.throws(
    () => applyProposal(filled, filled.members.at(-1), malicious),
    /administrator|fictional profiles/,
  );
  assert.throws(
    () =>
      applyProposal(
        filled,
        filled.members.find((m) => m.id === 'owner'),
        malicious,
      ),
    /fictional profiles/,
  );
  await decideAssistantJob('workspace', 'admin', job.id, 'undo');
  assert.deepEqual(getState(), before);
});
