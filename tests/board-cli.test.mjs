import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const launcher = resolve(repoRoot, "skills/behavior-debug-board/scripts/behavior-debug-board.mjs");
const configPath = resolve(repoRoot, "app/board.generated.json");

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

test("CLI validates and prepares a board end to end", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "behavior-board-cli-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const outputPath = join(temporaryRoot, "board.json");

  const validation = spawnSync(process.execPath, [launcher, "validate", "--config", configPath], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(validation.status, 0, validation.stderr);
  assert.match(validation.stdout, /BOARD_VALID/);

  const preparation = spawnSync(process.execPath, [launcher, "prepare", "--config", configPath, "--output", outputPath], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(preparation.status, 0, preparation.stderr);
  assert.match(preparation.stdout, /BOARD_PREPARED/);
  assert.equal(JSON.parse(await readFile(outputPath, "utf8")).version, 1);
});

test("launch starts a healthy localhost board and reports that it should be opened", { timeout: 90_000 }, async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "behavior-board-launch-"));
  const outputPath = join(temporaryRoot, "board.json");
  await writeFile(join(temporaryRoot, "package.json"), `${JSON.stringify({
    name: "board-launch-fixture",
    private: true,
    type: "module",
    scripts: { dev: "node dev-server.mjs" },
  }, null, 2)}\n`);
  await writeFile(join(temporaryRoot, "dev-server.mjs"), `
import { createServer } from "node:http";
const portIndex = process.argv.indexOf("--port");
const port = Number(process.argv[portIndex + 1]);
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><title>Behavior Debug Board fixture</title>");
});
server.listen(port);
const stop = () => server.close(() => process.exit(0));
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
`);
  const port = await availablePort();
  const child = spawn(process.execPath, [launcher, "launch", "--config", configPath, "--output", outputPath, "--repo-root", temporaryRoot, "--port", String(port), "--no-open"], {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  const stop = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolvePromise) => child.once("exit", resolvePromise));
      child.kill("SIGTERM");
      await Promise.race([
        exited,
        new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
      ]);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  };
  context.after(stop);

  await new Promise((resolvePromise, rejectPromise) => {
    const deadline = setTimeout(() => rejectPromise(new Error(`BOARD_READY timeout\n${output}`)), 75_000);
    const inspect = () => {
      if (output.includes("BOARD_READY")) {
        clearTimeout(deadline);
        resolvePromise();
      }
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    inspect();
    child.once("exit", (code) => {
      if (!output.includes("BOARD_READY")) {
        clearTimeout(deadline);
        rejectPromise(new Error(`launcher exited ${code}\n${output}`));
      }
    });
  });

  const response = await fetch(`http://localhost:${port}/`);
  assert.equal(response.status, 200);
  assert.match(output, new RegExp(`BOARD_URL http://localhost:${port}/`));
  assert.match(output, new RegExp(`BOARD_CONFIG ${outputPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(output, /BOARD_OPENED pending-codex-browser/);
});

test("launch reuses an existing local Behavior Debug Board", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "behavior-board-reuse-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await writeFile(join(temporaryRoot, "package.json"), '{"name":"reuse-fixture","private":true}\n');
  const outputPath = join(temporaryRoot, "board.json");
  const httpServer = (await import("node:http")).createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Behavior Debug Board · Local</title>");
  });
  context.after(() => new Promise((resolvePromise) => httpServer.close(resolvePromise)));
  await new Promise((resolvePromise, rejectPromise) => {
    httpServer.once("error", rejectPromise);
    httpServer.listen(0, resolvePromise);
  });
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const child = spawn(process.execPath, [launcher, "launch", "--config", configPath, "--output", outputPath, "--repo-root", temporaryRoot, "--port", String(port), "--no-open"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const status = await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", resolvePromise);
  });

  assert.equal(status, 0, stderr);
  assert.match(stdout, /reused existing local board/);
  assert.match(stdout, /BOARD_OPENED pending-codex-browser/);
});
