import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const root = resolve('work/render-runtime-tests');
await mkdir(root, { recursive: true });
const js = ts.transpileModule(await readFile('runtime/node-bindings.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
await writeFile(join(root, 'bindings.mjs'), js);
const { createStorage } = await import(pathToFileURL(join(root, 'bindings.mjs')));

test('Render SQLite preserves D1 batches, returning rows, rollback and persistent objects', async () => {
  const path = await mkdtemp(join(root, 'data-'));
  let storage = createStorage(path);
  try {
    const { DB, FILES } = storage;
    const inserted = await DB.prepare('INSERT INTO rate_limits VALUES (?,?,?)').bind('check', 1, 99).run();
    assert.equal(inserted.meta.changes, 1);
    const row = await DB.prepare('UPDATE rate_limits SET count=count+1 WHERE id=? RETURNING count').bind('check').first();
    assert.equal(row.count, 2);
    await assert.rejects(DB.batch([
      DB.prepare('UPDATE rate_limits SET count=20 WHERE id=?').bind('check'),
      DB.prepare('INSERT INTO rate_limits VALUES (?,?,?)').bind('check', 3, 99),
    ]));
    assert.equal((await DB.prepare('SELECT count FROM rate_limits WHERE id=?').bind('check').first()).count, 2);
    await FILES.put('../../private.png', new Uint8Array([1,2,3]), { httpMetadata: { contentType: 'image/png' } });
    storage.close();
    storage = createStorage(path);
    assert.equal((await storage.DB.prepare('SELECT count FROM rate_limits').first()).count, 2);
    const object = await storage.FILES.get('../../private.png');
    assert.deepEqual(new Uint8Array(await object.arrayBuffer()), new Uint8Array([1,2,3]));
    assert.equal(object.httpMetadata.contentType, 'image/png');
    await storage.FILES.delete(['../../private.png']);
    assert.equal(await storage.FILES.get('../../private.png'), null);
  } finally { storage.close(); await rm(path, { recursive: true, force: true }); }
});
