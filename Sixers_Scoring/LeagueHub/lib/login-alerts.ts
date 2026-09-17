import { env } from 'cloudflare:workers';
import { db } from './server';
import type { EmailMessage } from './email-template';
export const LOGIN_ALERT_RECIPIENT = 'simon@maraboustork.co.uk';
export function loginAlertMessage(
  account: { email: string; name: string },
  method: string,
  at: string,
): EmailMessage | null {
  const email = account.email.trim().toLowerCase();
  if (
    email === LOGIN_ALERT_RECIPIENT ||
    /@(.*\.)?(invalid|example|test)$|@example\.(com|org|net)$/i.test(email) ||
    method === 'preview'
  )
    return null;
  const methods: Record<string, string> = {
    password: 'Email and password',
    google: 'Google',
    email: 'Email sign-in code',
    verified: 'Email verification',
  };
  return {
    subject: 'Someone signed in to GolfSixes League',
    heading: 'A new sign-in to GolfSixes League',
    paragraphs: [
      'Someone other than you has successfully signed in. This records a sign-in, not an anonymous visit or a brochure view.',
    ],
    details: [
      { label: 'Name', value: account.name },
      { label: 'Email', value: email },
      {
        label: 'Signed in',
        value:
          new Date(at).toLocaleString('en-GB', {
            timeZone: 'Europe/London',
            dateStyle: 'full',
            timeStyle: 'short',
          }) + ' (UK time)',
      },
      { label: 'Method', value: methods[method] || 'Verified account' },
    ],
  };
}
/** Record only completed authentication. Delivery happens through the retryable outbox. */
export async function queueLoginAlert(
  account: { email: string; name: string },
  method: string,
) {
  const config = env as unknown as Record<string, string>;
  if (
    config.PRIVATE_PREVIEW === 'true' ||
    config.LOGIN_ALERTS_ENABLED === 'false'
  )
    return;
  const now = new Date().toISOString(),
    message = loginAlertMessage(account, method, now);
  if (!message) return;
  try {
    await db()
      .prepare(
        "INSERT INTO email_outbox(id,recipient,payload,status,available_at,created_at) VALUES (?,?,?,'queued',?,?)",
      )
      .bind(
        'login-alert:' + crypto.randomUUID(),
        LOGIN_ALERT_RECIPIENT,
        JSON.stringify(message),
        now,
        now,
      )
      .run();
  } catch {
    console.error('Unable to queue the successful sign-in notification.');
  }
}
