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
});
