#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { delimiter, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(scriptDirectory, "..");
const defaultRepoRoot = resolve(skillRoot, "../..");
const statuses = new Set(["idle", "running", "success", "error", "blocked"]);
const semantics = new Set(["request", "query", "response", "error"]);
const directions = new Set(["forward", "return"]);
const nodeKinds = new Set(["client", "rules", "database", "service", "screen"]);
const screenFrames = new Set(["browser", "mobile", "app"]);
const categoryIcons = new Set([
  "web-app", "mobile-app", "api", "database", "auth", "storage", "compute", "payment", "analytics",
  "messaging", "network", "security", "cloud", "queue", "webhook", "ai", "service",
]);
const boardHtmlMarker = "<title>Difftale · Local</title>";

function fail(message) {
  throw new Error(message);
}

export function rendererNodeSupport(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version));
  if (!match) return { supported: false, version: String(version) };
  const [, majorText, minorText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  return { supported: major > 22 || (major === 22 && minor >= 13), version: String(version) };
}

export function ensureRendererRuntime(repoRoot, version = process.versions.node) {
  if (resolve(repoRoot) !== defaultRepoRoot) return;
  const runtime = rendererNodeSupport(version);
  if (!runtime.supported) {
    fail(`Difftale renderer requires Node.js >=22.13.0; current runtime is ${runtime.version}. Switch Node before launch or QA.`);
  }
}

function uint24LittleEndian(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

export function readRasterDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: "png" };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 4 <= buffer.length) {
      while (offset < buffer.length && buffer[offset] !== 0xff) offset += 1;
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset];
      offset += 1;
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
      if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
        return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3), format: "jpeg" };
      }
      offset += segmentLength;
    }
  }

  if (buffer.length >= 30 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    const chunk = buffer.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") {
      return { width: uint24LittleEndian(buffer, 24) + 1, height: uint24LittleEndian(buffer, 27) + 1, format: "webp" };
    }
    if (chunk === "VP8 " && buffer.length >= 30 && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff, format: "webp" };
    }
    if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: "webp" };
    }
  }

  fail("screenshot dimensions could not be read from PNG, JPEG, or WebP data");
}

export function inferScreenFrame({ width, height }) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) fail("screenshot dimensions must be positive numbers");
  const ratio = width / height;
  if (ratio >= 1.2) return { frame: "browser", confidence: "high", reason: `landscape ${width}×${height}` };
  if (ratio <= 0.9 && width <= 700) return { frame: "mobile", confidence: "high", reason: `portrait ${width}×${height}` };
  return {
    frame: undefined,
    confidence: "ambiguous",
    reason: `${width}×${height} could be a tablet, high-resolution phone, cropped web page, or desktop full-page capture`,
  };
}

function requiredString(value, location) {
  if (typeof value !== "string" || value.trim() === "") fail(`${location} must be a non-empty string`);
}

