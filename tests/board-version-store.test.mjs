import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  boardSha256,
  canonicalBoardSource,
  createBoardRevision,
  diffBoardRevision,
  listBoardRevisions,
  restoreBoardRevision,
  semanticBoardDiff,
} from "../skills/difftale/scripts/board-version-store.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const examplePath = join(repoRoot, "skills/difftale/assets/example-board.json");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("semantic Board diff separates behavior/content changes from layout movement", async () => {
  const previous = JSON.parse(await readFile(examplePath, "utf8"));
  const current = structuredClone(previous);
  current.version = 2;
  current.flows[1].nodes[0].title = "新版 Web Client";
  current.flows[1].nodes[0].position = { x: 120, y: 220 };
  current.canvas = {
    items: [{ id: "note-1", type: "note", position: { x: 20, y: 30 }, text: "已確認 Rules" }],
    edges: [],
  };

  const diff = semanticBoardDiff(previous, current);
  assert.equal(diff.empty, false);
  assert.equal(diff.summary.added, 1);
  assert.equal(diff.summary.changed, 1);
  assert.equal(diff.summary.moved, 1);
  assert.ok(diff.changes.some((change) => change.entity === "node" && change.type === "changed"));
  assert.ok(diff.changes.some((change) => change.entity === "node" && change.type === "moved"));
  assert.ok(diff.changes.some((change) => change.entity === "canvas-item" && change.type === "added"));
});

test("semantic Board diff describes changed screenshots as screen changes", async () => {
  const previous = JSON.parse(await readFile(examplePath, "utf8"));
  previous.version = 3;
  const oldScreen = previous.flows[1].nodes[0];
  oldScreen.kind = "screen";
  oldScreen.screenshot = "assets/screens/dashboard-old.png";
  oldScreen.frame = "browser";
  delete oldScreen.categoryIcon;
  const current = structuredClone(previous);
  current.flows[1].nodes[0].screenshot = "assets/screens/dashboard-new.png";

  const diff = semanticBoardDiff(previous, current);
  assert.equal(diff.summary.changed, 1);
  assert.match(diff.changes[0].detail, /Screen capture updated/);
});

test("local Board versions can be created, compared, and restored with a safety snapshot", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "board-local-versions-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const configPath = join(temporaryRoot, "demo", "board.json");
  await mkdir(join(temporaryRoot, "demo"), { recursive: true });
  const original = JSON.parse(await readFile(examplePath, "utf8"));
  await writeFile(configPath, canonicalBoardSource(original));

  const revision = await createBoardRevision({ configPath, storageMode: "local", title: "初始問題" });
  const changed = structuredClone(original);
  changed.title = "已修正的問題";
  await writeFile(configPath, canonicalBoardSource(changed));

  const history = await listBoardRevisions({ configPath, storageMode: "local" });
  assert.equal(history.revisions.length, 1);
  assert.equal(history.revisions[0].active, false);
  const diff = await diffBoardRevision({ configPath, storageMode: "local", revisionId: revision.id });
  assert.equal(diff.summary.changed, 1);

  const currentSource = canonicalBoardSource(changed);
  const restored = await restoreBoardRevision({
    configPath,
    storageMode: "local",
    revisionId: revision.id,
    baseHash: boardSha256(currentSource),
  });
  assert.equal(restored.restored.title, original.title);
  assert.equal(JSON.parse(await readFile(configPath, "utf8")).title, original.title);
  const afterRestore = await listBoardRevisions({ configPath, storageMode: "local" });
  assert.equal(afterRestore.revisions.length, 2);
  assert.equal(afterRestore.revisions[0].title, "Automatic backup before restore");
});

test("local Board versions snapshot and restore referenced screen assets", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "difftale-screen-versions-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const bundle = join(temporaryRoot, "demo");
  const configPath = join(bundle, "board.json");
  await mkdir(join(bundle, "assets", "screens"), { recursive: true });
  const original = JSON.parse(await readFile(examplePath, "utf8"));
  original.version = 3;
  const screen = original.flows[1].nodes[0];
  screen.kind = "screen";
  screen.screenshot = "assets/screens/dashboard-old.png";
  screen.frame = "browser";
  delete screen.categoryIcon;
  await writeFile(join(bundle, screen.screenshot), "old pixels");
  await writeFile(configPath, canonicalBoardSource(original));

  const revision = await createBoardRevision({ configPath, storageMode: "local", title: "舊 Dashboard" });
  await rm(join(bundle, screen.screenshot));
  const changed = structuredClone(original);
  changed.flows[1].nodes[0].screenshot = "assets/screens/dashboard-new.png";
  await writeFile(join(bundle, changed.flows[1].nodes[0].screenshot), "new pixels");
  await writeFile(configPath, canonicalBoardSource(changed));

  await restoreBoardRevision({
    configPath,
    storageMode: "local",
    revisionId: revision.id,
    baseHash: boardSha256(canonicalBoardSource(changed)),
  });
  assert.equal(await readFile(join(bundle, screen.screenshot), "utf8"), "old pixels");
  const index = JSON.parse(await readFile(join(bundle, ".versions", "index.json"), "utf8"));
  assert.match(index.at(-1).file, /\/board\.json$/);
});

test("Git Board versions commit only the Board bundle and preserve unrelated staged work", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "board-git-versions-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const bundle = join(temporaryRoot, ".difftale", "boards", "firebase-rules");
  const configPath = join(bundle, "board.json");
  await mkdir(bundle, { recursive: true });
  const original = JSON.parse(await readFile(examplePath, "utf8"));
  await writeFile(configPath, canonicalBoardSource(original));
  await writeFile(join(temporaryRoot, "unrelated.txt"), "initial\n");

  git(temporaryRoot, ["init"]);
  git(temporaryRoot, ["config", "user.email", "board@example.local"]);
  git(temporaryRoot, ["config", "user.name", "Board Test"]);
  git(temporaryRoot, ["add", "."]);
  git(temporaryRoot, ["commit", "-m", "initial"]);
  const initialCommit = git(temporaryRoot, ["rev-parse", "HEAD"]);

  const changed = structuredClone(original);
  changed.title = "Git 版控後的 Board";
  await writeFile(configPath, canonicalBoardSource(changed));
  await writeFile(join(temporaryRoot, "unrelated.txt"), "staged but unrelated\n");
  git(temporaryRoot, ["add", "unrelated.txt"]);

  const revision = await createBoardRevision({ configPath, storageMode: "git", title: "記錄修正行為" });
  assert.equal(revision.source, "git");
  assert.equal(git(temporaryRoot, ["show", "--pretty=format:", "--name-only", "HEAD"]), ".difftale/boards/firebase-rules/board.json");
  assert.equal(git(temporaryRoot, ["diff", "--cached", "--name-only"]), "unrelated.txt");

  const history = await listBoardRevisions({ configPath, storageMode: "git" });
  assert.ok(history.revisions.length >= 2);
  assert.equal(history.revisions[0].active, true);
  const latestDiff = await diffBoardRevision({ configPath, storageMode: "git", revisionId: revision.id });
  assert.equal(latestDiff.empty, true);

  const currentSource = canonicalBoardSource(changed);
  await restoreBoardRevision({
    configPath,
    storageMode: "git",
    revisionId: `git:${initialCommit}`,
    baseHash: boardSha256(currentSource),
  });
  assert.equal(JSON.parse(await readFile(configPath, "utf8")).title, original.title);
  assert.match(git(temporaryRoot, ["status", "--short", "--", ".difftale/boards/firebase-rules"]), /^M /);
});
