import { env } from 'cloudflare:workers';
import { cookies } from 'next/headers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
export const sitesSignInAvailable = () =>
  (env as unknown as { GOLFSIXES_RUNTIME?: string }).GOLFSIXES_RUNTIME !==
  'node';
export async function digest(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
export async function currentIdentity() {
  const cookie = (await cookies()).get('golfsixes_session')?.value;
  if (cookie) {
    const row = await (env as unknown as { DB: D1Database }).DB.prepare(
      'SELECT email,name,user_id FROM sessions WHERE hash = ? AND expires > ?',
    )
      .bind(await digest(cookie), new Date().toISOString())
      .first<{ email: string; name: string; user_id: string }>();
    if (row)
      return {
        userId: row.user_id,
        email: row.email,
        displayName: row.name,
        fullName: row.name,
      };
  }
  return getChatGPTUser();
}
