import { queueLoginAlert } from './login-alerts';
import { cookies } from 'next/headers';
import { db, json } from './server';
import { digest } from './identity';
import { requireThat } from './model';
import { limit, sendAccountCode } from './email';
import { passwordHash, passwordMatches } from './passwords';
export type Account = {
  email: string;
  user_id: string;
  name: string;
  password_hash: string | null;
  google_sub: string | null;
};
export async function canonicalUserId(email: string) {
  const rows = await db()
    .prepare(
      "SELECT DISTINCT json_extract(m.value,'$.id') AS id FROM workspaces, json_each(workspaces.data,'$.members') m WHERE lower(json_extract(m.value,'$.email'))=? AND demo=0",
    )
    .bind(email)
    .all<{ id: string }>();
  requireThat(
    rows.results.length <= 1,
    'Your email is linked to multiple records. Ask your administrator to combine them.',
    409,
  );
  return rows.results[0]?.id || `email-${await digest(email)}`;
}
export async function accountSession(account: Account, method = 'password') {
  const old = (await cookies()).get('golfsixes_session')?.value;
  const token = crypto.randomUUID() + crypto.randomUUID();
  const statements = [
    db()
      .prepare(
        'INSERT INTO sessions(hash,email,name,user_id,expires,method) VALUES (?,?,?,?,?,?)',
      )
      .bind(
        await digest(token),
        account.email,
        account.name,
        account.user_id,
        new Date(Date.now() + 30 * 86400000).toISOString(),
        method,
      ),
  ];
  if (old)
    statements.push(
      db()
        .prepare('DELETE FROM sessions WHERE hash=?')
        .bind(await digest(old)),
    );
  await db().batch(statements);
  await queueLoginAlert(account, method);
  const r = json({ ok: true });
  r.headers.append(
    'Set-Cookie',
    `golfsixes_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`,
  );
  r.headers.append(
    'Set-Cookie',
    'golfsixes_demo=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
  );
  return r;
}
export async function accountAction(a: any) {
  if (!['register', 'password', 'reset', 'account-verify'].includes(a.type))
    return null;
  if (a.type === 'account-verify') {
    requireThat(
      typeof a.challenge === 'string' && /^\d{6}$/.test(a.code),
      'Enter the six-digit code from your email.',
    );
    const c = await db()
      .prepare(
        "UPDATE account_challenges SET attempts=attempts+1 WHERE id=? AND kind IN ('register','reset') AND expires>? AND attempts<5 RETURNING *",
      )
      .bind(a.challenge, new Date().toISOString())
      .first<{
        id: string;
        email: string;
        kind: string;
        payload: string;
        hash: string;
      }>();
    requireThat(
      c && (await digest(`${c.id}:${a.code}`)) === c.hash,
      'This code is incorrect or expired. Please request a new one.',
    );
    const p = JSON.parse(c.payload);
    const uid = await canonicalUserId(c.email);
    // The consuming insert/update and token deletion share a transaction. A replay cannot update a password.
    const statement =
      c.kind === 'register'
        ? db()
            .prepare(
              'INSERT OR IGNORE INTO accounts(email,user_id,name,password_hash,verified_at) SELECT email,?,?,?,? FROM account_challenges WHERE id=?',
            )
            .bind(uid, p.name, p.password, new Date().toISOString(), c.id)
        : db()
            .prepare(
              'UPDATE accounts SET password_hash=? WHERE email=? AND EXISTS(SELECT 1 FROM account_challenges WHERE id=?)',
            )
            .bind(p.password, c.email, c.id);
    const results = await db().batch([
      statement,
      db()
        .prepare(
          'DELETE FROM sessions WHERE email=? AND EXISTS(SELECT 1 FROM account_challenges WHERE id=?)',
        )
        .bind(c.email, c.id),
      db().prepare('DELETE FROM account_challenges WHERE id=?').bind(c.id),
    ]);
    requireThat(
      results[0].meta.changes === 1,
      'This code has already been used, or this account already exists. Please sign in or reset your password.',
      409,
    );
    const account = await db()
      .prepare('SELECT * FROM accounts WHERE email=?')
      .bind(c.email)
      .first<Account>();
    return accountSession(account!, 'verified');
  }
  requireThat(
    typeof a.email === 'string' &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim()) &&
      a.email.length < 255,
    'Enter a valid email address.',
  );
  const email = a.email.trim().toLowerCase();
  await limit(
    `account:${a.type}:${email}`,
    a.type === 'password' ? 10 : 3,
    600,
  );
  requireThat(
    typeof a.password === 'string' && a.password.length <= 200,
    'Enter your password.',
  );
  const account = await db()
    .prepare('SELECT * FROM accounts WHERE email=?')
    .bind(email)
    .first<Account>();
  if (a.type === 'password') {
    // Same expensive hash path for unknown email addresses.
    const hash =
      account?.password_hash ||
      `pbkdf2-sha256:600000:00000000000000000000000000000000:${'0'.repeat(64)}`;
    const ok = await passwordMatches(a.password, hash);
    requireThat(
      ok && account,
      'Email or password is incorrect. You can reset your password below.',
      401,
    );
    return accountSession(account!);
  }
  requireThat(
    a.password.length >= 12,
    'Choose a password with at least 12 characters.',
  );
  requireThat(
    a.type !== 'register' ||
      (typeof a.name === 'string' &&
        a.name.trim().length >= 2 &&
        a.name.length <= 100),
    'Enter your name.',
  );
  const id = crypto.randomUUID(),
    code = String(
      crypto.getRandomValues(new Uint32Array(1))[0] % 1000000,
    ).padStart(6, '0');
  const eligible = a.type === 'register' ? !account : !!account;
  if (eligible) {
    await db()
      .prepare(
        'INSERT INTO account_challenges(id,email,kind,payload,hash,expires) VALUES (?,?,?,?,?,?)',
      )
      .bind(
        id,
        email,
        a.type,
        JSON.stringify({
          name: a.name?.trim(),
          password: await passwordHash(a.password),
        }),
        await digest(`${id}:${code}`),
        new Date(Date.now() + 600000).toISOString(),
      )
      .run();
    await sendAccountCode(email, code, a.type === 'reset');
  }
  return json({
    challenge: id,
    message:
      a.type === 'reset'
        ? 'If this email has an account, we have sent a verification code.'
        : 'If this email is new, we have sent a verification code. If you already have an account, sign in or reset your password.',
  });
}
