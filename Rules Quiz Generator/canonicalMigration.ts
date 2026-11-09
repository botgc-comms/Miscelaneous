import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { LibraryPaths } from "./libraryPaths.js";
import { assertSafeFolderName, clearFileHashCache, computeSourceRevision, findQuestionFolders, latestVersionedFile, pathExists, readJson, resolveSourceSelection, type AudienceQuestion } from "./quizFiles.js";

type Master = { schemaVersion: number; contentVersion: string; sourceExport: { sha256: string }; rules: { id: string; metadata: any; assets: { image: { sha256: string }; prompt: { sha256: string } }; provenance: { serverSourceRevision: string } }[] };
type Write = { relative: string; before: string | null; after: string };
type Journal = { contentVersion: string; sourceExportSha256: string; complete: boolean; writes: Write[]; verifiedQuestions?: number; importedAtUtc?: string; previousReceipt?: unknown };
const MIGRATION_FILE = "2026-11-09-services-library.json";
const RECEIPT_FILE = "services-library-import.json";
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

function validate(q: AudienceQuestion, id: string): void {
  if (![q.title, q.question, q.explanation].every(v => typeof v === "string" && v.trim())) throw new Error(`Incomplete question: ${id}`);
  const ids = q.choices?.map(c => c.id) ?? [];
  if (ids.length < 2 || new Set(ids).size !== ids.length || !q.choices.every(c => c.text?.trim())) throw new Error(`Invalid choices: ${id}`);
  if (!q.correctAnswers?.length || !q.correctAnswers.every(key => ids.includes(key)) || q.correctAnswers.length >= ids.length) throw new Error(`Invalid answer keys: ${id}`);
  if (q.type !== (q.correctAnswers.length === 1 ? "multiple_choice" : "multi_select")) throw new Error(`Invalid question type: ${id}`);
}

async function nextRevision(folder: string, prefix: string): Promise<string> {
  const latest = await latestVersionedFile(folder, new RegExp(`^${prefix}-v(\\d+)\\.json$`, "i"));
  const version = latest ? Number(path.basename(latest).match(/-v(\d+)\.json$/i)![1]) + 1 : 1;
  return path.join(folder, `${prefix}-v${version}.json`);
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const temporary = file + ".canonical-import.tmp";
  await fs.writeFile(temporary, content, "utf8");
  await fs.rename(temporary, file);
}

export async function readCanonicalReceipt(paths: LibraryPaths): Promise<any | null> {
  const file = path.join(paths.publishedDir, RECEIPT_FILE);
  return await pathExists(file) ? readJson(file) : null;
}

/** One-time migration of the exported working library from the Services master.
 * Runs before the HTTP server starts. Retains original bytes in a durable journal,
 * appends revisions, and refuses to overwrite any source changed since export.
 * A crash can resume only if every planned target still has its before/after bytes.
 */
