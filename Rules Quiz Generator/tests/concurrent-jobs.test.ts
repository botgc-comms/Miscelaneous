import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { reserveNextFolderPath } from "../createQuizFromRuleDescription.js";
import { PortalJobManager } from "../portalJobs.js";

test("concurrent rule drafts reserve distinct sequential folders", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rulesready-folders-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const folders = await Promise.all([
    reserveNextFolderPath(root, "The same rule"),
    reserveNextFolderPath(root, "The same rule"),
    reserveNextFolderPath(root, "A different rule"),
  ]);
  const names = folders.map((folder) => path.basename(folder));

  assert.equal(new Set(names).size, 3);
  assert.deepEqual(names.map((name) => name.slice(0, 6)), ["ai_001", "ai_002", "ai_003"]);
  assert.equal((await fs.readdir(root)).length, 3);
});

test("background jobs run independently instead of waiting for one another", async () => {
  const manager = new PortalJobManager();
  let releaseJobs: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseJobs = resolve;
  });
  let running = 0;
  let maximumRunning = 0;

  const startJob = (name: string) => manager.start("create-rule", `Creating ${name}`, async () => {
    running += 1;
    maximumRunning = Math.max(maximumRunning, running);
    await gate;
    running -= 1;
    return { name };
  });

  const first = startJob("first");
  const second = startJob("second");
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(first.status, "running");
  assert.equal(second.status, "running");
  assert.equal(maximumRunning, 2);

  releaseJobs();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  assert.deepEqual(first.result, { name: "first" });
  assert.deepEqual(second.result, { name: "second" });
});
