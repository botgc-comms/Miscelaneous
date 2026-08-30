import { promises as fs } from "node:fs";
import path from "node:path";
import { pathExists } from "./quizFiles.js";

export type LibraryPaths = {
  projectRoot: string;
  dataRoot: string;
  outputDir: string;
  inputDir: string;
  compiledDir: string;
  publishedDir: string;
  publicDir: string;
};

function resolveDataPath(dataRoot: string, configured: string | undefined, fallback: string): string {
  if (!configured) {
    return path.join(dataRoot, fallback);
  }

  return path.isAbsolute(configured) ? configured : path.resolve(dataRoot, configured);
}

export function resolveLibraryPaths(projectRoot = process.cwd()): LibraryPaths {
  const dataRoot = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : projectRoot;

  return {
    projectRoot,
    dataRoot,
    outputDir: resolveDataPath(dataRoot, process.env.OUTPUT_DIR, "Output"),
    inputDir: resolveDataPath(dataRoot, process.env.INPUT_DIR, "Input"),
    compiledDir: resolveDataPath(dataRoot, process.env.COMPILED_DIR, "compiled"),
    publishedDir: resolveDataPath(dataRoot, process.env.PUBLISHED_DIR, "published"),
    publicDir: path.join(projectRoot, "public"),
  };
}

async function copySeedDirectory(source: string, target: string): Promise<void> {
  if (!await pathExists(source)) {
    return;
  }

  await fs.mkdir(target, { recursive: true });
  await fs.cp(source, target, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
}

export async function ensureLibraryData(paths: LibraryPaths): Promise<void> {
  await fs.mkdir(paths.dataRoot, { recursive: true });

  if (path.resolve(paths.dataRoot) !== path.resolve(paths.projectRoot)) {
    const markerPath = path.join(paths.dataRoot, ".quiz-library-seeded-v1.json");

    if (!await pathExists(markerPath)) {
      console.log(`Seeding the persistent quiz library in ${paths.dataRoot}...`);
      await copySeedDirectory(path.join(paths.projectRoot, "Output"), paths.outputDir);
      await copySeedDirectory(path.join(paths.projectRoot, "Input"), paths.inputDir);
      await fs.writeFile(markerPath, JSON.stringify({
        schemaVersion: 1,
        seededAtUtc: new Date().toISOString(),
        source: paths.projectRoot,
      }, null, 2));
      console.log("Persistent quiz library seed complete.");
    }
  }

  await Promise.all([
    fs.mkdir(paths.outputDir, { recursive: true }),
    fs.mkdir(paths.inputDir, { recursive: true }),
    fs.mkdir(paths.compiledDir, { recursive: true }),
    fs.mkdir(paths.publishedDir, { recursive: true }),
  ]);
}
