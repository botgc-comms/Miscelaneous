import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://localhost:3000';
const uid = 'registration-test-' + randomUUID();
const token = randomUUID();
const hash = createHash('sha256').update(token).digest('hex');
const email = uid + '@example.test';
const sqlPath = path.resolve('work/tests/registration-session.sql');
const sqlQuote = (s) => "'" + s.replaceAll("'", "''") + "'";
async function sql(statement) {
  await mkdir(path.dirname(sqlPath), { recursive: true });
  await writeFile(sqlPath, statement);
  execFileSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'd1',
      'execute',
      'DB',
      '--local',
      '--config',
      'wrangler.local.json',
      '--file',
      sqlPath,
    ],
    {
      stdio: 'pipe',
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_WRITE_LOGS: 'false',
      },
    },
  );
}
async function call(cookie, route, body) {
  const r = await fetch(origin + route, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
}

test('verified registration, club approval and private child avatars work end to end', async () => {
  const signin = await fetch(origin + '/signin-with-chatgpt?return_to=/', {
    redirect: 'manual',
  });
  const owner = signin.headers.get('set-cookie').split(';')[0];
  const fresh = 'golfsixes_session=' + token;
  let workspace;
  try {
    await sql(
      `INSERT INTO sessions(hash,email,name,user_id,expires) VALUES (${[hash, email, 'Test organiser', uid, new Date(Date.now() + 600000).toISOString()].map(sqlQuote).join(',')});`,
    );
    assert.equal((await call('', '/api/registration')).body.user, null);
    assert.equal(
      (await call('', '/api/registration', { role: 'admin' })).status,
      401,
    );
    const created = await call(owner, '/api/workspace', {
      action: { type: 'create-workspace', name: uid },
    });
    assert.equal(created.status, 200);
    workspace = created.body.workspace;
    const clubReply = await call(owner, '/api/workspace', {
      workspace,
      action: { type: 'organisation', name: 'Registration test club' },
    });
    const orgId = clubReply.body.state.orgs[0].id;
    assert.equal(
      (await call(fresh, '/api/workspace')).status,
      404,
      'New accounts must not get an admin workspace',
    );
    let r = await call(fresh, '/api/registration', {
      role: 'parent',
      name: 'New Parent',
      phone: '07700 900123',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.parentRegistered, true);
    assert.equal(r.body.memberships.length, 0);
    const family = await call(fresh, '/api/parent');
    const child = await call(fresh, '/api/parent', {
      type: 'child',
      expectedRevision: family.body.revision,
      name: 'Avatar Test Child',
      dob: '2017-01-01',
      handicap: '',
      diet: '',
      care: '',
      photoConsent: false,
      emergencyName: 'New Parent',
      emergencyPhone: '07700 900123',
      consent: true,
    });
    assert.equal(child.status, 200, JSON.stringify(child.body));
    const playerId = child.body.family.children[0].id;
    const form = new FormData();
    form.set('playerId', playerId);
    form.set(
      'photo',
      new Blob(
        [
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+VEAAAAASUVORK5CYII=',
            'base64',
          ),
        ],
        { type: 'image/png' },
      ),
      'avatar.png',
    );
    const upload = await fetch(origin + '/api/family-photo', {
      method: 'POST',
      headers: { Cookie: fresh },
      body: form,
    });
    assert.equal(upload.status, 200);
    const uploaded = await upload.json();
    assert.ok(uploaded.family.children[0].photoKey);
    assert.equal(
      (
        await fetch(origin + '/api/family-photo?playerId=' + playerId, {
          headers: { Cookie: fresh },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(origin + '/api/family-photo?playerId=' + playerId, {
          headers: { Cookie: owner },
        })
      ).status,
      404,
    );
    r = await call(fresh, '/api/registration', {
      role: 'staff',
      workspace,
      orgId,
      name: 'New Organiser',
      phone: '07700 900123',
      email: 'forged@example.test',
    });
    assert.equal(r.status, 200);
    assert.equal(
      r.body.parentRegistered,
      true,
      'Adding another role preserves parent registration',
    );
    assert.equal(r.body.memberships.length, 0);
    const pending = r.body.requests.find((q) => q.workspace === workspace);
    assert.equal(pending.status, 'pending');
    assert.equal(
      pending.email,
      email,
      'Email must come from the verified identity',
    );
    assert.equal(
      (await call(fresh, '/api/workspace?workspace=' + workspace)).status,
      403,
    );
    assert.equal(
      (
        await call(fresh, '/api/workspace', {
          workspace,
          action: {
            type: 'access-request-decision',
            id: pending.id,
            decision: 'approve',
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call(owner, '/api/workspace', {
          workspace,
          action: {
            type: 'access-request-decision',
            id: pending.id,
            decision: 'approve',
          },
        })
      ).status,
      200,
    );
    r = await call(
      fresh,
      '/api/workspace?workspace=' + workspace + '&view=admin',
    );
    assert.equal(
      r.body.me.role,
      'organiser',
      'A URL role cannot grant administration',
    );
    assert.deepEqual(r.body.me.orgIds, [orgId]);
    assert.deepEqual(
      r.body.state.orgs.map((o) => o.id),
      [orgId],
    );
    const adminRequest = await call(fresh, '/api/registration', {
      role: 'admin',
      workspace,
      name: 'New Organiser',
      phone: '07700 900123',
    });
    const waiting = adminRequest.body.requests.find(
      (q) => q.role === 'admin' && q.status === 'pending',
    );
    assert.ok(waiting);
    assert.equal(
      (
        await call(fresh, '/api/workspace', {
          workspace,
          action: {
            type: 'access-request-decision',
            id: waiting.id,
            decision: 'approve',
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call(owner, '/api/workspace', {
          workspace,
          action: {
            type: 'access-request-decision',
            id: waiting.id,
            decision: 'reject',
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (await call(fresh, '/api/workspace?workspace=' + workspace)).body.me.role,
      'organiser',
    );
  } finally {
    await sql(
      `DELETE FROM sessions WHERE hash=${sqlQuote(hash)}; DELETE FROM families WHERE id=${sqlQuote(uid)};${workspace ? ` DELETE FROM workspaces WHERE id=${sqlQuote(workspace)};` : ''}`,
    );
    await unlink(sqlPath).catch(() => {});
  }
});
