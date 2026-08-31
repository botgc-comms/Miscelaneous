import assert from "node:assert/strict";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPortalApp } from "../portalServer.js";
import type { LibraryPaths } from "../libraryPaths.js";

test("the portal uses an HTML login and a signed session cookie", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rulesready-auth-test-"));
  const previousEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    PORTAL_USERNAME: process.env.PORTAL_USERNAME,
    PORTAL_PASSWORD: process.env.PORTAL_PASSWORD,
  };
  process.env.NODE_ENV = "test";
  process.env.PORTAL_USERNAME = "editor";
  process.env.PORTAL_PASSWORD = "correct-horse-battery-staple";

  const paths: LibraryPaths = {
    projectRoot: root,
    dataRoot: root,
    outputDir: path.join(root, "Output"),
    inputDir: path.join(root, "Input"),
    compiledDir: path.join(root, "compiled"),
    publishedDir: path.join(root, "published"),
    publicDir: path.resolve("public"),
  };
  const app = await createPortalApp(paths);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });

    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const protectedPage = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert.equal(protectedPage.status, 303);
  assert.equal(protectedPage.headers.get("location"), "/login?next=%2F");
  assert.equal(protectedPage.headers.get("www-authenticate"), null);

  const loginPage = await fetch(`${baseUrl}/login`);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /RulesReady Content Studio/);
  assert.match(loginPage.headers.get("content-type") ?? "", /text\/html/);

  const anonymousApi = await fetch(`${baseUrl}/api/library`);
  assert.equal(anonymousApi.status, 401);
  assert.deepEqual(await anonymousApi.json(), { error: "Your session has expired. Please sign in again." });

  const invalidLogin = await fetch(`${baseUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "editor", password: "wrong", next: "/" }),
  });
  assert.equal(invalidLogin.status, 303);
  assert.match(invalidLogin.headers.get("location") ?? "", /^\/login\?error=1/);

  const validLogin = await fetch(`${baseUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "editor", password: "correct-horse-battery-staple", next: "/" }),
  });
  assert.equal(validLogin.status, 303);
  assert.equal(validLogin.headers.get("location"), "/");
  const setCookie = validLogin.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /^rulesready_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(";", 1)[0];

  const authenticatedApi = await fetch(`${baseUrl}/api/library`, { headers: { Cookie: cookie } });
  assert.equal(authenticatedApi.status, 200);
  assert.equal((await authenticatedApi.json() as { counts: { total: number } }).counts.total, 0);

  const logout = await fetch(`${baseUrl}/logout`, {
    method: "POST",
    redirect: "manual",
    headers: { Cookie: cookie },
  });
  assert.equal(logout.status, 303);
  assert.equal(logout.headers.get("location"), "/login");
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
});
