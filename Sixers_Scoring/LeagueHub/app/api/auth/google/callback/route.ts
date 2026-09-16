import { finishGoogle } from '@/lib/google-auth';
import { publicOrigin } from '@/lib/server';
export async function GET(req: Request) {
  try {
    return await finishGoogle(req);
  } catch {
    return Response.redirect(publicOrigin(req) + '/?auth=google-error', 303);
  }
}
