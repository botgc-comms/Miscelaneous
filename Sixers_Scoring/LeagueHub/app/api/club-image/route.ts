import {
  context,
  db,
  files,
  user,
  sameOrigin,
  failure,
  mutate,
  type Row,
} from '@/lib/server';
import { canOrg, AppError, type State } from '@/lib/model';
import { imageType } from '@/lib/club-images';
export async function GET(req: Request) {
  try {
    await user();
    const q = new URL(req.url).searchParams;
    const row = await db()
      .prepare('SELECT * FROM workspaces WHERE id=? AND demo=0')
      .bind(q.get('workspace'))
      .first<Row>();
    const club =
      row &&
      (JSON.parse(row.data) as State).clubs.find(
        (c) => c.id === q.get('clubId'),
      );
    if (!club?.imageKey) throw new AppError('Club image not found.', 404);
    const file = await files().get(club.imageKey);
    if (!file) throw new AppError('Club image not found.', 404);
    return new Response(file.body, {
      headers: {
        'Content-Type': file.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  let key = '';
  try {
    sameOrigin(req);
    if (Number(req.headers.get('content-length') || 0) > 4_200_000)
      throw new AppError('Choose a photo smaller than 4 MB.');
    const form = await req.formData(),
      workspace = String(form.get('workspace') || ''),
      view = String(form.get('view') || '');
    const c = await context(workspace, view),
      club = c.state.clubs.find((c) => c.id === form.get('clubId'));
    if (!club || !canOrg(c.state, c.me, club.orgId))
      throw new AppError('You cannot change this club photo.', 403);
    const file = form.get('photo');
    if (!(file instanceof File) || file.size > 4_000_000)
      throw new AppError('Choose a JPEG, PNG or WebP photo smaller than 4 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer()),
      type = imageType(bytes);
    if (!type) throw new AppError('Choose a JPEG, PNG or WebP photo.');
    key = `club-images/${workspace}/${club.id}/${crypto.randomUUID()}`;
    await files().put(key, bytes, { httpMetadata: { contentType: type } });
    return Response.json(
      await mutate(workspace, view, {
        type: 'club-image-set',
        clubId: club.id,
        imageKey: key,
      }),
    );
  } catch (e) {
    if (key)
      await files()
        .delete(key)
        .catch(() => {});
    return failure(e);
  }
}
