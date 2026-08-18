import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { prepareBoard, prepareRuntimeBoard, validateBoardConfig } from "../skills/behavior-debug-board/scripts/behavior-debug-board.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const defaultConfigPath = resolve(repoRoot, "skills/behavior-debug-board/assets/example-board.json");
const defaultConfig = JSON.parse(await readFile(defaultConfigPath, "utf8"));
const fanoutConfigPath = resolve(repoRoot, "skills/behavior-debug-board/assets/fanout-board.json");
const fanoutConfig = JSON.parse(await readFile(fanoutConfigPath, "utf8"));

function cloneConfig() {
  return structuredClone(defaultConfig);
}

function rejectsMutation(name, mutate, pattern) {
  test(name, () => {
    const config = cloneConfig();
    mutate(config);
    assert.throws(() => validateBoardConfig(config), pattern);
  });
}

test("accepts the bundled Before/After behavior board", () => {
  assert.equal(validateBoardConfig(cloneConfig()).title, defaultConfig.title);
});

test("accepts the bundled single-source fan-out behavior board", () => {
  assert.equal(validateBoardConfig(structuredClone(fanoutConfig)).title, fanoutConfig.title);
});

rejectsMutation("requires a supported config version", (config) => { config.version = 3; }, /version must be 1 or 2/);
rejectsMutation("requires exact Before and After flows", (config) => { config.flows[1].id = "during"; }, /unique ids: before and after/);
rejectsMutation("requires matching outcomes", (config) => { config.flows[0].outcome = "success"; }, /outcome must be error/);
rejectsMutation("limits a flow to five nodes", (config) => { config.flows[0].nodes = [config.flows[0].nodes[0]]; }, /2–5 service nodes/);
rejectsMutation("rejects duplicate node ids", (config) => { config.flows[0].nodes[1].id = config.flows[0].nodes[0].id; }, /duplicate node id/);
rejectsMutation("rejects invalid node kinds", (config) => { config.flows[0].nodes[0].kind = "screen"; }, /kind is invalid/);
rejectsMutation("rejects remote and traversing logo paths", (config) => { config.flows[0].nodes[1].logo = "/logos/../secret.svg"; }, /\/logos\/\*\.svg or a board-local assets\/\*\.svg path/);
rejectsMutation("rejects unknown category icons", (config) => { config.flows[0].nodes[0].categoryIcon = "brand-ish"; }, /categoryIcon is invalid/);
rejectsMutation("rejects ambiguous logo and category icon", (config) => { config.flows[0].nodes.find((node) => node.logo).categoryIcon = "security"; }, /either logo or categoryIcon/);
rejectsMutation("rejects edges to unknown nodes", (config) => { config.flows[0].edges[0].target = "missing"; }, /unknown node/);
rejectsMutation("rejects self links", (config) => { config.flows[0].edges[0].target = config.flows[0].edges[0].source; }, /cannot connect a node to itself/);
rejectsMutation("enforces semantic direction", (config) => { config.flows[1].edges.find((edge) => ["response", "error"].includes(edge.semantic)).direction = "forward"; }, /response\/error traffic must use direction return/);
rejectsMutation("rejects duplicate directional routes", (config) => { config.flows[1].edges[1] = { ...config.flows[1].edges[0], id: "duplicate" }; }, /duplicate directional route/);
rejectsMutation("rejects duplicate active steps", (config) => { config.flows[1].edges[0].activeSteps = [1, 1]; }, /activeSteps contains duplicates/);
rejectsMutation("rejects active steps outside the timeline", (config) => { config.flows[1].edges[0].activeSteps = [99]; }, /invalid active step/);
rejectsMutation("requires a status for every node", (config) => { delete config.flows[0].steps[0].nodeStatuses[config.flows[0].nodes[0].id]; }, /missing or invalid/);
rejectsMutation("rejects statuses for unknown nodes", (config) => { config.flows[0].steps[0].nodeStatuses.ghost = "idle"; }, /unknown node/);

test("accepts version 2 persisted layout and canvas items", () => {
  const config = cloneConfig();
  config.version = 2;
  config.flows[0].nodes[0].position = { x: 90, y: 78 };
  config.flows[0].labelPosition = { x: 36, y: 18 };
  config.flows[0].playbackPosition = { x: 140, y: 252 };
  config.canvas = {
    items: [{ id: "canvas-note-1", type: "note", position: { x: 40, y: 80 }, text: "本機註記" }],
    edges: [{ id: "canvas-edge-1", source: "before-client", target: "canvas-note-1" }],
  };
  assert.equal(validateBoardConfig(config).version, 2);
});

rejectsMutation("requires version 2 for persisted canvas data", (config) => {
  config.canvas = { items: [], edges: [] };
}, /requires board config version 2/);

rejectsMutation("rejects invalid persisted node positions", (config) => {
  config.flows[0].nodes[0].position = { x: "left", y: 10 };
}, /position must contain numeric x and y/);

test("prepareBoard writes a validated app config", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "behavior-debug-board-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const outputPath = join(temporaryRoot, "nested", "board.json");

  const result = await prepareBoard({ configPath: defaultConfigPath, outputPath });
  const written = JSON.parse(await readFile(outputPath, "utf8"));

  assert.equal(result.outputPath, outputPath);
  assert.match(result.configHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(written, defaultConfig);
});

test("runtime preparation writes immutable hash-addressed config outside the app fixture", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "behavior-debug-runtime-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const result = await prepareRuntimeBoard({ configPath: defaultConfigPath, repoRoot: temporaryRoot });
  const written = await readFile(result.runtimePath, "utf8");

  assert.equal(result.runtimePath, join(temporaryRoot, "public", "runtime", `${result.configHash}.json`));
  assert.equal(written, result.source);
  assert.deepEqual(JSON.parse(written), defaultConfig);
});

test("runtime preparation copies board-local logo assets without changing canonical config", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "behavior-debug-assets-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const boardDirectory = join(temporaryRoot, "board");
  const runtimeRoot = join(temporaryRoot, "renderer");
  await mkdir(join(boardDirectory, "assets"), { recursive: true });
  const config = cloneConfig();
  config.flows[0].nodes[1].logo = "assets/acme.svg";
  const configPath = join(boardDirectory, "board.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await writeFile(join(boardDirectory, "assets", "acme.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>\n", "utf8");

  const result = await prepareRuntimeBoard({ configPath, repoRoot: runtimeRoot });
  const copied = await readFile(join(runtimeRoot, "public", "runtime", "assets", result.configHash, "acme.svg"), "utf8");
  assert.match(copied, /<svg/);
  assert.equal(JSON.parse(await readFile(result.runtimePath, "utf8")).flows[0].nodes[1].logo, "assets/acme.svg");
});
