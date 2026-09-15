import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const folder = path.resolve('work/tests/assistant-inputs');
await mkdir(folder, { recursive: true });
for (const name of [
  'assistant-attachments',
  'assistant-audio',
  'assistant-upload',
  'assistant-provider',
]) {
  const js = ts
    .transpileModule(await readFile(`lib/${name}.ts`, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(/from 'cloudflare:workers'/g, "from './env'")
    .replace(
      /from '\.\/(.*?)'/g,
      (_, n) =>
        `from '${['model', 'assistant-plan'].includes(n) ? '../' : './'}${n}.mjs'`,
    );
  await writeFile(path.join(folder, name + '.mjs'), js);
}
await writeFile(
  path.join(folder, 'env.mjs'),
  `export const env = {OPENAI_API_KEY: 'test-only-key'};`,
);
const load = (n) => import(pathToFileURL(path.join(folder, n + '.mjs')));
const {
  readAttachments,
  checkAttachments,
  attachmentInputs,
  ATTACHMENT_BYTES,
} = await load('assistant-attachments');
const { validateAudio, AUDIO_BYTES } = await load('assistant-audio');
const { boundedForm } = await load('assistant-upload');
const { startResponse, transcribeAudio } = await load('assistant-provider');
const { demoState } = await import(
  pathToFileURL(path.resolve('work/tests/demo.mjs'))
);
const png = new File(
  [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])],
  'club.png',
  { type: 'image/png' },
);
test('mixed attachments preserve order, filenames and every image/document in the AI request', async () => {
  const files = [
    png,
    new File([await png.arrayBuffer()], 'second.png'),
    new File(['%PDF-1.7\n'], 'league.pdf'),
    new File(['Club,County\nBurton,Staffordshire'], 'clubs.csv'),
  ];
  const attachments = await readAttachments(files);
  assert.deepEqual(
    attachments.map((f) => f.kind),
    ['image', 'image', 'pdf', 'text'],
  );
  const inputs = attachmentInputs(attachments);
  assert.equal(inputs.filter((f) => f.type === 'input_image').length, 2);
  assert.equal(
    inputs.find((f) => f.type === 'input_file').filename,
    'league.pdf',
  );
  assert.match(inputs.at(-1).text, /Burton,Staffordshire/);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_, options) => {
      const request = JSON.parse(options.body);
      assert.deepEqual(request.input[0].content.slice(1), inputs);
      assert.equal(request.background, true);
      return Response.json({ id: 'response-multiple' });
    };
    await startResponse('Review these files', demoState(), attachments);
  } finally {
    globalThis.fetch = original;
  }
});
test('rejects excess count, individual size, combined size and unsupported types', () => {
  assert.throws(() => checkAttachments(Array(6).fill(png)), /up to 5/);
  assert.throws(
    () => checkAttachments([{ name: 'x.pdf', size: ATTACHMENT_BYTES + 1 }]),
    /4 MB/,
  );
  assert.throws(
    () =>
      checkAttachments(
        Array(4).fill({ name: 'x.pdf', size: ATTACHMENT_BYTES }),
      ),
    /12 MB/,
  );
  assert.throws(
    () => checkAttachments([{ name: 'x.exe', size: 10 }]),
    /Choose JPG/,
  );
  assert.throws(
    () => checkAttachments([{ name: 'x.png', size: 0 }]),
    /non-empty/,
  );
});
test('validates actual image/PDF and UTF-8 text contents, with a text budget', async () => {
  await assert.rejects(
    () => readAttachments([new File(['not a PNG'], 'fake.png')]),
    /contents/,
  );
  await assert.rejects(
    async () =>
      readAttachments([new File([await png.arrayBuffer()], 'fake.pdf')]),
    /contents/,
  );
  await assert.rejects(
    () => readAttachments([new File([Uint8Array.from([255, 255])], 'bad.txt')]),
    /UTF-8/,
  );
  await assert.rejects(
    () => readAttachments([new File(['a\0b'], 'binary.csv')]),
    /not a text/,
  );
  await assert.rejects(
    () => readAttachments([new File(['a'.repeat(100001)], 'long.txt')]),
    /100,000/,
  );
});
test('multipart size limits hold when Content-Length is absent', async () => {
  const form = new FormData();
  form.append('attachments', png);
  form.append('attachments', new File(['hello'], 'notes.txt'));
  const make = () =>
    new Request('https://example.test', { method: 'POST', body: form });
  assert.equal(
    (await boundedForm(make(), 4096)).getAll('attachments').length,
    2,
  );
  const raw = await make().arrayBuffer();
  const chunked = new Request('https://example.test', {
    method: 'POST',
    duplex: 'half',
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(raw));
        controller.close();
      },
    }),
    headers: { 'Content-Type': make().headers.get('content-type') },
  });
  await assert.rejects(() => boundedForm(chunked, 10), /too large/);
});
test('audio normalises supported recordings and rejects invalid or oversized audio', async () => {
  const webm = await validateAudio(
    new File([Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0])], 'recording', {
      type: 'unknown',
    }),
  );
  assert.equal(webm.name, 'instruction.webm');
  assert.equal(webm.type, 'audio/webm');
  assert.equal(
    (await validateAudio(new File(['0000ftypisom'], 'capture.mp4'))).type,
    'audio/mp4',
  );
  await assert.rejects(
    () => validateAudio(new File(['bad'], 'capture.webm')),
    /format/,
  );
  await assert.rejects(
    () =>
      validateAudio(new File([new Uint8Array(AUDIO_BYTES + 1)], 'big.webm')),
    /90 seconds/,
  );
});
test('transcription uses audio endpoint, returns text only and never calls the data assistant', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
      assert.equal(options.body.get('model'), 'gpt-4o-mini-transcribe');
      assert.ok(options.body.get('file') instanceof File);
      assert.equal(options.headers['Content-Type'], undefined);
      return Response.json({ text: '  Find clubs in Derbyshire.  ' });
    };
    assert.equal(
      await transcribeAudio(new File(['audio'], 'test.webm')),
      'Find clubs in Derbyshire.',
    );
    globalThis.fetch = async () => Response.json({ text: '' });
    await assert.rejects(() => transcribeAudio(png), /No speech/);
    globalThis.fetch = async () =>
      Response.json({ error: 'private provider details' }, { status: 429 });
    await assert.rejects(() => transcribeAudio(png), /usage limit/);
  } finally {
    globalThis.fetch = original;
  }
});
