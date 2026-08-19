#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { validateBoardConfig } from "./difftale.mjs";
import {
  boardSha256,
  canonicalBoardSource,
  createBoardRevision,
  diffBoardRevision,
  listBoardRevisions,
  restoreBoardRevision,
} from "./board-version-store.mjs";

const execFileAsync = promisify(execFile);
const maximumBodyBytes = 5 * 1024 * 1024;

function canonicalSource(config) {
  return canonicalBoardSource(validateBoardConfig(structuredClone(config)));
}

function localOrigin(origin) {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin ?? "");
}

async function readRequestJson(request) {
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maximumBodyBytes) throw new Error("save payload exceeds 5 MB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, body, origin = "") {
  response.writeHead(status, {
    "access-control-allow-headers": "content-type,x-board-token",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-origin": localOrigin(origin) ? origin : "http://localhost",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function gitState(configPath) {
  try {
    const { stdout: rootOutput } = await execFileAsync("git", ["-C", dirname(configPath), "rev-parse", "--show-toplevel"]);
    const [root, resolvedConfigPath] = await Promise.all([realpath(rootOutput.trim()), realpath(configPath)]);
    const repoPath = relative(root, resolvedConfigPath);
    if (!repoPath || repoPath.startsWith("..")) return { tracked: false, error: `board path is outside Git root (${root})` };
    const [{ stdout: branchOutput }, { stdout: statusOutput }] = await Promise.all([
      execFileAsync("git", ["-C", root, "branch", "--show-current"]),
      execFileAsync("git", ["-C", root, "status", "--short", "--", repoPath]),
    ]);
    return {
      tracked: true,
      root,
      branch: branchOutput.trim() || "detached",
      status: statusOutput.trimEnd() || "clean",
    };
  } catch (error) {
    return { tracked: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function startBoardSaveServer({ configPath, token, port = 0, storageMode = "local" }) {
  const absoluteConfigPath = resolve(configPath);
  if (typeof token !== "string" || token.length < 32) throw new Error("save server requires a strong session token");
  if (!["git", "local"].includes(storageMode)) throw new Error("storageMode must be git or local");

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin ?? "";
    if (request.method === "OPTIONS") {
      if (!localOrigin(origin)) return sendJson(response, 403, { error: "save bridge only accepts localhost origins" }, origin);
      return sendJson(response, 204, {}, origin);
    }

    const suppliedToken = request.headers["x-board-token"];
    if (suppliedToken !== token) return sendJson(response, 401, { error: "invalid save session" }, origin);

    if (request.method === "GET" && request.url === "/health") {
      try {
        const source = canonicalSource(JSON.parse(await readFile(absoluteConfigPath, "utf8")));
        return sendJson(response, 200, {
          ready: true,
          path: absoluteConfigPath,
          sha256: boardSha256(source),
          storageMode,
          git: await gitState(absoluteConfigPath),
        }, origin);
      } catch (error) {
        return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }, origin);
      }
    }
    if (request.method === "GET" && request.url === "/versions") {
      try {
        return sendJson(response, 200, await listBoardRevisions({ configPath: absoluteConfigPath, storageMode }), origin);
      } catch (error) {
        return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }, origin);
      }
    }

    if (request.method !== "POST" || !["/save", "/version", "/diff", "/restore"].includes(request.url ?? "")) {
      return sendJson(response, 404, { error: "not found" }, origin);
    }
    if (!localOrigin(origin)) return sendJson(response, 403, { error: "save bridge only accepts localhost origins" }, origin);

    try {
      const payload = await readRequestJson(request);
      if (request.url === "/version") {
        const revision = await createBoardRevision({ configPath: absoluteConfigPath, storageMode, title: payload.title });
        return sendJson(response, 200, {
          revision,
          versions: await listBoardRevisions({ configPath: absoluteConfigPath, storageMode }),
          git: await gitState(absoluteConfigPath),
        }, origin);
      }
      if (request.url === "/diff") {
        return sendJson(response, 200, {
          revisionId: payload.revisionId,
          diff: await diffBoardRevision({ configPath: absoluteConfigPath, revisionId: payload.revisionId, storageMode }),
        }, origin);
      }
      if (request.url === "/restore") {
        const result = await restoreBoardRevision({
          configPath: absoluteConfigPath,
          revisionId: payload.revisionId,
          storageMode,
          baseHash: payload.baseHash,
        });
        return sendJson(response, 200, {
          ...result,
          path: absoluteConfigPath,
          git: await gitState(absoluteConfigPath),
          versions: await listBoardRevisions({ configPath: absoluteConfigPath, storageMode }),
        }, origin);
      }

      const currentSource = canonicalSource(JSON.parse(await readFile(absoluteConfigPath, "utf8")));
      const currentHash = boardSha256(currentSource);
      if (payload.baseHash !== currentHash) {
        return sendJson(response, 409, {
          error: "board file changed on disk; reload before saving",
          currentHash,
        }, origin);
      }

      const nextSource = canonicalSource(payload.config);
      const nextHash = boardSha256(nextSource);
      const temporaryPath = `${absoluteConfigPath}.tmp-${process.pid}-${Date.now()}`;
      try {
        await writeFile(temporaryPath, nextSource, { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, absoluteConfigPath);
      } catch (error) {
        await unlink(temporaryPath).catch(() => {});
        throw error;
      }

      return sendJson(response, 200, {
        saved: true,
        path: absoluteConfigPath,
        sha256: nextHash,
        git: await gitState(absoluteConfigPath),
      }, origin);
    } catch (error) {
      return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }, origin);
    }
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${resolvedPort}`,
    port: resolvedPort,
    close: () => new Promise((resolvePromise) => server.close(resolvePromise)),
  };
}

async function main() {
  const configPath = process.env.BOARD_SAVE_CONFIG;
  const token = process.env.BOARD_SAVE_TOKEN;
  const port = Number(process.env.BOARD_SAVE_PORT ?? "0");
  const storageMode = process.env.BOARD_STORAGE_MODE ?? "local";
  if (!configPath || !token) throw new Error("BOARD_SAVE_CONFIG and BOARD_SAVE_TOKEN are required");
  const server = await startBoardSaveServer({ configPath, token, port, storageMode });
  console.log(`BOARD_SAVE_SERVER_READY ${server.origin}`);
  const parentPid = Number(process.env.BOARD_SAVE_PARENT_PID ?? "0");
  const parentWatch = parentPid > 0 ? setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      server.close().finally(() => process.exit(0));
    }
  }, 2_000) : undefined;
  parentWatch?.unref();
  const stop = () => server.close().finally(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`BOARD_SAVE_SERVER_ERROR ${error.message}`);
    process.exitCode = 1;
  });
}
