import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileFolder } from "../compilerService.js";
import { publishCompiledRules, type RulesReadyRepositoryConfig } from "../githubPublisher.js";
import type { LibraryPaths } from "../libraryPaths.js";
import { readPublicationManifest } from "../publicationStore.js";

test("publishing creates a RulesReady branch, commit, pull request, and local publication record", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rulesready-publisher-test-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const paths: LibraryPaths = {
    projectRoot: root,
    dataRoot: root,
    outputDir: path.join(root, "Output"),
    inputDir: path.join(root, "Input"),
    compiledDir: path.join(root, "compiled"),
    publishedDir: path.join(root, "published"),
    publicDir: path.join(root, "public"),
  };
  const folderName = "001_001_Test_Rule";
  const sourceFolder = path.join(paths.outputDir, folderName);
  await fs.mkdir(sourceFolder, { recursive: true });
  await fs.writeFile(path.join(sourceFolder, "illustration.png"), Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  ));
  await fs.writeFile(path.join(sourceFolder, "final-prompt.txt"), "A test release image.");
  await fs.writeFile(path.join(sourceFolder, "metadata.json"), JSON.stringify({
    schemaVersion: 1,
    ruleNumber: "1.1",
    ruleName: "Test rule",
    group: "Tests",
    title: "Publishing a test rule",
    question: "What happens when this test is published?",
    type: "multiple_choice",
    choices: [{ id: "a", text: "It is reviewed" }, { id: "b", text: "It bypasses review" }],
    correctAnswers: ["a"],
    explanation: "Publishing creates a review pull request.",
  }));
  await compileFolder(sourceFolder, paths.compiledDir);

  const requests: { method: string; url: string; body: any }[] = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method, url, body });

    if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: "base-commit" } });
    if (url.includes("/git/commits/base-commit")) return Response.json({ tree: { sha: "base-tree" } });
    if (method === "GET" && url.includes("/contents/")) return new Response("not found", { status: 404 });
    if (url.endsWith("/git/blobs")) return Response.json({ sha: "image-blob" }, { status: 201 });
    if (url.endsWith("/git/trees")) return Response.json({ sha: "release-tree" }, { status: 201 });
    if (url.endsWith("/git/commits")) return Response.json({ sha: "release-commit" }, { status: 201 });
    if (url.endsWith("/git/refs")) return Response.json({ ref: body.ref }, { status: 201 });
    if (url.endsWith("/pulls")) return Response.json({
      number: 17,
      html_url: "https://github.com/example/rulesready/pull/17",
    }, { status: 201 });
    return Response.json({ message: "Unexpected request" }, { status: 500 });
  };
  const config: RulesReadyRepositoryConfig = {
    repository: "example/rulesready",
    owner: "example",
    repo: "rulesready",
    token: "test-token",
    targetBranch: "main",
    contentPath: "public/content/rules",
  };

  const result = await publishCompiledRules(paths, [folderName], { config, fetchImplementation });
  assert.equal(result.pullRequestNumber, 17);
  assert.equal(result.commitSha, "release-commit");
  assert.match(result.publicationBranch, /^rulesready\/content-/);
  const revisionPrefix = result.rules[0]!.sourceRevision.slice(0, 12);

  const treeRequest = requests.find((request) => request.url.endsWith("/git/trees"));
  assert.ok(treeRequest);
  assert.equal(treeRequest.body.base_tree, "base-tree");
  assert.deepEqual(
    treeRequest.body.tree.map((entry: any) => entry.path).sort(),
    [
      `public/content/rules/001_001_Test_Rule/image-${revisionPrefix}.webp`,
      "public/content/rules/001_001_Test_Rule/rule.json",
      "public/content/rules/library.json",
    ]
  );

  const manifest = await readPublicationManifest(paths);
  assert.equal(manifest.rules[folderName]?.sourceRevision, result.rules[0]!.sourceRevision);
  assert.equal(manifest.rules[folderName]?.pullRequestUrl, "https://github.com/example/rulesready/pull/17");
});
