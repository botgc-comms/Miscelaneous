import { LOGIN_ALERT_RECIPIENT } from './login-alerts';
import { env } from 'cloudflare:workers';
import { db, type Row } from './server';
import { deliverEmail, emailReady } from './email';
import { scheduledEmails, type PlannedEmail } from './season-emails';
import { londonDay } from './team-priority';
const testAddress = (email: string) =>
  /@(.*\.)?(invalid|example|test)$|@example\.(com|org|net)$/i.test(email);
export function queueStatement(
  p: PlannedEmail,
  workspace: string,
  revision?: number,
) {
  const now = new Date().toISOString();
  return db()
    .prepare(
      'INSERT OR IGNORE INTO email_outbox(id,workspace,recipient,payload,status,available_at,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=? AND demo=0' +
        (revision === undefined ? '' : ' AND revision=?') +
        ')',
    )
    .bind(
      p.id,
      workspace,
      p.recipient,
      JSON.stringify(p.message),
      testAddress(p.recipient) ? 'suppressed' : 'queued',
      now,
      now,
      workspace,
      ...(revision === undefined ? [] : [revision]),
    );
}
let working = false;
export async function runEmailWorker() {
  const config = env as unknown as Record<string, string>;
  if (!working && config.EMAIL_SMOKE_TEST_ID && emailReady())
    await smokeTest(config.EMAIL_SMOKE_TEST_ID);
  if (
    working ||
    !emailReady() ||
    config.PRIVATE_PREVIEW === 'true' ||
    config.EMAIL_DELIVERY_ENABLED !== 'true'
  )
    return { enabled: false };
  working = true;
  try {
    const rows = (
      await db().prepare('SELECT * FROM workspaces WHERE demo=0').all<Row>()
    ).results;
    const reminders = rows.flatMap((w) =>
      scheduledEmails(
        JSON.parse(w.data),
        w.id,
        config.GOLFSIXES_PUBLIC_ORIGIN,
        londonDay(),
      ).map((p) => ({ p, w })),
    );
    for (const { p, w } of reminders) await queueStatement(p, w.id).run();
    // A reminder that no longer applies must not be sent after an availability/fixture update.
    const valid = new Set(reminders.map((r) => r.p.id));
    const candidates = (
      await db()
        .prepare(
          "SELECT id,workspace,recipient,payload,created_at FROM email_outbox WHERE (status='queued' OR status='sending') AND available_at<=? ORDER BY created_at LIMIT 30",
        )
        .bind(new Date().toISOString())
        .all<{
          id: string;
          workspace: string;
          recipient: string;
          payload: string;
          created_at: string;
        }>()
    ).results;
    let sent = 0;
    for (const job of candidates) {
      const old = Date.now() - Date.parse(job.created_at) > 23 * 3600000;
      if (
        old ||
        ((job.id.startsWith('reminder:') || job.id.startsWith('selection:')) &&
          !valid.has(job.id)) ||
        (!(
          job.id.startsWith('login-alert:') &&
          !job.workspace &&
          job.recipient === LOGIN_ALERT_RECIPIENT &&
          config.LOGIN_ALERTS_ENABLED !== 'false'
        ) &&
          !rows.some((w) => w.id === job.workspace))
      ) {
        await db()
          .prepare('UPDATE email_outbox SET status=?,error=? WHERE id=?')
          .bind(
            old ? 'review' : 'superseded',
            old ? 'Delivery window expired; review before resending.' : null,
            job.id,
          )
          .run();
        continue;
      }
      const claimed = await db()
        .prepare(
          "UPDATE email_outbox SET status='sending',attempts=attempts+1,available_at=? WHERE id=? AND (status='queued' OR status='sending') AND available_at<=? RETURNING attempts",
        )
        .bind(
          new Date(Date.now() + 120000).toISOString(),
          job.id,
          new Date().toISOString(),
        )
        .first<{ attempts: number }>();
      if (!claimed) continue;
      try {
        const current = reminders.find((r) => r.p.id === job.id)?.p.message;
        const provider = await deliverEmail(
          job.recipient,
          current || JSON.parse(job.payload),
          job.id,
        );
        await db()
          .prepare(
            "UPDATE email_outbox SET status='sent',sent_at=?,provider_id=?,error=NULL WHERE id=?",
          )
          .bind(new Date().toISOString(), provider, job.id)
          .run();
        sent++;
      } catch {
        await db()
          .prepare(
            'UPDATE email_outbox SET status=?,available_at=?,error=? WHERE id=?',
          )
          .bind(
            claimed.attempts >= 8 ? 'failed' : 'queued',
            new Date(
              Date.now() + Math.min(3600000, 60000 * 2 ** claimed.attempts),
            ).toISOString(),
            'Delivery failed; check the email service configuration.',
            job.id,
          )
          .run();
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    await db()
      .prepare('DELETE FROM account_challenges WHERE expires<?')
      .bind(new Date().toISOString())
      .run();
    return { enabled: true, sent };
  } finally {
    working = false;
  }
}

async function smokeTest(id: string) {
  const key = 'smoke:' + id,
    now = new Date().toISOString();
  await db()
    .prepare(
      "INSERT OR IGNORE INTO email_outbox(id,recipient,payload,status,available_at,created_at) VALUES (?,'delivered@resend.dev','{}','internal-test',?,?)",
    )
    .bind(key, now, now)
    .run();
  const claim = await db()
    .prepare(
      "UPDATE email_outbox SET attempts=attempts+1,available_at=? WHERE id=? AND status='internal-test' AND attempts<3 AND available_at<=? RETURNING id",
    )
    .bind(new Date(Date.now() + 300000).toISOString(), key, now)
    .first();
  if (!claim) return;
  try {
    const provider = await deliverEmail(
      'delivered@resend.dev',
      {
        subject: 'GolfSixes deployment delivery check',
        heading: 'Email connection check',
        paragraphs: [
          'This message is sent only to the Resend test sink to validate the GolfSixes sender configuration.',
        ],
      },
      key,
    );
    await db()
      .prepare(
        "UPDATE email_outbox SET status='sent',sent_at=?,provider_id=? WHERE id=?",
      )
      .bind(now, provider, key)
      .run();
    console.log('GOLFSIXES_EMAIL_CHECK: accepted by Resend');
  } catch {
    console.error(
      'GOLFSIXES_EMAIL_CHECK: failed; check Resend key and verified sender domain',
    );
  }
}
