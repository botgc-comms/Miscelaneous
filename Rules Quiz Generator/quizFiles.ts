import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

export type Choice = {
  id: string;
  text: string;
};

export type AudienceQuestion = {
  audience: "junior-friendly" | "standard";
  membershipCategories: string[];
  title: string;
  question: string;
  type: "multiple_choice" | "multi_select";
  choices: Choice[];
  correctAnswers: string[];
  correctAnswer: string | string[];
  explanation: string;
  vocabulary?: { term: string; simpleMeaning: string }[];
  teachingTip?: string;
  likelyMisconceptions?: string[];
};

export type SourceSelection = {
  folder: string;
  folderName: string;
  metadataPath: string;
  metadata: any;
  questionPath: string | null;
  juniorQuestionPath: string | null;
  legacyJuniorPath: string | null;
  imagePath: string | null;
  promptPath: string | null;
  standardQuestion: AudienceQuestion;
  juniorQuestion: AudienceQuestion | null;
};

type HashCacheEntry = {
  size: number;
  mtimeMs: number;
  hash: string;
};

const hashCache = new Map<string, HashCacheEntry>();

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function assertSafeFolderName(folderName: unknown): string {
  if (typeof folderName !== "string" || !folderName.trim()) {
    throw new Error("folderName is required.");
  }

  const value = folderName.trim();

  if (
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.basename(value) !== value
  ) {
    throw new Error("Invalid folderName.");
  }

  return value;
}

export function assertSafeFileName(fileName: unknown, allowed: RegExp): string {
  if (typeof fileName !== "string" || !allowed.test(fileName) || path.basename(fileName) !== fileName) {
    throw new Error("Invalid file name.");
  }

  return fileName;
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

export async function latestVersionedFile(folder: string, pattern: RegExp): Promise<string | null> {
  const entries = await fs.readdir(folder);
  const matches = entries
    .map((name) => {
      const match = pattern.exec(name);
      return match ? { name, version: Number(match[1]) } : null;
    })
    .filter((item): item is { name: string; version: number } => item !== null)
    .sort((a, b) => b.version - a.version);

  return matches[0] ? path.join(folder, matches[0].name) : null;
}

export async function findQuestionFolders(sourceDir: string): Promise<string[]> {
  if (!await pathExists(sourceDir)) {
    return [];
  }

  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const folders: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "_source-state") {
      continue;
    }

    const folder = path.join(sourceDir, entry.name);

    if (await pathExists(path.join(folder, "metadata.json"))) {
      folders.push(folder);
    }
  }

  return folders.sort((a, b) => a.localeCompare(b));
}

function singleOrManyCorrectAnswer(correctAnswers: string[]): string | string[] {
  return correctAnswers.length === 1 ? correctAnswers[0] : correctAnswers;
}

function buildStandardQuestion(originalMetadata: any, question: any, hasJunior: boolean): AudienceQuestion {
  const correctAnswers = question?.correctAnswers ?? originalMetadata.correctAnswers ?? [];

  return {
    audience: "standard",
    membershipCategories: hasJunior ? ["Junior"] : ["Cadet", "Course Cadet", "Junior"],
    title: question?.title ?? originalMetadata.title,
    question: question?.question ?? originalMetadata.question,
    type: originalMetadata.type,
    choices: question?.choices ?? originalMetadata.choices,
    correctAnswers,
    correctAnswer: singleOrManyCorrectAnswer(correctAnswers),
    explanation: question?.explanation ?? originalMetadata.explanation,
  };
}

function buildJuniorQuestion(originalMetadata: any, junior: any, standard: AudienceQuestion): AudienceQuestion {
  const correctAnswers = junior.correctAnswers ?? standard.correctAnswers;

  return {
    audience: "junior-friendly",
    membershipCategories: ["Junior Cadet", "Junior Course Cadet"],
    title: junior.title ?? standard.title,
    question: junior.question ?? standard.question,
    type: originalMetadata.type,
    choices: junior.choices ?? standard.choices,
    correctAnswers,
    correctAnswer: singleOrManyCorrectAnswer(correctAnswers),
    explanation: junior.explanation ?? standard.explanation,
    vocabulary: junior.vocabulary ?? [],
    teachingTip: junior.teachingTip ?? "",
    likelyMisconceptions: junior.likelyMisconceptions ?? [],
  };
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function resolveSourceSelection(folder: string): Promise<SourceSelection> {
  const folderName = assertSafeFolderName(path.basename(folder));
  const metadataPath = path.join(folder, "metadata.json");

  if (!await pathExists(metadataPath)) {
    throw new Error(`metadata.json not found for ${folderName}.`);
  }

  const metadata = await readJson<any>(metadataPath);
  const questionPath = await latestVersionedFile(folder, /^question-v(\d+)\.json$/i);
  const juniorQuestionPath = await latestVersionedFile(folder, /^junior-question-v(\d+)\.json$/i);
  const legacyJuniorCandidate = path.join(folder, "junior-version.json");
  const legacyJuniorPath = await pathExists(legacyJuniorCandidate) ? legacyJuniorCandidate : null;

  const questionJson = questionPath ? await readJson<any>(questionPath) : null;
  const question = questionJson?.suggestion ?? questionJson ?? metadata;
  const juniorQuestionJson = juniorQuestionPath ? await readJson<any>(juniorQuestionPath) : null;
  const legacyJuniorJson = legacyJuniorPath ? await readJson<any>(legacyJuniorPath) : null;
  const junior =
    juniorQuestionJson?.juniorSuggestion ??
    juniorQuestionJson?.suggestion ??
    legacyJuniorJson?.juniorVersion ??
    null;

  const standardQuestion = buildStandardQuestion(metadata, question, Boolean(junior));
  const juniorQuestion = junior ? buildJuniorQuestion(metadata, junior, standardQuestion) : null;
  const imagePath =
    await latestVersionedFile(folder, /^illustration-v(\d+)\.png$/i) ??
    await firstExisting([
      path.join(folder, "illustration-v2.png"),
      path.join(folder, "illustration.png"),
    ]);
  const promptPath =
    await latestVersionedFile(folder, /^final-prompt-v(\d+)\.txt$/i) ??
    await firstExisting([
      path.join(folder, "final-prompt-v2.txt"),
      path.join(folder, "final-prompt.txt"),
    ]);

  return {
    folder,
    folderName,
    metadataPath,
    metadata,
    questionPath,
    juniorQuestionPath,
    legacyJuniorPath,
    imagePath,
    promptPath,
    standardQuestion,
    juniorQuestion,
  };
}

async function hashFile(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  const cached = hashCache.get(filePath);

  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.hash;
  }

  const hash = createHash("sha256");

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  const digest = hash.digest("hex");
  hashCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, hash: digest });
  return digest;
}

export async function computeSourceRevision(selection: SourceSelection): Promise<string> {
  const files = [
    selection.metadataPath,
    selection.questionPath,
    selection.juniorQuestionPath ?? selection.legacyJuniorPath,
    selection.imagePath,
    selection.promptPath,
  ].filter((item): item is string => Boolean(item));

  const parts: { name: string; hash: string }[] = [];

  for (const filePath of files) {
    parts.push({
      name: path.basename(filePath),
      hash: await hashFile(filePath),
    });
  }

  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function clearFileHashCache(): void {
  hashCache.clear();
}
