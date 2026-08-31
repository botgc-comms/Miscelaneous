import { promises as fs } from "node:fs";
import path from "node:path";
import type { LibraryPaths } from "./libraryPaths.js";
import { pathExists, readJson } from "./quizFiles.js";

export type PublishedRule = {
  folderName: string;
  sourceRevision: string;
  compiledAtUtc: string;
  publishedAtUtc: string;
  releaseId: string;
  repository: string;
  targetBranch: string;
  publicationBranch: string;
  commitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  files: {
    rule: string;
    image: string;
  };
};

export type PublicationManifest = {
  schemaVersion: 1;
  releaseId: string | null;
  publishedAtUtc: string | null;
  repository: string | null;
  targetBranch: string | null;
  publicationBranch: string | null;
  commitSha: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  rules: Record<string, PublishedRule>;
};

const emptyManifest = (): PublicationManifest => ({
  schemaVersion: 1,
  releaseId: null,
  publishedAtUtc: null,
  repository: null,
  targetBranch: null,
  publicationBranch: null,
  commitSha: null,
  pullRequestNumber: null,
  pullRequestUrl: null,
  rules: {},
});

export function publicationManifestPath(paths: LibraryPaths): string {
  return path.join(paths.publishedDir, "publication-manifest.json");
}

export async function readPublicationManifest(paths: LibraryPaths): Promise<PublicationManifest> {
  const manifestPath = publicationManifestPath(paths);

  if (!await pathExists(manifestPath)) {
    return emptyManifest();
  }

  try {
    const manifest = await readJson<PublicationManifest>(manifestPath);
    return {
      ...emptyManifest(),
      ...manifest,
      rules: manifest.rules ?? {},
    };
  } catch (error) {
    throw new Error(`Could not read the publication manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
}

let manifestWriteQueue: Promise<void> = Promise.resolve();

export async function recordPublication(
  paths: LibraryPaths,
  publication: Omit<PublicationManifest, "schemaVersion" | "rules"> & { rules: PublishedRule[] }
): Promise<PublicationManifest> {
  let result = emptyManifest();

  manifestWriteQueue = manifestWriteQueue.then(async () => {
    const manifest = await readPublicationManifest(paths);
    manifest.releaseId = publication.releaseId;
    manifest.publishedAtUtc = publication.publishedAtUtc;
    manifest.repository = publication.repository;
    manifest.targetBranch = publication.targetBranch;
    manifest.publicationBranch = publication.publicationBranch;
    manifest.commitSha = publication.commitSha;
    manifest.pullRequestNumber = publication.pullRequestNumber;
    manifest.pullRequestUrl = publication.pullRequestUrl;

    for (const rule of publication.rules) {
      manifest.rules[rule.folderName] = rule;
    }

    await fs.mkdir(paths.publishedDir, { recursive: true });
    const manifestPath = publicationManifestPath(paths);
    const temporaryPath = `${manifestPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(manifest, null, 2), "utf8");
    await fs.rename(temporaryPath, manifestPath);
    result = manifest;
  });

  await manifestWriteQueue;
  return result;
}
