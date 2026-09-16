import {
  context,
  db,
  files,
  user,
  sameOrigin,
  failure,
  json,
  type Row,
} from '@/lib/server';
import { AppError, canOrg, type State } from '@/lib/model';
import { imageType } from '@/lib/club-images';
import {
  logoId,
  updateLogo,
  logoRows,
  type LogoData,
} from '@/lib/club-logo-jobs';
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
    if (!club) throw new AppError('Club not found.', 404);
    const logo = await db()
      .prepare('SELECT data FROM club_logos WHERE id=? AND website=?')
      .bind(logoId(row!.id, club.id), club.website || 'manual')
      .first<{ data: string }>();
    const data: LogoData = logo ? JSON.parse(logo.data) : {};
    if (!data.key) throw new AppError('Logo not found.', 404);
    const file = await files().get(data.key);
    if (!file) throw new AppError('Logo not found.', 404);
    return new Response(file.body, {
      headers: {
        'Content-Type': file.httpMetadata?.contentType || 'image/png',
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    if (Number(req.headers.get('content-length') || 0) > 4_200_000)
      throw new AppError('Choose a logo smaller than 4 MB.');
    const form = await req.formData(),
      c = await context(
        String(form.get('workspace') || ''),
        String(form.get('view') || ''),
      ),
      club = c.state.clubs.find((v) => v.id === form.get('clubId'));
    if (!club || !canOrg(c.state, c.me, club.orgId))
      throw new AppError('You cannot change this club logo.', 403);
    const type = String(form.get('action') || '');
    if (type === 'upload') {
      const file = form.get('file');
      if (!(file instanceof File) || file.size > 4_000_000)
        throw new AppError(
          'Choose a JPEG, PNG or WebP logo smaller than 4 MB.',
        );
      const bytes = new Uint8Array(await file.arrayBuffer()),
        mime = imageType(bytes);
      if (!mime) throw new AppError('Choose a JPEG, PNG or WebP logo.');
      const key = `club-logos/${c.row.id}/${club.id}/${crypto.randomUUID()}`;
      await files().put(key, bytes, { httpMetadata: { contentType: mime } });
      await updateLogo(c.row.id, club, {
        status: 'manual',
        key,
        original: undefined,
        message: 'Uploaded logo',
      });
    } else if (type === 'remove')
      await updateLogo(c.row.id, club, {
        status: 'none',
        key: undefined,
        original: undefined,
        message: undefined,
      });
    else if (type === 'retry') {
      if (!club.website) throw new AppError('Add the club’s website first.');
      await updateLogo(c.row.id, club, {
        status: 'queued',
        responseId: undefined,
        message: undefined,
      });
    } else if (type === 'original') {
      const row = (await logoRows(c.row.id)).find((v) => v.club_id === club.id),
        d: LogoData = row ? JSON.parse(row.data) : ({} as LogoData);
      if (!d.original) throw new AppError('No original logo is available.');
      await updateLogo(c.row.id, club, {
        status: 'manual',
        key: d.original,
        message: 'Original website logo',
      });
    } else throw new AppError('Unknown logo action.');
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
