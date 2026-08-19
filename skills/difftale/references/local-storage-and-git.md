# Local storage and Git

Local persistence is mandatory; Git is an upfront user choice. Git always means local commits first and never implies a push.

## Choice gate

If the request does not already state a preference, ask this before gathering the debug story or writing files, then stop the turn:

```text
要讓這張 Board 使用 Git 版本控制嗎？所有內容都會先存在本機，不會自動上傳。

1. Git 版控（推薦）— 存進目前專案，由我建立／使用 feature branch、驗證並 commit
2. 只存本機 — 存在本機專案資料夾，不建立 commit，之後仍可轉成 Git 版控
3. 取消 — 這次不建立 Board
```

## Storage modes

### Git tracked

Store a self-contained bundle under the current Git root:

```text
.difftale/boards/<slug>/
├── board.json
└── assets/
    └── <brand>.svg
```

- If the current branch is the default branch, create `codex/board-<slug>` before writing.
- Save and QA before committing.
- Stage only the bundle and any intentionally changed documentation. Never use `git add -A`.
- Commit a coherent board revision, for example `board(firebase-rules): explain successful access path`.
- Before committing, force-save from the Board, wait until the save status is `saved`, and confirm the canonical `board.json` hash stays stable through the one-second auto-save window. If it changes after a commit, QA the new hash before amending.
- A named version created from the Board UI or version CLI is this same local commit; do not maintain duplicate snapshot files in Git mode.
- Do not push or open a PR unless the user explicitly requests it.
- Preserve unrelated dirty files.

If no Git root exists, ask one follow-up choice: initialize Git in the explicitly resolved project directory, switch to local-only storage, or cancel. Never initialize Git in a home directory or another broad unresolved path.

### Local only

Store the same bundle outside Git:

```text
~/.difftale/projects/<project-id>/boards/<slug>/
├── board.json
├── assets/
└── .versions/
```

Derive `<project-id>` from the project path plus a short hash so projects with the same folder name do not collide. Report the absolute path. Do not use a temporary directory.

## Persistence boundary

Persist:

- flow and service-card copy;
- screen-card copy, route, frame, and immutable screenshot asset path;
- service, group, label, and playback-card positions;
- directional edges and timeline steps;
- canvas text, notes, shapes, and custom edges;
- board-local screenshots, logo SVGs, and their provenance notes.

Do not persist transient renderer state:

- current playback step, loading animation, selections, or hover state;
- current viewport pan/zoom;
- hash-addressed `public/runtime/` files;
- QA screenshots and reports unless the user explicitly wants artifacts tracked.

Never copy a user's Board bundle, screenshots, product/repository names, source paths, raw code/logs, private URLs, or identifiers back into the reusable `skills/difftale/` package, its fixtures, tests, or public docs. Git mode tracks the user's own bundle in their selected project only; it does not make that content part of Difftale itself.

The local Save Bridge binds to `127.0.0.1`, requires a random session token, validates the full document, uses a base hash to reject stale writes, and atomically replaces only the resolved source `board.json`. It is detached from the launcher/Codex task lifecycle, stays alive through authenticated browser heartbeats, and closes after an idle timeout. Always open the exact launcher-provided `BOARD_URL`; removing `save` or `saveToken` intentionally makes the Board read-only.
The board auto-saves after one second of inactivity; the Save button and `Cmd/Ctrl+S` force an immediate save.
Auto-save updates only `board.json`; it never creates a named version. The user explicitly creates versions from the version panel or version CLI. Read [version-history.md](version-history.md) before comparing or restoring.
