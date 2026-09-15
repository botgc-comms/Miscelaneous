import { AppError } from './model';
export const AUDIO_BYTES = 8 * 1024 * 1024;
export const RECORDING_SECONDS = 90;
export async function validateAudio(file: File) {
  if (!file.size || file.size > AUDIO_BYTES)
    throw new AppError(
      'Record a voice instruction of up to 90 seconds (8 MB maximum).',
    );
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const head = (s: number, e: number) => String.fromCharCode(...b.slice(s, e));
  const format = [0x1a, 0x45, 0xdf, 0xa3].every((v, i) => b[i] === v)
    ? { mime: 'audio/webm', ext: 'webm' }
    : head(4, 8) === 'ftyp'
      ? { mime: 'audio/mp4', ext: 'mp4' }
      : head(0, 4) === 'RIFF' && head(8, 12) === 'WAVE'
        ? { mime: 'audio/wav', ext: 'wav' }
        : null;
  if (!format)
    throw new AppError(
      'This recording format is not supported. Please try Chrome, Edge or Safari, or type your instruction.',
    );
  return new File([file], `instruction.${format.ext}`, { type: format.mime });
}
