import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";

import { makeBoardUrl, prepareRuntimeBoard, startBoardServer } from "./behavior-debug-board.mjs";

const renderProtocol = "1";

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

async function runFullInteractionQa(page, config, flow, checks) {
  const playback = page.locator(`[data-testid="playback-card"][data-flow="${flow}"]`);
  const totalSteps = Number(await playback.getAttribute("data-total-steps"));
  ensure(Number.isInteger(totalSteps) && totalSteps >= 2, `${flow} playback step count is invalid`);

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

  const draggable = page.locator(".react-flow__node-debugNode").first();
  const box = await draggable.boundingBox();
  ensure(box, "service node is not draggable because it has no bounding box");
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
    await page.mouse.move(movedBox.x + movedBox.width / 2, movedBox.y + movedBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(movedBox.x + movedBox.width / 2 - 32, movedBox.y + movedBox.height / 2 - 12, { steps: 6 });
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
}

export async function runBoardQa(options) {
  const startedAt = Date.now();
  const timings = {};
  const prepareStartedAt = Date.now();
  const prepared = await prepareRuntimeBoard(options);
  timings.prepare = millisecondsSince(prepareStartedAt);

  const serverStartedAt = Date.now();
  const server = await startBoardServer(options);
  timings.server = millisecondsSince(serverStartedAt);

  const url = makeBoardUrl(server.origin, prepared.configHash, {
    flow: options.flow,
    finalStep: options.finalStep,
    timeScale: options.full ? 0.08 : 0.03,
  });
  const screenshotPath = options.screenshotPath ?? resolve(options.repoRoot, "outputs/qa", prepared.configHash, "board.jpg");
  const reportPath = options.reportPath ?? resolve(dirname(screenshotPath), "qa-report.json");
  const expected = {
    serviceNodes: prepared.config.flows.reduce((count, candidate) => count + candidate.nodes.length, 0),
    edges: prepared.config.flows.reduce((count, candidate) => count + candidate.edges.length, 0),
    labels: prepared.config.flows.reduce((count, candidate) => count + candidate.edges.length, 0),
    playbackCards: prepared.config.flows.length,
  };
  const checks = {};
  let browser;
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
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
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

    actual = {
      serviceNodes: await page.locator('[data-testid="service-node"]').count(),
      edges: await page.locator(".react-flow__edge").count(),
      labels: await page.locator('[data-testid="edge-label"]').count(),
      playbackCards: await page.locator('[data-testid="playback-card"]').count(),
    };
    ensure(actual.serviceNodes === expected.serviceNodes, `rendered ${actual.serviceNodes} service nodes; expected ${expected.serviceNodes}`);
    ensure(actual.edges === expected.edges, `rendered ${actual.edges} edges; expected ${expected.edges}`);
    ensure(actual.labels === expected.labels, `rendered ${actual.labels} labels; expected ${expected.labels}`);
    ensure(actual.playbackCards === expected.playbackCards, `rendered ${actual.playbackCards} playback cards; expected ${expected.playbackCards}`);
    checks["service-nodes"] = true;
    checks.edges = true;
    checks.labels = true;
    checks.playback = true;

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
    await browser?.close();
    if (!server.reused) await server.stop();
  }
}
