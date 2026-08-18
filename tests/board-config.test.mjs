import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { prepareBoard, validateBoardConfig } from "../skills/behavior-debug-board/scripts/behavior-debug-board.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const defaultConfigPath = resolve(repoRoot, "app/board.generated.json");
const defaultConfig = JSON.parse(await readFile(defaultConfigPath, "utf8"));

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

rejectsMutation("requires config version 1", (config) => { config.version = 2; }, /version must be 1/);
rejectsMutation("requires exact Before and After flows", (config) => { config.flows[1].id = "during"; }, /unique ids: before and after/);
rejectsMutation("requires matching outcomes", (config) => { config.flows[0].outcome = "success"; }, /outcome must be error/);
rejectsMutation("limits a flow to five nodes", (config) => { config.flows[0].nodes = [config.flows[0].nodes[0]]; }, /2–5 service nodes/);
rejectsMutation("rejects duplicate node ids", (config) => { config.flows[0].nodes[1].id = "client"; }, /duplicate node id/);
rejectsMutation("rejects invalid node kinds", (config) => { config.flows[0].nodes[0].kind = "screen"; }, /kind is invalid/);
rejectsMutation("rejects remote and traversing logo paths", (config) => { config.flows[0].nodes[1].logo = "/logos/../secret.svg"; }, /local \/logos\/\*\.svg path/);
rejectsMutation("rejects unknown category icons", (config) => { config.flows[0].nodes[0].categoryIcon = "brand-ish"; }, /categoryIcon is invalid/);
rejectsMutation("rejects ambiguous logo and category icon", (config) => { config.flows[0].nodes[1].categoryIcon = "security"; }, /either logo or categoryIcon/);
rejectsMutation("rejects edges to unknown nodes", (config) => { config.flows[0].edges[0].target = "missing"; }, /unknown node/);
rejectsMutation("rejects self links", (config) => { config.flows[0].edges[0].target = "client"; }, /cannot connect a node to itself/);
rejectsMutation("enforces semantic direction", (config) => { config.flows[1].edges[2].direction = "forward"; }, /response\/error traffic must use direction return/);
rejectsMutation("rejects duplicate directional routes", (config) => { config.flows[1].edges[1] = { ...config.flows[1].edges[0], id: "duplicate" }; }, /duplicate directional route/);
rejectsMutation("rejects duplicate active steps", (config) => { config.flows[1].edges[0].activeSteps = [1, 1]; }, /activeSteps contains duplicates/);
rejectsMutation("rejects active steps outside the timeline", (config) => { config.flows[1].edges[0].activeSteps = [99]; }, /invalid active step/);
rejectsMutation("requires a status for every node", (config) => { delete config.flows[0].steps[0].nodeStatuses.rules; }, /missing or invalid/);
rejectsMutation("rejects statuses for unknown nodes", (config) => { config.flows[0].steps[0].nodeStatuses.ghost = "idle"; }, /unknown node/);

test("prepareBoard writes a validated app config", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "behavior-debug-board-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const outputPath = join(temporaryRoot, "nested", "board.json");

  const result = await prepareBoard({ configPath: defaultConfigPath, outputPath });
  const written = JSON.parse(await readFile(outputPath, "utf8"));

  assert.equal(result.outputPath, outputPath);
  assert.deepEqual(written, defaultConfig);
});
