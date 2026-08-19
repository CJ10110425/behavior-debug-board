import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";

import { ensureRendererRuntime, makeBoardUrl, prepareRuntimeBoard, startBoardServer } from "./difftale.mjs";
import { startBoardSaveServer } from "./save-board-server.mjs";

const renderProtocol = "5";

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function millisecondsSince(startedAt) {
  return Date.now() - startedAt;
}

export function sniffImage(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", extension: ".png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", extension: ".jpg" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mime: "image/webp", extension: ".webp" };
  }
  throw new Error("browser returned an unsupported screenshot format");
}

function withActualExtension(requestedPath, extension) {
  const requestedExtension = extname(requestedPath).toLowerCase();
  const equivalent = extension === ".jpg" && requestedExtension === ".jpeg";
  if (requestedExtension === extension || equivalent) return requestedPath;
  return resolve(dirname(requestedPath), `${basename(requestedPath, requestedExtension)}${extension}`);
}

async function saveScreenshot(page, requestedPath) {
  const requestedExtension = extname(requestedPath).toLowerCase();
  const type = requestedExtension === ".png" ? "png" : "jpeg";
  const buffer = await page.screenshot({ type, quality: type === "jpeg" ? 90 : undefined, animations: "disabled" });
  const detected = sniffImage(buffer);
  const actualPath = withActualExtension(requestedPath, detected.extension);
  await mkdir(dirname(actualPath), { recursive: true });
  await writeFile(actualPath, buffer);
  const viewport = page.viewportSize();
  return {
    path: actualPath,
    mime: detected.mime,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer.length,
    width: viewport?.width,
    height: viewport?.height,
  };
}

async function copyQaBoardAssets(config, sourceConfigPath, qaConfigPath) {
  const sourceDirectory = dirname(sourceConfigPath);
  const qaDirectory = dirname(qaConfigPath);
  const assets = [...new Set(config.flows.flatMap((flow) => (
    flow.nodes.flatMap((node) => [node.logo, node.screenshot]).filter((asset) => asset?.startsWith("assets/"))
  )))];
  for (const asset of assets) {
    const destination = resolve(qaDirectory, asset);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(sourceDirectory, asset), destination);
  }
}

async function launchBrowser(chromium) {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch (chromeError) {
    try {
      return await chromium.launch({ headless: true });
    } catch (bundledError) {
      throw new Error(`unable to launch Chrome/Chromium. Install Google Chrome or run "npx playwright install chromium". ${chromeError.message}; ${bundledError.message}`);
    }
  }
}

async function viewportTransform(page) {
  return page.locator(".react-flow__viewport").evaluate((element) => getComputedStyle(element).transform);
}

async function seekFlow(page, flow, step) {
  const timeline = page.getByLabel(`${flow} debug timeline`);
  await timeline.fill(String(step));
  await page.locator(`[data-testid="playback-card"][data-flow="${flow}"]`).waitFor({ state: "visible" });
}

function singleSourceFanouts(config) {
  return config.flows.flatMap((flow) => {
    if (flow.nodes.some((node) => node.kind === "screen")) return [];
    if (flow.nodes.length !== 3) return [];
    const forwardEdges = flow.edges.filter((edge) => edge.direction === "forward");
    const sources = [...new Set(forwardEdges.map((edge) => edge.source))];
    if (sources.length !== 1) return [];
    const source = sources[0];
    const targetSet = new Set(forwardEdges.filter((edge) => edge.source === source).map((edge) => edge.target));
    const targets = flow.nodes.map((node) => node.id).filter((nodeId) => targetSet.has(nodeId));
    if (targets.length !== 2 || new Set([source, ...targets]).size !== 3) return [];
    return [{ flow: flow.id, source, targets }];
  });
}