export async function importCanonicalSnapshot(paths: LibraryPaths, snapshotFile = path.join(paths.projectRoot, "migrations", MIGRATION_FILE), previousSnapshotFile = path.join(paths.projectRoot, "migrations", "previous-services-library.json")): Promise<boolean> {
  if (!await pathExists(snapshotFile)) return false;
  const master = await readJson<Master>(snapshotFile);
  if (master.schemaVersion !== 1 || !/^[0-9a-f]{64}$/.test(master.contentVersion)) throw new Error("Invalid Services library snapshot.");
  const existingReceipt = await readCanonicalReceipt(paths);
  if (existingReceipt?.contentVersion === master.contentVersion && existingReceipt?.complete) return false;
  const transaction = path.join(paths.dataRoot, "canonical-import-backups", master.contentVersion);
  const journalFile = path.join(transaction, "journal.json");
  let journal: Journal;
  if (await pathExists(journalFile)) {
    journal = await readJson<Journal>(journalFile);
    if (journal.contentVersion !== master.contentVersion) throw new Error("Migration journal mismatch.");
  } else {
    // A successor may replace only the exact previously imported release. The
    // original export revision remains provenance, never a bypass for later edits.
    let previous: Master | null = null;
    if (existingReceipt?.complete) {
      if (!await pathExists(previousSnapshotFile)) throw new Error("Previous Services snapshot required for successor import.");
      previous = await readJson<Master>(previousSnapshotFile);
      if (previous.contentVersion !== existingReceipt.contentVersion || previous.sourceExport.sha256 !== master.sourceExport.sha256) throw new Error("Previous Services receipt does not match the supplied predecessor.");
      if (!isDeepStrictEqual(previous.rules.map(r => r.id).sort(), master.rules.map(r => r.id).sort())) throw new Error("Successor inventory differs from the previous release.");
    } else if (existingReceipt) {
      throw new Error("An incomplete prior Services import requires reconciliation.");
    }
    const folders = await findQuestionFolders(paths.outputDir);
    const ids = master.rules.map(r => assertSafeFolderName(r.id));
    if (new Set(ids).size !== ids.length || !isDeepStrictEqual([...ids].sort(), folders.map(f => path.basename(f)).sort())) throw new Error("Server inventory changed since export; reconciliation required.");
    journal = { contentVersion: master.contentVersion, sourceExportSha256: master.sourceExport.sha256, complete: false, writes: [], previousReceipt: existingReceipt };
    for (const rule of master.rules) {
      const folder = path.join(paths.outputDir, rule.id);
      const selection = await resolveSourceSelection(folder);
      if (previous) {
        const prior = previous.rules.find(r => r.id === rule.id)!;
        for (const q of prior.metadata.questions as AudienceQuestion[]) {
          const current = q.audience === "standard" ? selection.standardQuestion : selection.juniorQuestion;
          if (!isDeepStrictEqual(current, q)) throw new Error(`Server question changed since previous import: ${rule.id} (${q.audience})`);
        }
        for (const key of ["ruleNumber", "ruleName", "imageAlt", "editorialReview"]) {
          if (!isDeepStrictEqual(selection.metadata[key], prior.metadata[key])) throw new Error(`Server metadata changed since previous import: ${rule.id} (${key})`);
        }
      } else if (await computeSourceRevision(selection) !== rule.provenance.serverSourceRevision) throw new Error(`Server question changed since export: ${rule.id}`);
      const questions: AudienceQuestion[] = rule.metadata.questions;
      if (questions.length !== 2 || new Set(questions.map(q => q.audience)).size !== 2) throw new Error(`Both age versions required: ${rule.id}`);
      questions.forEach(q => validate(q, rule.id));
      const standard = questions.find(q => q.audience === "standard")!;
      const junior = questions.find(q => q.audience === "junior-friendly")!;
      if (!standard || !junior) throw new Error(`Unknown audience: ${rule.id}`);
      const metadata = { ...selection.metadata, ...standard };
      delete metadata.audience;
      delete metadata.membershipCategories;
      for (const key of ["ruleNumber", "ruleName", "imageAlt", "editorialReview"]) metadata[key] = rule.metadata[key];
      const writes: [string, unknown][] = [
        [selection.metadataPath, metadata],
        [await nextRevision(folder, "question"), { schemaVersion: 1, suggestion: standard, canonicalContentVersion: master.contentVersion }],
        [await nextRevision(folder, "junior-question"), { schemaVersion: 1, juniorSuggestion: junior, canonicalContentVersion: master.contentVersion }],
      ];
      for (const [target, value] of writes) journal.writes.push({ relative: path.relative(paths.outputDir, target), before: await pathExists(target) ? (await fs.readFile(target)).toString("base64") : null, after: json(value) });
    }
    await fs.mkdir(transaction, { recursive: true });
    await fs.writeFile(journalFile, json(journal), { flag: "wx" });
  }
  // Validate every file, including artwork, before changing any target.
  for (const rule of master.rules) {
    const selection = await resolveSourceSelection(path.join(paths.outputDir, assertSafeFolderName(rule.id)));
    if (!selection.imagePath || !selection.promptPath || hash(await fs.readFile(selection.imagePath)) !== rule.assets.image.sha256 || hash(await fs.readFile(selection.promptPath)) !== rule.assets.prompt.sha256) throw new Error(`Server artwork changed since export: ${rule.id}`);
  }
  for (const item of journal.writes) {
    const target = path.resolve(paths.outputDir, item.relative);
    if (!target.startsWith(path.resolve(paths.outputDir) + path.sep)) throw new Error("Unsafe migration path.");
    const current = await pathExists(target) ? await fs.readFile(target) : null;
    const original = item.before === null ? null : Buffer.from(item.before, "base64");
    if (!(current === null && original === null) && !(current && original && current.equals(original)) && !(current && hash(current) === hash(item.after))) throw new Error(`Concurrent edit prevents migration: ${item.relative}`);
  }
  for (const item of journal.writes) await atomicWrite(path.join(paths.outputDir, item.relative), item.after);
  clearFileHashCache();
  for (const rule of master.rules) {
    const actual = await resolveSourceSelection(path.join(paths.outputDir, rule.id));
    for (const q of rule.metadata.questions as AudienceQuestion[]) {
      const resolved = q.audience === "standard" ? actual.standardQuestion : actual.juniorQuestion;
      if (!isDeepStrictEqual(resolved, q)) throw new Error(`Imported question failed readback: ${rule.id} (${q.audience})`);
    }
  }
  journal.complete = true;
  journal.verifiedQuestions = master.rules.length;
  journal.importedAtUtc = new Date().toISOString();
  await atomicWrite(journalFile, json(journal));
  await fs.mkdir(paths.publishedDir, { recursive: true });
  await atomicWrite(path.join(paths.publishedDir, RECEIPT_FILE), json({ complete: true, contentVersion: master.contentVersion, questionCount: master.rules.length, variantCount: master.rules.length * 2, authoritativeSource: "botgc-comms/services:BOTGC.RulesQuiz/library.json", sourceExportSha256: master.sourceExport.sha256, importedAtUtc: journal.importedAtUtc, compilationComplete: false }));
  return true;
}
