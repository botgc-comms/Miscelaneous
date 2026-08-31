import { promises as fs } from "node:fs";
import path from "node:path";
import type { LibraryPaths } from "./libraryPaths.js";
import {
  assertSafeFolderName,
  computeSourceRevision,
  findQuestionFolders,
  pathExists,
  readJson,
  resolveSourceSelection,
  type AudienceQuestion,
  type SourceSelection,
} from "./quizFiles.js";
import { readLiveDeployment, type LiveDeploymentState } from "./liveDeployment.js";
import { readPublicationManifest, type PublicationManifest } from "./publicationStore.js";

export type RuleReleaseStatus = {
  sourceRevision: string;
  compiled: boolean;
  compiledCurrent: boolean;
  compiledAtUtc: string | null;
  published: boolean;
  publishedCurrent: boolean;
  publishedAtUtc: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  deployed: boolean;
  deployedCurrent: boolean;
  deployedAtUtc: string | null;
  deploymentVerificationConfigured: boolean;
  deploymentVerificationAvailable: boolean;
  deploymentVerificationError: string | null;
  unpublished: boolean;
};

export type RuleSummary = {
  folderName: string;
  ruleNumber: string;
  ruleName: string;
  group: string;
  title: string;
  question: string;
  imageUrl: string | null;
  status: RuleReleaseStatus;
};

export type RuleDetail = RuleSummary & {
  metadata: any;
  standardQuestion: AudienceQuestion;
  juniorQuestion: AudienceQuestion | null;
  sourceImageUrl: string | null;
  imagePrompt: string;
  files: {
    metadata: string;
    question: string | null;
    juniorQuestion: string | null;
    image: string | null;
    prompt: string | null;
  };
};

type CompiledState = {
  exists: boolean;
  currentCompiler: boolean;
  revision: string | null;
  compiledAtUtc: string | null;
};

function assetUrl(folderName: string, filePath: string | null, revision: string): string | null {
  if (!filePath) {
    return null;
  }

  return `/assets/${encodeURIComponent(folderName)}/${encodeURIComponent(path.basename(filePath))}?v=${revision.slice(0, 12)}`;
}

async function getCompiledState(paths: LibraryPaths, folderName: string): Promise<CompiledState> {
  const metadataPath = path.join(paths.compiledDir, folderName, "metadata.json");

  if (!await pathExists(metadataPath)) {
    return { exists: false, currentCompiler: false, revision: null, compiledAtUtc: null };
  }

  try {
    const metadata = await readJson<any>(metadataPath);
    return {
      exists: true,
      currentCompiler: metadata?.schemaVersion === 4 && metadata?.imageFileName === "illustration.webp",
      revision: metadata?.compiledFrom?.sourceRevision ?? null,
      compiledAtUtc: metadata?.compiledFrom?.compiledAtUtc ?? null,
    };
  } catch {
    return { exists: true, currentCompiler: false, revision: null, compiledAtUtc: null };
  }
}

async function getStatus(
  paths: LibraryPaths,
  selection: SourceSelection,
  publicationManifest: PublicationManifest,
  liveDeployment: LiveDeploymentState
): Promise<RuleReleaseStatus> {
  const sourceRevision = await computeSourceRevision(selection);
  const compiled = await getCompiledState(paths, selection.folderName);
  const published = publicationManifest.rules[selection.folderName];
  const deployed = liveDeployment.rules[selection.folderName];
  const compiledCurrent = compiled.currentCompiler && compiled.revision === sourceRevision;
  const publishedCurrent = published?.sourceRevision === sourceRevision;
  const deployedCurrent = deployed?.sourceRevision === sourceRevision;

  return {
    sourceRevision,
    compiled: compiled.exists,
    compiledCurrent,
    compiledAtUtc: compiled.compiledAtUtc,
    published: Boolean(published),
    publishedCurrent,
    publishedAtUtc: published?.publishedAtUtc ?? null,
    pullRequestNumber: published?.pullRequestNumber ?? null,
    pullRequestUrl: published?.pullRequestUrl ?? null,
    deployed: Boolean(deployed),
    deployedCurrent,
    deployedAtUtc: deployedCurrent ? liveDeployment.verifiedAtUtc : null,
    deploymentVerificationConfigured: liveDeployment.configured,
    deploymentVerificationAvailable: liveDeployment.available,
    deploymentVerificationError: liveDeployment.error,
    unpublished: !publishedCurrent,
  };
}

