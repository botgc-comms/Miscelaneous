import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exportLibrary } from "../libraryExport.js";
import { ensureLibraryData, type LibraryPaths } from "../libraryPaths.js";

test("export preserves history and binary assets, excludes app secrets, and rejects concurrent edits", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quiz-export-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths: LibraryPaths = { projectRoot: root, dataRoot: root, outputDir: path.join(root, "Output"), inputDir: path.join(root, "Input"), compiledDir: path.join(root, "compiled"), publishedDir: path.join(root, "published"), publicDir: path.join(root, "public") };
  await ensureLibraryData(paths);
  await fs.mkdir(path.join(paths.outputDir, "tree"));
  const files = { "Output/tree/metadata.json": Buffer.from('{"title":"Tree"}'), "Output/tree/question-v2.json": Buffer.from('{"title":"Later edit"}'), "Output/tree/illustration.png": Buffer.from([0, 255, 2, 4]), "Input/rules.txt": Buffer.from("Original input"), "compiled/tree.json": Buffer.from("{}"), "published/manifest.json": Buffer.from("{}") };
  for (const [relative, bytes] of Object.entries(files)) await fs.writeFile(path.join(root, relative), bytes);
  await fs.writeFile(path.join(root, ".env"), "PRIVATE=excluded");
  const rows = [];
  for await (const line of exportLibrary(paths)) rows.push(JSON.parse(line));
  assert.equal(rows[0].fileCount, Object.keys(files).length);
  assert.equal(rows.at(-1).type, "complete");
  for (const row of rows.filter(row => row.type === "file")) {
    const original = files[row.path as keyof typeof files];
    assert.ok(original, row.path);
    assert.deepEqual(Buffer.from(row.data, "base64"), original);
    assert.equal(row.sha256, createHash("sha256").update(original).digest("hex"));
  }
  const changing = exportLibrary(paths);
  await changing.next();
  await fs.writeFile(path.join(paths.outputDir, "tree", "question-v3.json"), "{}");
  await assert.rejects(async () => { for await (const line of changing) assert.notEqual(JSON.parse(line).type, "complete"); }, /Library changed/);
});
