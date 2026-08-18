import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { startBoardSaveServer } from "../skills/behavior-debug-board/scripts/save-board-server.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const examplePath = join(repoRoot, "skills/behavior-debug-board/assets/example-board.json");

function canonical(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

test("local save bridge atomically persists a board and reports Git state", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "behavior-board-save-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const configPath = join(temporaryRoot, ".behavior-debug-board", "boards", "example.board.json");
  const original = JSON.parse(await readFile(examplePath, "utf8"));
  await mkdir(join(temporaryRoot, ".behavior-debug-board", "boards"), { recursive: true });
  await writeFile(configPath, canonical(original), "utf8");

  for (const args of [
    ["init"],
    ["config", "user.email", "board@example.local"],
    ["config", "user.name", "Board Test"],
    ["add", ".behavior-debug-board/boards/example.board.json"],
    ["commit", "-m", "add board"],
  ]) {
    const command = spawnSync("git", args, { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(command.status, 0, command.stderr);
  }

  const token = "a".repeat(48);
  const server = await startBoardSaveServer({ configPath, token });
  context.after(() => server.close());
  const changed = structuredClone(original);
  changed.version = 2;
  changed.flows[1].nodes[0].title = "已儲存的新標題";
  changed.canvas = { items: [], edges: [] };

  const response = await fetch(`${server.origin}/save`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3001",
      "x-board-token": token,
    },
    body: JSON.stringify({ baseHash: sha256(canonical(original)), config: changed }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.saved, true);
  assert.equal(result.git.tracked, true, JSON.stringify(result.git));
  assert.match(result.git.status, /^ M /);
  assert.equal(JSON.parse(await readFile(configPath, "utf8")).flows[1].nodes[0].title, "已儲存的新標題");

  const conflict = await fetch(`${server.origin}/save`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3001",
      "x-board-token": token,
    },
    body: JSON.stringify({ baseHash: sha256(canonical(original)), config: changed }),
  });
  assert.equal(conflict.status, 409);

  const versionResponse = await fetch(`${server.origin}/version`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3001",
      "x-board-token": token,
    },
    body: JSON.stringify({ title: "Rules 修正完成" }),
  });
  const versionResult = await versionResponse.json();
  assert.equal(versionResponse.status, 200, JSON.stringify(versionResult));
  assert.match(versionResult.revision.id, /^local:/);

  const versionsResponse = await fetch(`${server.origin}/versions`, { headers: { "x-board-token": token } });
  const versions = await versionsResponse.json();
  assert.equal(versions.storageMode, "local");
  assert.equal(versions.revisions.length, 1);

  const newer = structuredClone(changed);
  newer.flows[1].nodes[0].title = "第二版標題";
  const newerResponse = await fetch(`${server.origin}/save`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3001",
      "x-board-token": token,
    },
    body: JSON.stringify({ baseHash: result.sha256, config: newer }),
  });
  const newerResult = await newerResponse.json();
  assert.equal(newerResponse.status, 200, JSON.stringify(newerResult));

  const diffResponse = await fetch(`${server.origin}/diff`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3001",
      "x-board-token": token,
    },
    body: JSON.stringify({ revisionId: versionResult.revision.id }),
  });
  const diffResult = await diffResponse.json();
  assert.equal(diffResponse.status, 200, JSON.stringify(diffResult));
  assert.equal(diffResult.diff.summary.changed, 1);

  const restoreResponse = await fetch(`${server.origin}/restore`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3001",
      "x-board-token": token,
    },
    body: JSON.stringify({ revisionId: versionResult.revision.id, baseHash: newerResult.sha256 }),
  });
  const restoreResult = await restoreResponse.json();
  assert.equal(restoreResponse.status, 200, JSON.stringify(restoreResult));
  assert.equal(restoreResult.restored.flows[1].nodes[0].title, "已儲存的新標題");
});
