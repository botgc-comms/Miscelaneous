import { cookies } from 'next/headers';
import { currentIdentity, digest } from './identity';
import { db } from './server';
import { requireThat } from './model';

export const canTimeTravelLive = (email?: string) =>
  email?.trim().toLowerCase() === 'simon@maraboustork.co.uk';

export async function liveClockSession() {
  const identity = await currentIdentity();
  const token = (await cookies()).get('golfsixes_session')?.value;
  if (!identity || !token || !canTimeTravelLive(identity.email)) return null;
  const hash = await digest(token);
  const session = await db()
    .prepare(
      'SELECT hash FROM sessions WHERE hash=? AND user_id=? AND expires>?',
    )
    .bind(hash, identity.userId, new Date().toISOString())
    .first();
  return session ? { identity, hash } : null;
}

/** A viewing date belongs to this authenticated session, never the workspace. */
export async function liveViewingDate() {
  const session = await liveClockSession();
  if (!session) return undefined;
  const row = await db()
    .prepare('SELECT today FROM live_view_dates WHERE session_hash=?')
    .bind(session.hash)
    .first<{ today: string }>();
  return row?.today;
}

export async function setLiveViewingDate(today: unknown) {
  const session = await liveClockSession();
  requireThat(
    session,
    'Live time travel is not available for this account.',
    403,
  );
  requireThat(
    today === null ||
      (typeof today === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(today) &&
        !Number.isNaN(Date.parse(today)) &&
        new Date(today).toISOString().slice(0, 10) === today),
    'Choose a valid date.',
  );
  if (today === null) {
    await db()
      .prepare('DELETE FROM live_view_dates WHERE session_hash=?')
      .bind(session.hash)
      .run();
  } else {
    await db()
      .prepare(
        'INSERT INTO live_view_dates(session_hash,today) VALUES (?,?) ON CONFLICT(session_hash) DO UPDATE SET today=excluded.today',
      )
      .bind(session.hash, today)
      .run();
  }
}
