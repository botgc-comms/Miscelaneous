import { NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
export async function middleware(req: NextRequest) {
  const config = env as unknown as Record<string, string>;
  const path = req.nextUrl.pathname;
  if (
    config.GOLFSIXES_PUBLIC_ORIGIN &&
    req.method === 'GET' &&
    ['junior-golf-sixes.onrender.com', 'www.golfsixesleague.co.uk'].includes(
      req.nextUrl.hostname,
    ) &&
    req.nextUrl.origin !== config.GOLFSIXES_PUBLIC_ORIGIN
  )
    return NextResponse.redirect(
      new URL(path + req.nextUrl.search, config.GOLFSIXES_PUBLIC_ORIGIN),
    );
  if (!path.startsWith('/api/')) return NextResponse.next();
  const token = req.cookies.get('golfsixes_session')?.value;
  let hash = '';
  if (token) {
    const bytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(token),
    );
    hash = Array.from(new Uint8Array(bytes), (v) =>
      v.toString(16).padStart(2, '0'),
    ).join('');
  }
  const db = (env as unknown as { DB: D1Database }).DB;
  if (
    hash &&
    req.method !== 'GET' &&
    [
      '/api/invite',
      '/api/registration',
      '/api/login-help',
      '/api/parent-invitation',
      '/api/invitations',
      '/api/backup',
    ].includes(path)
  ) {
    const demo = await db
      .prepare('SELECT workspace FROM demo_sessions WHERE session_hash=?')
      .bind(hash)
      .first();
    if (demo)
      return NextResponse.json(
        {
          error:
            'Demo mode does not send real invitations or change live accounts. Use the demo actor selector to try these roles.',
        },
        { status: 403 },
      );
  }
  if (
    config.GOLFSIXES_RUNTIME !== 'node' ||
    config.PRIVATE_PREVIEW !== 'true' ||
    ['/api/auth', '/api/backup', '/api/internal/email'].includes(path)
  )
    return NextResponse.next();
  if (
    hash &&
    (await db
      .prepare('SELECT user_id FROM sessions WHERE hash=? AND expires>?')
      .bind(hash, new Date().toISOString())
      .first())
  )
    return NextResponse.next();
  return NextResponse.json(
    { error: 'Enter the private preview password to continue.' },
    { status: 401 },
  );
}
