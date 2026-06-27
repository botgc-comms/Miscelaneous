import { promises as fs } from "node:fs";
import path from "node:path";

type Choice = {
  id: string;
  text: string;
};

type AudienceQuestion = {
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

const SOURCE_DIR = process.argv[2] ?? "./output";
const COMPILED_DIR = process.argv[3] ?? "./compiled";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function latestVersionedFile(folder: string, pattern: RegExp): Promise<string | null> {
  const entries = await fs.readdir(folder);

  const matches = entries
    .map((name) => {
      const match = pattern.exec(name);
      return match ? { name, version: Number(match[1]) } : null;
    })
    .filter((x): x is { name: string; version: number } => x !== null)
    .sort((a, b) => b.version - a.version);

  return matches[0] ? path.join(folder, matches[0].name) : null;
}

async function findQuestionFolders(sourceDir: string): Promise<string[]> {
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

async function copyLatestImage(sourceFolder: string, targetFolder: string): Promise<string | null> {
  const latest =
    await latestVersionedFile(sourceFolder, /^illustration-v(\d+)\.png$/i) ??
    (await pathExists(path.join(sourceFolder, "illustration-v2.png")) ? path.join(sourceFolder, "illustration-v2.png") : null) ??
    (await pathExists(path.join(sourceFolder, "illustration.png")) ? path.join(sourceFolder, "illustration.png") : null);

  if (!latest) {
    return null;
  }

  await fs.copyFile(latest, path.join(targetFolder, "illustration.png"));
  return path.basename(latest);
}

async function copyLatestPrompt(sourceFolder: string, targetFolder: string): Promise<string | null> {
  const latest =
    await latestVersionedFile(sourceFolder, /^final-prompt-v(\d+)\.txt$/i) ??
    (await pathExists(path.join(sourceFolder, "final-prompt-v2.txt")) ? path.join(sourceFolder, "final-prompt-v2.txt") : null) ??
    (await pathExists(path.join(sourceFolder, "final-prompt.txt")) ? path.join(sourceFolder, "final-prompt.txt") : null);

  if (!latest) {
    return null;
  }

  await fs.copyFile(latest, path.join(targetFolder, "final-prompt.txt"));
  return path.basename(latest);
}

function buildStandardQuestion(originalMetadata: any, question: any): AudienceQuestion {
  const correctAnswers = question.correctAnswers ?? originalMetadata.correctAnswers;

  return {
    audience: "standard",
    membershipCategories: ["Junior"],
    title: question.title ?? originalMetadata.title,
    question: question.question ?? originalMetadata.question,
    type: originalMetadata.type,
    choices: question.choices ?? originalMetadata.choices,
    correctAnswers,
    correctAnswer: singleOrManyCorrectAnswer(correctAnswers),
    explanation: question.explanation ?? originalMetadata.explanation,
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

async function compileFolder(sourceFolder: string): Promise<void> {
  const folderName = path.basename(sourceFolder);
  const targetFolder = path.join(COMPILED_DIR, folderName);

  await fs.mkdir(targetFolder, { recursive: true });

  const originalMetadata = await readJson<any>(path.join(sourceFolder, "metadata.json"));

  const latestQuestionPath = await latestVersionedFile(sourceFolder, /^question-v(\d+)\.json$/i);
  const latestJuniorQuestionPath = await latestVersionedFile(sourceFolder, /^junior-question-v(\d+)\.json$/i);

  const questionJson = latestQuestionPath ? await readJson<any>(latestQuestionPath) : null;
  const question = questionJson?.suggestion ?? questionJson ?? originalMetadata;

  const juniorQuestionJson = latestJuniorQuestionPath ? await readJson<any>(latestJuniorQuestionPath) : null;

  const legacyJuniorPath = path.join(sourceFolder, "junior-version.json");
  const legacyJuniorJson = await pathExists(legacyJuniorPath) ? await readJson<any>(legacyJuniorPath) : null;

  const junior =
    juniorQuestionJson?.juniorSuggestion ??
    juniorQuestionJson?.suggestion ??
    legacyJuniorJson?.juniorVersion ??
    null;

  const sourceImageFileName = await copyLatestImage(sourceFolder, targetFolder);
  const sourcePromptFileName = await copyLatestPrompt(sourceFolder, targetFolder);

  const standardQuestion = buildStandardQuestion(originalMetadata, question);

  const questions: AudienceQuestion[] = junior
    ? [
        buildJuniorQuestion(originalMetadata, junior, standardQuestion),
        standardQuestion,
      ]
    : [
        {
          ...standardQuestion,
          membershipCategories: ["Cadet", "Course Cadet", "Junior"],
        },
      ];

  const compiledMetadata = {
    ...originalMetadata,

    schemaVersion: 2,

    imageFileName: "illustration.png",
    promptFileName: "final-prompt.txt",

    questions,

    compiledFrom: {
      sourceFolder: folderName,
      originalMetadataFileName: "metadata.json",
      questionFileName: latestQuestionPath ? path.basename(latestQuestionPath) : null,
      juniorQuestionFileName: latestJuniorQuestionPath ? path.basename(latestJuniorQuestionPath) : null,
      imageFileName: sourceImageFileName,
      promptFileName: sourcePromptFileName,
      compiledAtUtc: new Date().toISOString(),
    },
  };

  delete compiledMetadata.title;
  delete compiledMetadata.question;
  delete compiledMetadata.choices;
  delete compiledMetadata.correctAnswer;
  delete compiledMetadata.correctAnswers;
  delete compiledMetadata.explanation;
  delete compiledMetadata.juniorVersion;

  await fs.writeFile(
    path.join(targetFolder, "metadata.json"),
    JSON.stringify(compiledMetadata, null, 2),
    "utf8"
  );

  console.log(`Compiled ${folderName}`);
}

async function main(): Promise<void> {
  await fs.rm(COMPILED_DIR, { recursive: true, force: true });
  await fs.mkdir(COMPILED_DIR, { recursive: true });

  const folders = await findQuestionFolders(SOURCE_DIR);

  if (folders.length === 0) {
    throw new Error(`No question folders found in ${SOURCE_DIR}`);
  }

  for (const folder of folders) {
    await compileFolder(folder);
  }

  console.log("");
  console.log(`Compiled ${folders.length} question folders.`);
  console.log(`Output: ${COMPILED_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});