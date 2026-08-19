import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { validateBoardConfig } from "./difftale.mjs";

const execFileAsync = promisify(execFile);

export function canonicalBoardSource(config) {
  return `${JSON.stringify(validateBoardConfig(structuredClone(config)), null, 2)}\n`;
}

export function boardSha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function without(value, keys) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

export function semanticBoardDiff(previous, current) {
  validateBoardConfig(structuredClone(previous));
  validateBoardConfig(structuredClone(current));
  const changes = [];
  const add = (type, entity, id, label, detail, flow) => changes.push({ type, entity, id, label, detail, ...(flow ? { flow } : {}) });

  if (previous.title !== current.title) add("changed", "board", "title", "Board title", `${previous.title} → ${current.title}`);

  const previousFlows = new Map(previous.flows.map((flow) => [flow.id, flow]));
  for (const flow of current.flows) {
    const oldFlow = previousFlows.get(flow.id);
    if (!oldFlow) continue;
    if (oldFlow.label !== flow.label) add("changed", "flow", flow.id, `${flow.id} label`, `${oldFlow.label} → ${flow.label}`, flow.id);
    if (oldFlow.outcome !== flow.outcome) add("changed", "flow", flow.id, `${flow.label} outcome`, `${oldFlow.outcome} → ${flow.outcome}`, flow.id);
    if (!same(oldFlow.position, flow.position) || !same(oldFlow.labelPosition, flow.labelPosition) || !same(oldFlow.playbackPosition, flow.playbackPosition)) {
      add("moved", "flow", flow.id, `${flow.label} group`, "Group, label, or playback card position changed", flow.id);
    }

    const oldNodes = new Map(oldFlow.nodes.map((node) => [node.id, node]));
    const nextNodes = new Map(flow.nodes.map((node) => [node.id, node]));
    for (const node of oldFlow.nodes) {
      if (!nextNodes.has(node.id)) add("removed", "node", node.id, node.title, node.kind === "screen" ? "Screen removed" : "Service card removed", flow.id);
    }
    for (const node of flow.nodes) {
      const oldNode = oldNodes.get(node.id);
      if (!oldNode) {
        add("added", "node", node.id, node.title, node.kind === "screen" ? "Screen added" : "Service card added", flow.id);
        continue;
      }
      if (!same(without(oldNode, ["position"]), without(node, ["position"]))) {
        const detail = oldNode.screenshot !== node.screenshot
          ? `Screen capture updated: ${oldNode.screenshot ?? "none"} → ${node.screenshot ?? "none"}`
          : node.kind === "screen"
            ? "Screen name, route, device frame, or description changed"
            : oldNode.title === node.title ? "Service content changed" : `${oldNode.title} → ${node.title}`;
        add("changed", "node", node.id, node.title, detail, flow.id);
      }
      if (!same(oldNode.position, node.position)) add("moved", "node", node.id, node.title, node.kind === "screen" ? "Screen position changed" : "Service card position changed", flow.id);
    }

    const oldEdges = new Map(oldFlow.edges.map((edge) => [edge.id, edge]));
    const nextEdges = new Map(flow.edges.map((edge) => [edge.id, edge]));
    for (const edge of oldFlow.edges) {
      if (!nextEdges.has(edge.id)) add("removed", "edge", edge.id, edge.label, `${edge.source} → ${edge.target}`, flow.id);
    }
    for (const edge of flow.edges) {
      const oldEdge = oldEdges.get(edge.id);
      if (!oldEdge) add("added", "edge", edge.id, edge.label, `${edge.source} → ${edge.target}`, flow.id);
      else if (!same(oldEdge, edge)) add("changed", "edge", edge.id, edge.label, `Direction, copy, or playback timing changed for ${edge.source} → ${edge.target}`, flow.id);
    }

    if (!same(oldFlow.steps, flow.steps)) add("changed", "timeline", `${flow.id}-steps`, `${flow.label} playback`, "Steps, reasons, notes, or node states changed", flow.id);
  }

  const oldItems = new Map((previous.canvas?.items ?? []).map((item) => [item.id, item]));
  const nextItems = new Map((current.canvas?.items ?? []).map((item) => [item.id, item]));
  for (const item of previous.canvas?.items ?? []) {
    if (!nextItems.has(item.id)) add("removed", "canvas-item", item.id, item.text, "Canvas object removed");
  }
  for (const item of current.canvas?.items ?? []) {
    const oldItem = oldItems.get(item.id);
    if (!oldItem) add("added", "canvas-item", item.id, item.text, `Added ${item.type}`);
    else {
      if (!same(without(oldItem, ["position"]), without(item, ["position"]))) add("changed", "canvas-item", item.id, item.text, "Canvas object content changed");
      if (!same(oldItem.position, item.position)) add("moved", "canvas-item", item.id, item.text, "Canvas object position changed");
    }
  }

  const oldCanvasEdges = new Map((previous.canvas?.edges ?? []).map((edge) => [edge.id, edge]));
  const nextCanvasEdges = new Map((current.canvas?.edges ?? []).map((edge) => [edge.id, edge]));
  for (const edge of previous.canvas?.edges ?? []) {
    if (!nextCanvasEdges.has(edge.id)) add("removed", "canvas-edge", edge.id, "Custom connection", `${edge.source} → ${edge.target}`);
  }
  for (const edge of current.canvas?.edges ?? []) {
    const oldEdge = oldCanvasEdges.get(edge.id);
    if (!oldEdge) add("added", "canvas-edge", edge.id, "Custom connection", `${edge.source} → ${edge.target}`);
    else if (!same(oldEdge, edge)) add("changed", "canvas-edge", edge.id, "Custom connection", `${edge.source} → ${edge.target}`);
  }

  const summary = { added: 0, removed: 0, changed: 0, moved: 0 };
  for (const change of changes) summary[change.type] += 1;
  return { summary, changes, empty: changes.length === 0 };
}

