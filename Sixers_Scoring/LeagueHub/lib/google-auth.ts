import { env } from 'cloudflare:workers';
import { limit } from './email';
import { cookies } from 'next/headers';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { db, publicOrigin } from './server';
import { requireThat } from './model';
import { currentIdentity, digest } from './identity';
import { accountSession, canonicalUserId, type Account } from './accounts';
const config = () => env as unknown as Record<string, string>;
export const googleReady = () =>
  !!config().GOOGLE_CLIENT_ID && !!config().GOOGLE_CLIENT_SECRET;
const keys = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);
const cookie = (value: string, age = 600) =>
  `golfsixes_google=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`;
export async function beginGoogle(req: Request) {
  requireThat(googleReady(), 'Google sign-in is not configured yet.', 503);
  await limit('google-auth-start', 100, 60);
  const id = crypto.randomUUID(),
    verifier = crypto.randomUUID() + crypto.randomUUID(),
    nonce = crypto.randomUUID();
  const q = new URL(req.url).searchParams,
    target = q.get('return') || '/';
  const linking = q.get('link') === '1' ? await currentIdentity() : null;
  if (q.get('link') === '1')
    requireThat(linking, 'Sign in before connecting Google.', 401);
  const returnTo = target.startsWith('/?') || target === '/' ? target : '/';
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  const challenge = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  const browser = crypto.randomUUID() + crypto.randomUUID();
  await db()
    .prepare(
      "INSERT INTO account_challenges(id,email,kind,payload,hash,expires) VALUES (?,'','google',?,?,?)",
    )
    .bind(
      id,
      JSON.stringify({
        verifier,
        nonce,
        returnTo,
        linkUserId: linking?.userId,
      }),
      await digest(browser),
      new Date(Date.now() + 600000).toISOString(),
    )
    .run();
  const params = new URLSearchParams({
    client_id: config().GOOGLE_CLIENT_ID,
    redirect_uri: publicOrigin(req) + '/api/auth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state: id,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + params,
      'Set-Cookie': cookie(browser),
      'Cache-Control': 'no-store',
    },
  });
}
export async function finishGoogle(req: Request) {
  requireThat(googleReady(), 'Google sign-in is not configured.', 503);
  const q = new URL(req.url).searchParams,
    id = q.get('state'),
    code = q.get('code');
  const browser = (await cookies()).get('golfsixes_google')?.value;
  requireThat(
    id && code && browser,
    'Google sign-in was cancelled or expired. Please try again.',
  );
  const c = await db()
    .prepare(
      "DELETE FROM account_challenges WHERE id=? AND kind='google' AND hash=? AND expires>? RETURNING payload",
    )
    .bind(id, await digest(browser), new Date().toISOString())
    .first<{ payload: string }>();
  requireThat(c, 'Google sign-in expired. Please start again.');
  const p = JSON.parse(c.payload);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config().GOOGLE_CLIENT_ID,
      client_secret: config().GOOGLE_CLIENT_SECRET,
      redirect_uri: publicOrigin(req) + '/api/auth/google/callback',
      grant_type: 'authorization_code',
      code_verifier: p.verifier,
    }),
    signal: AbortSignal.timeout(15000),
  });
  requireThat(
    res.ok,
    'Google could not finish signing you in. Please try again.',
    502,
  );
  const tokens: any = await res.json();
  const { payload } = await jwtVerify(tokens.id_token, keys, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: config().GOOGLE_CLIENT_ID,
    algorithms: ['RS256'],
  });
  requireThat(
    payload.nonce === p.nonce &&
      payload.email_verified === true &&
      typeof payload.email === 'string' &&
      payload.sub,
    'Google could not verify this email address.',
    401,
  );
  const email = (payload.email as string).toLowerCase();
  const signedIn = p.linkUserId ? await currentIdentity() : null;
  if (p.linkUserId)
    requireThat(
      signedIn?.userId === p.linkUserId &&
        signedIn?.email?.toLowerCase() === email,
      'Choose the Google account with the same email address as your signed-in account.',
      409,
    );
  let account = await db()
    .prepare('SELECT * FROM accounts WHERE google_sub=?')
    .bind(payload.sub)
    .first<Account>();
  if (!account) {
    account = await db()
      .prepare('SELECT * FROM accounts WHERE email=?')
      .bind(email)
      .first<Account>();
    if (
      account &&
      signedIn?.userId === account.user_id &&
      p.linkUserId === account.user_id
    ) {
      requireThat(
        !account.google_sub || account.google_sub === payload.sub,
        'Another Google account is already connected.',
        409,
      );
      await db()
        .prepare('UPDATE accounts SET google_sub=? WHERE email=?')
        .bind(payload.sub, email)
        .run();
    } else {
      requireThat(
        !account || account.google_sub === payload.sub,
        'This email already has an account. Sign in with your password, then connect Google from your account settings.',
        409,
      );
      const uid = await canonicalUserId(email);
      await db()
        .prepare(
          'INSERT INTO accounts(email,user_id,name,google_sub,verified_at) VALUES (?,?,?,?,?)',
        )
        .bind(
          email,
          uid,
          typeof payload.name === 'string'
            ? payload.name.slice(0, 100)
            : email.split('@')[0],
          payload.sub,
          new Date().toISOString(),
        )
        .run();
      account = (await db()
        .prepare('SELECT * FROM accounts WHERE email=?')
        .bind(email)
        .first<Account>())!;
    }
  }
  const session = await accountSession(account, 'google');
  session.headers.set('Location', publicOrigin(req) + p.returnTo);
  session.headers.append('Set-Cookie', cookie('', 0));
  return new Response(null, { status: 303, headers: session.headers });
}
