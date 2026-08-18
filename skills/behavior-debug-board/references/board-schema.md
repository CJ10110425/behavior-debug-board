# Board JSON schema

The renderer accepts version `1` fixtures and saves editable boards as version `2`. A board contains exactly two flows: `before` and `after`.

```json
{
  "version": 2,
  "title": "Profile permission failure",
  "flows": [
    {
      "id": "before",
      "label": "Before",
      "outcome": "error",
      "position": { "x": 150, "y": 55 },
      "labelPosition": { "x": 36, "y": 18 },
      "playbackPosition": { "x": 140, "y": 252 },
      "nodes": [],
      "edges": [],
      "steps": []
    },
    {
      "id": "after",
      "label": "After",
      "outcome": "success",
      "position": { "x": 150, "y": 505 },
      "nodes": [],
      "edges": [],
      "steps": []
    }
  ]
}
```

## Node

```json
{
  "id": "rules",
  "title": "Firebase Rules",
  "subtitle": "決定請求能不能通過",
  "detail": "只允許本人存取自己的資料",
  "position": { "x": 410, "y": 78 },
  "kind": "rules",
  "logo": "assets/firebase.svg",
  "changed": true
}
```

- `kind`: `client`, `rules`, `database`, or `service`.
- `logo`: optional board-local `assets/*.svg` path. Bundled `/logos/*.svg` paths remain supported for legacy fixtures. Never hotlink runtime logos.
- `categoryIcon`: use only when no trustworthy brand logo can be found. Valid values are `web-app`, `mobile-app`, `api`, `database`, `auth`, `storage`, `compute`, `payment`, `analytics`, `messaging`, `network`, `security`, `cloud`, `queue`, `webhook`, `ai`, and `service`.
- Set either `logo` or `categoryIcon`, never both. When both are omitted, the renderer derives a generic icon from `kind`.
- `changed`: mark the behavior-changing service in the After flow.
- Use 2–5 unique nodes per flow.

## Canvas persistence

Version 2 may persist free canvas items and user-created edges:

```json
{
  "canvas": {
    "items": [
      { "id": "canvas-note-1", "type": "note", "position": { "x": 520, "y": 320 }, "text": "確認 Rules 已部署" }
    ],
    "edges": [
      { "id": "canvas-edge-1", "source": "after-rules", "target": "canvas-note-1" }
    ]
  }
}
```

Valid item types are `text`, `note`, and `shape`. Service-node endpoints use rendered ids such as `before-client` and `after-rules`. Playback state, selection, pan, and zoom are transient and are not part of the saved document.

## Edge

```json
{
  "id": "database-rules",
  "source": "database",
  "target": "rules",
  "direction": "return",
  "label": "回傳 Profile",
  "semantic": "response",
  "activeSteps": [5]
}
```

- `direction`: `forward` or `return`.
- `semantic`: `request`, `query`, `response`, or `error`.
- Opposite directions must be separate edge records with different ids and endpoints.
- All edges and labels are visible at step 0. `activeSteps` only controls color and packet motion.
- Set `muted: true` for a possible path that was never reached.

## Step

```json
{
  "title": "權限通過",
  "reason": "登入者與資料擁有者相同",
  "note": "Rules 允許這次 Profile 讀取。",
  "nodeStatuses": {
    "client": "idle",
    "rules": "running",
    "database": "idle"
  }
}
```

Every step must provide a status for every node. Valid statuses: `idle`, `running`, `success`, `error`, `blocked`.

## Validation

```bash
node skills/behavior-debug-board/scripts/behavior-debug-board.mjs validate --config /absolute/path/board.json
```

The validator rejects unknown nodes, duplicate directional routes, missing statuses, invalid active-step indices, external logo URLs, self-links, and malformed Before/After structure.
