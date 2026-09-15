import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const dir = path.resolve('work/tests/voice');
await mkdir(dir, { recursive: true });
await writeFile(
  path.join(dir, 'hooks.mjs'),
  `export const useState=(v)=>globalThis.voiceHooks.state(v);export const useRef=(v)=>globalThis.voiceHooks.ref(v);export const useEffect=(fn,deps)=>globalThis.voiceHooks.effect(fn,deps);`,
);
await writeFile(
  path.join(dir, 'constants.mjs'),
  `export const AUDIO_BYTES=8388608;export const RECORDING_SECONDS=90;`,
);
const js = ts
  .transpileModule(await readFile('app/assistant-voice.tsx', 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  .outputText.replace("from 'react'", "from './hooks.mjs'")
  .replace("from '@/lib/assistant-audio'", "from './constants.mjs'");
await writeFile(path.join(dir, 'component.mjs'), js);
const { AssistantVoice } = await import(
  pathToFileURL(path.join(dir, 'component.mjs'))
);
const settle = () => new Promise((resolve) => setImmediate(resolve));
function harness(getMedia) {
  const saved = Object.fromEntries(
    ['navigator', 'document', 'MediaRecorder', 'fetch'].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  const doc = new EventTarget();
  doc.hidden = false;
  const records = [],
    texts = [],
    busy = [],
    stopped = [];
  class Recorder {
    static isTypeSupported = (type) => type.startsWith('audio/webm');
    constructor() {
      this.state = 'inactive';
      records.push(this);
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({
          data: new Blob([Uint8Array.from([26, 69, 223, 163])]),
        });
        this.onstop?.();
      });
    }
  }
  const media = () => ({
    getTracks: () => [{ stop: () => stopped.push(true) }],
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: { getUserMedia: getMedia || (async () => media()) },
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: doc,
  });
  globalThis.MediaRecorder = Recorder;
  let cursor = 0,
    tree,
    props = {
      workspace: 'workspace',
      view: 'admin',
      open: true,
      disabled: false,
      onText: (t) => texts.push(t),
      onBusy: (b) => busy.push(b),
    };
  const cells = [],
    effects = [];
  globalThis.voiceHooks = {
    state(v) {
      const i = cursor++;
      if (!(i in cells)) cells[i] = v;
      return [
        cells[i],
        (next) => {
          cells[i] = typeof next === 'function' ? next(cells[i]) : next;
        },
      ];
    },
    ref(v) {
      const i = cursor++;
      return (cells[i] ||= { current: v });
    },
    effect(fn, deps) {
      const i = cursor++;
      const previous = cells[i];
      if (!previous || deps.some((v, n) => v !== previous.deps[n]))
        effects.push(() => {
          previous?.cleanup?.();
          cells[i] = { deps, cleanup: fn() };
        });
    },
  };
  const render = (changes = {}) => {
    props = { ...props, ...changes };
    cursor = 0;
    tree = AssistantVoice(props);
    while (effects.length) effects.shift()();
    return tree;
  };
  const nodes = (n) =>
    !n || typeof n !== 'object'
      ? []
      : Array.isArray(n)
        ? n.flatMap(nodes)
        : [n, ...nodes(n.props?.children)];
  const button = (label) =>
    nodes(tree).find(
      (n) => n.type === 'button' && n.props['aria-label'] === label,
    );
  render();
  render();
  return {
    render,
    nodes: () => nodes(tree),
    button,
    records,
    texts,
    busy,
    stopped,
    media,
    doc,
    cleanup() {
      for (const c of cells) c?.cleanup?.();
      for (const [k, v] of Object.entries(saved))
        v ? Object.defineProperty(globalThis, k, v) : delete globalThis[k];
    },
  };
}
test('microphone opens only on click; Stop transcribes for review, never submits a data task', async () => {
  const h = harness();
  try {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);
      return Response.json({ text: 'Find Derbyshire clubs.' });
    };
    assert.equal(h.records.length, 0);
    h.button('Speak your instruction').props.onClick();
    await settle();
    h.render();
    assert.equal(h.records[0].state, 'recording');
    h.button('Stop recording and transcribe').props.onClick();
    await settle();
    h.render();
    assert.deepEqual(h.texts, ['Find Derbyshire clubs.']);
    assert.equal(requests.length, 1);
    assert.match(requests[0], /^\/api\/assistant\/voice\?/);
    assert.ok(h.stopped.length);
    assert.equal(h.busy.at(-1), false);
  } finally {
    h.cleanup();
  }
});
test('closing while permission is pending discards late microphone access', async () => {
  let resolve;
  const h = harness(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  try {
    h.button('Speak your instruction').props.onClick();
    h.render();
    h.render({ open: false });
    resolve(h.media());
    await settle();
    h.render();
    assert.equal(h.records.length, 0);
    assert.equal(h.stopped.length, 1);
    assert.deepEqual(h.texts, []);
  } finally {
    h.cleanup();
  }
});
test('closing during transcription cancels request and ignores late results', async () => {
  const h = harness();
  let resolve, signal;
  try {
    globalThis.fetch = (_, options) => {
      signal = options.signal;
      return new Promise((r) => {
        resolve = r;
      });
    };
    h.button('Speak your instruction').props.onClick();
    await settle();
    h.render();
    h.button('Stop recording and transcribe').props.onClick();
    await settle();
    h.render();
    h.render({ open: false });
    assert.equal(signal.aborted, true);
    resolve(Response.json({ text: 'Must be discarded' }));
    await settle();
    assert.deepEqual(h.texts, []);
  } finally {
    h.cleanup();
  }
});
test('permission denial leaves typing available and makes no request', async () => {
  const h = harness(async () => {
    throw new DOMException('Denied', 'NotAllowedError');
  });
  try {
    h.button('Speak your instruction').props.onClick();
    await settle();
    h.render();
    assert.match(
      h.nodes().find((n) => n.props?.role === 'alert').props.children,
      /Microphone access was not allowed/,
    );
    assert.equal(h.busy.at(-1), false);
    assert.equal(h.records.length, 0);
  } finally {
    h.cleanup();
  }
});

test('failed transcription can retry the same audio without reopening the microphone', async () => {
  const h = harness();
  let attempts = 0;
  try {
    globalThis.fetch = async () =>
      ++attempts === 1
        ? Response.json({ error: 'Please retry' }, { status: 502 })
        : Response.json({ text: 'Recovered instruction' });
    h.button('Speak your instruction').props.onClick();
    await settle();
    h.render();
    h.button('Stop recording and transcribe').props.onClick();
    await settle();
    h.render();
    h.nodes()
      .find(
        (n) =>
          n.type === 'button' && n.props.children === 'Retry transcription',
      )
      .props.onClick();
    await settle();
    h.render();
    assert.equal(h.records.length, 1);
    assert.deepEqual(h.texts, ['Recovered instruction']);
  } finally {
    h.cleanup();
  }
});

test('hiding the page stops recording without uploading audio', async () => {
  const h = harness();
  let requests = 0;
  try {
    globalThis.fetch = async () => {
      requests++;
      return Response.json({ text: 'bad' });
    };
    h.button('Speak your instruction').props.onClick();
    await settle();
    h.render();
    h.doc.hidden = true;
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    assert.equal(h.records[0].state, 'inactive');
    assert.equal(requests, 0);
    assert.ok(h.stopped.length);
  } finally {
    h.cleanup();
  }
});
