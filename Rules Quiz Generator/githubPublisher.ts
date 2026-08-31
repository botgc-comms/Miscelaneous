import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LibraryPaths } from "./libraryPaths.js";
import { recordPublication, type PublishedRule } from "./publicationStore.js";
import {
  assertSafeFolderName,
  computeSourceRevision,
  pathExists,
  readJson,
  resolveSourceSelection,
} from "./quizFiles.js";

export type RulesReadyRepositoryConfig = {
  repository: string;
  owner: string;
  repo: string;
  token: string;
  targetBranch: string;
  contentPath: string;
};

export type PublicRuleEntry = {
  folderName: string;
  sourceRevision: string;
  ruleNumber: string;
  ruleName: string;
  group: string;
  title: string;
  rule: string;
  image: string;
};

export type PublicLibrary = {
  schemaVersion: 1;
  releaseId: string;
  publishedAtUtc: string;
  rules: PublicRuleEntry[];
};

export type GitHubPublicationResult = {
  releaseId: string;
  publishedAtUtc: string;
  repository: string;
  targetBranch: string;
  publicationBranch: string;
  commitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  rules: PublishedRule[];
};

export type PublicationProgress = (values: {
  message: string;
  processed?: number;
  total?: number;
}) => void;

type CompiledRulePackage = {
  folderName: string;
  sourceRevision: string;
  compiledAtUtc: string;
  publicEntry: PublicRuleEntry;
  ruleJson: string;
  image: Buffer;
};