async function gitContext(configPath) {
  try {
    const { stdout: rootOutput } = await execFileAsync("git", ["-C", dirname(configPath), "rev-parse", "--show-toplevel"]);
    const [root, resolvedConfigPath] = await Promise.all([realpath(rootOutput.trim()), realpath(configPath)]);
    const repoPath = relative(root, resolvedConfigPath);
    if (!repoPath || repoPath.startsWith("..")) return undefined;
    return { root, repoPath, bundlePath: dirname(repoPath) };
  } catch {
    return undefined;
  }
}

function validGitBundle(context) {
  const segments = context.repoPath.split(/[\\/]/);
  const boardRoot = segments.slice(0, 2).join("/");
  return segments.length >= 4 && [".difftale/boards", ".behavior-debug-board/boards"].includes(boardRoot);
}

function versionDirectory(configPath) {
  return resolve(dirname(configPath), ".versions");
}

function referencedLocalAssets(config) {
  return [...new Set(config.flows.flatMap((flow) => flow.nodes.flatMap((node) => [node.logo, node.screenshot])
    .filter((asset) => typeof asset === "string" && asset.startsWith("assets/"))))];
}

function safeChild(root, child, label) {
  const absolute = resolve(root, child);
  const childRelative = relative(root, absolute);
  if (!childRelative || childRelative.startsWith("..") || childRelative.startsWith("/") || childRelative.startsWith("\\")) {
    throw new Error(`${label} escapes its bundle: ${child}`);
  }
  return absolute;
}

async function copyRevisionAssets(config, configPath, destinationRoot) {
  const bundleRoot = await realpath(dirname(configPath));
  for (const asset of referencedLocalAssets(config)) {
    const sourcePath = await realpath(safeChild(bundleRoot, asset, "board asset"));
    const sourceRelative = relative(bundleRoot, sourcePath);
    if (!sourceRelative || sourceRelative.startsWith("..")) throw new Error(`board asset escapes its bundle: ${asset}`);
    const destinationPath = safeChild(destinationRoot, asset, "version asset");
    await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
    await copyFile(sourcePath, destinationPath);
  }
}

