---
name: difftale
description: Create, persist, semantically diff, restore, optionally Git-version, and open a local animated Before/After story of what changed across app screenshots, user flows, and service behavior. Use for UI or UX changes, web/mobile screen flows, visual changelogs, vibe-coded app reviews, bugs, permission failures, request/response paths, or requests to save, compare, commit, or restore a visual Board.
---

# Difftale

Turn product-change evidence into a local, editable, replayable visual story. The renderer is the bundled React Flow app; do not generate a `.tldr` file for this workflow.

## Contract

Guarantee all of the following:

- Represent both `Before` and `After` on one infinite white canvas.
- Treat an app/web/mobile screenshot as a first-class `screen` node that can connect to user actions and service nodes. Never reduce a screen flow to an attachment inside a service card.
- Classify every screen as `mobile`, `browser`, or `app` from the strongest available evidence: explicit user statement, project layout/platform code, then screenshot geometry. Ask the user when evidence conflicts or remains ambiguous; never silently default an uncertain screen to desktop web.
- Give every direction its own edge. Never reuse one geometric line for request and response.
- Render every edge, arrowhead, and label before playback starts. Playback only highlights an existing edge and moves its packet.
- Keep every service or screen card title and description directly editable on the canvas, and preserve edits while playback changes card status.
- Persist the full semantic board, screenshots, canvas items, layout, and logo assets to an explicit local bundle. Browser memory or `localStorage` is never the sole copy.
- Ask whether to use Git before creating files unless the user already chose. Git mode includes safe local branch/commit work but never implies push or PR permission.
- Keep Board revision history separate from the `Before` / `After` behavior inside a debug story. Compare revisions semantically as added, removed, changed, or moved entities instead of exposing JSON line diffs.
- Require explicit confirmation before restore, reject stale source hashes, create a safety snapshot in local-only mode, and reload the canvas session after a successful restore.
- Reserve enough horizontal space for the longest directional label between adjacent cards; edge labels must never overlap service cards in the initial fitted layout.
- Describe behavior, cause, and user-visible result. Do not expose commit hashes or code diffs unless requested.
- Preserve official brand colors and store fetched SVGs locally for offline use.
- Store screenshots as immutable board-local PNG, JPEG, or WebP assets. Use a new filename when the pixels change so semantic revision history can identify the changed screen.
- Keep the reusable skill package generic. Never copy a user's product, company, repository, branch, source filename/path, raw code/log, private URL, identifier, or screenshot into `skills/difftale/`, renderer fixtures, tests, or public documentation. Keep user-specific evidence only in the selected local Board bundle.
- Default Board copy to role-based names and behavioral summaries. Mention a user's own product name, source filename, or raw implementation detail only when the user explicitly asks; verified third-party service names and logos are allowed when they materially explain the flow.
- Keep the reusable skill, public documentation, bundled fixtures, CLI output, and default Board UI English-first. Preserve Traditional Chinese as the secondary documentation and `?lang=zh-TW` UI. Write private Board story content in the user's language when it is known.
- Load each generated board from an immutable SHA-256 runtime URL; never overwrite a tracked app fixture.
- Treat `BOARD_SERVER_READY` as transport readiness only. Completion requires `BOARD_RENDERED` and `BOARD_QA_PASS` from browser QA.
- Open and hand off the exact `BOARD_URL` printed by the launcher, including `config`, `save`, and `saveToken`. Never reconstruct, shorten, or strip its query parameters; a config-only URL is read-only and must show a blocking warning.
- Start localhost, wait for a healthy response, and open the board for the user. Producing JSON without opening the board is incomplete.

## Workflow

1. Read [references/local-storage-and-git.md](references/local-storage-and-git.md). If the request does not already state a storage preference, present its Git/local-only choice gate and stop. Do not gather content or write files until the user answers.
2. Resolve the storage bundle from the answer. In Git mode, create/use a feature branch and preserve unrelated changes. In local-only mode, use the durable per-project directory; never use `/tmp`.
3. Gather the user-visible Before/After journey, relevant screens, user actions, services, root cause or product intent, and verified result. Treat inspected project code, filenames, logs, identifiers, and private URLs as ephemeral evidence: translate them into roles and behavior instead of copying them into the Board or skill package.
4. When screens matter, read [references/screenshots.md](references/screenshots.md). Inspect the target project's layout/platform code and capture viewport before classifying the frame. Use screenshot dimensions only after code evidence; ask the user if the result is ambiguous. Capture or copy each required state into `assets/screens/`, then model it as a `kind: "screen"` node. A screen-to-screen navigation and a screen-to-service request are both normal directional edges.
5. Read [references/board-schema.md](references/board-schema.md), then write `board.json` inside the resolved local bundle.
6. For named products, read [references/logo-mcp.md](references/logo-mcp.md). Try the Logo MCP first, then search the web for an official brand/media asset and trusted registries. Save trustworthy SVGs under the bundle's `assets/` directory and record their source. If no reliable logo exists, use a category icon; never invent a brand mark.
7. Before renderer QA, verify Node.js `>=22.13.0`; if the shell is older, use the Codex bundled runtime, nvm, Volta, or another installed compatible Node. Then run the fast browser QA. The CLI also fails early with an actionable version error before starting the renderer. QA validates the config, copies local assets into the immutable runtime, chooses/reuses a port, waits for React Flow hydration/layout/fit-view, verifies node/edge/label and screenshot counts, opens the selected flow at its final step, and writes a correctly typed screenshot plus JSON report:

   ```bash
   node skills/difftale/scripts/difftale.mjs qa \
     --config /absolute/path/to/board.json \
     --port auto \
     --flow after \
     --final-step \
     --screenshot /absolute/path/to/result.jpg
   ```

