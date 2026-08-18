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
- Describe behavior, cause, and user-visible result. Do not expose commit hashes or code diffs unless requested.
- Preserve official brand colors and store fetched SVGs locally for offline use.
- Start localhost, wait for a healthy response, and open the board for the user. Producing JSON without opening the board is incomplete.

## Workflow

1. Gather the bug symptom, actors/services, observed path, root cause, fix, and verified result.
2. Read [references/board-schema.md](references/board-schema.md), then write a version-1 board JSON file.
3. For named products, read [references/logo-mcp.md](references/logo-mcp.md). Try the Logo MCP first, then search the web for an official brand/media asset and trusted registries. Save a trustworthy SVG under `public/logos/` and record its source. If no reliable logo exists, classify the service and set `categoryIcon`; never invent a brand mark.
4. Validate and prepare the board:

   ```bash
   node skills/behavior-debug-board/scripts/behavior-debug-board.mjs prepare --config /absolute/path/to/board.json
   ```

5. Launch the local board:

   ```bash
   node skills/behavior-debug-board/scripts/behavior-debug-board.mjs launch --config /absolute/path/to/board.json --port 3001
   ```

6. If a Codex in-app browser tool is available, pass `--no-open`, wait for `BOARD_READY`, then open the printed `BOARD_URL` in that browser. Otherwise let the launcher open the system browser.
7. Verify that all cards, independent directional edges, labels, loading indicators, replay controls, drag behavior, zoom, and fit-view work.

## Diagram Rules

- Use 2–5 service nodes per flow and keep peer nodes on one horizontal band.
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
- `assets/logos/`: offline Firebase and Firestore fallbacks.
- `scripts/behavior-debug-board.mjs`: validate, prepare, launch, wait, and open the board.

## Output Format

Return:

```text
Board: <absolute config path>
URL: http://localhost:<port>/
Opened: Codex browser | system browser
Flows: Before <node/edge counts>; After <node/edge counts>
Logos: <service → local SVG → source>
```

When blocked, state whether the failure is invalid config, missing runtime dependencies, unavailable Logo MCP/network, occupied port, or unhealthy local server.
