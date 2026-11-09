import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LibraryPaths } from "./libraryPaths.js";

type Entry = { path: string; absolutePath: string; size: number; mtimeMs: number; ctimeMs: number };

async function inventory(paths: LibraryPaths): Promise<Entry[]> {
  const entries: Entry[] = [];
  async function visit(root: string, relative: string): Promise<void> {
    const absolutePath = path.join(root, relative);
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink()) throw new Error("Library export does not follow symbolic links.");
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(absolutePath)).sort()) {
        await visit(root, path.join(relative, name));
      }
    } else if (stat.isFile()) {
      entries.push({ path: relative.split(path.sep).join("/"), absolutePath, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
    } else {
      throw new Error("Unsupported file in library export.");
    }
  }
  // Explicit content directories only: never the application root or environment files.
  for (const [label, directory] of Object.entries({ Output: paths.outputDir, Input: paths.inputDir, compiled: paths.compiledDir, published: paths.publishedDir })) {
    const start = entries.length;
    await visit(directory, "");
    for (const entry of entries.slice(start)) entry.path = `${label}/${entry.path}`;
  }
  return entries;
}

/** Gzipped by the HTTP route. Each file is byte-exact, with a SHA-256 checksum.
 * A complete footer is mandatory; missing footer means the export must be rejected.
 * No source files are written. Concurrent edits invalidate the entire export.
 */
export async function* exportLibrary(paths: LibraryPaths): AsyncGenerator<string> {
  const before = await inventory(paths);
  yield JSON.stringify({ type: "header", format: "rulesready-library", version: 1, exportedAtUtc: new Date().toISOString(), fileCount: before.length }) + "\n";
  let totalBytes = 0;
  for (const entry of before) {
    const bytes = await fs.readFile(entry.absolutePath);
    if (bytes.length !== entry.size) throw new Error("Library changed during export. Please retry when editing has finished.");
    totalBytes += bytes.length;
    yield JSON.stringify({ type: "file", path: entry.path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), encoding: "base64", data: bytes.toString("base64") }) + "\n";
  }
  if (JSON.stringify(before) !== JSON.stringify(await inventory(paths))) {
    throw new Error("Library changed during export. Please retry when editing has finished.");
  }
  yield JSON.stringify({ type: "complete", fileCount: before.length, totalBytes }) + "\n";
}
