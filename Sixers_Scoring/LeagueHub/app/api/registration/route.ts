import { json, failure, sameOrigin } from '@/lib/server';
import { AppError } from '@/lib/model';
import { registrationSnapshot, register } from '@/lib/registration';
export async function GET() {
  try {
    return json(await registrationSnapshot());
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    if (Number(req.headers.get('content-length') || 0) > 10000)
      throw new AppError('This registration is too large.');
    return json(await register(await req.json()));
  } catch (e) {
    return failure(e);
  }
}