function validPosition(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

export function validateBoardConfig(config) {
  if (!config || typeof config !== "object") fail("board config must be an object");
  if (![1, 2, 3].includes(config.version)) fail("board config version must be 1, 2, or 3");
  requiredString(config.title, "title");
  if (!Array.isArray(config.flows) || config.flows.length !== 2) fail("flows must contain exactly Before and After");

  const flowIds = config.flows.map((flow) => flow?.id);
  if (new Set(flowIds).size !== 2 || !flowIds.includes("before") || !flowIds.includes("after")) {
    fail("flows must have unique ids: before and after");
  }

  for (const flow of config.flows) {
    if (!flow || typeof flow !== "object" || Array.isArray(flow)) fail("every flow must be an object");
    const flowPath = `flows.${flow.id}`;
    requiredString(flow.label, `${flowPath}.label`);
    const expectedOutcome = flow.id === "before" ? "error" : "success";
    if (flow.outcome !== expectedOutcome) fail(`${flowPath}.outcome must be ${expectedOutcome}`);
    if (!validPosition(flow.position)) {
      fail(`${flowPath}.position must contain numeric x and y`);
    }
    if (flow.labelPosition !== undefined && !validPosition(flow.labelPosition)) fail(`${flowPath}.labelPosition must contain numeric x and y`);
    if (flow.playbackPosition !== undefined && !validPosition(flow.playbackPosition)) fail(`${flowPath}.playbackPosition must contain numeric x and y`);
    if (!Array.isArray(flow.nodes) || flow.nodes.length < 2 || flow.nodes.length > 5) {
      fail(`${flowPath}.nodes must contain 2–5 visual nodes`);
    }
    if (!Array.isArray(flow.steps) || flow.steps.length < 2) fail(`${flowPath}.steps must contain at least 2 steps`);
    if (!Array.isArray(flow.edges) || flow.edges.length < 1) fail(`${flowPath}.edges must contain at least 1 edge`);

    const nodeIds = new Set();
    for (const node of flow.nodes) {
      requiredString(node.id, `${flowPath}.nodes[].id`);
      requiredString(node.title, `${flowPath}.nodes.${node.id}.title`);
      requiredString(node.subtitle, `${flowPath}.nodes.${node.id}.subtitle`);
      requiredString(node.detail, `${flowPath}.nodes.${node.id}.detail`);
      if (node.position !== undefined && !validPosition(node.position)) fail(`${flowPath}.nodes.${node.id}.position must contain numeric x and y`);
      if (nodeIds.has(node.id)) fail(`${flowPath} has duplicate node id: ${node.id}`);
      nodeIds.add(node.id);
      if (!nodeKinds.has(node.kind)) fail(`${flowPath}.nodes.${node.id}.kind is invalid`);
      if (node.changed !== undefined && typeof node.changed !== "boolean") fail(`${flowPath}.nodes.${node.id}.changed must be boolean`);
      const bundledLogo = typeof node.logo === "string" && /^\/logos\/[a-z0-9][a-z0-9._-]*\.svg$/i.test(node.logo);
      const boardLocalLogo = typeof node.logo === "string" && /^assets\/(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.svg$/i.test(node.logo);
      if (node.logo !== undefined && !bundledLogo && !boardLocalLogo) {
        fail(`${flowPath}.nodes.${node.id}.logo must be /logos/*.svg or a board-local assets/*.svg path`);
      }
      if (node.categoryIcon !== undefined && !categoryIcons.has(node.categoryIcon)) {
        fail(`${flowPath}.nodes.${node.id}.categoryIcon is invalid`);
      }
      if (node.logo && node.categoryIcon) fail(`${flowPath}.nodes.${node.id} must use either logo or categoryIcon, not both`);
      const boardLocalScreenshot = typeof node.screenshot === "string" && /^assets\/(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp)$/i.test(node.screenshot);
      if (node.kind === "screen") {
        if (config.version !== 3) fail(`${flowPath}.nodes.${node.id} screen nodes require board config version 3`);
        if (!boardLocalScreenshot) fail(`${flowPath}.nodes.${node.id}.screenshot must be a board-local assets/*.png, *.jpg, or *.webp path`);
        if (node.frame !== undefined && !screenFrames.has(node.frame)) fail(`${flowPath}.nodes.${node.id}.frame must be browser, mobile, or app`);
        if (node.route !== undefined) requiredString(node.route, `${flowPath}.nodes.${node.id}.route`);
        if (node.logo || node.categoryIcon) fail(`${flowPath}.nodes.${node.id} screen nodes cannot use logo or categoryIcon`);
      } else if (node.screenshot !== undefined || node.frame !== undefined || node.route !== undefined) {
        fail(`${flowPath}.nodes.${node.id} screenshot, frame, and route are only valid for screen nodes`);
      }
    }

    const edgeIds = new Set();
    const edgeRoutes = new Set();
    for (const edge of flow.edges) {
      requiredString(edge.id, `${flowPath}.edges[].id`);
      requiredString(edge.label, `${flowPath}.edges.${edge.id}.label`);
      if (edgeIds.has(edge.id)) fail(`${flowPath} has duplicate edge id: ${edge.id}`);
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) fail(`${flowPath}.edges.${edge.id} references an unknown node`);
      if (edge.source === edge.target) fail(`${flowPath}.edges.${edge.id} cannot connect a node to itself`);
      if (!directions.has(edge.direction)) fail(`${flowPath}.edges.${edge.id}.direction must be forward or return`);
      if (!semantics.has(edge.semantic)) fail(`${flowPath}.edges.${edge.id}.semantic is invalid`);
      if (["request", "query"].includes(edge.semantic) && edge.direction !== "forward") {
        fail(`${flowPath}.edges.${edge.id} request/query traffic must use direction forward`);
      }
      if (["response", "error"].includes(edge.semantic) && edge.direction !== "return") {
        fail(`${flowPath}.edges.${edge.id} response/error traffic must use direction return`);
      }
      if (edge.muted !== undefined && typeof edge.muted !== "boolean") fail(`${flowPath}.edges.${edge.id}.muted must be boolean`);
      if (!Array.isArray(edge.activeSteps)) fail(`${flowPath}.edges.${edge.id}.activeSteps must be an array`);
      if (new Set(edge.activeSteps).size !== edge.activeSteps.length) fail(`${flowPath}.edges.${edge.id}.activeSteps contains duplicates`);
      for (const step of edge.activeSteps) {
        if (!Number.isInteger(step) || step < 0 || step >= flow.steps.length) fail(`${flowPath}.edges.${edge.id} has an invalid active step`);
      }
      const route = `${edge.source}|${edge.target}|${edge.direction}`;
      if (edgeRoutes.has(route)) fail(`${flowPath} has duplicate directional route: ${route}`);
      edgeRoutes.add(route);
    }

    flow.steps.forEach((step, index) => {
      const stepPath = `${flowPath}.steps.${index}`;
      requiredString(step.title, `${stepPath}.title`);
      requiredString(step.reason, `${stepPath}.reason`);
      requiredString(step.note, `${stepPath}.note`);
      if (!step.nodeStatuses || typeof step.nodeStatuses !== "object" || Array.isArray(step.nodeStatuses)) {
        fail(`${stepPath}.nodeStatuses must be an object`);
      }
      for (const nodeId of nodeIds) {
        if (!statuses.has(step.nodeStatuses[nodeId])) fail(`${stepPath}.nodeStatuses.${nodeId} is missing or invalid`);
      }
      for (const nodeId of Object.keys(step.nodeStatuses)) {
        if (!nodeIds.has(nodeId)) fail(`${stepPath}.nodeStatuses contains unknown node: ${nodeId}`);
      }
    });
  }

  if (config.canvas !== undefined) {
    if (config.version < 2) fail("canvas persistence requires board config version 2 or 3");
    if (!config.canvas || !Array.isArray(config.canvas.items) || !Array.isArray(config.canvas.edges)) {
      fail("canvas must contain items and edges arrays");
    }
    const itemIds = new Set();
    for (const item of config.canvas.items) {
      requiredString(item.id, "canvas.items[].id");
      requiredString(item.text, `canvas.items.${item.id}.text`);
      if (itemIds.has(item.id)) fail(`canvas has duplicate item id: ${item.id}`);
      itemIds.add(item.id);
      if (!["text", "note", "shape"].includes(item.type)) fail(`canvas.items.${item.id}.type is invalid`);
      if (!validPosition(item.position)) fail(`canvas.items.${item.id}.position must contain numeric x and y`);
    }
    const persistedNodeIds = new Set([
      ...config.flows.flatMap((flow) => flow.nodes.map((node) => `${flow.id}-${node.id}`)),
      ...itemIds,
    ]);
    const edgeIds = new Set();
    for (const edge of config.canvas.edges) {
      requiredString(edge.id, "canvas.edges[].id");
      requiredString(edge.source, `canvas.edges.${edge.id}.source`);
      requiredString(edge.target, `canvas.edges.${edge.id}.target`);
      if (edgeIds.has(edge.id)) fail(`canvas has duplicate edge id: ${edge.id}`);
      edgeIds.add(edge.id);
      if (!persistedNodeIds.has(edge.source) || !persistedNodeIds.has(edge.target)) fail(`canvas.edges.${edge.id} references an unknown node`);
      if (edge.source === edge.target) fail(`canvas.edges.${edge.id} cannot connect a node to itself`);
      for (const field of ["sourceHandle", "targetHandle"]) {
        if (edge[field] !== undefined && edge[field] !== null && typeof edge[field] !== "string") fail(`canvas.edges.${edge.id}.${field} must be a string or null`);
      }
    }
  }

  return config;
}

export async function readAndValidateConfig(configPath) {
  const absolutePath = resolve(configPath);
  const text = await readFile(absolutePath, "utf8");
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    fail(`invalid JSON in ${absolutePath}: ${error.message}`);
  }
  const validated = validateBoardConfig(config);
  const boardDirectory = dirname(absolutePath);
  for (const flow of validated.flows) {
    for (const node of flow.nodes.filter((candidate) => candidate.kind === "screen")) {
      const screenshotPath = resolve(boardDirectory, node.screenshot);
      let dimensions;
      try {
        dimensions = readRasterDimensions(await readFile(screenshotPath));
      } catch (error) {
        fail(`flows.${flow.id}.nodes.${node.id}.screenshot cannot be inspected: ${error.message}`);
      }
      if (!node.frame) {
        const inferred = inferScreenFrame(dimensions);
        if (!inferred.frame) {
          fail(`flows.${flow.id}.nodes.${node.id}.frame needs user confirmation: ${inferred.reason}; ask whether this is mobile, browser, or app and set frame explicitly`);
        }
        node.frame = inferred.frame;
      }
    }
  }
  return { config: validated, absolutePath };
}

