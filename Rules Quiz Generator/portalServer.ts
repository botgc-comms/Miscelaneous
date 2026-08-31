import { createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { compileFolder } from "./compilerService.js";
import { createQuizFromRuleDescription } from "./createQuizFromRuleDescription.js";
import { getRule, listRules } from "./libraryStore.js";
import { ensureLibraryData, resolveLibraryPaths, type LibraryPaths } from "./libraryPaths.js";
import { PortalJobManager, type JobReporter } from "./portalJobs.js";
import { publishCompiledRules, repositoryPublishingConfiguration } from "./githubPublisher.js";
import { assertSafeFolderName } from "./quizFiles.js";
import { regenerateSingleImage } from "./regenerateSingleImage.js";
import { suggestQuestionEdit } from "./suggestQuestionEdit.js";

const PORT = Number(process.env.PORT ?? "4317");
const HOST = process.env.HOST ?? "0.0.0.0";
const jobs = new PortalJobManager();
const SESSION_COOKIE = "rulesready_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

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

function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return /[\r\n]/.test(value) ? "/" : value;
}

function parseCookie(req: Request, name: string): string | undefined {
  const cookies = req.header("cookie")?.split(";") ?? [];

  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    const key = separator >= 0 ? cookie.slice(0, separator).trim() : cookie.trim();

    if (key === name) {
      return separator >= 0 ? cookie.slice(separator + 1).trim() : "";
    }
  }

  return undefined;
}

