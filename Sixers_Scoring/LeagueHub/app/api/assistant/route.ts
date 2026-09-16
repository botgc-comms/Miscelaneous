import { json, failure, sameOrigin } from '@/lib/server';
import { AppError } from '@/lib/model';
import {
  readAttachments,
  ATTACHMENTS_BYTES,
  type AssistantAttachment,
} from '@/lib/assistant-attachments';
import { boundedForm } from '@/lib/assistant-upload';
import {
  assistantStatus,
  createAssistantJob,
  decideAssistantJob,
  adminContext,
} from '@/lib/assistant-server';
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    return json(
      await assistantStatus(q.get('workspace') || '', q.get('view') || ''),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    let b: any,
      attachments: AssistantAttachment[] = [];
    if (req.headers.get('content-type')?.includes('multipart/form-data')) {
      const form = await boundedForm(req, ATTACHMENTS_BYTES + 65536);
      b = Object.fromEntries(
        ['workspace', 'view', 'action', 'prompt', 'replyTo'].map((k) => [
          k,
          form.get(k),
        ]),
      );
      if (typeof b.workspace !== 'string')
        throw new AppError('Choose a workspace.');
      await adminContext(b.workspace, b.view);
      attachments = await readAttachments(
        [...form.getAll('attachments'), ...form.getAll('image')].filter(
          (f): f is File => f instanceof File,
        ),
      );
    } else {
      const raw = await req.text();
      if (raw.length > 10000)
        throw new AppError('This instruction is too long.');
      b = JSON.parse(raw);
    }
    if (typeof b.workspace !== 'string')
      throw new AppError('Choose a workspace.');
    return json(
      b.action === 'start' || b.action === 'reset'
        ? await createAssistantJob(
            b.workspace,
            b.view,
            b.action === 'reset' ? 'Start with an empty workspace' : b.prompt,
            b.action === 'reset',
            attachments,
            typeof b.replyTo === 'string' ? b.replyTo : undefined,
          )
        : await decideAssistantJob(b.workspace, b.view, b.id, b.action),
    );
  } catch (e) {
    return failure(e);
  }
}