export async function prepareBoard({ configPath, outputPath }) {
  const { config, absolutePath } = await readAndValidateConfig(configPath);
  const source = `${JSON.stringify(config, null, 2)}\n`;
  const configHash = createHash("sha256").update(source).digest("hex");
  const absoluteOutput = resolve(outputPath);
  await mkdir(dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, source, "utf8");
  return { config, configHash, configPath: absolutePath, outputPath: absoluteOutput, source };
}

export async function prepareRuntimeBoard({ configPath, repoRoot, outputPath }) {
  const { config, absolutePath } = await readAndValidateConfig(configPath);
  const source = `${JSON.stringify(config, null, 2)}\n`;
  const configHash = createHash("sha256").update(source).digest("hex");
  const runtimePath = resolve(repoRoot, "public/runtime", `${configHash}.json`);
  await mkdir(dirname(runtimePath), { recursive: true });
  await writeFile(runtimePath, source, "utf8");
  const boardDirectory = await realpath(dirname(absolutePath));
  const localAssets = [...new Set(config.flows.flatMap((flow) => flow.nodes.flatMap((node) => [node.logo, node.screenshot]).filter((asset) => asset?.startsWith("assets/"))))];
  for (const asset of localAssets) {
    const sourcePath = await realpath(resolve(boardDirectory, asset));
    const sourceRelative = relative(boardDirectory, sourcePath);
    if (!sourceRelative || sourceRelative.startsWith("..") || isAbsolute(sourceRelative)) {
      fail(`board-local asset escapes the board directory: ${asset}`);
    }
    const destinationPath = resolve(repoRoot, "public/runtime/assets", configHash, asset.slice("assets/".length));
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, await readFile(sourcePath));
  }

  let mirrorPath;
  if (outputPath) {
    mirrorPath = resolve(outputPath);
    if (mirrorPath !== runtimePath) {
      await mkdir(dirname(mirrorPath), { recursive: true });
      await writeFile(mirrorPath, source, "utf8");
    }
  }

  return { config, configHash, configPath: absolutePath, outputPath: mirrorPath, runtimePath, source };
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  fail(`local board server did not become healthy within ${timeoutMs / 1000}s: ${url}`);
}

