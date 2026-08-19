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
  "subtitle": "Decides whether a request may pass",
  "detail": "Allows users to access only their own data",
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
  "title": "World lobby",
  "subtitle": "Available worlds after sign-in",
  "detail": "The new primary entry point",
  "kind": "screen",
  "screenshot": "assets/screens/after-dashboard-a82f61c2.png",
  "frame": "browser",
  "route": "/lobby/",
  "changed": true
}
```

- Screen nodes require Board version `3` and a board-local PNG, JPEG, or WebP screenshot.
- `frame` may be `browser`, `mobile`, or `app`. Determine it from explicit user context, project layout/platform code, and the captured viewport before falling back to image dimensions. Ambiguous evidence requires user confirmation.
- Screen nodes do not use `logo` or `categoryIcon`.
- Treat screenshot paths as immutable. Write a new filename when the captured pixels change.
- The renderer keeps screen copy compact. Mobile frames display only the editable title and one-line description around the device frame; `detail` remains available for semantic diff and playback context.

## Canvas persistence

Versions 2 and 3 may persist free canvas items and user-created edges:

```json
{
  "canvas": {
    "items": [
      { "id": "canvas-note-1", "type": "note", "position": { "x": 520, "y": 320 }, "text": "Confirm Rules are deployed" }
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
  "label": "Return profile",
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
  "title": "Access allowed",
  "reason": "The signed-in user owns the document",
  "note": "Rules allow this profile read.",
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
