import { json, failure, sameOrigin } from '@/lib/server';
import { adminContext } from '@/lib/assistant-server';
import { transcribeAudio } from '@/lib/assistant-provider';
import { boundedForm } from '@/lib/assistant-upload';
import { AUDIO_BYTES, validateAudio } from '@/lib/assistant-audio';
import { limit } from '@/lib/email';
import { AppError } from '@/lib/model';

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const q = new URL(req.url).searchParams;
    const c = await adminContext(q.get('workspace') || '', q.get('view') || '');
    await limit('assistant-voice:' + c.u.userId, 30, 3600);
    const form = await boundedForm(req, AUDIO_BYTES + 65536);
    const audio = form.get('audio');
    if (!(audio instanceof File))
      throw new AppError('Record your instruction first.');
    return json({
      text: await transcribeAudio(await validateAudio(audio), req.signal),
    });
  } catch (e) {
    return failure(e);
  }
}