async function inspectExistingServer(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return { occupied: true, isBoard: false };
    const html = await response.text();
    return { occupied: true, isBoard: html.includes(boardHtmlMarker) };
  } catch {
    return { occupied: false, isBoard: false };
  }
}

function openSystemBrowser(url) {
  if (process.platform === "darwin") return spawn("open", [url], { stdio: "ignore", detached: true });
  if (process.platform === "win32") return spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true });
  return spawn("xdg-open", [url], { stdio: "ignore", detached: true });
}

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

async function resolveServerPort(requestedPort) {
  if (requestedPort !== "auto") return requestedPort;
  const preferred = await inspectExistingServer("http://localhost:3001/");
  if (preferred.isBoard || !preferred.occupied) return 3001;
  return availablePort();
}

export function makeBoardUrl(origin, configHash, { flow, finalStep, timeScale, saveOrigin, saveToken } = {}) {
  const url = new URL(origin);
  url.searchParams.set("config", configHash);
  if (flow) url.searchParams.set("flow", flow);
  if (finalStep) url.searchParams.set("step", "final");
  if (timeScale) url.searchParams.set("timeScale", String(timeScale));
  if (saveOrigin) url.searchParams.set("save", saveOrigin);
  if (saveToken) url.searchParams.set("saveToken", saveToken);
  return url.toString();
}

