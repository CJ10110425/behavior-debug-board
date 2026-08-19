# Board version history

Board versions are a separate axis from the `Before` and `After` flows inside one debug story.

- `Before` / `After`: the system behavior that failed and the behavior after the fix.
- Board version: revisions to the saved explanation, layout, evidence, or flow model over time.

Never rename Board versions to Before/After or treat playback steps as revision history.

## Natural-language intents

Route these requests to the deterministic version scripts:

- “Save this version” → create a named revision.
- “Compare with the previous version” → semantic diff against the selected revision.
- “Restore the previous version” → restore after explicit confirmation.
- “List versions” → list local snapshots or Git commits.

Equivalent requests in the user's language should route the same way, including Traditional Chinese `存一下現在這版`, `跟上一版比較`, `回復上一版`, and `列出版本`.

Use:

```bash
npm run board:version -- list \
  --config /absolute/path/to/board.json \
  --storage local

npm run board:version -- create \
  --config /absolute/path/to/board.json \
  --storage git \
  --title "Behavior after fixing Firebase Rules"

npm run board:version -- diff \
  --config /absolute/path/to/board.json \
  --storage git \
  --revision git:<40-character-commit>

npm run board:version -- restore \
  --config /absolute/path/to/board.json \
  --storage local \
  --revision local:<revision-id>
```

## Storage behavior

### Git mode

- Each named version is a normal local Git commit.
- Stage and commit only `.difftale/boards/<slug>/`; accept `.behavior-debug-board/boards/<slug>/` only for legacy bundles.
- Preserve unrelated staged and unstaged work.
- Never push or open a PR without a separate explicit request.
- Restoring a Git revision writes its Board document into the working tree and leaves it uncommitted for review.

### Local-only mode

Store immutable snapshots next to the Board source:

```text
<board-bundle>/
├── board.json
├── assets/
└── .versions/
    ├── index.json
    └── <timestamp>-<sha256-prefix>/
        ├── board.json
        └── assets/
```

Before a restore, automatically snapshot the current Board as `Automatic backup before restore`.

## Semantic diff

Report behavior-level meaning rather than JSON line changes:

- `added`: screens, service cards, directional edges, canvas objects, or custom connections were added;
- `removed`: those entities were removed;
- `changed`: screenshots, screen routes, copy, direction, semantics, playback steps, statuses, or other behavior changed;
- `moved`: only layout position changed.

Keep content changes and movement separate even when both affect the same Card. Show concise labels and details; do not expose the raw JSON patch unless requested.

## Restore safety

- Require an explicit restore request or the on-screen two-step confirmation.
- Check the current source SHA before writing; reject stale restores.
- Validate the selected revision before replacing `board.json`.
- Replace the source atomically.
- Reload the entire canvas session after restore so controlled inputs and React Flow positions cannot retain stale state.
