import { currentIdentity, digest, sitesSignInAvailable } from '@/lib/identity';
import { cookies } from 'next/headers';
import { db, json, failure, sameOrigin } from '@/lib/server';
import { AppError, requireThat } from '@/lib/model';
import { emailReady, limit, sendLoginCode } from '@/lib/email';
import { env } from 'cloudflare:workers';
const previewMode = () => !sitesSignInAvailable() && (env as unknown as Record<string, string>).PRIVATE_PREVIEW === 'true';
export async function GET() {
  try {
    const u = await currentIdentity();
    return json({
      user: u ? { name: u.displayName, email: u.email } : null,
      emailReady: !previewMode() && emailReady(),
      sitesSignIn: sitesSignInAvailable(),
      privatePreview: previewMode(),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const a: any = await req.json();
    requireThat(!previewMode() || a.type === 'preview' || a.type === 'logout', 'Use the private preview password to sign in.', 403);
    if (a.type === 'preview') {
      const config = env as unknown as Record<string, string>;
      requireThat(previewMode() && !!config.APP_PASSWORD, 'Private preview access is not configured.', 503);
      await limit('private-preview-login', 20, 600);
      requireThat(typeof a.password === 'string' && a.password.length <= 300 && await digest(a.password) === await digest(config.APP_PASSWORD), 'The preview password is incorrect.', 401);
      const row = await db().prepare('SELECT owner,data FROM workspaces ORDER BY updated DESC LIMIT 1').first<{owner: string; data: string}>();
      requireThat(row, 'Your data is still being transferred. Please try again shortly.', 503);
      const owner = JSON.parse(row.data).members.find((m: any) => m.id === row.owner && m.role === 'admin');
      requireThat(owner, 'The preview administrator has not been configured.', 503);
      const token = crypto.randomUUID() + crypto.randomUUID();
      await db().prepare('INSERT INTO sessions(hash,email,name,user_id,expires) VALUES (?,?,?,?,?)').bind(await digest(token), owner.email, owner.name, owner.id, new Date(Date.now() + 12 * 3600000).toISOString()).run();
      const response = json({ ok: true });
      response.headers.append('Set-Cookie', `golfsixes_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`);
      return response;
    }
    if (a.type === 'logout') {
      const token = (await cookies()).get('golfsixes_session')?.value;
      if (token)
        await db()
          .prepare('DELETE FROM sessions WHERE hash=?')
          .bind(await digest(token))
          .run();
      const r = json({ ok: true });
      r.headers.append(
        'Set-Cookie',
        'golfsixes_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
      );
      return r;
    }
    if (a.type === 'start') {
      requireThat(
        typeof a.email === 'string' &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email) &&
          a.email.length < 255,
        'Enter your email address.',
      );
      const email = a.email.trim().toLowerCase();
      await limit(`login:${email}`, 3, 600);
      requireThat(
        emailReady(),
        'Email sign-in is not connected yet. Use the signed-in account option for this private review.',
        503,
      );
      const id = crypto.randomUUID();
      const code = String(
        crypto.getRandomValues(new Uint32Array(1))[0] % 1000000,
      ).padStart(6, '0');
      const name =
        typeof a.name === 'string' && a.name.trim()
          ? a.name.trim().slice(0, 100)
          : email.split('@')[0];
      await db()
        .prepare(
          'INSERT INTO auth_challenges(id,email,name,hash,expires,attempts) VALUES (?,?,?,?,?,0)',
        )
        .bind(
          id,
          email,
          name,
          await digest(`${id}:${code}`),
          new Date(Date.now() + 600000).toISOString(),
        )
        .run();
      await sendLoginCode(email, code);
      return json({ challenge: id });
    }
    if (a.type === 'verify') {
      requireThat(
        typeof a.challenge === 'string' &&
          typeof a.code === 'string' &&
          /^\d{6}$/.test(a.code),
        'Enter the six-digit code from your email.',
      );
      const c = await db()
        .prepare(
          'UPDATE auth_challenges SET attempts=attempts+1 WHERE id=? AND expires > ? AND attempts < 5 RETURNING *',
        )
        .bind(a.challenge, new Date().toISOString())
        .first<{ id: string; email: string; name: string; hash: string }>();
      requireThat(
        c && (await digest(`${c.id}:${a.code}`)) === c.hash,
        'This code is incorrect or expired. Request a new one.',
      );
      const token = crypto.randomUUID() + crypto.randomUUID(),
        hash = await digest(token);
      // Email has now been verified. Reuse the migrated member ID so existing
      // families and club permissions are retained across hosting providers.
      const accounts = await db()
        .prepare(
          "SELECT DISTINCT json_extract(m.value,'$.id') AS id FROM workspaces, json_each(workspaces.data,'$.members') m WHERE lower(json_extract(m.value,'$.email'))=? AND demo=0",
        )
        .bind(c.email)
        .all<{ id: string }>();
      requireThat(
        accounts.results.length <= 1,
        'Your email is linked to more than one account. Ask your administrator to combine them before signing in.',
        409,
      );
      const userId =
        accounts.results[0]?.id || `email-${await digest(c.email)}`;
      const inserted = await db().batch([
        db()
          .prepare(
            'INSERT INTO sessions(hash,email,name,user_id,expires) SELECT ?,email,name,?,? FROM auth_challenges WHERE id=? AND hash=?',
          )
          .bind(
            hash,
            userId,
            new Date(Date.now() + 30 * 86400000).toISOString(),
            c.id,
            c.hash,
          ),
        db().prepare('DELETE FROM auth_challenges WHERE id=?').bind(c.id),
      ]);
      requireThat(
        inserted[0].meta.changes === 1,
        'This code has already been used. Request a new one.',
        409,
      );
      const r = json({ ok: true });
      r.headers.append(
        'Set-Cookie',
        `golfsixes_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`,
      );
      return r;
    }
    throw new AppError('Unknown sign-in action.');
  } catch (e) {
    return failure(e);
  }
}
