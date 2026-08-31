import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileFolder } from "../compilerService.js";
import { getRule, listRules } from "../libraryStore.js";
import type { LibraryPaths } from "../libraryPaths.js";
import { readLiveDeployment } from "../liveDeployment.js";
import { readPublicationManifest, recordPublication } from "../publicationStore.js";
import { assertSafeFileName, assertSafeFolderName, clearFileHashCache } from "../quizFiles.js";

async function fixture(): Promise<{ root: string; paths: LibraryPaths; folderName: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rules-portal-test-"));
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
  const folder = path.join(paths.outputDir, folderName);
  await fs.mkdir(folder, { recursive: true });
  await fs.mkdir(paths.inputDir, { recursive: true });
  await fs.writeFile(path.join(folder, "illustration.png"), Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  ));
  await fs.writeFile(path.join(folder, "final-prompt.txt"), "A golfer tests a portal release.");
  await fs.writeFile(path.join(folder, "metadata.json"), JSON.stringify({
    schemaVersion: 1,
    sourceImageName: "source.png",
    ruleNumber: "1.1",
    ruleName: "Test rule",
    group: "Tests",
    title: "A test rule",
    question: "What should the player do?",
    type: "multiple_choice",
    choices: [
      { id: "a", text: "Correct action" },
      { id: "b", text: "Incorrect action" },
    ],
    correctAnswers: ["a"],
    explanation: "Choose the correct action.",
    imagePrompt: "A golfer tests a portal release.",
  }, null, 2));

  return { root, paths, folderName };
}

test("a rule moves from draft to compiled to published and becomes a draft after editing", async (t) => {
  const { root, paths, folderName } = await fixture();
  t.after(async () => fs.rm(root, { recursive: true, force: true }));

  let rule = await getRule(paths, folderName);
  assert.equal(rule.status.compiled, false);
  assert.equal(rule.status.published, false);
  assert.equal(rule.status.deployed, false);
  assert.equal(rule.status.unpublished, true);

  await compileFolder(path.join(paths.outputDir, folderName), paths.compiledDir);
  rule = await getRule(paths, folderName);
  assert.equal(rule.status.compiledCurrent, true);
  assert.equal(rule.status.deployedCurrent, false);

  await recordPublication(paths, {
    releaseId: "test-release",
    publishedAtUtc: "2026-08-31T12:00:00.000Z",
    repository: "example/rulesready",
    targetBranch: "main",
    publicationBranch: "rulesready/test-release",
    commitSha: "abc123",
    pullRequestNumber: 42,
    pullRequestUrl: "https://github.com/example/rulesready/pull/42",
    rules: [{
      folderName,
      sourceRevision: rule.status.sourceRevision,
      compiledAtUtc: rule.status.compiledAtUtc!,
      publishedAtUtc: "2026-08-31T12:00:00.000Z",
      releaseId: "test-release",
      repository: "example/rulesready",
      targetBranch: "main",
      publicationBranch: "rulesready/test-release",
      commitSha: "abc123",
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/example/rulesready/pull/42",
      files: { rule: "/content/rules/001_001_Test_Rule/rule.json", image: "/content/rules/001_001_Test_Rule/image.webp" },
    }],
  });
  rule = await getRule(paths, folderName);
  assert.equal(rule.status.compiledCurrent, true);
  assert.equal(rule.status.publishedCurrent, true);
  assert.equal(rule.status.deployedCurrent, false);

  const manifest = await readPublicationManifest(paths);
  assert.equal(manifest.rules[folderName]?.releaseId, "test-release");
  assert.equal(
    await fs.readFile(
      path.join(paths.compiledDir, folderName, "illustration.webp")
    ).then(() => true),
    true
  );

  await fs.writeFile(path.join(paths.outputDir, folderName, "question-v3.json"), JSON.stringify({
    suggestion: {
      title: "An updated test rule",
      question: "What should the player do now?",
      choices: [
        { id: "a", text: "Correct updated action" },
        { id: "b", text: "Incorrect action" },
      ],
      correctAnswers: ["a"],
      explanation: "Use the updated action.",
    },
  }));
  clearFileHashCache();

  rule = await getRule(paths, folderName);
  assert.equal(rule.title, "An updated test rule");
  assert.equal(rule.status.compiledCurrent, false);
  assert.equal(rule.status.published, true);
  assert.equal(rule.status.publishedCurrent, false);
  assert.equal(rule.status.deployed, false);
  assert.equal(rule.status.deployedCurrent, false);
  assert.equal(rule.status.unpublished, true);

  const library = await listRules(paths);
  assert.equal(library.counts.total, 1);
  assert.equal(library.counts.drafts, 1);
});

test("live deployment is verified from the public RulesReady manifest", async () => {
  const state = await readLiveDeployment("https://rulesready.test/content/rules/library.json", async () =>
    new Response(JSON.stringify({
      releaseId: "release-live",
      publishedAtUtc: "2026-08-31T12:00:00.000Z",
      rules: [{ folderName: "001_001_Test_Rule", sourceRevision: "revision-live" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  );

  assert.equal(state.available, true);
  assert.equal(state.rules["001_001_Test_Rule"]?.sourceRevision, "revision-live");
  assert.ok(state.verifiedAtUtc);
});

test("folder and prompt file validation blocks traversal", () => {
  assert.equal(assertSafeFolderName("001_Rule"), "001_Rule");
  assert.throws(() => assertSafeFolderName("../secrets"), /Invalid folderName/);
  assert.throws(() => assertSafeFolderName("nested/rule"), /Invalid folderName/);
  assert.equal(
    assertSafeFileName("final-prompt-v4.txt", /^final-prompt(?:-v\d+)?\.txt$/i),
    "final-prompt-v4.txt"
  );
  assert.throws(
    () => assertSafeFileName("../../../secret.txt", /^final-prompt(?:-v\d+)?\.txt$/i),
    /Invalid file name/
  );
});