async function buildSummary(
  paths: LibraryPaths,
  folder: string,
  publicationManifest: PublicationManifest,
  liveDeployment: LiveDeploymentState
): Promise<{ summary: RuleSummary; selection: SourceSelection }> {
  const selection = await resolveSourceSelection(folder);
  const status = await getStatus(paths, selection, publicationManifest, liveDeployment);

  return {
    selection,
    summary: {
      folderName: selection.folderName,
      ruleNumber: selection.metadata.ruleNumber ?? "",
      ruleName: selection.metadata.ruleName ?? "",
      group: selection.metadata.group ?? selection.metadata.ruleName ?? "Ungrouped",
      title: selection.standardQuestion.title,
      question: selection.standardQuestion.question,
      imageUrl: assetUrl(selection.folderName, selection.imagePath, status.sourceRevision),
      status,
    },
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

export async function listRules(paths: LibraryPaths): Promise<{
  rules: RuleSummary[];
  counts: { total: number; drafts: number; ready: number; published: number; deployed: number };
}> {
  const [folders, publicationManifest, liveDeployment] = await Promise.all([
    findQuestionFolders(paths.outputDir),
    readPublicationManifest(paths),
    readLiveDeployment(),
  ]);
  const items = await mapWithConcurrency(folders, 6, async (folder) =>
    (await buildSummary(paths, folder, publicationManifest, liveDeployment)).summary
  );

  return {
    rules: items,
    counts: {
      total: items.length,
      drafts: items.filter((item) => !item.status.compiledCurrent).length,
      ready: items.filter((item) => item.status.compiledCurrent && !item.status.publishedCurrent).length,
      published: items.filter((item) => item.status.publishedCurrent && !item.status.deployedCurrent).length,
      deployed: items.filter((item) => item.status.deployedCurrent).length,
    },
  };
}

export async function getRule(paths: LibraryPaths, rawFolderName: string): Promise<RuleDetail> {
  const folderName = assertSafeFolderName(rawFolderName);
  const folder = path.join(paths.outputDir, folderName);
  const [publicationManifest, liveDeployment] = await Promise.all([
    readPublicationManifest(paths),
    readLiveDeployment(),
  ]);
  const { summary, selection } = await buildSummary(paths, folder, publicationManifest, liveDeployment);
  const imagePrompt = selection.promptPath ? await fs.readFile(selection.promptPath, "utf8") : "";
  const sourceImageName = selection.metadata.sourceImageName;
  const safeSourceImageName = typeof sourceImageName === "string" && path.basename(sourceImageName) === sourceImageName
    ? sourceImageName
    : null;
  const sourceImageUrl = safeSourceImageName && await pathExists(path.join(paths.inputDir, safeSourceImageName))
    ? `/input/${encodeURIComponent(safeSourceImageName)}`
    : null;

  return {
    ...summary,
    metadata: selection.metadata,
    standardQuestion: selection.standardQuestion,
    juniorQuestion: selection.juniorQuestion,
    sourceImageUrl,
    imagePrompt,
    files: {
      metadata: path.basename(selection.metadataPath),
      question: selection.questionPath ? path.basename(selection.questionPath) : null,
      juniorQuestion: selection.juniorQuestionPath ? path.basename(selection.juniorQuestionPath) : null,
      image: selection.imagePath ? path.basename(selection.imagePath) : null,
      prompt: selection.promptPath ? path.basename(selection.promptPath) : null,
    },
  };
}