function createSessionToken(username: string, password: string): string {
  const payload = Buffer.from(JSON.stringify({
    username,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  })).toString("base64url");
  const signature = createHmac("sha256", password).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function hasValidSession(req: Request): boolean {
  const expectedPassword = process.env.PORTAL_PASSWORD;

  if (!expectedPassword) {
    return true;
  }

  const token = parseCookie(req, SESSION_COOKIE);
  const separator = token?.lastIndexOf(".") ?? -1;

  if (!token || separator < 1) {
    return false;
  }

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expectedSignature = createHmac("sha256", expectedPassword).update(payload).digest("base64url");

  if (!safeEqual(signature, expectedSignature)) {
    return false;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      username?: unknown;
      expiresAt?: unknown;
    };
    return session.username === (process.env.PORTAL_USERNAME ?? "admin")
      && typeof session.expiresAt === "number"
      && session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function sessionCookie(req: Request, value: string, maxAge = SESSION_TTL_SECONDS): string {
  const secure = process.env.NODE_ENV === "production" || req.secure ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function portalAuthentication(req: Request, res: Response, next: NextFunction): void {
  if (hasValidSession(req)) {
    next();
    return;
  }

  if (req.path.startsWith("/api/")) {
    res.status(401).json({ error: "Your session has expired. Please sign in again." });
    return;
  }

  res.redirect(303, `/login?next=${encodeURIComponent(safeReturnPath(req.originalUrl))}`);
}

function sameOriginMutation(req: Request, res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }

  const origin = req.header("origin");
  const fetchSite = req.header("sec-fetch-site");

  try {
    if ((origin && new URL(origin).host !== req.header("host"))
      || (fetchSite && !["same-origin", "none"].includes(fetchSite))) {
      res.status(403).json({ error: "Cross-site changes are not allowed." });
      return;
    }
  } catch {
    res.status(403).json({ error: "Invalid request origin." });
    return;
  }

  next();
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

async function runReadyPublication(paths: LibraryPaths, reporter: JobReporter): Promise<unknown> {
  const library = await listRules(paths);
  const ready = library.rules.filter((rule) => rule.status.compiledCurrent && !rule.status.publishedCurrent);
  return publishCompiledRules(paths, ready.map((rule) => rule.folderName), {
    progress: (values) => reporter.update(values),
  });
}

async function runDraftCompilation(paths: LibraryPaths, reporter: JobReporter): Promise<unknown> {
  const library = await listRules(paths);
  const drafts = library.rules.filter((rule) => !rule.status.compiledCurrent);
  let compiled = 0;
  let processed = 0;
  reporter.update({ total: drafts.length, message: `Preparing to compile ${drafts.length} draft rule${drafts.length === 1 ? "" : "s"}...` });

  for (const rule of drafts) {
    reporter.update({ message: `Validating and optimizing ${rule.title}...` });
    try {
      await compileFolder(path.join(paths.outputDir, rule.folderName), paths.compiledDir);
      compiled += 1;
    } catch (error) {
      reporter.addError(`${rule.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
    processed += 1;
    reporter.update({ processed });
  }

  return { compiled, requested: drafts.length };
}

export async function createPortalApp(paths = resolveLibraryPaths()): Promise<express.Express> {
  await ensureLibraryData(paths);

  const app = express();
  const changeLimiter = mutationRateLimit();
  const loginLimiter = mutationRateLimit(15 * 60_000, 12);

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    );
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", service: "rulesready-content-studio" });
  });

  app.get("/styles.css", (_req, res) => res.sendFile(path.join(paths.publicDir, "styles.css")));
  app.get("/login.js", (_req, res) => res.sendFile(path.join(paths.publicDir, "login.js")));

  app.get("/login", (req, res) => {
    if (!process.env.PORTAL_PASSWORD || hasValidSession(req)) {
      res.redirect(303, safeReturnPath(req.query.next));
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(paths.publicDir, "login.html"));
  });

  app.post("/login", loginLimiter, (req, res) => {
    const expectedUsername = process.env.PORTAL_USERNAME ?? "admin";
    const expectedPassword = process.env.PORTAL_PASSWORD;
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const nextPath = safeReturnPath(req.body?.next);

    if (expectedPassword && safeEqual(username, expectedUsername) && safeEqual(password, expectedPassword)) {
      res.setHeader("Set-Cookie", sessionCookie(req, createSessionToken(username, expectedPassword)));
      res.redirect(303, nextPath);
      return;
    }

    const query = new URLSearchParams({ error: "1", next: nextPath });
    res.redirect(303, `/login?${query.toString()}`);
  });

  app.post("/logout", sameOriginMutation, (req, res) => {
    res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
    res.redirect(303, "/login");
  });

  app.use(portalAuthentication);
  app.use(sameOriginMutation);
  app.use("/assets", express.static(paths.outputDir, { fallthrough: false, index: false }));
  app.use("/input", express.static(paths.inputDir, { fallthrough: false, index: false }));

  app.get("/api/session", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ username: process.env.PORTAL_USERNAME ?? "admin" });
  });

  app.get("/api/library", async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({
        ...await listRules(paths),
        publishing: repositoryPublishingConfiguration(),
      });
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
      if (jobs.findRunning("compile-drafts")) {
        res.status(409).json({ error: "The draft library is already being compiled." });
        return;
      }
      const folderName = assertSafeFolderName(req.params.folderName);
      const result = await compileFolder(path.join(paths.outputDir, folderName), paths.compiledDir);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rules/:folderName/publish", changeLimiter, async (req, res, next) => {
    try {
      const folderName = assertSafeFolderName(req.params.folderName);
      const rule = await getRule(paths, folderName);
      if (!rule.status.compiledCurrent) {
        throw new Error(`${rule.title} has draft changes and must be compiled before it can be published.`);
      }
      if (rule.status.publishedCurrent) {
        throw new Error(`${rule.title} has already been published.`);
      }

      const running = jobs.findRunning("publish-rules");
      if (running) {
        res.status(409).json({ error: "Another RulesReady publication is already in progress." });
        return;
      }

      const job = jobs.start("publish-rules", `Publishing ${rule.title}...`, (reporter) =>
        publishCompiledRules(paths, [folderName], {
          progress: (values) => reporter.update(values),
        })
      );
      res.status(202).json(job);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/compilations/drafts", changeLimiter, (_req, res) => {
    const running = jobs.findRunning("compile-drafts");
    if (running) {
      res.status(202).json(running);
      return;
    }

    const job = jobs.start("compile-drafts", "Finding draft rules...", (reporter) =>
      runDraftCompilation(paths, reporter)
    );
    res.status(202).json(job);
  });

  app.post("/api/publications/ready", changeLimiter, (_req, res) => {
    const running = jobs.findRunning("publish-rules");

    if (running) {
      res.status(409).json({ error: "Another RulesReady publication is already in progress." });
      return;
    }

    const job = jobs.start("publish-rules", "Finding compiled rules ready to publish...", (reporter) =>
      runReadyPublication(paths, reporter)
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
    console.log(`RulesReady Content Studio listening on http://${HOST}:${PORT}`);
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
