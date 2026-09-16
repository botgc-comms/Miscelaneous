import { env } from 'cloudflare:workers';
import { db } from './server';
import { AppError } from './model';
import { renderEmail, type EmailMessage } from './email-template';
export const emailReady = () => {
  const e = env as unknown as Record<string, string>;
  return !!e.RESEND_API_KEY && !!e.AUTH_FROM_EMAIL;
};
export async function deliverEmail(
  email: string,
  message: EmailMessage,
  id = crypto.randomUUID(),
) {
  if (!emailReady())
    throw new AppError(
      'Email delivery is not connected yet. Please contact your administrator.',
      503,
    );
  if (/@(.*\.)?(invalid|example|test)$|@example\.(com|org|net)$/i.test(email))
    throw new AppError(
      'Test addresses cannot receive real emails. Use the demo actor selector to view their updates.',
      400,
    );
  const e = env as unknown as Record<string, string>;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${e.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': id,
    },
    body: JSON.stringify({
      from: e.AUTH_FROM_EMAIL,
      to: [email],
      ...renderEmail(message),
    }),
  });
  if (!r.ok) {
    console.error('Resend delivery rejected with HTTP status', r.status);
    throw new AppError(
      'Email delivery is temporarily unavailable. Please try again shortly.',
      502,
    );
  }
  const result: any = await r.json();
  return result.id as string;
}
export async function sendParentJoiningEmail(
  email: string,
  club: string,
  league: string,
  link: string,
) {
  await deliverEmail(email, {
    subject: `Join ${club} for GolfSixes`,
    heading: 'Your family’s season starts here',
    paragraphs: [
      `You’re invited to register your children with ${club} for ${league}.`,
      'Create an account or sign in, add your children, then request their places. Your junior organiser will confirm each child’s team.',
      'If you weren’t expecting this invitation, you can ignore it.',
    ],
    action: { label: 'Register my children', url: link },
  });
}
export async function sendInvitationEmail(
  email: string,
  clubNames: string,
  link: string,
) {
  await deliverEmail(email, {
    subject: 'Your GolfSixes invitation',
    heading: 'You’re invited',
    paragraphs: [
      `You have been invited to join ${clubNames} on GolfSixes League.`,
      `Sign in or register with ${email}, then accept your invitation. It expires in 14 days.`,
      'If you weren’t expecting this invitation, you can ignore it.',
    ],
    action: { label: 'Accept invitation', url: link },
  });
}
export async function sendAccountCode(
  email: string,
  code: string,
  reset = false,
) {
  await deliverEmail(email, {
    subject: reset
      ? 'Reset your GolfSixes password'
      : 'Verify your GolfSixes email',
    heading: reset
      ? 'Confirm your password reset'
      : 'One last step to get started',
    paragraphs: [
      'Enter this code in the app. It expires in 10 minutes.',
      reset
        ? 'If you didn’t request a password reset, ignore this email. Your password has not changed.'
        : 'If you didn’t create an account, ignore this email.',
    ],
    code,
  });
}
export async function sendLoginCode(email: string, code: string) {
  await deliverEmail(email, {
    subject: 'Your GolfSixes sign-in code',
    heading: 'Let’s get you signed in',
    paragraphs: [
      'Enter this code in the app. It expires in 10 minutes.',
      'If you didn’t request this code, ignore this email.',
    ],
    code,
  });
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