async function verifyFanoutLayout(page, config, checks) {
  const fanouts = singleSourceFanouts(config);
  if (fanouts.length === 0) return;
  let expectedCurvedEdges = 0;
  let expectedAboveLabels = 0;
  let expectedBelowLabels = 0;

  for (const fanout of fanouts) {
    const source = await page.locator(`[data-testid="service-node"][data-flow="${fanout.flow}"][data-node-id="${fanout.source}"]`).boundingBox();
    const targets = await Promise.all(fanout.targets.map((target) => (
      page.locator(`[data-testid="service-node"][data-flow="${fanout.flow}"][data-node-id="${target}"]`).boundingBox()
    )));
    ensure(source && targets.every(Boolean), `${fanout.flow} fan-out cards have no bounding boxes`);
    ensure(targets.every((target) => source.x + source.width < target.x), `${fanout.flow} fan-out source is not left of both targets`);
    const targetCenters = targets.map((target) => target.y + target.height / 2);
    ensure(Math.abs(targetCenters[0] - targetCenters[1]) >= 80, `${fanout.flow} fan-out targets are not visibly split into two branches`);
    const flow = config.flows.find((candidate) => candidate.id === fanout.flow);
    const branchEdges = flow.edges.filter((edge) => edge.source === fanout.source || edge.target === fanout.source);
    expectedCurvedEdges += branchEdges.length;
    for (const edge of branchEdges) {
      const branchNodeId = edge.source === fanout.source ? edge.target : edge.source;
      const branchIndex = fanout.targets.indexOf(branchNodeId);
      if (branchIndex === 0) expectedAboveLabels += 1;
      if (branchIndex === 1) expectedBelowLabels += 1;
    }
  }
  const curvedPaths = page.locator(".packet-edge-path--curved");
  ensure(await curvedPaths.count() === expectedCurvedEdges, `rendered ${await curvedPaths.count()} curved fan-out edges; expected ${expectedCurvedEdges}`);
  const pathData = await curvedPaths.evaluateAll((paths) => paths.map((path) => path.getAttribute("d") ?? ""));
  ensure(pathData.every((path) => path.includes("C") && !path.includes("NaN")), "fan-out edges are not valid cubic curves");
  const aboveLabels = page.locator('[data-testid="edge-label"][data-label-lane="above"]');
  const belowLabels = page.locator('[data-testid="edge-label"][data-label-lane="below"]');
  ensure(await aboveLabels.count() === expectedAboveLabels, `rendered ${await aboveLabels.count()} upper fan-out labels; expected ${expectedAboveLabels}`);
  ensure(await belowLabels.count() === expectedBelowLabels, `rendered ${await belowLabels.count()} lower fan-out labels; expected ${expectedBelowLabels}`);
  checks["fanout-layout"] = true;
  checks["fanout-curves"] = true;
  checks["fanout-label-lanes"] = true;
}

async function verifyFlowClearance(page, checks) {
  const flowBounds = {};
  for (const flow of ["before", "after"]) {
    const cardBoxes = await page.locator(`[data-testid="service-node"][data-flow="${flow}"]`).evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    }));
    const playbackBox = await page.locator(`[data-testid="playback-card"][data-flow="${flow}"]`).evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    });
    const cardBottom = Math.max(...cardBoxes.map((box) => box.bottom));
    ensure(cardBottom + 12 <= playbackBox.top, `${flow} playback card overlaps a visual node`);
    flowBounds[flow] = {
      top: Math.min(...cardBoxes.map((box) => box.top)),
      bottom: Math.max(playbackBox.bottom, cardBottom),
    };
  }
  ensure(flowBounds.before.bottom + 20 <= flowBounds.after.top, "Before and After flows overlap");
  checks["playback-clearance"] = true;
  checks["flow-clearance"] = true;
}

async function verifyFrameContainment(page, checks) {
  for (const flow of ["before", "after"]) {
    const frame = await page.locator(`.react-flow__node[data-id="${flow}-group"]`).evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    });
    const framed = await page
      .locator(`[data-testid="service-node"][data-flow="${flow}"], [data-testid="playback-card"][data-flow="${flow}"]`)
      .evaluateAll((elements) => elements.map((element) => {
        const box = element.getBoundingClientRect();
        return {
          id: element.getAttribute("data-node-id") ?? element.getAttribute("data-testid"),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      }));
    ensure(framed.length > 0, `${flow} flow rendered no framed content`);
    for (const item of framed) {
      const escapedBy = Math.max(
        frame.left - item.left,
        item.right - frame.right,
        frame.top - item.top,
        item.bottom - frame.bottom,
      );
      ensure(escapedBy <= 1, `${flow} ${item.id} sits ${Math.round(escapedBy)}px outside its flow frame`);
    }
  }
  checks["frame-containment"] = true;
}

