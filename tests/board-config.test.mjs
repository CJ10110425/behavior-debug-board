import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { inferScreenFrame, prepareBoard, prepareRuntimeBoard, readRasterDimensions, validateBoardConfig } from "../skills/difftale/scripts/difftale.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const defaultConfigPath = resolve(repoRoot, "skills/difftale/assets/example-board.json");
const defaultConfig = JSON.parse(await readFile(defaultConfigPath, "utf8"));
const fanoutConfigPath = resolve(repoRoot, "skills/difftale/assets/fanout-board.json");
const fanoutConfig = JSON.parse(await readFile(fanoutConfigPath, "utf8"));

function cloneConfig() {
  return structuredClone(defaultConfig);
}

function pngDimensions(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function jpegDimensions(width, height) {
  const buffer = Buffer.alloc(21);
  Buffer.from([0xff, 0xd8, 0xff, 0xc0]).copy(buffer);
  buffer.writeUInt16BE(17, 4);
  buffer[6] = 8;
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}

function webpDimensions(width, height) {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  buffer[24] = encodedWidth & 0xff;
  buffer[25] = (encodedWidth >> 8) & 0xff;
  buffer[26] = (encodedWidth >> 16) & 0xff;
  buffer[27] = encodedHeight & 0xff;
  buffer[28] = (encodedHeight >> 8) & 0xff;
  buffer[29] = (encodedHeight >> 16) & 0xff;
  return buffer;
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

rejectsMutation("requires a supported config version", (config) => { config.version = 4; }, /version must be 1, 2, or 3/);
rejectsMutation("requires exact Before and After flows", (config) => { config.flows[1].id = "during"; }, /unique ids: before and after/);
rejectsMutation("requires matching outcomes", (config) => { config.flows[0].outcome = "success"; }, /outcome must be error/);
rejectsMutation("limits a flow to five nodes", (config) => { config.flows[0].nodes = [config.flows[0].nodes[0]]; }, /2–5 visual nodes/);
rejectsMutation("rejects duplicate node ids", (config) => { config.flows[0].nodes[1].id = config.flows[0].nodes[0].id; }, /duplicate node id/);
rejectsMutation("rejects invalid node kinds", (config) => { config.flows[0].nodes[0].kind = "cache"; }, /kind is invalid/);
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

test("accepts version 3 screenshot screen nodes", () => {
  const config = cloneConfig();
  config.version = 3;
  const screen = config.flows[0].nodes[0];
  screen.kind = "screen";
  screen.screenshot = "assets/screens/before-login-a1b2c3d4.png";
  screen.frame = "browser";
  screen.route = "/login";
  delete screen.categoryIcon;
  assert.equal(validateBoardConfig(config).flows[0].nodes[0].kind, "screen");
});

test("reads raster dimensions and infers clear mobile and browser layouts", () => {
  assert.deepEqual(readRasterDimensions(pngDimensions(390, 844)), { width: 390, height: 844, format: "png" });
  assert.deepEqual(readRasterDimensions(jpegDimensions(1440, 900)), { width: 1440, height: 900, format: "jpeg" });
  assert.deepEqual(readRasterDimensions(webpDimensions(390, 844)), { width: 390, height: 844, format: "webp" });
  assert.equal(inferScreenFrame({ width: 390, height: 844 }).frame, "mobile");
  assert.equal(inferScreenFrame({ width: 1440, height: 900 }).frame, "browser");
});

test("requires user confirmation for an ambiguous high-resolution portrait", () => {
  const result = inferScreenFrame({ width: 1179, height: 2556 });
  assert.equal(result.frame, undefined);
  assert.equal(result.confidence, "ambiguous");
});

rejectsMutation("requires local raster assets for screen nodes", (config) => {
  config.version = 3;
  const screen = config.flows[0].nodes[0];
  screen.kind = "screen";
  screen.screenshot = "https://example.com/login.png";
  delete screen.categoryIcon;
}, /board-local assets\/\*\.png/);

rejectsMutation("requires version 3 for screen nodes", (config) => {
  const screen = config.flows[0].nodes[0];
  screen.kind = "screen";
  screen.screenshot = "assets/screens/login.png";
  delete screen.categoryIcon;
}, /require board config version 3/);

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

rejectsMutation("requires version 2 or 3 for persisted canvas data", (config) => {
  config.canvas = { items: [], edges: [] };
}, /requires board config version 2 or 3/);

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

test("runtime preparation infers a missing frame and copies board-local screenshot assets", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "difftale-screen-assets-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const boardDirectory = join(temporaryRoot, "board");
  const runtimeRoot = join(temporaryRoot, "renderer");
  await mkdir(join(boardDirectory, "assets", "screens"), { recursive: true });
  const config = cloneConfig();
  config.version = 3;
  const screen = config.flows[0].nodes[0];
  screen.kind = "screen";
  screen.screenshot = "assets/screens/login-deadbeef.png";
  delete screen.categoryIcon;
  const configPath = join(boardDirectory, "board.json");
  const screenshot = pngDimensions(1280, 720);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await writeFile(join(boardDirectory, screen.screenshot), screenshot);

  const result = await prepareRuntimeBoard({ configPath, repoRoot: runtimeRoot });
  const copied = await readFile(join(runtimeRoot, "public", "runtime", "assets", result.configHash, "screens", "login-deadbeef.png"));
  assert.deepEqual(copied, screenshot);
  assert.equal(JSON.parse(await readFile(result.runtimePath, "utf8")).flows[0].nodes[0].frame, "browser");
});

test("runtime preparation asks for confirmation when screenshot geometry is ambiguous", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "difftale-ambiguous-screen-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const boardDirectory = join(temporaryRoot, "board");
  await mkdir(join(boardDirectory, "assets", "screens"), { recursive: true });
  const config = cloneConfig();
  config.version = 3;
  const screen = config.flows[0].nodes[0];
  screen.kind = "screen";
  screen.screenshot = "assets/screens/ambiguous.png";
  delete screen.frame;
  delete screen.categoryIcon;
  const configPath = join(boardDirectory, "board.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await writeFile(join(boardDirectory, screen.screenshot), pngDimensions(1179, 2556));

  await assert.rejects(
    prepareRuntimeBoard({ configPath, repoRoot: join(temporaryRoot, "renderer") }),
    /frame needs user confirmation/,
  );
});
