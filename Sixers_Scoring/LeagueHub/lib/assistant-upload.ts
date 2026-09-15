import { AppError } from './model';

// Bound chunked requests too; Content-Length alone is not a reliable size limit.
export async function boundedForm(req: Request, max: number) {
  if (Number(req.headers.get('content-length') || 0) > max)
    throw new AppError('These attachments are too large.', 413);
  const reader = req.body?.getReader();
  if (!reader) throw new AppError('Choose a file.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel();
        throw new AppError('These attachments are too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(new Blob(chunks as BlobPart[]), {
    headers: { 'Content-Type': req.headers.get('content-type') || '' },
  }).formData();
}