async function startSaveBridge(configPath, storageMode) {
  const port = await availablePort();
  const token = randomBytes(24).toString("hex");
  const saveServerPath = resolve(scriptDirectory, "save-board-server.mjs");
  const child = spawn(process.execPath, [saveServerPath], {
    cwd: defaultRepoRoot,
    env: {
      ...process.env,
      BOARD_SAVE_CONFIG: resolve(configPath),
      BOARD_SAVE_PORT: String(port),
      BOARD_SAVE_TOKEN: token,
      BOARD_STORAGE_MODE: storageMode,
    },
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`, { headers: { "x-board-token": token } });
      if (response.ok) {
        child.unref();
        return {
          origin,
          token,
          pid: child.pid,
          completion: Promise.resolve({ code: 0, signal: null, detached: true }),
        };
      }
    } catch {
      // The local save bridge is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  try {
    process.kill(child.pid, "SIGTERM");
  } catch {
    // The save bridge already exited while readiness was being checked.
  }
  fail("local save bridge did not become ready");
}

export async function startBoardServer({ repoRoot, port }) {
  const absoluteRepoRoot = resolve(repoRoot);
  await access(resolve(absoluteRepoRoot, "package.json"), constants.R_OK);
  const resolvedPort = await resolveServerPort(port);
  const origin = `http://localhost:${resolvedPort}/`;

  const existing = await inspectExistingServer(origin);
  if (existing.isBoard) {
    return { origin, port: resolvedPort, reused: true, completion: Promise.resolve({ code: 0, signal: null }), stop: async () => {} };
  }
  if (existing.occupied) fail(`port ${resolvedPort} is already serving another app; choose a different --port`);

  ensureRendererRuntime(absoluteRepoRoot);

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const runtimePath = [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter);
  const child = spawn(npmCommand, ["run", "dev", "--", "--port", String(resolvedPort)], {
    cwd: absoluteRepoRoot,
    env: { ...process.env, PATH: runtimePath },
    stdio: "inherit",
    detached: process.platform !== "win32",
  });

  const stopSignal = () => {
    if (child.exitCode !== null) return;
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  };
  const stop = async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise((resolvePromise) => child.once("exit", resolvePromise));
    stopSignal();
    await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
  };
  process.once("SIGINT", stopSignal);
  process.once("SIGTERM", stopSignal);

  let becameHealthy = false;
  const childCompletion = new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (!becameHealthy) rejectPromise(new Error(`board server exited before it became healthy (${signal ?? code})`));
      else if (signal || code === 0) resolvePromise({ code, signal });
      else rejectPromise(new Error(`board server exited with code ${code}`));
    });
  });
  await Promise.race([waitForServer(origin), childCompletion]);
  becameHealthy = true;
  return { origin, port: resolvedPort, reused: false, completion: childCompletion, stop };
}

