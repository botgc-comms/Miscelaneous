import { db } from '@/lib/server';
export async function GET() {
  try {
    await db().prepare('SELECT 1 AS ok').first();
    return Response.json({ status: 'ok' });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
