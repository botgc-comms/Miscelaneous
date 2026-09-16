import { env } from 'cloudflare:workers';
import { digest } from '@/lib/identity';
import { runEmailWorker } from '@/lib/email-outbox';
export async function POST(req: Request) {
  const secret = (env as unknown as Record<string, string>).EMAIL_WORKER_SECRET;
  if (
    !secret ||
    (await digest(req.headers.get('authorization') || '')) !==
      (await digest('Bearer ' + secret))
  )
    return new Response(null, { status: 403 });
  return Response.json(await runEmailWorker());
}
