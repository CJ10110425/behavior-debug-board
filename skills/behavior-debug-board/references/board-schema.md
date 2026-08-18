# Board JSON schema

Use version `1`. A board contains exactly two flows: `before` and `after`.

```json
{
  "version": 1,
  "title": "Profile permission failure",
  "flows": [
    {
      "id": "before",
      "label": "Before",
      "outcome": "error",
      "position": { "x": 150, "y": 55 },
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
  "kind": "rules",
  "logo": "/logos/firebase.svg",
  "changed": true
}
```

- `kind`: `client`, `rules`, `database`, or `service`.
- `logo`: optional local `/logos/*.svg` path. Do not hotlink runtime logos.
- `categoryIcon`: use only when no trustworthy brand logo can be found. Valid values are `web-app`, `mobile-app`, `api`, `database`, `auth`, `storage`, `compute`, `payment`, `analytics`, `messaging`, `network`, `security`, `cloud`, `queue`, `webhook`, `ai`, and `service`.
- Set either `logo` or `categoryIcon`, never both. When both are omitted, the renderer derives a generic icon from `kind`.
- `changed`: mark the behavior-changing service in the After flow.
- Use 2–5 unique nodes per flow.

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
