import { env } from 'cloudflare:workers';
import { db } from './server';
import { AppError } from './model';
export function emailReady() {
  const e = env as unknown as Record<string, string>;
  return !!e.RESEND_API_KEY && !!e.AUTH_FROM_EMAIL;
}
export async function sendParentJoiningEmail(
  email: string,
  club: string,
  league: string,
  link: string,
) {
  if (!emailReady())
    throw new AppError(
      'Email delivery is not connected yet. Use “Open in my email app” or copy the joining link.',
      503,
    );
  const e = env as unknown as Record<string, string>;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${e.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: e.AUTH_FROM_EMAIL,
      to: [email],
      subject: `Join ${club} for GolfSixes`,
      text: `You’re invited to register your children with ${club} for ${league}.\n\nRegister or sign in, add your children, then request their places:\n${link}\n\nYour junior organiser will confirm each child’s team. We look forward to welcoming you!\n\nIf you weren’t expecting this invitation, you can ignore it.`,
    }),
  });
  if (!r.ok)
    throw new AppError(
      'The invitation could not be sent. Try your email app or copy the joining link.',
      502,
    );
}
export async function sendInvitationEmail(
  email: string,
  clubNames: string,
  link: string,
) {
  if (!emailReady())
    throw new AppError(
      'Email delivery is not connected yet. Copy the invitation link to share it directly.',
      503,
    );
  const e = env as unknown as Record<string, string>;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${e.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: e.AUTH_FROM_EMAIL,
      to: [email],
      subject: 'Your GolfSixes invitation',
      text: `You have been invited to join ${clubNames} on GolfSixes. Sign in with ${email} and accept your invitation:\n\n${link}\n\nThis invitation expires after 14 days. If you were not expecting it, you can ignore it.`,
    }),
  });
  if (!r.ok)
    throw new AppError(
      'The email could not be sent. You can copy the invitation link or try sending again.',
      502,
    );
}
export async function limit(key: string, max: number, seconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const r = await db()
    .prepare(
      'INSERT INTO rate_limits(id,count,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires <= ? THEN 1 ELSE count+1 END, expires=CASE WHEN expires <= ? THEN excluded.expires ELSE expires END RETURNING count',
    )
    .bind(key, now + seconds, now, now)
    .first<{ count: number }>();
  if ((r?.count || 0) > max)
    throw new AppError(
      'Too many attempts. Please wait a few minutes and try again.',
      429,
    );
}
export async function sendLoginCode(email: string, code: string) {
  if (!emailReady())
    throw new AppError(
      'Email sign-in is not connected yet. Use the signed-in account option for this private review.',
      503,
    );
  const e = env as unknown as Record<string, string>;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${e.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: e.AUTH_FROM_EMAIL,
      to: [email],
      subject: 'Your GolfSixes sign-in code',
      text: `Your GolfSixes sign-in code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this message.`,
    }),
  });
  if (!r.ok)
    throw new AppError(
      'We could not send your code. Please try again shortly.',
      502,
    );
}