8. Use `--full` when changing the renderer itself. Full QA additionally exercises local save, replay, loading, drag, zoom, fit-view, and detected fan-out layout.
9. Launch the local board for the user. Pass the selected storage mode. The launcher starts a token-protected localhost Save Bridge, so canvas edits and `Cmd+S` update the source `board.json`:

   ```bash
   node skills/difftale/scripts/difftale.mjs launch \
     --config /absolute/path/to/board.json \
     --storage git \
     --port auto
   ```

10. If a Codex in-app browser tool is available, pass `--no-open`, wait for `BOARD_SERVER_READY`, then open the launcher output's complete `BOARD_URL` verbatim in that browser. Preserve the `config`, `save`, and `saveToken` query parameters. Otherwise let the launcher open the system browser.
11. When the user asks to save a version, compare, list history, or restore, read [references/version-history.md](references/version-history.md) and use the bundled version script. A named Git version is a local commit of only the Board bundle; a named local-only version is an immutable `.versions/` snapshot including referenced assets.
12. In Git mode, re-run QA before the final named version, force-save the Board, wait for `data-save-state="saved"`, and verify the Board source hash remains unchanged across the auto-save settling window before committing. Inspect `git status` and the exact Board diff, and preserve unrelated staged or unstaged changes. If the source changes after a commit, re-run QA before amending. Do not push without a separate explicit request.
13. Report the local source path, storage mode, revision ID when created or restored, Git branch/status when applicable, QA report, and screenshot. A screenshot captured before `data-board-ready="true"` is invalid.

## Diagram Rules

- Use 2–5 visual nodes per flow. Mix `screen` and service nodes when it explains the user journey. Keep linear peers on one horizontal band. For one service source with exactly two outbound targets, place the source on the left, stack both targets on the right, and use low-curvature branch paths so the fan-out is unmistakable without looking decorative. Put the upper branch label above its path and the lower branch label below its path.
- Use `direction: "forward"` for outbound traffic and `direction: "return"` for responses/errors. Parallel tracks are mandatory for opposite directions.
- Keep labels short and behavioral: `Read profile`, `Query data`, `Return profile`, `Deny access`.
- Use blue for requests/loading, orange for processing/query, green for success/response, and red for failure. Keep the canvas and cards neutral.
- Use `blocked` for a service that the request never reached; use `running` only for the card processing the active step.
- Keep logos 24–32px, preserve aspect ratio, and never recolor brand assets.
- Render browser screenshots in a browser frame, mobile screenshots in a narrow phone frame, and desktop/native app screenshots in an app frame. Mobile is the primary screen presentation: keep only an editable short title and one-line description around the device frame. Preserve readable content and never crop away the changed state.

## Resources

- [references/board-schema.md](references/board-schema.md): JSON contract and validation rules.
- [references/screenshots.md](references/screenshots.md): screenshot capture, immutable naming, screen-node modeling, and privacy rules.
- [references/logo-mcp.md](references/logo-mcp.md): MCP tools, fallback chain, and local asset workflow.
- [references/logo-sources.md](references/logo-sources.md): bundled logo provenance and trademark notes.
- [references/rendering-stack.md](references/rendering-stack.md): renderer, animation, and UI-icon implementation.
- [references/local-storage-and-git.md](references/local-storage-and-git.md): mandatory local persistence, first-turn Git choice, safe branch/commit rules, and tracked bundle layout.
- [references/version-history.md](references/version-history.md): named revisions, semantic diff categories, Git/local storage, CLI commands, and restore safety.
- `assets/example-board.json`: smallest complete Before/After configuration to copy and edit.
- `assets/fanout-board.json`: single-source/two-target regression fixture for curved branch layout.
- `assets/logos/`: offline Firebase, Firestore, and Cloud Run fallbacks.
- `scripts/difftale.mjs`: validate, hash-prepare, launch, wait, and open Difftale.
- `scripts/qa-board.mjs`: fast/full Playwright QA, structured report, and magic-byte-safe screenshot capture.
- `scripts/board-version.mjs`: list, create, semantically diff, and restore Board revisions.
- `scripts/board-version-store.mjs`: deterministic local/Git revision engine shared by the CLI and Save Bridge.

## Output Format

Return:

```text
Board: <absolute config path>
Storage: Git tracked <branch/status> | local only
URL: <complete BOARD_URL including config, save, and saveToken>
Opened: Codex browser | system browser
Flows: Before <node/edge counts>; After <node/edge counts>
Screens: <screen → local image → route/state>
Logos: <service → local SVG → source>
QA: <fast|full> pass · <report path> · <screenshot path and MIME>
Version: <created|compared|restored revision id and semantic summary, when requested>
```

When blocked, state whether the failure is invalid config, missing runtime dependencies, unavailable Logo MCP/network, occupied port, or unhealthy local server.
