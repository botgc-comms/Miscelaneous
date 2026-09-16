import { json, failure, sameOrigin } from '@/lib/server';
import { parentSnapshot, saveChild, requestTeam } from '@/lib/families';
import { AppError } from '@/lib/model';
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    return json(
      await parentSnapshot(q.get('demo') === '1', q.get('stage') || 'ready'),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const b: any = await req.json();
    if (b.type === 'child')
      return json(await saveChild(b, !!b.demo, b.stage || 'ready'));
    if (b.type === 'request-team')
      return json(await requestTeam(b, !!b.demo, b.stage || 'ready'));
    throw new AppError('Unknown parent action.');
  } catch (e) {
    return failure(e);
  }
}
