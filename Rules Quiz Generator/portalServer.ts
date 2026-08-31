import { randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { compileFolder } from "./compilerService.js";
import { createQuizFromRuleDescription } from "./createQuizFromRuleDescription.js";
import { getRule, listRules } from "./libraryStore.js";
import { ensureLibraryData, resolveLibraryPaths, type LibraryPaths } from "./libraryPaths.js";
import { PortalJobManager, type JobReporter } from "./portalJobs.js";
import { assertSafeFolderName, assertSafeFileName } from "./quizFiles.js";
import { regenerateSingleImage } from "./regenerateSingleImage.js";
import {
  deployCompiledRule,
  publishedRuleFilePath,
  readReleaseManifest,
  type ReleasedRule,
} from "./releaseStore.js";
import { suggestQuestionEdit } from "./suggestQuestionEdit.js";

const PORT = Number(process.env.PORT ?? "4317");
const HOST = process.env.HOST ?? "0.0.0.0";
const jobs = new PortalJobManager();

function text(value: unknown, field: string, maxLength = 10_000): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }

  const result = value.trim();

  if (result.length > maxLength) {
    throw new Error(`${field} must be ${maxLength} characters or fewer.`);
  }

  return result;
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function portalAuthentication(req: Request, res: Response, next: NextFunction): void {
  const expectedPassword = process.env.PORTAL_PASSWORD;

  if (!expectedPassword) {
    next();
    return;
  }

  const authorization = req.header("authorization");

  if (authorization?.startsWith("Basic ")) {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    const username = separator >= 0 ? decoded.slice(0, separator) : "";
    const password = separator >= 0 ? decoded.slice(separator + 1) : "";
    const expectedUsername = process.env.PORTAL_USERNAME ?? "admin";

    if (safeEqual(username, expectedUsername) && safeEqual(password, expectedPassword)) {
      next();
      return;
    }
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="Rules Library Portal", charset="UTF-8"');
  res.status(401).send("Authentication required.");
}

function mutationRateLimit(windowMs = 15 * 60_000, limit = 40) {
  const requests = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const recent = (requests.get(key) ?? []).filter((timestamp) => timestamp > now - windowMs);

    if (recent.length >= limit) {
      res.status(429).json({ error: "Too many changes requested. Please wait and try again." });
      return;
    }

    recent.push(now);
    requests.set(key, recent);
    next();
  };
}

function publicManifestEntry(entry: ReleasedRule) {
  const base = `/published/${encodeURIComponent(entry.folderName)}`;
  return {
    ...entry,
    urls: {
      metadata: `${base}/metadata.json`,
      illustration: `${base}/illustration.png`,
      prompt: `${base}/final-prompt.txt`,
    },
  };
}

async function runLibraryRelease(paths: LibraryPaths, reporter: JobReporter): Promise<unknown> {
  const library = await listRules(paths);
  const unpublished = library.rules.filter((rule) => rule.status.unpublished);
  const releaseId = randomUUID();
  let released = 0;
  let processed = 0;

  reporter.update({ total: unpublished.length, message: `Preparing ${unpublished.length} unpublished rules...` });

  for (const rule of unpublished) {
    reporter.update({ message: `Compiling ${rule.title}...` });

    try {
      await compileFolder(path.join(paths.outputDir, rule.folderName), paths.compiledDir);
      reporter.update({ message: `Releasing ${rule.title}...` });
      await deployCompiledRule(paths, rule.folderName, releaseId);
      released += 1;
    } catch (error) {
      reporter.addError(`${rule.title}: ${error instanceof Error ? error.message : String(error)}`);
    }

    processed += 1;
    reporter.update({ processed });
  }

  return { releaseId, released, requested: unpublished.length };
}

