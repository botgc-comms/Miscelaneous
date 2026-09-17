import { db, json, failure, sameOrigin, type Row } from '@/lib/server';
import {
  liveClockSession,
  liveViewingDate,
  setLiveViewingDate,
} from '@/lib/live-clock';
import { projectState, upgradeState } from '@/lib/model';

export async function GET() {
  try {
    const session = await liveClockSession();
    if (!session) return json({ available: false });
    const rows = await db()
      .prepare(
        "SELECT * FROM workspaces WHERE demo=0 AND EXISTS(SELECT 1 FROM json_each(workspaces.data,'$.members') m WHERE json_extract(m.value,'$.id')=?)",
      )
      .bind(session.identity.userId)
      .all<Row>();
    const fixtures = rows.results
      .flatMap((row) => {
        const s = upgradeState(JSON.parse(row.data));
        const me = s.members.find((m) => m.id === session.identity.userId);
        return me
          ? projectState(s, me)
              .fixtures.filter(
                (f) => f.status === 'scheduled' || f.status === 'live',
              )
              .map((f) => ({ id: f.id, name: f.name, date: f.date }))
          : [];
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    return json({ available: true, today: await liveViewingDate(), fixtures });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const body = (await req.json()) as { today?: unknown };
    await setLiveViewingDate(body.today);
    return json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