type GitHubErrorBody = { message?: string; documentation_url?: string };

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required before content can be published.`);
  return value;
}

function normalizeContentPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/");
  if (
    !normalized ||
    !/^[A-Za-z0-9._/-]+$/.test(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("RULESREADY_CONTENT_PATH must be a safe repository-relative directory.");
  }
  return normalized;
}

export function resolveRulesReadyRepositoryConfig(): RulesReadyRepositoryConfig {
  const repository = requiredEnvironmentValue("RULESREADY_GITHUB_REPOSITORY");
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(repository);
  if (!match) throw new Error("RULESREADY_GITHUB_REPOSITORY must use the owner/repository format.");

  const targetBranch = process.env.RULESREADY_GITHUB_BRANCH?.trim() || "main";
  if (
    !/^[A-Za-z0-9._/-]+$/.test(targetBranch) ||
    targetBranch.startsWith("/") ||
    targetBranch.endsWith("/") ||
    targetBranch.includes("//") ||
    targetBranch.includes("..") ||
    targetBranch.includes("@{") ||
    targetBranch.endsWith(".lock")
  ) {
    throw new Error("RULESREADY_GITHUB_BRANCH contains invalid characters.");
  }

  return {
    repository,
    owner: match[1]!,
    repo: match[2]!,
    token: requiredEnvironmentValue("RULESREADY_GITHUB_TOKEN"),
    targetBranch,
    contentPath: normalizeContentPath(process.env.RULESREADY_CONTENT_PATH?.trim() || "public/content/rules"),
  };
}

export function repositoryPublishingConfiguration() {
  const repository = process.env.RULESREADY_GITHUB_REPOSITORY?.trim() || null;
  const targetBranch = process.env.RULESREADY_GITHUB_BRANCH?.trim() || "main";
  const contentPath = process.env.RULESREADY_CONTENT_PATH?.trim() || "public/content/rules";
  const liveManifestUrl = process.env.RULESREADY_LIVE_MANIFEST_URL?.trim() || null;
  return {
    configured: Boolean(repository && process.env.RULESREADY_GITHUB_TOKEN?.trim()),
    repository,
    targetBranch,
    contentPath,
    liveManifestUrl,
    liveVerificationConfigured: Boolean(liveManifestUrl),
  };
}

class GitHubApi {
  constructor(
    private readonly config: RulesReadyRepositoryConfig,
    private readonly fetchImplementation: typeof fetch
  ) {}

  private repositoryPath(route: string): string {
    return `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}${route}`;
  }

  async request<T>(method: string, route: string, body?: unknown, allowNotFound = false): Promise<T | null> {
    const response = await this.fetchImplementation(`https://api.github.com${this.repositoryPath(route)}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.config.token}`,
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "RulesReady-Content-Studio",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      let details: GitHubErrorBody = {};
      try {
        details = await response.json() as GitHubErrorBody;
      } catch {
        // GitHub occasionally returns a non-JSON proxy response.
      }
      throw new Error(`GitHub ${method} ${route} failed (${response.status}): ${details.message ?? response.statusText}`);
    }

    if (response.status === 204) return null;
    return await response.json() as T;
  }

  async readLibrary(contentPath: string, branch: string): Promise<PublicLibrary | null> {
    const route = `/contents/${contentPath.split("/").map(encodeURIComponent).join("/")}/library.json?ref=${encodeURIComponent(branch)}`;
    const file = await this.request<{ content?: string; encoding?: string }>("GET", route, undefined, true);
    if (!file) return null;
    if (file.encoding !== "base64" || !file.content) {
      throw new Error("The RulesReady library.json could not be read through the GitHub API.");
    }

    try {
      return JSON.parse(Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8")) as PublicLibrary;
    } catch (error) {
      throw new Error(`The existing RulesReady library.json is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function publicRelativePath(contentPath: string, child: string): string {
  const publicPrefix = "public/";
  const root = contentPath.startsWith(publicPrefix) ? contentPath.slice(publicPrefix.length) : contentPath;
  return `/${[root, child].filter(Boolean).join("/")}`;
}

async function readCompiledRule(
  paths: LibraryPaths,
  rawFolderName: string,
  contentPath: string
): Promise<CompiledRulePackage> {
  const folderName = assertSafeFolderName(rawFolderName);
  const compiledFolder = path.join(paths.compiledDir, folderName);
  const metadataPath = path.join(compiledFolder, "metadata.json");
  if (!await pathExists(metadataPath)) throw new Error(`${folderName} has not been compiled.`);

  const metadata = await readJson<any>(metadataPath);
  const sourceRevision = metadata?.compiledFrom?.sourceRevision;
  const compiledAtUtc = metadata?.compiledFrom?.compiledAtUtc;
  const compiledImageFileName = metadata?.imageFileName;
  if (typeof sourceRevision !== "string" || typeof compiledAtUtc !== "string") {
    throw new Error(`${folderName} must be recompiled with the current compiler.`);
  }
  if (compiledImageFileName !== "illustration.webp") {
    throw new Error(`${folderName} must be recompiled to produce an optimized WebP image.`);
  }

  const imagePath = path.join(compiledFolder, compiledImageFileName);
  if (!await pathExists(imagePath)) throw new Error(`${folderName} is missing its compiled WebP image.`);

  const workingSelection = await resolveSourceSelection(path.join(paths.outputDir, folderName));
  const workingRevision = await computeSourceRevision(workingSelection);
  if (workingRevision !== sourceRevision) {
    throw new Error(`${folderName} changed after it was compiled. Compile it again before publishing.`);
  }

  const imageFileName = `image-${sourceRevision.slice(0, 12)}.webp`;
  const rulePath = `${folderName}/rule.json`;
  const imageRelativePath = `${folderName}/${imageFileName}`;
  const publicMetadata = {
    ...metadata,
    sourceRevision,
    imageFileName,
    compiledFrom: {
      sourceRevision,
      compiledAtUtc,
      publicImage: metadata?.compiledFrom?.publicImage ?? null,
    },
  };
  delete publicMetadata.promptFileName;
  delete publicMetadata.imagePrompt;
  delete publicMetadata.sourceImageName;

  return {
    folderName,
    sourceRevision,
    compiledAtUtc,
    publicEntry: {
      folderName,
      sourceRevision,
      ruleNumber: String(metadata.ruleNumber ?? ""),
      ruleName: String(metadata.ruleName ?? ""),
      group: String(metadata.group ?? metadata.ruleName ?? "Ungrouped"),
      title: String(metadata.questions?.find((question: any) => question?.audience === "standard")?.title ?? metadata.ruleName ?? folderName),
      rule: publicRelativePath(contentPath, rulePath),
      image: publicRelativePath(contentPath, imageRelativePath),
    },
    ruleJson: `${JSON.stringify(publicMetadata, null, 2)}\n`,
    image: await fs.readFile(imagePath),
  };
}

function mergeLibrary(
  existing: PublicLibrary | null,
  updates: CompiledRulePackage[],
  releaseId: string,
  publishedAtUtc: string
): PublicLibrary {
  const rules = new Map<string, PublicRuleEntry>();
  const existingRules = Array.isArray(existing?.rules)
    ? existing.rules
    : existing?.rules && typeof existing.rules === "object"
      ? Object.values(existing.rules as Record<string, PublicRuleEntry>)
      : [];
  for (const rule of existingRules) {
    if (rule?.folderName) rules.set(rule.folderName, rule);
  }
  for (const update of updates) rules.set(update.folderName, update.publicEntry);

  return {
    schemaVersion: 1,
    releaseId,
    publishedAtUtc,
    rules: [...rules.values()].sort((left, right) =>
      left.ruleNumber.localeCompare(right.ruleNumber, undefined, { numeric: true }) || left.title.localeCompare(right.title)
    ),
  };
}

export async function publishCompiledRules(
  paths: LibraryPaths,
  folderNames: string[],
  options: {
    config?: RulesReadyRepositoryConfig;
    fetchImplementation?: typeof fetch;
    progress?: PublicationProgress;
  } = {}
): Promise<GitHubPublicationResult> {
  const config = options.config ?? resolveRulesReadyRepositoryConfig();
  const api = new GitHubApi(config, options.fetchImplementation ?? fetch);
  const uniqueFolderNames = [...new Set(folderNames.map(assertSafeFolderName))];
  if (uniqueFolderNames.length === 0) throw new Error("There are no compiled rules ready to publish.");

  const releaseId = randomUUID();
  const publishedAtUtc = new Date().toISOString();
  const total = uniqueFolderNames.length + 6;
  let processed = 0;
  const update = (message: string) => options.progress?.({ message, processed, total });

  update(`Preparing ${uniqueFolderNames.length} compiled rule${uniqueFolderNames.length === 1 ? "" : "s"}...`);
  const packages: CompiledRulePackage[] = [];
  for (const folderName of uniqueFolderNames) {
    packages.push(await readCompiledRule(paths, folderName, config.contentPath));
    processed += 1;
    update(`Prepared ${folderName}.`);
  }

  update(`Reading ${config.repository}:${config.targetBranch}...`);
  const baseRef = await api.request<{ object: { sha: string } }>(
    "GET",
    `/git/ref/heads/${encodeURIComponent(config.targetBranch)}`
  );
  if (!baseRef) throw new Error(`The target branch ${config.targetBranch} was not found.`);
  const baseCommit = await api.request<{ tree: { sha: string } }>("GET", `/git/commits/${baseRef.object.sha}`);
  if (!baseCommit) throw new Error(`The target commit ${baseRef.object.sha} could not be read.`);
  const existingLibrary = await api.readLibrary(config.contentPath, config.targetBranch);
  processed += 1;

  const library = mergeLibrary(existingLibrary, packages, releaseId, publishedAtUtc);
  const treeEntries: { path: string; mode: "100644"; type: "blob"; content?: string; sha?: string }[] = [{
    path: `${config.contentPath}/library.json`,
    mode: "100644",
    type: "blob",
    content: `${JSON.stringify(library, null, 2)}\n`,
  }];

  for (const item of packages) {
    update(`Uploading ${item.folderName} artwork...`);
    const blob = await api.request<{ sha: string }>("POST", "/git/blobs", {
      content: item.image.toString("base64"),
      encoding: "base64",
    });
    if (!blob) throw new Error(`GitHub did not return an image blob for ${item.folderName}.`);
    treeEntries.push(
      { path: `${config.contentPath}/${item.folderName}/rule.json`, mode: "100644", type: "blob", content: item.ruleJson },
      { path: `${config.contentPath}/${item.folderName}/${path.basename(item.publicEntry.image)}`, mode: "100644", type: "blob", sha: blob.sha }
    );
  }
  processed += 1;

  update("Creating the RulesReady release commit...");
  const tree = await api.request<{ sha: string }>("POST", "/git/trees", {
    base_tree: baseCommit.tree.sha,
    tree: treeEntries,
  });
  if (!tree) throw new Error("GitHub did not return a release tree.");
  processed += 1;

  const commit = await api.request<{ sha: string }>("POST", "/git/commits", {
    message: `Publish ${packages.length} RulesReady rule${packages.length === 1 ? "" : "s"}`,
    tree: tree.sha,
    parents: [baseRef.object.sha],
  });
  if (!commit) throw new Error("GitHub did not return a release commit.");
  processed += 1;

  const branchTimestamp = publishedAtUtc.replace(/[-:TZ.]/g, "").slice(0, 14);
  const publicationBranch = `rulesready/content-${branchTimestamp}-${releaseId.slice(0, 8)}`;
  update(`Pushing ${publicationBranch}...`);
  await api.request("POST", "/git/refs", {
    ref: `refs/heads/${publicationBranch}`,
    sha: commit.sha,
  });
  processed += 1;

  update("Opening the RulesReady content pull request...");
  const pullRequest = await api.request<{ number: number; html_url: string }>("POST", "/pulls", {
    title: `RulesReady content release · ${packages.length} rule${packages.length === 1 ? "" : "s"}`,
    head: publicationBranch,
    base: config.targetBranch,
    body: [
      "Automated content release from RulesReady Content Studio.",
      "",
      ...packages.map((item) => `- ${item.publicEntry.ruleNumber || "Rule"} · ${item.publicEntry.title} (\`${item.sourceRevision.slice(0, 12)}\`)`),
      "",
      `Release ID: \`${releaseId}\``,
    ].join("\n"),
  });
  if (!pullRequest) throw new Error("GitHub did not return a pull request.");
  processed += 1;

  const rules: PublishedRule[] = packages.map((item) => ({
    folderName: item.folderName,
    sourceRevision: item.sourceRevision,
    compiledAtUtc: item.compiledAtUtc,
    publishedAtUtc,
    releaseId,
    repository: config.repository,
    targetBranch: config.targetBranch,
    publicationBranch,
    commitSha: commit.sha,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.html_url,
    files: {
      rule: item.publicEntry.rule,
      image: item.publicEntry.image,
    },
  }));

  const result: GitHubPublicationResult = {
    releaseId,
    publishedAtUtc,
    repository: config.repository,
    targetBranch: config.targetBranch,
    publicationBranch,
    commitSha: commit.sha,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.html_url,
    rules,
  };

  await recordPublication(paths, result);
  options.progress?.({ message: `Pull request #${pullRequest.number} is ready for review.`, processed: total, total });
  return result;
}
