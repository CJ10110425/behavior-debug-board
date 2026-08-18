---
name: behavior-debug-board
description: Create and open a local animated before/after debugging board that explains behavior changes through service cards, directional request/response lines, persistent edge labels, brand logos, loading states, and replay controls. Use when a user asks to visualize a bug, debug flow, behavior diff, permission failure, request/response path, or wants a local whiteboard instead of a text or code diff.
---

# Behavior Debug Board

Turn debugging evidence into a local, editable, replayable behavior diagram. The renderer is the bundled React Flow app; do not generate a `.tldr` file for this workflow.

## Contract

Guarantee all of the following:

- Represent both `Before` and `After` on one infinite white canvas.
- Give every direction its own edge. Never reuse one geometric line for request and response.
- Render every edge, arrowhead, and label before playback starts. Playback only highlights an existing edge and moves its packet.
- Keep every service card title and description directly editable on the canvas, and preserve edits while playback changes card status.
- Reserve enough horizontal space for the longest directional label between adjacent cards; edge labels must never overlap service cards in the initial fitted layout.
- Describe behavior, cause, and user-visible result. Do not expose commit hashes or code diffs unless requested.
- Preserve official brand colors and store fetched SVGs locally for offline use.
- Load each generated board from an immutable SHA-256 runtime URL; never overwrite a tracked app fixture.
- Treat `BOARD_SERVER_READY` as transport readiness only. Completion requires `BOARD_RENDERED` and `BOARD_QA_PASS` from browser QA.
- Start localhost, wait for a healthy response, and open the board for the user. Producing JSON without opening the board is incomplete.

## Workflow

1. Gather the bug symptom, actors/services, observed path, root cause, fix, and verified result.
2. Read [references/board-schema.md](references/board-schema.md), then write a version-1 board JSON file.
3. For named products, read [references/logo-mcp.md](references/logo-mcp.md). Try the Logo MCP first, then search the web for an official brand/media asset and trusted registries. Save a trustworthy SVG under `public/logos/` and record its source. If no reliable logo exists, classify the service and set `categoryIcon`; never invent a brand mark.
4. Run the fast browser QA. This validates the config, chooses/reuses a port, waits for React Flow hydration/layout/fit-view, verifies node/edge/label counts, opens the selected flow at its final step, and writes a correctly typed screenshot plus JSON report:

   ```bash
   node skills/behavior-debug-board/scripts/behavior-debug-board.mjs qa \
     --config /absolute/path/to/board.json \
     --port auto \
     --flow after \
     --final-step \
     --screenshot /absolute/path/to/result.jpg
   ```

5. Use `--full` when changing the renderer itself. Full QA additionally exercises replay, loading, drag, zoom, fit-view, and any detected single-source fan-out layout. Do not pay this cost for every generated board.
6. Launch the local board for the user:

   ```bash
   node skills/behavior-debug-board/scripts/behavior-debug-board.mjs launch --config /absolute/path/to/board.json --port auto
   ```

7. If a Codex in-app browser tool is available, pass `--no-open`, wait for `BOARD_SERVER_READY`, then open the printed hash-addressed `BOARD_URL` in that browser. Otherwise let the launcher open the system browser.
8. Report the `BOARD_QA_REPORT` and `BOARD_SCREENSHOT` paths. A screenshot captured before `data-board-ready="true"` is invalid.

## Diagram Rules

- Use 2–5 service nodes per flow. Keep linear peers on one horizontal band. For one source with exactly two outbound targets, place the source on the left, stack both targets on the right, and use low-curvature branch paths so the fan-out is unmistakable without looking decorative. Put the upper branch label above its path and the lower branch label below its path.
- Use `direction: "forward"` for outbound traffic and `direction: "return"` for responses/errors. Parallel tracks are mandatory for opposite directions.
- Keep labels short and behavioral: `讀取 Profile`, `查詢資料`, `回傳 Profile`, `拒絕存取`.
- Use blue for requests/loading, orange for processing/query, green for success/response, and red for failure. Keep the canvas and cards neutral.
- Use `blocked` for a service that the request never reached; use `running` only for the card processing the active step.
- Keep logos 24–32px, preserve aspect ratio, and never recolor brand assets.

## Resources

- [references/board-schema.md](references/board-schema.md): JSON contract and validation rules.
- [references/logo-mcp.md](references/logo-mcp.md): MCP tools, fallback chain, and local asset workflow.
- [references/logo-sources.md](references/logo-sources.md): bundled logo provenance and trademark notes.
- [references/rendering-stack.md](references/rendering-stack.md): renderer, animation, and UI-icon implementation.
- `assets/example-board.json`: smallest complete Before/After configuration to copy and edit.
- `assets/fanout-board.json`: single-source/two-target regression fixture for curved branch layout.
- `assets/logos/`: offline Firebase, Firestore, and Cloud Run fallbacks.
- `scripts/behavior-debug-board.mjs`: validate, hash-prepare, launch, wait, and open the board.
- `scripts/qa-board.mjs`: fast/full Playwright QA, structured report, and magic-byte-safe screenshot capture.

## Output Format

Return:

```text
Board: <absolute config path>
URL: http://localhost:<port>/?config=<sha256>
Opened: Codex browser | system browser
Flows: Before <node/edge counts>; After <node/edge counts>
Logos: <service → local SVG → source>
QA: <fast|full> pass · <report path> · <screenshot path and MIME>
```

When blocked, state whether the failure is invalid config, missing runtime dependencies, unavailable Logo MCP/network, occupied port, or unhealthy local server.