export async function launchBoard({ configPath, outputPath, repoRoot, port, shouldOpen, storageMode = "local" }) {
  const startedAt = Date.now();
  const absoluteRepoRoot = resolve(repoRoot);
  const prepared = await prepareRuntimeBoard({ configPath, outputPath, repoRoot: absoluteRepoRoot });
  const server = await startBoardServer({ repoRoot: absoluteRepoRoot, port });
  const saveBridge = await startSaveBridge(prepared.configPath, storageMode);
  const url = makeBoardUrl(server.origin, prepared.configHash, { saveOrigin: saveBridge.origin, saveToken: saveBridge.token });

  console.log(`BOARD_CONFIG_LOADED sha256=${prepared.configHash} path=${prepared.runtimePath}`);
  console.log(`BOARD_LOCAL_SOURCE ${prepared.configPath}`);
  console.log(`BOARD_SAVE_READY ${saveBridge.origin} mode=${storageMode} pid=${saveBridge.pid}`);
  console.log(`${server.reused ? "BOARD_SERVER_REUSED" : "BOARD_SERVER_STARTED"} ${server.origin}`);
  console.log(`BOARD_SERVER_READY ${server.origin}`);
  console.log(`BOARD_URL ${url}`);
  if (shouldOpen) {
    const opener = openSystemBrowser(url);
    opener.unref();
    console.log("BOARD_OPENED system-browser");
  } else {
    console.log("BOARD_OPENED pending-codex-browser");
  }
  console.log(`BOARD_DURATION_MS ${Date.now() - startedAt}`);
  if (server.reused) return saveBridge.completion;
  return server.completion;
}

function parseCli(argv) {
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "launch";
  const args = command === "launch" && argv[0]?.startsWith("--") ? argv : argv.slice(1);
  const options = {
    command,
    configPath: resolve(skillRoot, "assets/example-board.json"),
    outputPath: undefined,
    repoRoot: defaultRepoRoot,
    port: 3001,
    shouldOpen: true,
    flow: "after",
    finalStep: false,
    full: false,
    screenshotPath: undefined,
    reportPath: undefined,
    storageMode: "local",
  };

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--no-open") options.shouldOpen = false;
    else if (flag === "--final-step") options.finalStep = true;
    else if (flag === "--full") options.full = true;
    else if (["--config", "--output", "--repo-root", "--port", "--flow", "--screenshot", "--report", "--storage"].includes(flag)) {
      const value = args[index + 1];
      if (!value) fail(`${flag} requires a value`);
      index += 1;
      if (flag === "--config") options.configPath = resolve(value);
      if (flag === "--output") options.outputPath = resolve(value);
      if (flag === "--repo-root") options.repoRoot = resolve(value);
      if (flag === "--port") {
        options.port = value === "auto" ? "auto" : Number(value);
        if (options.port !== "auto" && (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535)) fail("--port must be auto or an integer from 1024 to 65535");
      }
      if (flag === "--flow") {
        if (!["before", "after"].includes(value)) fail("--flow must be before or after");
        options.flow = value;
      }
      if (flag === "--screenshot") options.screenshotPath = resolve(value);
      if (flag === "--report") options.reportPath = resolve(value);
      if (flag === "--storage") {
        if (!["git", "local"].includes(value)) fail("--storage must be git or local");
        options.storageMode = value;
      }
    } else if (flag === "--help") options.command = "help";
    else fail(`unknown option: ${flag}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  if (options.command === "help") {
    console.log("Usage: difftale.mjs <validate|prepare|launch|qa> [--config file] [--output file] [--port 3001|auto] [--storage git|local] [--no-open]");
    console.log("       difftale.mjs qa [--flow before|after] [--final-step] [--full] [--screenshot file] [--report file]");
    return;
  }
  if (!["validate", "prepare", "launch", "qa"].includes(options.command)) fail(`unknown command: ${options.command}`);

  if (options.command === "validate") {
    const { config, absolutePath } = await readAndValidateConfig(options.configPath);
    console.log(`BOARD_VALID ${absolutePath} (${config.flows.length} flows)`);
    return;
  }
  if (options.command === "prepare") {
    const prepared = options.outputPath
      ? await prepareBoard({ configPath: options.configPath, outputPath: options.outputPath })
      : await prepareRuntimeBoard(options);
    console.log(`BOARD_PREPARED ${prepared.outputPath ?? prepared.runtimePath}`);
    console.log(`BOARD_CONFIG_LOADED sha256=${prepared.configHash}`);
    return;
  }
  if (options.command === "qa") {
    const { runBoardQa } = await import("./qa-board.mjs");
    await runBoardQa(options);
    return;
  }
  await launchBoard(options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`BOARD_ERROR ${error.message}`);
    process.exitCode = 1;
  });
}