async function restoreRevisionAssets(configPath, revisionFile, config) {
  const snapshotRoot = dirname(revisionFile);
  if (snapshotRoot === versionDirectory(configPath)) return; // Legacy flat revisions did not snapshot assets.
  const bundleRoot = dirname(configPath);
  for (const asset of referencedLocalAssets(config)) {
    const sourcePath = safeChild(snapshotRoot, asset, "version asset");
    const destinationPath = safeChild(bundleRoot, asset, "board asset");
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }
}

async function readLocalIndex(configPath) {
  try {
    const index = JSON.parse(await readFile(resolve(versionDirectory(configPath), "index.json"), "utf8"));
    return Array.isArray(index) ? index : [];
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw new Error(`invalid local Board version index: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeAtomically(path, source) {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, source, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function listGitRevisions(configPath, limit) {
  const context = await gitContext(configPath);
  if (!context || !validGitBundle(context)) return [];
  const { stdout } = await execFileAsync("git", [
    "-C", context.root, "log", `-${limit}`, "--follow", "--format=%H%x00%aI%x00%s", "--", context.repoPath,
  ]).catch(() => ({ stdout: "" }));
  return stdout.trim().split("\n").filter(Boolean).map((line) => {
    const [commit, createdAt, title] = line.split("\0");
    return { id: `git:${commit}`, source: "git", commit, shortCommit: commit.slice(0, 7), createdAt, title };
  });
}

export async function listBoardRevisions({ configPath, storageMode = "local", limit = 20 }) {
  const absoluteConfigPath = resolve(configPath);
  const currentSource = canonicalBoardSource(JSON.parse(await readFile(absoluteConfigPath, "utf8")));
  const currentHash = boardSha256(currentSource);
  const revisions = storageMode === "git"
    ? await listGitRevisions(absoluteConfigPath, limit)
    : (await readLocalIndex(absoluteConfigPath)).slice(0, limit);
  return {
    storageMode,
    currentHash,
    revisions: await Promise.all(revisions.map(async (revision) => {
      if (revision.sha256) return { ...revision, active: revision.sha256 === currentHash };
      try {
        const source = await readBoardRevision({ configPath: absoluteConfigPath, revisionId: revision.id, storageMode });
        const revisionHash = boardSha256(canonicalBoardSource(source));
        return { ...revision, sha256: revisionHash, active: revisionHash === currentHash };
      } catch {
        return { ...revision, unavailable: true, active: false };
      }
    })),
  };
}

export async function readBoardRevision({ configPath, revisionId, storageMode = "local" }) {
  const absoluteConfigPath = resolve(configPath);
  if (storageMode === "git" && revisionId.startsWith("git:")) {
    const commit = revisionId.slice(4);
    if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error("invalid Git board revision");
    const context = await gitContext(absoluteConfigPath);
    if (!context || !validGitBundle(context)) throw new Error("board is not in a Git-tracked board bundle");
    const { stdout } = await execFileAsync("git", ["-C", context.root, "show", `${commit}:${context.repoPath}`]);
    return validateBoardConfig(JSON.parse(stdout));
  }

  if (storageMode !== "local" || !revisionId.startsWith("local:")) throw new Error("revision does not match the selected storage mode");
  const metadata = (await readLocalIndex(absoluteConfigPath)).find((revision) => revision.id === revisionId);
  if (!metadata) throw new Error("local board revision not found");
  if (typeof metadata.file !== "string" || !metadata.file) throw new Error("invalid local board revision path");
  const revisionFile = safeChild(versionDirectory(absoluteConfigPath), metadata.file, "local board revision");
  return validateBoardConfig(JSON.parse(await readFile(revisionFile, "utf8")));
}

async function createLocalRevision(configPath, title, { allowUnchanged = false } = {}) {
  const source = canonicalBoardSource(JSON.parse(await readFile(configPath, "utf8")));
  const hash = boardSha256(source);
  const index = await readLocalIndex(configPath);
  if (!allowUnchanged && index[0]?.sha256 === hash) throw new Error("The current Board matches the latest version");
  const createdAt = new Date().toISOString();
  const identifier = `${createdAt.replace(/[:.]/g, "-")}-${hash.slice(0, 12)}-${randomBytes(3).toString("hex")}`;
  const file = `${identifier}/board.json`;
  const revision = { id: `local:${identifier}`, source: "local", createdAt, title, sha256: hash, file };
  const directory = versionDirectory(configPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const revisionFile = safeChild(directory, file, "local board revision");
  await mkdir(dirname(revisionFile), { recursive: true, mode: 0o700 });
  await writeAtomically(revisionFile, source);
  await copyRevisionAssets(JSON.parse(source), configPath, dirname(revisionFile));
  await writeAtomically(resolve(directory, "index.json"), `${JSON.stringify([revision, ...index], null, 2)}\n`);
  return revision;
}

async function createGitRevision(configPath, title) {
  const context = await gitContext(configPath);
  if (!context || !validGitBundle(context)) throw new Error("Git versions require a .difftale/boards/<slug>/ bundle (legacy .behavior-debug-board paths remain supported)");
  const { stdout: status } = await execFileAsync("git", ["-C", context.root, "status", "--porcelain", "--", context.bundlePath]);
  if (!status.trim()) throw new Error("The current Board has no changes to version");
  const slug = basename(context.bundlePath).replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "board";
  const message = `board(${slug}): ${title.replace(/[\r\n]+/g, " ").trim().slice(0, 72)}`;
  await execFileAsync("git", ["-C", context.root, "add", "--all", "--", context.bundlePath]);
  try {
    await execFileAsync("git", ["-C", context.root, "commit", "--only", "-m", message, "--", context.bundlePath]);
  } catch (error) {
    throw new Error(`Unable to create Git Board version: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { stdout: commitOutput } = await execFileAsync("git", ["-C", context.root, "rev-parse", "HEAD"]);
  const commit = commitOutput.trim();
  return { id: `git:${commit}`, source: "git", commit, shortCommit: commit.slice(0, 7), createdAt: new Date().toISOString(), title: message };
}

export async function createBoardRevision({ configPath, storageMode = "local", title }) {
  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  if (!normalizedTitle) throw new Error("A short version description is required");
  const absoluteConfigPath = resolve(configPath);
  canonicalBoardSource(JSON.parse(await readFile(absoluteConfigPath, "utf8")));
  return storageMode === "git"
    ? createGitRevision(absoluteConfigPath, normalizedTitle)
    : createLocalRevision(absoluteConfigPath, normalizedTitle);
}

export async function diffBoardRevision({ configPath, revisionId, storageMode = "local" }) {
  const previous = await readBoardRevision({ configPath, revisionId, storageMode });
  const current = validateBoardConfig(JSON.parse(await readFile(resolve(configPath), "utf8")));
  return semanticBoardDiff(previous, current);
}

export async function restoreBoardRevision({ configPath, revisionId, storageMode = "local", baseHash }) {
  const absoluteConfigPath = resolve(configPath);
  const current = validateBoardConfig(JSON.parse(await readFile(absoluteConfigPath, "utf8")));
  const currentSource = canonicalBoardSource(current);
  const currentHash = boardSha256(currentSource);
  if (baseHash !== currentHash) throw new Error("board file changed on disk; reload before restoring");
  const restored = await readBoardRevision({ configPath: absoluteConfigPath, revisionId, storageMode });
  const restoredSource = canonicalBoardSource(restored);
  if (restoredSource === currentSource) return { restored, sha256: currentHash, diff: semanticBoardDiff(current, restored), unchanged: true };
  if (storageMode === "local") {
    await createLocalRevision(absoluteConfigPath, "Automatic backup before restore", { allowUnchanged: true });
    const metadata = (await readLocalIndex(absoluteConfigPath)).find((revision) => revision.id === revisionId);
    if (!metadata || typeof metadata.file !== "string") throw new Error("local board revision not found");
    const revisionFile = safeChild(versionDirectory(absoluteConfigPath), metadata.file, "local board revision");
    await restoreRevisionAssets(absoluteConfigPath, revisionFile, restored);
  }
  await writeAtomically(absoluteConfigPath, restoredSource);
  return { restored, sha256: boardSha256(restoredSource), diff: semanticBoardDiff(current, restored), unchanged: false };
}
