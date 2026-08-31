import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LibraryPaths } from "./libraryPaths.js";
import { assertSafeFolderName, pathExists, readJson } from "./quizFiles.js";

export type ReleasedRule = {
  folderName: string;
  sourceRevision: string;
  compiledAtUtc: string;
  deployedAtUtc: string;
  releaseId: string;
  files: {
    metadata: "metadata.json";
    illustration: "illustration.png";
    prompt: "final-prompt.txt";
  };
};

export type ReleaseManifest = {
  schemaVersion: 1;
  releaseId: string | null;
  releasedAtUtc: string | null;
  rules: Record<string, ReleasedRule>;
};

const emptyManifest = (): ReleaseManifest => ({
  schemaVersion: 1,
  releaseId: null,
  releasedAtUtc: null,
  rules: {},
});

export function releaseManifestPath(paths: LibraryPaths): string {
  return path.join(paths.publishedDir, "release-manifest.json");
}

export async function readReleaseManifest(paths: LibraryPaths): Promise<ReleaseManifest> {
  const manifestPath = releaseManifestPath(paths);

  if (!await pathExists(manifestPath)) {
    return emptyManifest();
  }

  try {
    const manifest = await readJson<ReleaseManifest>(manifestPath);
    return {
      ...emptyManifest(),
      ...manifest,
      rules: manifest.rules ?? {},
    };
  } catch (error) {
    throw new Error(`Could not read the release manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
}

let manifestWriteQueue: Promise<void> = Promise.resolve();

async function writeManifest(paths: LibraryPaths, update: (manifest: ReleaseManifest) => void): Promise<ReleaseManifest> {
  let result = emptyManifest();

  manifestWriteQueue = manifestWriteQueue.then(async () => {
    const manifest = await readReleaseManifest(paths);
    update(manifest);
    await fs.mkdir(paths.publishedDir, { recursive: true });
    await fs.writeFile(releaseManifestPath(paths), JSON.stringify(manifest, null, 2), "utf8");
    result = manifest;
  });

  await manifestWriteQueue;
  return result;
}

export async function deployCompiledRule(
  paths: LibraryPaths,
  rawFolderName: string,
  releaseId: string = randomUUID()
): Promise<ReleasedRule> {
  const folderName = assertSafeFolderName(rawFolderName);
  const compiledFolder = path.join(paths.compiledDir, folderName);
  const compiledMetadataPath = path.join(compiledFolder, "metadata.json");

  if (!await pathExists(compiledMetadataPath)) {
    throw new Error(`${folderName} has not been compiled.`);
  }

  const compiledMetadata = await readJson<any>(compiledMetadataPath);
  const sourceRevision = compiledMetadata?.compiledFrom?.sourceRevision;
  const compiledAtUtc = compiledMetadata?.compiledFrom?.compiledAtUtc;

  if (!sourceRevision || !compiledAtUtc) {
    throw new Error(`${folderName} must be recompiled with the current compiler before it can be released.`);
  }

  for (const fileName of ["metadata.json", "illustration.png", "final-prompt.txt"]) {
    if (!await pathExists(path.join(compiledFolder, fileName))) {
      throw new Error(`${folderName} is missing compiled ${fileName}.`);
    }
  }

  const revisionFolder = path.join(paths.publishedDir, "rules", folderName, sourceRevision);

  if (!await pathExists(revisionFolder)) {
    await fs.mkdir(path.dirname(revisionFolder), { recursive: true });
    const temporaryFolder = `${revisionFolder}.tmp-${randomUUID()}`;
    await fs.cp(compiledFolder, temporaryFolder, { recursive: true, force: true });
    await fs.rename(temporaryFolder, revisionFolder);
  }

  const deployedAtUtc = new Date().toISOString();
  const entry: ReleasedRule = {
    folderName,
    sourceRevision,
    compiledAtUtc,
    deployedAtUtc,
    releaseId,
    files: {
      metadata: "metadata.json",
      illustration: "illustration.png",
      prompt: "final-prompt.txt",
    },
  };

  await writeManifest(paths, (manifest) => {
    manifest.releaseId = releaseId;
    manifest.releasedAtUtc = deployedAtUtc;
    manifest.rules[folderName] = entry;
  });

  const rulesRoot = path.join(paths.publishedDir, "rules", folderName);
  const revisions = await fs.readdir(rulesRoot, { withFileTypes: true });

  for (const revision of revisions) {
    if (revision.isDirectory() && revision.name !== sourceRevision) {
      await fs.rm(path.join(rulesRoot, revision.name), { recursive: true, force: true });
    }
  }

  return entry;
}

export function publishedRuleFilePath(
  paths: LibraryPaths,
  entry: ReleasedRule,
  fileName: keyof ReleasedRule["files"]
): string {
  return path.join(
    paths.publishedDir,
    "rules",
    entry.folderName,
    entry.sourceRevision,
    entry.files[fileName]
  );
}
