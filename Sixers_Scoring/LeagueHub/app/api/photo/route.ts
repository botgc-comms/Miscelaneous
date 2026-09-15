import {
  context,
  json,
  failure,
  mutate,
  files,
  sameOrigin,
} from '@/lib/server';
import { AppError, canPlayer, canOrg } from '@/lib/model';
export async function POST(req: Request) {
  let key = '';
  try {
    sameOrigin(req);
    if (Number(req.headers.get('content-length') || 0) > 2200000)
      throw new AppError('Choose a photo smaller than 2 MB.');
    const form = await req.formData();
    const workspace = String(form.get('workspace') || ''),
      view = String(form.get('view') || '');
    const c = await context(workspace, view);
    const playerId = String(form.get('playerId') || '');
    const p = c.state.players.find((p) => p.id === playerId);
    if (p?.familyManaged)
      throw new AppError(
        'This photo is managed by the parent through My children.',
        403,
      );
    if (!p || !(p.parentId === c.me.id || canOrg(c.state, c.me, p.orgId)))
      throw new AppError('You cannot change this player’s photo.', 403);
    const file = form.get('photo');
    if (!(file instanceof File) || file.size > 2000000 || file.size < 12)
      throw new AppError('Choose a JPEG, PNG or WebP photo smaller than 2 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const png =
      bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
    const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp =
      new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
      new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
    if (!png && !jpg && !webp)
      throw new AppError('Only JPEG, PNG and WebP photos are accepted.');
    key = `${workspace}/${playerId}/${crypto.randomUUID()}`;
    await files().put(key, bytes, {
      httpMetadata: {
        contentType: png ? 'image/png' : jpg ? 'image/jpeg' : 'image/webp',
      },
    });
    const result = await mutate(workspace, view, {
      type: 'photo',
      playerId,
      photoKey: key,
    });
    if (p.photoKey)
      await files()
        .delete(p.photoKey)
        .catch(() => {});
    return json(result);
  } catch (e) {
    if (key)
      await files()
        .delete(key)
        .catch(() => {});
    return failure(e);
  }
}
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const c = await context(
      q.get('workspace') || undefined,
      q.get('view') || undefined,
    );
    const p = c.state.players.find((p) => p.id === q.get('playerId'));
    if (!p || !p.photoKey || !canPlayer(c.state, c.me, p))
      throw new AppError('Photo not found.', 404);
    const file = await files().get(p.photoKey);
    if (!file) throw new AppError('Photo not found.', 404);
    return new Response(file.body, {
      headers: {
        'Content-Type': file.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return failure(e);
  }
}