async function runFullInteractionQa(page, config, flow, checks) {
  const playback = page.locator(`[data-testid="playback-card"][data-flow="${flow}"]`);
  const totalSteps = Number(await playback.getAttribute("data-total-steps"));
  ensure(Number.isInteger(totalSteps) && totalSteps >= 2, `${flow} playback step count is invalid`);

  await page.locator('[data-testid="board-version-toggle"]').click();
  const versionPanel = page.locator('[data-testid="board-version-panel"]');
  await versionPanel.waitFor({ state: "visible" });
  await versionPanel.locator('[data-testid="board-version-title"]').fill("Initial QA version");
  await page.locator('[data-testid="board-version-create"]').click();
  await versionPanel.locator("article").first().waitFor({ state: "visible" });
  await versionPanel.locator('[data-testid="board-version-close"]').click();
  checks["local-version-create"] = true;

  await seekFlow(page, flow, totalSteps - 1);
  await page.locator(`[data-testid="playback-replay-${flow}"]`).click();
  await page.waitForFunction(
    ({ selectedFlow }) => Number(document.querySelector(`[data-testid="playback-card"][data-flow="${selectedFlow}"]`)?.getAttribute("data-current-step")) > 0,
    { selectedFlow: flow },
    { timeout: 3_000 },
  );
  checks.replay = true;

  const selectedFlow = config.flows.find((candidate) => candidate.id === flow);
  const runningStep = selectedFlow.steps.findIndex((step) => Object.values(step.nodeStatuses).includes("running"));
  if (runningStep >= 0) {
    await seekFlow(page, flow, runningStep);
    ensure(await page.locator(`[data-testid="service-node"][data-flow="${flow}"][data-status="running"]`).count() > 0, `${flow} loading state did not render`);
  }
  checks.loading = true;

  const editableCard = page.locator(`[data-testid="service-node"][data-flow="${flow}"]`).first();
  const titleInput = editableCard.locator('[data-testid="service-title-input"]');
  const descriptionInput = editableCard.locator('[data-testid="service-description-input"]');
  const originalTitle = await titleInput.inputValue();
  const originalDescription = await descriptionInput.inputValue();
  const editedTitle = `${originalTitle} · QA`;
  const editedDescription = `${originalDescription} · edited`;
  await titleInput.fill(editedTitle);
  await descriptionInput.fill(editedDescription);
  const rerenderStep = runningStep === 0 ? 1 : 0;
  await seekFlow(page, flow, rerenderStep);
  ensure(await titleInput.inputValue() === editedTitle, `${flow} card title edit was lost after playback rendered`);
  ensure(await descriptionInput.inputValue() === editedDescription, `${flow} card description edit was lost after playback rendered`);
  await page.locator('[data-testid="board-save-status"][data-save-state="dirty"]').waitFor({ state: "visible" });
  await page.locator('[data-testid="board-save-status"][data-save-state="saved"]').waitFor({ state: "visible", timeout: 3_000 });
  checks["local-autosave"] = true;
  await titleInput.fill(originalTitle);
  await descriptionInput.fill(originalDescription);
  await page.locator('[data-testid="board-save-status"][data-save-state="dirty"]').waitFor({ state: "visible" });
  await page.locator('[data-testid="board-save-button"]').click();
  await page.locator('[data-testid="board-save-status"][data-save-state="saved"]').waitFor({ state: "visible" });
  checks["local-save"] = true;
  checks["card-text-editing"] = true;

  const draggable = page.locator(".react-flow__node-debugNode").first();
  const dragSurface = draggable.locator(".debug-node__topline, .screen-card__meta").first();
  const box = await dragSurface.boundingBox();
  ensure(box, "service node drag surface has no bounding box");
  const beforeDrag = await draggable.evaluate((element) => getComputedStyle(element).transform);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 32, box.y + box.height / 2 + 12, { steps: 6 });
  await page.mouse.up();
  const afterDrag = await draggable.evaluate((element) => getComputedStyle(element).transform);
  ensure(afterDrag !== beforeDrag, "dragging a service card did not change its position");
  checks.drag = true;

  const movedBox = await draggable.boundingBox();
  if (movedBox) {
    await page.mouse.move(movedBox.x + movedBox.width / 2, movedBox.y + 18);
    await page.mouse.down();
    await page.mouse.move(movedBox.x + movedBox.width / 2 - 32, movedBox.y + 6, { steps: 6 });
    await page.mouse.up();
  }

  const beforeZoom = await viewportTransform(page);
  await page.locator('[data-testid="zoom-in"]').click();
  await page.waitForTimeout(220);
  const afterZoom = await viewportTransform(page);
  ensure(afterZoom !== beforeZoom, "zoom-in did not change the canvas viewport");
  checks.zoom = true;

  await page.locator('[data-testid="fit-view"]').click();
  await page.waitForTimeout(340);
  const afterFit = await viewportTransform(page);
  ensure(afterFit !== afterZoom && afterFit !== "none", "fit-view did not restore the canvas viewport");
  checks["fit-view"] = true;

  await seekFlow(page, flow, totalSteps - 1);
  if (await page.locator('[data-testid="board-save-status"][data-save-state="dirty"]').count()) {
    await page.locator('[data-testid="board-save-button"]').click();
    await page.locator('[data-testid="board-save-status"][data-save-state="saved"]').waitFor({ state: "visible" });
  }

  const finalTitleInput = page.locator(`[data-testid="service-node"][data-flow="${flow}"]`).first().locator('[data-testid="service-title-input"]');
  await finalTitleInput.fill(`${originalTitle} · semantic diff`);
  await page.locator('[data-testid="board-save-status"][data-save-state="saved"]').waitFor({ state: "visible", timeout: 3_000 });
  await page.locator('[data-testid="board-version-toggle"]').click();
  await versionPanel.waitFor({ state: "visible" });
  const firstVersion = versionPanel.locator("article").first();
  await firstVersion.locator('[data-testid="board-version-compare"]').click();
  await page.locator('[data-testid="board-version-diff"] .semantic-change--changed').first().waitFor({ state: "visible" });
  checks["semantic-version-diff"] = true;
  await firstVersion.locator('[data-testid="board-version-restore"]').click();
  await page.locator('[data-testid="board-version-restore-confirm"]').click();
  await page.waitForFunction(
    ({ selectedFlow, expectedTitle }) => {
      const input = document.querySelector(`[data-testid="service-node"][data-flow="${selectedFlow}"] [data-testid="service-title-input"]`);
      return input instanceof HTMLInputElement && input.value === expectedTitle;
    },
    { selectedFlow: flow, expectedTitle: originalTitle },
    { timeout: 3_000 },
  );
  const restoredTitle = await page.locator(`[data-testid="service-node"][data-flow="${flow}"]`).first().locator('[data-testid="service-title-input"]').inputValue();
  ensure(restoredTitle === originalTitle, `restoring a Board version returned ${restoredTitle}; expected ${originalTitle}`);
  checks["local-version-restore"] = true;

  const readOnlyPage = await page.context().newPage();
  try {
    const readOnlyUrl = new URL(page.url());
    readOnlyUrl.searchParams.delete("save");
    readOnlyUrl.searchParams.delete("saveToken");
    readOnlyUrl.searchParams.set("lang", "zh-TW");
    await readOnlyPage.goto(readOnlyUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    await readOnlyPage.locator('[data-testid="board-write-blocker"][data-bridge-state="missing"]').waitFor({ state: "visible" });
    ensure(await readOnlyPage.locator('main[data-save-bridge-state="missing"]').count() === 1, "config-only Board URL was not marked read-only");
    ensure(await readOnlyPage.locator('main[data-locale="zh-TW"]').count() === 1, "Traditional Chinese UI query was not applied");
    ensure(await readOnlyPage.getByText("目前無法安全編輯", { exact: true }).count() === 1, "Traditional Chinese blocker copy did not render");
    checks["read-only-without-save-url"] = true;
    checks["traditional-chinese-ui"] = true;
  } finally {
    await readOnlyPage.close();
  }
}

