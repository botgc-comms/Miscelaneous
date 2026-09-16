export type EmailMessage = {
  subject: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  details?: { label: string; value: string }[];
  code?: string;
};
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
export function renderEmail(m: EmailMessage) {
  const e = escapeHtml;
  const url =
    m.action && /^https:\/\//.test(m.action.url) ? m.action.url : undefined;
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>${e(m.subject)}</title></head><body style="margin:0;background:#f3f7f5;font-family:Arial,Helvetica,sans-serif;color:#173e37"><div style="display:none;max-height:0;overflow:hidden">${e(m.paragraphs[0] || m.heading)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:auto;background:#fff;border:1px solid #dce7e1;border-radius:16px;overflow:hidden"><tr><td style="padding:28px 32px;background:#075b4c;color:#fff;font-size:23px;font-weight:bold">GolfSixes <span style="font-weight:normal">League</span></td></tr><tr><td style="padding:32px"><h1 style="font-size:27px;line-height:1.25;margin:0 0 24px">${e(m.heading)}</h1>${m.paragraphs.map((p) => `<p style="font-size:16px;line-height:1.65;margin:0 0 18px">${e(p)}</p>`).join('')}${m.code ? `<p style="padding:20px;background:#edf5ef;border-radius:8px;text-align:center;font-size:32px;letter-spacing:8px;font-weight:bold">${e(m.code)}</p>` : ''}${m.details?.length ? `<table role="presentation" width="100%" style="margin:20px 0;border-top:1px solid #dce7e1">${m.details.map((d) => `<tr><td style="padding:10px 0;color:#59736a;font-size:14px;width:32%;vertical-align:top">${e(d.label)}</td><td style="padding:10px 0;font-size:15px;line-height:1.5">${e(d.value)}</td></tr>`).join('')}</table>` : ''}${url ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0"><tr><td style="background:#087e67;border-radius:8px;text-align:center"><a href="${e(url)}" style="display:inline-block;padding:16px 24px;color:#fff;font-size:16px;font-weight:bold;text-decoration:none">${e(m.action!.label)} &rarr;</a></td></tr></table><p style="font-size:12px;color:#61786f;word-break:break-all">Button not opening? Copy this link into your browser:<br><a href="${e(url)}" style="color:#087e67">${e(url)}</a></p>` : ''}</td></tr><tr><td style="padding:24px 32px;background:#edf5ef;color:#59736a;font-size:13px;line-height:1.6">A little golf. A lot to look forward to.<br>GolfSixes League · This is a service message about your account or season.<br>For fixture questions, contact your junior organiser through the app.</td></tr></table></td></tr></table></body></html>`;
  const text = [
    m.heading,
    ...m.paragraphs,
    m.code || '',
    ...(m.details || []).map((d) => `${d.label}: ${d.value}`),
    url ? `${m.action!.label}: ${url}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { subject: m.subject, html, text };
}
