# Screenshot nodes

Use screenshot nodes when the change is visible in an app, web app, or mobile flow. A screenshot is a semantic flow participant, not decoration.

## Capture

- Prefer a real local/staging page at the exact state being explained.
- Capture a stable viewport after fonts, images, loading, and layout settle.
- Do not treat HTTP 200 or `networkidle` alone as visual readiness. Wait for a screen-specific heading, button, image, or explicit `data-*` readiness marker before capture; use a screenshot preview to reject blank or partially hydrated frames.
- Use PNG for UI text and line art; use JPEG or WebP only when photo-heavy content makes PNG wasteful.
- Remove or mask secrets, tokens, private messages, email addresses, and real customer data before saving.
- Save under `assets/screens/`. Never hotlink a runtime screenshot.
- Use immutable filenames such as `after-dashboard-a82f61c2.png`. If pixels change, create a new asset instead of overwriting the old file.

When browser automation is available, open the local app, navigate to the required state, verify the target UI element, DOM, and console, then capture the screenshot directly into the Board bundle. When automation is unavailable, copy a user-provided image into the same folder.

## Determine the frame

Use this evidence order before writing `frame`:

1. The user's explicit statement (`手機 App`, `手機版網頁`, `桌面網頁`, or `桌面 App`).
2. Project code and the actual screen layout:
   - React Native, Expo, Flutter, SwiftUI, UIKit, Jetpack Compose, or Android/iOS targets indicate `mobile` unless the user says otherwise.
   - Electron, Tauri, AppKit, or Windows desktop shells indicate `app`.
   - Next.js, Vite, Remix, or ordinary HTML/CSS indicate web, but responsive code still requires the captured viewport: inspect viewport metadata, breakpoint media queries, mobile navigation, and layout component names.
3. Screenshot dimensions:
   - a clear landscape image is usually `browser`;
   - a portrait image at phone-scale width is usually `mobile`;
   - square/tablet ratios, high-resolution portrait captures, and very tall full-page captures are ambiguous.
4. Ask the user when code, viewport, and dimensions disagree or remain ambiguous.

An explicit frame always wins over geometry. A responsive web page captured at a phone viewport uses `mobile`; the same route captured at a desktop viewport uses `browser`. The CLI fills a missing frame only for high-confidence dimensions and otherwise reports `frame needs user confirmation`.

## Model

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

- `kind` must be `screen` and requires Board schema version `3`.
- `screenshot` must be a board-local `.png`, `.jpg`, `.jpeg`, or `.webp` asset.
- `frame` is `browser`, `mobile`, or `app`. New Boards should store it explicitly after inference or confirmation; the renderer's browser fallback exists only for older embedded configs.
- `route` is the user-facing route, screen name, or app location—not a source-code path.
- Keep title and subtitle short enough to remain editable and readable on the canvas.
- Mobile cards show only that short editable title and one-line description around the phone frame; `detail` remains semantic Board data but is not rendered as another footer.

Connect screens with behavioral labels such as `點擊登入`, `送出邀請碼`, `完成排序`, or `進入任務大廳`. Connect screens to services only when that service interaction materially explains the observed change.

## Before / After

- Reuse the same semantic node id across Before and After when it is still the same product screen.
- Change the screenshot asset path when pixels or state change; Difftale will report it as an updated screen.
- Add or remove a screen node when the user journey truly gained or lost a state.
- Do not create one screen node per tiny animation frame. Capture meaningful decision, loading, error, and completion states.

## Versioning

Git mode commits the complete `.difftale/boards/<slug>/` bundle. Local-only mode snapshots `board.json` and every referenced local asset under `.versions/<revision>/`. Restore requires confirmation and restores the referenced screenshot assets with the Board.
