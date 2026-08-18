#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(scriptDirectory, "..");
const defaultRepoRoot = resolve(skillRoot, "../..");
const statuses = new Set(["idle", "running", "success", "error", "blocked"]);
const semantics = new Set(["request", "query", "response", "error"]);
const directions = new Set(["forward", "return"]);
const nodeKinds = new Set(["client", "rules", "database", "service"]);
const categoryIcons = new Set([
  "web-app", "mobile-app", "api", "database", "auth", "storage", "compute", "payment", "analytics",
  "messaging", "network", "security", "cloud", "queue", "webhook", "ai", "service",
]);
const boardHtmlMarker = "<title>Behavior Debug Board · Local</title>";

function fail(message) {
  throw new Error(message);
}

function requiredString(value, location) {
  if (typeof value !== "string" || value.trim() === "") fail(`${location} must be a non-empty string`);
}

export function validateBoardConfig(config) {
  if (!config || typeof config !== "object") fail("board config must be an object");
  if (config.version !== 1) fail("board config version must be 1");
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
    if (!flow.position || !Number.isFinite(flow.position.x) || !Number.isFinite(flow.position.y)) {
      fail(`${flowPath}.position must contain numeric x and y`);
    }
    if (!Array.isArray(flow.nodes) || flow.nodes.length < 2 || flow.nodes.length > 5) {
      fail(`${flowPath}.nodes must contain 2–5 service nodes`);
    }
    if (!Array.isArray(flow.steps) || flow.steps.length < 2) fail(`${flowPath}.steps must contain at least 2 steps`);
    if (!Array.isArray(flow.edges) || flow.edges.length < 1) fail(`${flowPath}.edges must contain at least 1 edge`);

    const nodeIds = new Set();
    for (const node of flow.nodes) {
      requiredString(node.id, `${flowPath}.nodes[].id`);
      requiredString(node.title, `${flowPath}.nodes.${node.id}.title`);
      requiredString(node.subtitle, `${flowPath}.nodes.${node.id}.subtitle`);
      requiredString(node.detail, `${flowPath}.nodes.${node.id}.detail`);
      if (nodeIds.has(node.id)) fail(`${flowPath} has duplicate node id: ${node.id}`);
      nodeIds.add(node.id);
      if (!nodeKinds.has(node.kind)) fail(`${flowPath}.nodes.${node.id}.kind is invalid`);
      if (node.changed !== undefined && typeof node.changed !== "boolean") fail(`${flowPath}.nodes.${node.id}.changed must be boolean`);
      if (node.logo !== undefined && (typeof node.logo !== "string" || !/^\/logos\/[a-z0-9][a-z0-9._-]*\.svg$/i.test(node.logo))) {
        fail(`${flowPath}.nodes.${node.id}.logo must be a local /logos/*.svg path`);
      }
      if (node.categoryIcon !== undefined && !categoryIcons.has(node.categoryIcon)) {
        fail(`${flowPath}.nodes.${node.id}.categoryIcon is invalid`);
      }
      if (node.logo && node.categoryIcon) fail(`${flowPath}.nodes.${node.id} must use either logo or categoryIcon, not both`);
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
  return { config: validateBoardConfig(config), absolutePath };
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

export function makeBoardUrl(origin, configHash, { flow, finalStep, timeScale } = {}) {
  const url = new URL(origin);
  url.searchParams.set("config", configHash);
  if (flow) url.searchParams.set("flow", flow);
  if (finalStep) url.searchParams.set("step", "final");
  if (timeScale) url.searchParams.set("timeScale", String(timeScale));
  return url.toString();
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

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npmCommand, ["run", "dev", "--", "--port", String(resolvedPort)], {
    cwd: absoluteRepoRoot,
    env: process.env,
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

export async function launchBoard({ configPath, outputPath, repoRoot, port, shouldOpen }) {
  const startedAt = Date.now();
  const absoluteRepoRoot = resolve(repoRoot);
  const prepared = await prepareRuntimeBoard({ configPath, outputPath, repoRoot: absoluteRepoRoot });
  const server = await startBoardServer({ repoRoot: absoluteRepoRoot, port });
  const url = makeBoardUrl(server.origin, prepared.configHash);

  console.log(`BOARD_CONFIG_LOADED sha256=${prepared.configHash} path=${prepared.runtimePath}`);
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
  if (server.reused) return { code: 0, signal: null, url, reused: true };
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
  };

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--no-open") options.shouldOpen = false;
    else if (flag === "--final-step") options.finalStep = true;
    else if (flag === "--full") options.full = true;
    else if (["--config", "--output", "--repo-root", "--port", "--flow", "--screenshot", "--report"].includes(flag)) {
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
    } else if (flag === "--help") options.command = "help";
    else fail(`unknown option: ${flag}`);
  }
  return options;
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  if (options.command === "help") {
    console.log("Usage: behavior-debug-board.mjs <validate|prepare|launch|qa> [--config file] [--output file] [--port 3001|auto] [--no-open]");
    console.log("       behavior-debug-board.mjs qa [--flow before|after] [--final-step] [--full] [--screenshot file] [--report file]");
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
