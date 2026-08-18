---
name: behavior-debug-board
description: Create, persist, semantically diff, restore, optionally Git-version, and open a local animated before/after debugging board with service cards, directional request/response lines, brand logos, loading states, replay controls, and revision history. Use for visualizing bugs, debug flows, behavior diffs, permission failures, request/response paths, local whiteboards, or requests to save, list versions, compare, commit, or restore a behavior board.
---

# Behavior Debug Board

Turn debugging evidence into a local, editable, replayable behavior diagram. The renderer is the bundled React Flow app; do not generate a `.tldr` file for this workflow.

## Contract

Guarantee all of the following:

- Represent both `Before` and `After` on one infinite white canvas.
- Give every direction its own edge. Never reuse one geometric line for request and response.
- Render every edge, arrowhead, and label before playback starts. Playback only highlights an existing edge and moves its packet.
- Keep every service card title and description directly editable on the canvas, and preserve edits while playback changes card status.
- Persist the full semantic board, canvas items, layout, and logo assets to an explicit local bundle. Browser memory or `localStorage` is never the sole copy.
- Ask whether to use Git before creating files unless the user already chose. Git mode includes safe local branch/commit work but never implies push or PR permission.
- Keep Board revision history separate from the `Before` / `After` behavior inside a debug story. Compare revisions semantically as added, removed, changed, or moved entities instead of exposing JSON line diffs.
- Require explicit confirmation before restore, reject stale source hashes, create a safety snapshot in local-only mode, and reload the canvas session after a successful restore.
- Reserve enough horizontal space for the longest directional label between adjacent cards; edge labels must never overlap service cards in the initial fitted layout.
- Describe behavior, cause, and user-visible result. Do not expose commit hashes or code diffs unless requested.
- Preserve official brand colors and store fetched SVGs locally for offline use.
- Load each generated board from an immutable SHA-256 runtime URL; never overwrite a tracked app fixture.
- Treat `BOARD_SERVER_READY` as transport readiness only. Completion requires `BOARD_RENDERED` and `BOARD_QA_PASS` from browser QA.
- Start localhost, wait for a healthy response, and open the board for the user. Producing JSON without opening the board is incomplete.

## Workflow

1. Read [references/local-storage-and-git.md](references/local-storage-and-git.md). If the request does not already state a storage preference, present its Git/local-only choice gate and stop. Do not gather content or write files until the user answers.
2. Resolve the storage bundle from the answer. In Git mode, create/use a feature branch and preserve unrelated changes. In local-only mode, use the durable per-project directory; never use `/tmp`.
3. Gather the bug symptom, actors/services, observed path, root cause, fix, and verified result.
4. Read [references/board-schema.md](references/board-schema.md), then write `board.json` inside the resolved local bundle.
5. For named products, read [references/logo-mcp.md](references/logo-mcp.md). Try the Logo MCP first, then search the web for an official brand/media asset and trusted registries. Save trustworthy SVGs under the bundle's `assets/` directory and record their source. If no reliable logo exists, use a category icon; never invent a brand mark.
6. Run the fast browser QA. This validates the config, chooses/reuses a port, waits for React Flow hydration/layout/fit-view, verifies node/edge/label counts, opens the selected flow at its final step, and writes a correctly typed screenshot plus JSON report:

   ```bash
   node skills/behavior-debug-board/scripts/behavior-debug-board.mjs qa \
     --config /absolute/path/to/board.json \
     --port auto \
     --flow after \
     --final-step \
     --screenshot /absolute/path/to/result.jpg
   ```

7. Use `--full` when changing the renderer itself. Full QA additionally exercises local save, replay, loading, drag, zoom, fit-view, and detected fan-out layout.
8. Launch the local board for the user. Pass the selected storage mode. The launcher starts a token-protected localhost Save Bridge, so canvas edits and `Cmd+S` update the source `board.json`:

   ```bash
   node skills/behavior-debug-board/scripts/behavior-debug-board.mjs launch \
     --config /absolute/path/to/board.json \
     --storage git \
     --port auto
   ```

9. If a Codex in-app browser tool is available, pass `--no-open`, wait for `BOARD_SERVER_READY`, then open the printed hash-addressed `BOARD_URL` in that browser. Otherwise let the launcher open the system browser.
10. When the user asks to save a version, compare, list history, or restore, read [references/version-history.md](references/version-history.md) and use the bundled version script. A named Git version is a local commit of only the Board bundle; a named local-only version is an immutable `.versions/` snapshot.
11. In Git mode, re-run QA before the final named version, inspect `git status` and the exact Board diff, and preserve unrelated staged or unstaged changes. Do not push without a separate explicit request.
12. Report the local source path, storage mode, revision ID when created or restored, Git branch/status when applicable, QA report, and screenshot. A screenshot captured before `data-board-ready="true"` is invalid.

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
- [references/local-storage-and-git.md](references/local-storage-and-git.md): mandatory local persistence, first-turn Git choice, safe branch/commit rules, and tracked bundle layout.
- [references/version-history.md](references/version-history.md): named revisions, semantic diff categories, Git/local storage, CLI commands, and restore safety.
- `assets/example-board.json`: smallest complete Before/After configuration to copy and edit.
- `assets/fanout-board.json`: single-source/two-target regression fixture for curved branch layout.
- `assets/logos/`: offline Firebase, Firestore, and Cloud Run fallbacks.
- `scripts/behavior-debug-board.mjs`: validate, hash-prepare, launch, wait, and open the board.
- `scripts/qa-board.mjs`: fast/full Playwright QA, structured report, and magic-byte-safe screenshot capture.
- `scripts/board-version.mjs`: list, create, semantically diff, and restore Board revisions.
- `scripts/board-version-store.mjs`: deterministic local/Git revision engine shared by the CLI and Save Bridge.

## Output Format

Return:

```text
Board: <absolute config path>
Storage: Git tracked <branch/status> | local only
URL: http://localhost:<port>/?config=<sha256>
Opened: Codex browser | system browser
Flows: Before <node/edge counts>; After <node/edge counts>
Logos: <service → local SVG → source>
QA: <fast|full> pass · <report path> · <screenshot path and MIME>
Version: <created|compared|restored revision id and semantic summary, when requested>
```

When blocked, state whether the failure is invalid config, missing runtime dependencies, unavailable Logo MCP/network, occupied port, or unhealthy local server.