export async function runBoardQa(options) {
  ensureRendererRuntime(options.repoRoot);
  const startedAt = Date.now();
  const timings = {};
  const prepareStartedAt = Date.now();
  const prepared = await prepareRuntimeBoard(options);
  timings.prepare = millisecondsSince(prepareStartedAt);

  const serverStartedAt = Date.now();
  const server = await startBoardServer(options);
  timings.server = millisecondsSince(serverStartedAt);

  const screenshotPath = options.screenshotPath ?? resolve(options.repoRoot, "outputs/qa", prepared.configHash, "board.jpg");
  const reportPath = options.reportPath ?? resolve(dirname(screenshotPath), "qa-report.json");
  const qaRuntimeRoot = resolve(dirname(screenshotPath), ".qa-runtime", `${prepared.configHash}-${randomBytes(6).toString("hex")}`);
  const qaSavePath = resolve(qaRuntimeRoot, "board.json");
  await mkdir(dirname(qaSavePath), { recursive: true });
  await writeFile(qaSavePath, prepared.source, "utf8");
  await copyQaBoardAssets(prepared.config, prepared.configPath, qaSavePath);
  const saveToken = randomBytes(24).toString("hex");
  const saveBridge = await startBoardSaveServer({ configPath: qaSavePath, token: saveToken });
  const url = makeBoardUrl(server.origin, prepared.configHash, {
    flow: options.flow,
    finalStep: options.finalStep,
    saveOrigin: saveBridge.origin,
    saveToken,
    timeScale: options.full ? 0.08 : 0.03,
  });
  const expected = {
    serviceNodes: prepared.config.flows.reduce((count, candidate) => count + candidate.nodes.length, 0),
    screenNodes: prepared.config.flows.reduce((count, candidate) => count + candidate.nodes.filter((node) => node.kind === "screen").length, 0),
    mobileScreens: prepared.config.flows.reduce((count, candidate) => count + candidate.nodes.filter((node) => node.kind === "screen" && node.frame === "mobile").length, 0),
    edges: prepared.config.flows.reduce((count, candidate) => count + candidate.edges.length, 0)
      + (prepared.config.canvas?.edges?.length ?? 0),
    labels: prepared.config.flows.reduce((count, candidate) => count + candidate.edges.length, 0),
    playbackCards: prepared.config.flows.length,
  };
  const checks = {};
  let browser;
  let context;
  let page;
  let actual;
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];

  try {
    let playwright;
    try {
      playwright = await import("playwright");
    } catch (error) {
      throw new Error(`Playwright is required for board QA. Run "npm install" in ${options.repoRoot}. ${error.message}`);
    }
    browser = await launchBrowser(playwright.chromium);
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`));

    const renderStartedAt = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const readySelector = `main[data-board-ready="true"][data-config-sha256="${prepared.configHash}"][data-render-protocol="${renderProtocol}"]`;
    await page.locator(readySelector).waitFor({ state: "attached", timeout: 30_000 });
    timings.render = millisecondsSince(renderStartedAt);
    checks["render-ready"] = true;
    checks["config-hash"] = true;
    ensure(await page.locator('main[data-locale="en"]').count() === 1, "Board UI is not English by default");
    ensure(await page.locator('[data-testid="language-toggle"]').textContent() === "繁中", "English UI does not offer the Traditional Chinese switch");
    checks["english-default-ui"] = true;

    actual = {
      serviceNodes: await page.locator('[data-testid="service-node"]').count(),
      screenNodes: await page.locator('[data-testid="service-node"][data-node-kind="screen"]').count(),
      mobileScreens: await page.locator('[data-testid="service-node"][data-screen-frame="mobile"]').count(),
      edges: await page.locator(".react-flow__edge").count(),
      labels: await page.locator('[data-testid="edge-label"]').count(),
      playbackCards: await page.locator('[data-testid="playback-card"]').count(),
    };
    ensure(actual.serviceNodes === expected.serviceNodes, `rendered ${actual.serviceNodes} service nodes; expected ${expected.serviceNodes}`);
    ensure(actual.screenNodes === expected.screenNodes, `rendered ${actual.screenNodes} screen nodes; expected ${expected.screenNodes}`);
    ensure(actual.mobileScreens === expected.mobileScreens, `rendered ${actual.mobileScreens} mobile screen nodes; expected ${expected.mobileScreens}`);
    ensure(actual.edges === expected.edges, `rendered ${actual.edges} edges; expected ${expected.edges}`);
    ensure(actual.labels === expected.labels, `rendered ${actual.labels} labels; expected ${expected.labels}`);
    ensure(actual.playbackCards === expected.playbackCards, `rendered ${actual.playbackCards} playback cards; expected ${expected.playbackCards}`);
    ensure(await page.locator('[data-testid="service-title-input"]').count() === expected.serviceNodes, "not every service card has an editable title");
    ensure(await page.locator('[data-testid="service-description-input"]').count() === expected.serviceNodes, "not every service card has an editable description");
    checks["service-nodes"] = true;
    if (expected.screenNodes > 0) {
      const screenshotState = await page.locator('[data-testid="screen-preview"] img').evaluateAll((images) => images.map((image) => ({
        complete: image instanceof HTMLImageElement && image.complete,
        naturalWidth: image instanceof HTMLImageElement ? image.naturalWidth : 0,
        source: image instanceof HTMLImageElement ? image.currentSrc : "",
      })));
      ensure(screenshotState.length === expected.screenNodes, "not every screen node rendered a screenshot");
      ensure(screenshotState.every((image) => image.complete && image.naturalWidth > 0), "one or more screen screenshots failed to load");
      ensure(screenshotState.every((image) => image.source.includes(`/runtime/assets/${prepared.configHash}/`)), "screen screenshot did not load from the immutable local runtime bundle");
      ensure(await page.locator('[data-testid="service-node"][data-node-kind="screen"] .debug-node__detail').count() === 0, "screen cards rendered the long service detail footer");
      checks["screen-nodes"] = true;
      checks["screen-assets"] = true;
      checks["screen-frame-layout"] = true;
      checks["concise-screen-copy"] = true;
    }
    checks["editable-card-copy"] = true;
    checks.edges = true;
    checks.labels = true;
    checks.playback = true;
    await verifyFlowClearance(page, checks);
    await verifyFrameContainment(page, checks);
    ensure(await page.locator('main[data-save-bridge-state="online"]').count() === 1, "Save Bridge is not online after Board render");
    ensure(await page.locator('[data-testid="board-save-button"]').isEnabled(), "local save button is not connected");
    ensure(await page.locator('[data-testid="board-version-toggle"]').isEnabled(), "local version history is not connected");
    await page.getByText("Local only · no Git commits", { exact: true }).waitFor({ state: "visible" });
    checks["local-persistence"] = true;
    checks["save-bridge-heartbeat"] = true;
    checks["local-version-history"] = true;
    checks["storage-mode-label"] = true;

    const labelTexts = await page.locator('[data-testid="edge-label"]').allTextContents();
    ensure(labelTexts.every((label) => label.trim().length > 0), "one or more directional edges rendered without a label");
    checks["persistent-edge-labels"] = true;

    const labelNodeOverlaps = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('[data-testid="edge-label"]'));
      const serviceNodes = Array.from(document.querySelectorAll('[data-testid="service-node"]'));
      return labels.flatMap((label) => {
        const labelBounds = label.getBoundingClientRect();
        return serviceNodes.flatMap((node) => {
          const nodeBounds = node.getBoundingClientRect();
          const overlapWidth = Math.max(0, Math.min(labelBounds.right, nodeBounds.right) - Math.max(labelBounds.left, nodeBounds.left));
          const overlapHeight = Math.max(0, Math.min(labelBounds.bottom, nodeBounds.bottom) - Math.max(labelBounds.top, nodeBounds.top));
          if (overlapWidth <= 0.5 || overlapHeight <= 0.5) return [];
          return [{
            edge: label.getAttribute("data-edge-id"),
            node: node.getAttribute("data-node-id"),
            flow: node.getAttribute("data-flow"),
            overlapWidth: Math.round(overlapWidth),
            overlapHeight: Math.round(overlapHeight),
          }];
        });
      });
    });
    actual.labelNodeOverlaps = labelNodeOverlaps.length;
    ensure(labelNodeOverlaps.length === 0, `edge labels overlap service cards: ${JSON.stringify(labelNodeOverlaps)}`);
    checks["edge-label-clearance"] = true;
    await verifyFanoutLayout(page, prepared.config, checks);

    if (options.finalStep) {
      const playback = page.locator(`[data-testid="playback-card"][data-flow="${options.flow}"]`);
      const currentStep = Number(await playback.getAttribute("data-current-step"));
      const totalSteps = Number(await playback.getAttribute("data-total-steps"));
      ensure(currentStep === totalSteps - 1, `${options.flow} did not open at its final step`);
      checks["final-step"] = true;
    }

    if (options.full) await runFullInteractionQa(page, prepared.config, options.flow, checks);

    await page.locator('[data-testid="fit-view"]').click();
    await page.waitForTimeout(340);
    ensure(pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`);
    ensure(consoleErrors.length === 0, `console errors: ${consoleErrors.join(" | ")}`);
    ensure(requestFailures.length === 0, `failed requests: ${requestFailures.join(" | ")}`);
    checks.console = true;
    checks.network = true;

    const screenshot = await saveScreenshot(page, screenshotPath);
    timings.qa = millisecondsSince(renderStartedAt) - timings.render;
    timings.total = millisecondsSince(startedAt);
    const report = {
      status: "pass",
      mode: options.full ? "full" : "fast",
      config: { source: prepared.configPath, runtime: prepared.runtimePath, sha256: prepared.configHash },
      renderer: { protocol: renderProtocol, url, serverReused: server.reused },
      expected,
      actual,
      checks,
      screenshot,
      diagnostics: { consoleErrors, pageErrors, requestFailures },
      timingsMs: timings,
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(`BOARD_CONFIG_LOADED sha256=${prepared.configHash} path=${prepared.runtimePath}`);
    console.log(`${server.reused ? "BOARD_SERVER_REUSED" : "BOARD_SERVER_STARTED"} ${server.origin}`);
    console.log(`BOARD_RENDERED nodes=${actual.serviceNodes} edges=${actual.edges} labels=${actual.labels}`);
    console.log(`BOARD_QA_PASS ${Object.keys(checks).join(" ")}`);
    console.log(`BOARD_SCREENSHOT path=${screenshot.path} mime=${screenshot.mime}`);
    console.log(`BOARD_QA_REPORT ${reportPath}`);
    console.log(`BOARD_DURATION_MS ${timings.total}`);
    return report;
  } catch (error) {
    timings.total = millisecondsSince(startedAt);
    let screenshot;
    if (page) {
      try {
        screenshot = await saveScreenshot(page, screenshotPath);
      } catch {
        // The page may have crashed before a screenshot could be captured.
      }
    }
    const report = {
      status: "fail",
      mode: options.full ? "full" : "fast",
      error: error instanceof Error ? error.message : String(error),
      config: { source: prepared.configPath, runtime: prepared.runtimePath, sha256: prepared.configHash },
      renderer: { protocol: renderProtocol, url, serverReused: server.reused },
      expected,
      actual,
      checks,
      screenshot,
      diagnostics: { consoleErrors, pageErrors, requestFailures },
      timingsMs: timings,
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.error(`BOARD_QA_FAIL ${report.error}`);
    if (screenshot) console.error(`BOARD_SCREENSHOT path=${screenshot.path} mime=${screenshot.mime}`);
    console.error(`BOARD_QA_REPORT ${reportPath}`);
    console.error(`BOARD_DURATION_MS ${timings.total}`);
    throw error;
  } finally {
    await context?.close();
    await browser?.close();
    await saveBridge.close();
    if (!server.reused) await server.stop();
    await rm(qaRuntimeRoot, { recursive: true, force: true });
  }
}
