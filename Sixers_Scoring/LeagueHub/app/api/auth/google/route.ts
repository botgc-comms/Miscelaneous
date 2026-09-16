import { beginGoogle } from '@/lib/google-auth';
import { failure } from '@/lib/server';
export async function GET(req: Request) {
  try {
    return await beginGoogle(req);
  } catch (e) {
    return failure(e);
  }
}
