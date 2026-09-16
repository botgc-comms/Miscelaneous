import { env } from 'cloudflare:workers';
import { demoOwner } from '@/lib/demo-session';
import { db, json, failure } from '@/lib/server';
export async function GET() {
  try {
    const owner = await demoOwner();
    const config = env as unknown as Record<string, string>;
    let domainStatus = 'Not connected';
    if (config.RESEND_API_KEY) {
      try {
        const r = await fetch('https://api.resend.com/domains', {
          headers: { Authorization: 'Bearer ' + config.RESEND_API_KEY },
          signal: AbortSignal.timeout(10000),
        });
        const data: any = await r.json();
        domainStatus = r.ok
          ? data.data?.find((d: any) => d.name === 'golfsixesleague.co.uk')
              ?.status || 'Domain not found'
          : r.status === 403
            ? 'Sending key configured; check domain verification in Resend'
            : 'Unable to verify the Resend connection';
      } catch {
        domainStatus = 'Unable to check Resend right now';
      }
    }
    const counts = await db()
      .prepare(
        "SELECT e.status,count(*) AS count FROM email_outbox e JOIN workspaces w ON w.id=e.workspace WHERE EXISTS(SELECT 1 FROM json_each(w.data,'$.members') m WHERE json_extract(m.value,'$.id')=? AND json_extract(m.value,'$.role')='admin') GROUP BY e.status",
      )
      .bind(owner.userId)
      .all();
    return json({
      enabled:
        config.EMAIL_DELIVERY_ENABLED === 'true' &&
        config.PRIVATE_PREVIEW !== 'true',
      sender: config.AUTH_FROM_EMAIL || '',
      domainStatus,
      counts: counts.results,
      google: !!config.GOOGLE_CLIENT_ID && !!config.GOOGLE_CLIENT_SECRET,
    });
  } catch (e) {
    return failure(e);
  }
}
