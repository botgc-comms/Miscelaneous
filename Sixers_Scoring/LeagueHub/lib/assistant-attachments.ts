import { AppError } from './model';

export const ATTACHMENT_LIMIT = 5;
export const ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const ATTACHMENTS_BYTES = 12 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.csv,.txt';
export type AssistantAttachment = {
  name: string;
  kind: 'image' | 'pdf' | 'text';
  data: string;
};

export function checkAttachments(files: { name: string; size: number }[]) {
  if (files.length > ATTACHMENT_LIMIT)
    throw new AppError('Attach up to 5 files per message.');
  if (files.some((f) => !/\.(jpe?g|png|webp|pdf|csv|txt)$/i.test(f.name)))
    throw new AppError('Choose JPG, PNG, WebP, PDF, CSV or TXT files.');
  if (files.some((f) => !f.size || f.size > ATTACHMENT_BYTES))
    throw new AppError(
      'Each attachment must be non-empty and no larger than 4 MB.',
    );
  if (files.reduce((total, f) => total + f.size, 0) > ATTACHMENTS_BYTES)
    throw new AppError('Keep the combined attachments under 12 MB.');
}

export async function readAttachments(
  files: File[],
): Promise<AssistantAttachment[]> {
  checkAttachments(files);
  const attachments: AssistantAttachment[] = [];
  let textLength = 0;
  for (const file of files) {
    const name = file.name.replace(/[\x00-\x1f]/g, '').slice(0, 200);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const head = (start: number, end: number) =>
      String.fromCharCode(...bytes.slice(start, end));
    const mime =
      bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'image/jpeg'
        : [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
          ? 'image/png'
          : head(0, 4) === 'RIFF' && head(8, 12) === 'WEBP'
            ? 'image/webp'
            : head(0, 5) === '%PDF-'
              ? 'application/pdf'
              : '';
    if (/\.(txt|csv)$/i.test(name)) {
      let data: string;
      try {
        data = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new AppError(`${name}: save this file as UTF-8 text or CSV.`);
      }
      if (/[\x00-\x08\x0e-\x1f]/.test(data))
        throw new AppError(`${name} is not a text file.`);
      textLength += data.length;
      if (textLength > 100000)
        throw new AppError(
          'Text and CSV attachments can contain up to 100,000 characters in total. Split them into smaller requests.',
        );
      attachments.push({ name, kind: 'text', data });
    } else {
      if (
        !mime ||
        (name.toLowerCase().endsWith('.pdf')
          ? mime !== 'application/pdf'
          : !mime.startsWith('image/'))
      )
        throw new AppError(
          `${name}: the file contents do not match a supported image or PDF.`,
        );
      attachments.push({
        name,
        kind: mime === 'application/pdf' ? 'pdf' : 'image',
        data: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
      });
    }
  }
  return attachments;
}

export function attachmentInputs(attachments: AssistantAttachment[]) {
  return attachments.flatMap((file): Record<string, unknown>[] => [
    {
      type: 'input_text',
      text: JSON.stringify({
        attachment: file.name,
        ...(file.kind === 'text' ? { content: file.data } : {}),
      }),
    },
    ...(file.kind === 'image'
      ? [{ type: 'input_image', image_url: file.data }]
      : file.kind === 'pdf'
        ? [{ type: 'input_file', filename: file.name, file_data: file.data }]
        : []),
  ]);
}
