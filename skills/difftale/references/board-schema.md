# Board JSON schema

The renderer accepts versions `1` and `2` for service-only Boards. Version `3` adds screenshot screen nodes and remains compatible with persisted canvas data. A board contains exactly two flows: `before` and `after`.

```json
{
  "version": 3,
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

- `kind`: `client`, `rules`, `database`, `service`, or `screen`.
- `logo`: optional board-local `assets/*.svg` path. Bundled `/logos/*.svg` paths remain supported for legacy fixtures. Never hotlink runtime logos.
- `categoryIcon`: use only when no trustworthy brand logo can be found. Valid values are `web-app`, `mobile-app`, `api`, `database`, `auth`, `storage`, `compute`, `payment`, `analytics`, `messaging`, `network`, `security`, `cloud`, `queue`, `webhook`, `ai`, and `service`.
- Set either `logo` or `categoryIcon`, never both. When both are omitted, the renderer derives a generic icon from `kind`.
- `changed`: mark the behavior-changing service in the After flow.
- Use 2–5 unique visual nodes per flow.

### Screenshot screen node

```json
{
  "id": "dashboard",
  "title": "任務大廳",
  "subtitle": "登入後看見可加入的世界",
  "detail": "新的主要入口",
  "kind": "screen",
  "screenshot": "assets/screens/after-dashboard-a82f61c2.png",
  "frame": "browser",
  "route": "/zh-tw/",
  "changed": true
}
```

- Screen nodes require Board version `3` and a board-local PNG, JPEG, or WebP screenshot.
- `frame` may be `browser`, `mobile`, or `app`.
- Screen nodes do not use `logo` or `categoryIcon`.
- Treat screenshot paths as immutable. Write a new filename when the captured pixels change.

## Canvas persistence

Versions 2 and 3 may persist free canvas items and user-created edges:

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
node skills/difftale/scripts/difftale.mjs validate --config /absolute/path/board.json
```

The validator rejects unknown nodes, duplicate directional routes, missing statuses, invalid active-step indices, external logo URLs, self-links, and malformed Before/After structure.
