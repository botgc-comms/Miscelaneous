import { files, json, failure, sameOrigin } from '@/lib/server';
import { familyContext, familyCAS, parentSnapshot } from '@/lib/families';
import { requireThat } from '@/lib/model';
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const c = await familyContext(
      q.get('demo') === '1',
      q.get('stage') || 'ready',
    );
    const p = c.family.children.find((p) => p.id === q.get('playerId'));
    requireThat(p?.photoKey, 'Photo not found.', 404);
    const file = await files().get(p.photoKey);
    requireThat(file, 'Photo not found.', 404);
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
export async function POST(req: Request) {
  let key = '',
    saved = false;
  try {
    sameOrigin(req);
    requireThat(
      Number(req.headers.get('content-length') || 0) < 2200000,
      'Choose a photo smaller than 2 MB.',
    );
    const form = await req.formData();
    const demo = form.get('demo') === '1',
      stage = String(form.get('stage') || 'ready'),
      c = await familyContext(demo, stage);
    const p = c.family.children.find((p) => p.id === form.get('playerId'));
    requireThat(p, 'Child not found.', 404);
    const file = form.get('photo');
    requireThat(
      file instanceof File && file.size <= 2000000 && file.size >= 12,
      'Choose a JPEG, PNG or WebP smaller than 2 MB.',
    );
    const bytes = new Uint8Array(await file.arrayBuffer());
    const png =
        bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71,
      jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      webp =
        new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
        new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
    requireThat(png || jpg || webp, 'Only JPEG, PNG and WebP are accepted.');
    key = `families/${c.row.id}/${p.id}/${crypto.randomUUID()}`;
    await files().put(key, bytes, {
      httpMetadata: {
        contentType: png ? 'image/png' : jpg ? 'image/jpeg' : 'image/webp',
      },
    });
    p.photoKey = key;
    c.family.pendingSync[p.id] = new Date().toISOString();
    requireThat(
      await familyCAS(c.row, c.family),
      'The child’s details changed. Try the upload again.',
      409,
    );
    saved = true;
    return json(await parentSnapshot(demo, stage));
  } catch (e) {
    if (key && !saved)
      await files()
        .delete(key)
        .catch(() => {});
    return failure(e);
  }
}