export async function createPortalApp(paths = resolveLibraryPaths()): Promise<express.Express> {
  await ensureLibraryData(paths);

  const app = express();
  const changeLimiter = mutationRateLimit();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'"
    );
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", service: "rules-library-portal" });
  });

  app.get("/published/manifest.json", async (_req, res, next) => {
    try {
      const manifest = await readReleaseManifest(paths);
      res.json({
        ...manifest,
        rules: Object.fromEntries(Object.entries(manifest.rules).map(([key, entry]) => [key, publicManifestEntry(entry)])),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/published/library.json", async (_req, res, next) => {
    try {
      const manifest = await readReleaseManifest(paths);
      res.json({
        releaseId: manifest.releaseId,
        releasedAtUtc: manifest.releasedAtUtc,
        rules: Object.values(manifest.rules).map(publicManifestEntry),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/published/:folderName/:fileName", async (req, res, next) => {
    try {
      const folderName = assertSafeFolderName(req.params.folderName);
      const fileName = assertSafeFileName(
        req.params.fileName,
        /^(metadata\.json|illustration\.png|final-prompt\.txt)$/
      );
      const manifest = await readReleaseManifest(paths);
      const entry = manifest.rules[folderName];

      if (!entry) {
        res.status(404).send("Rule has not been released.");
        return;
      }

      const key = fileName === "metadata.json" ? "metadata" : fileName === "illustration.png" ? "illustration" : "prompt";
      res.sendFile(publishedRuleFilePath(paths, entry, key), (error) => {
        if (error) {
          next(error);
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.use(portalAuthentication);
  app.use(express.json({ limit: "2mb" }));
  app.use("/assets", express.static(paths.outputDir, { fallthrough: false, index: false }));
  app.use("/input", express.static(paths.inputDir, { fallthrough: false, index: false }));

  app.get("/api/library", async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await listRules(paths));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/rules/:folderName", async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await getRule(paths, req.params.folderName));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rules", changeLimiter, (req, res, next) => {
    try {
      const description = text(req.body?.description, "description", 8_000);
      const job = jobs.start("create-rule", "Creating the rule...", async (reporter) => {
        reporter.update({ total: 1, message: "Writing the standard and junior questions and generating an image..." });
        const result = await createQuizFromRuleDescription({ outputDir: paths.outputDir, description });
        reporter.update({ processed: 1 });
        return result;
      });
      res.status(202).json(job);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rules/:folderName/suggest-question-edit", changeLimiter, async (req, res, next) => {
    try {
      const result = await suggestQuestionEdit({
        outputDir: paths.outputDir,
        folderName: assertSafeFolderName(req.params.folderName),
        instructions: text(req.body?.instructions, "instructions", 4_000),
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rules/:folderName/regenerate-image", changeLimiter, async (req, res, next) => {
    try {
      const result = await regenerateSingleImage({
        outputDir: paths.outputDir,
        folderName: assertSafeFolderName(req.params.folderName),
        promptFileName: req.body?.promptFileName,
        instructions: text(req.body?.instructions, "instructions", 4_000),
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rules/:folderName/compile", changeLimiter, async (req, res, next) => {
    try {
      const folderName = assertSafeFolderName(req.params.folderName);
      const result = await compileFolder(path.join(paths.outputDir, folderName), paths.compiledDir);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rules/:folderName/deploy", changeLimiter, async (req, res, next) => {
    try {
      const folderName = assertSafeFolderName(req.params.folderName);
      const rule = await getRule(paths, folderName);

      if (!rule.status.compiledCurrent) {
        await compileFolder(path.join(paths.outputDir, folderName), paths.compiledDir);
      }

      const released = await deployCompiledRule(paths, folderName);
      res.json({ success: true, released });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/releases/unpublished", changeLimiter, (_req, res) => {
    const running = jobs.findRunning("release-unpublished");

    if (running) {
      res.status(202).json(running);
      return;
    }

    const job = jobs.start("release-unpublished", "Finding unpublished rules...", (reporter) =>
      runLibraryRelease(paths, reporter)
    );
    res.status(202).json(job);
  });

  app.get("/api/jobs/:jobId", (req, res) => {
    const job = jobs.get(req.params.jobId);

    if (!job) {
      res.status(404).json({ error: "Job not found." });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.json(job);
  });

  // Compatibility routes for the previous generated review page.
  app.post("/api/create-quiz-from-description", changeLimiter, async (req, res, next) => {
    try {
      res.json(await createQuizFromRuleDescription({
        outputDir: paths.outputDir,
        description: text(req.body?.description, "description", 8_000),
      }));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/suggest-question-edit", changeLimiter, async (req, res, next) => {
    try {
      res.json(await suggestQuestionEdit({
        outputDir: paths.outputDir,
        folderName: assertSafeFolderName(req.body?.folderName),
        instructions: text(req.body?.instructions, "instructions", 4_000),
      }));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/regenerate-image", changeLimiter, async (req, res, next) => {
    try {
      res.json(await regenerateSingleImage({
        outputDir: paths.outputDir,
        folderName: assertSafeFolderName(req.body?.folderName),
        promptFileName: req.body?.promptFileName,
        instructions: text(req.body?.instructions, "instructions", 4_000),
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/image-review.html", (_req, res) => res.redirect(302, "/"));
  app.use(express.static(paths.publicDir, { index: "index.html" }));
  app.get("/", (_req, res) => res.sendFile(path.join(paths.publicDir, "index.html")));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(error);
    const status = /not found|has not been released/i.test(message) ? 404 : 400;
    res.status(status).json({ error: message });
  });

  return app;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && !process.env.PORTAL_PASSWORD) {
    throw new Error("PORTAL_PASSWORD must be set in production.");
  }

  if (!process.env.PORTAL_PASSWORD) {
    console.warn("PORTAL_PASSWORD is not set; the local portal is running without authentication.");
  }

  const paths = resolveLibraryPaths();
  const app = await createPortalApp(paths);
  const server = app.listen(PORT, HOST, () => {
    console.log(`Rules Library Portal listening on http://${HOST}:${PORT}`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]!);

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
