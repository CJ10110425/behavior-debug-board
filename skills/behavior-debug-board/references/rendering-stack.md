# Rendering stack

- Canvas and graph state: `@xyflow/react` (React Flow / XYFlow).
- UI runtime: React 19 with Vinext and Vite.
- Edge geometry: React Flow `getStraightPath`; forward and return traffic use separate handles and separate edge records.
- Edge-label layout: adjacent service-card gaps expand from the longest label estimate plus a safety margin; browser QA rejects any remaining label/card bounding-box intersection.
- Packet motion: native SVG `<animateMotion>` on a grouped halo and dot.
- Loading state: CSS spinner inside the active service card.
- Infinite board: React Flow pan/zoom, dotted `Background`, fit-view, draggable nodes, and movable parent groups.
- UI icons: local Lucide SVG masks from `lucide-static`.
- Brand assets: local raw SVG files resolved through theSVG MCP/registry, preserving official colors.
- Runtime config: validated canonical JSON written to ignored `public/runtime/<sha256>.json`, then fetched from `?config=<sha256>` and verified again in the browser.
- Render readiness: `data-board-ready="true"` is set only after config verification, React Flow initialization, fit-view, fonts/images, and two animation frames.
- Browser QA: Playwright fast mode verifies the exact config hash plus rendered counts and screenshot; `--full` additionally tests replay, loading, drag, zoom, and fit-view.

This skill does not render `.tldr` JSON. Its visual language is tldraw-like, but the interactive implementation is React Flow because it needs live playback, independent directional tracks, node state, and browser-local controls.
