import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import path from "node:path";
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

export async function compileFolder(sourceFolder: string, compiledDir: string): Promise<CompileResult> {
  const selection = await resolveSourceSelection(sourceFolder);
  const sourceRevision = await computeSourceRevision(selection);
  const targetFolder = path.join(compiledDir, selection.folderName);
  const compiledAtUtc = new Date().toISOString();

  await fs.mkdir(targetFolder, { recursive: true });

  const sourceImageFileName = await copyRequiredFile(
    selection.imagePath,
    path.join(targetFolder, "illustration.png"),
    `Illustration for ${selection.folderName}`
  );
  const sourcePromptFileName = await copyRequiredFile(
    selection.promptPath,
    path.join(targetFolder, "final-prompt.txt"),
    `Image prompt for ${selection.folderName}`
  );

  const questions: AudienceQuestion[] = selection.juniorQuestion
    ? [selection.juniorQuestion, selection.standardQuestion]
    : [selection.standardQuestion];

  const compiledMetadata: any = {
    ...selection.metadata,
    schemaVersion: 3,
    imageFileName: "illustration.png",
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
