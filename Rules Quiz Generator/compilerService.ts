import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  computeSourceRevision,
  findQuestionFolders,
  pathExists,
  resolveSourceSelection,
  type AudienceQuestion,
} from "./quizFiles.js";

export type CompileResult = {
  folderName: string;
  sourceRevision: string;
  compiledAtUtc: string;
  targetFolder: string;
};

async function copyRequiredFile(sourcePath: string | null, targetPath: string, label: string): Promise<string> {
  if (!sourcePath) {
    throw new Error(`${label} is missing.`);
  }

  await fs.copyFile(sourcePath, targetPath);
  return path.basename(sourcePath);
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function validateQuestion(question: AudienceQuestion, label: string): void {
  requiredText(question.title, `${label} title`);
  requiredText(question.question, `${label} question`);
  requiredText(question.explanation, `${label} explanation`);

  if (!Array.isArray(question.choices) || question.choices.length < 2) {
    throw new Error(`${label} must contain at least two choices.`);
  }

  const choiceIds = new Set<string>();
  for (const choice of question.choices) {
    const id = requiredText(choice?.id, `${label} choice ID`).toLowerCase();
    requiredText(choice?.text, `${label} choice text`);
    if (choiceIds.has(id)) throw new Error(`${label} contains duplicate choice ID ${id}.`);
    choiceIds.add(id);
  }

  if (!Array.isArray(question.correctAnswers) || question.correctAnswers.length === 0) {
    throw new Error(`${label} must identify at least one correct answer.`);
  }
  for (const answer of question.correctAnswers) {
    if (!choiceIds.has(String(answer).toLowerCase())) {
      throw new Error(`${label} correct answer ${answer} does not match a choice.`);
    }
  }
}

export async function compileFolder(sourceFolder: string, compiledDir: string): Promise<CompileResult> {
  const selection = await resolveSourceSelection(sourceFolder);
  validateQuestion(selection.standardQuestion, "Standard question");
  if (selection.juniorQuestion) validateQuestion(selection.juniorQuestion, "Junior question");
  const sourceRevision = await computeSourceRevision(selection);
  const targetFolder = path.join(compiledDir, selection.folderName);
  const temporaryFolder = path.join(compiledDir, `.${selection.folderName}.tmp-${sourceRevision.slice(0, 12)}`);
  const compiledAtUtc = new Date().toISOString();

  if (!selection.imagePath) throw new Error(`Illustration for ${selection.folderName} is missing.`);
  await fs.mkdir(compiledDir, { recursive: true });
  await fs.rm(temporaryFolder, { recursive: true, force: true });
  await fs.mkdir(temporaryFolder, { recursive: true });

  try {
    const sourceImageFileName = path.basename(selection.imagePath);
    const imageInfo = await sharp(selection.imagePath)
      .rotate()
      .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4, smartSubsample: true })
      .toFile(path.join(temporaryFolder, "illustration.webp"));
    const sourcePromptFileName = await copyRequiredFile(
      selection.promptPath,
      path.join(temporaryFolder, "final-prompt.txt"),
      `Image prompt for ${selection.folderName}`
    );

    const questions: AudienceQuestion[] = selection.juniorQuestion
      ? [selection.juniorQuestion, selection.standardQuestion]
      : [selection.standardQuestion];

    const compiledMetadata: any = {
      ...selection.metadata,
      schemaVersion: 4,
      imageFileName: "illustration.webp",
      promptFileName: "final-prompt.txt",
      questions,
      compiledFrom: {
        sourceFolder: selection.folderName,
        sourceRevision,
        originalMetadataFileName: "metadata.json",
        questionFileName: selection.questionPath ? path.basename(selection.questionPath) : null,
        juniorQuestionFileName: selection.juniorQuestionPath ? path.basename(selection.juniorQuestionPath) : null,
        imageFileName: sourceImageFileName,
        promptFileName: sourcePromptFileName,
        compiledAtUtc,
        publicImage: {
          format: imageInfo.format,
          width: imageInfo.width,
          height: imageInfo.height,
          sizeBytes: imageInfo.size,
        },
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
      path.join(temporaryFolder, "metadata.json"),
      JSON.stringify(compiledMetadata, null, 2),
      "utf8"
    );

    await fs.rm(targetFolder, { recursive: true, force: true });
    await fs.rename(temporaryFolder, targetFolder);
  } catch (error) {
    await fs.rm(temporaryFolder, { recursive: true, force: true });
    throw error;
  }

  return {
    folderName: selection.folderName,
    sourceRevision,
    compiledAtUtc,
    targetFolder,
  };
}

export async function compileAll(sourceDir: string, compiledDir: string, clean = false): Promise<CompileResult[]> {
  if (clean && await pathExists(compiledDir)) {
    const entries = await fs.readdir(compiledDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        await fs.rm(path.join(compiledDir, entry.name), { recursive: true, force: true });
      }
    }
  }

  await fs.mkdir(compiledDir, { recursive: true });
  const folders = await findQuestionFolders(sourceDir);

  if (folders.length === 0) {
    throw new Error(`No question folders found in ${sourceDir}`);
  }

  const results: CompileResult[] = [];

  for (const folder of folders) {
    const result = await compileFolder(folder, compiledDir);
    results.push(result);
    console.log(`Compiled ${result.folderName}`);
  }

  return results;
}

async function main(): Promise<void> {
  const sourceDir = process.argv[2] ?? "./Output";
  const compiledDir = process.argv[3] ?? "./compiled";
  const results = await compileAll(sourceDir, compiledDir, process.argv.includes("--clean"));
  console.log(`Compiled ${results.length} question folders to ${compiledDir}.`);
}

const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]!);

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
