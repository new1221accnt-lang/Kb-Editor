# KB EDITOR

A Photopea-class, Photoshop-compatible image editor that runs entirely in the browser.
Real PSD/PSB engine included — open, edit and save genuine Photoshop files. Free,
private (files never leave your device) and mobile friendly.

**Website name:** KB EDITOR · **Engine:** [ag-psd](https://github.com/Agamnentzar/ag-psd) (MIT), bundled into `js/vendor/ag-psd.bundle.mjs`

## Run it

No build step is required to use the app — it is a static site.

```bash
npm run serve          # serves ./ on 0.0.0.0:8080
# then open http://localhost:8080/
```

Any static file server works (`npx http-server`, nginx, GitHub Pages…). Do **not** open
`index.html` via `file://` — ES modules require http(s).

For a zero-dependency, offline-capable artifact, build the single-file version instead:

```bash
npm run build:standalone   # writes kb-editor-standalone.html (all CSS/JS inlined, ~530 KB)
```

`kb-editor-standalone.html` runs from `file://` on any phone/PC with no server — handy when
the preview proxy is not reachable. Verified by the same boot test:
`node test/smoke.test.mjs --standalone`.

## Features

- **Real PSD engine** — `.psd` / `.psb` open **and** save with layers, layer groups, layer
  masks, blend modes, opacity, visibility and trimmed layer bounds. A flattened composite
  preview is embedded in saved files, so they open correctly everywhere.
- **Raster editing** — move, brush, eraser, eyedropper, gradient, paint bucket, text, shapes, fill/stroke.
- **Selections** — rectangular, elliptical, lasso, quick selection (magic wand),
  select-all / deselect / invert, feathered edges; everything is selection-aware.
- **Adjustments** — Levels, Curves, Brightness/Contrast, Hue/Saturation, and more, applied
  through LUTs where applicable.
- **Filters** — blur, sharpen, noise, convolution matrix, etc. (live preview).
- **Layers & history** — unlimited thumbnails panel, per-step history with click-to-jump,
  huge undo depth (pixel-accurate snapshots, capped for memory safety).
- **Responsive & touch** — desktop, tablet and phone layouts. On phones the tool rail moves
  to a bottom bar, panels become a slide-in drawer (floating layers button, bottom-right),
  and tap targets + system font scaling are respected.
- **Clipboard** — internal copy/cut/paste (Ctrl/⌘+C/X/V) plus paste of images from the
  system clipboard; works inside and across KB EDITOR tabs.

## Development

```bash
npm install            # dev tooling (esbuild, jsdom, @napi-rs/canvas for Node tests)
npm run check          # bundle-check the app graph with esbuild
npm test               # engine roundtrip tests + full jsdom smoke test (boots the real UI)
npm run build:vendor   # rebuild js/vendor/ag-psd.bundle.mjs from node_modules
```

`npm test` runs three suites:

| Suite | What it proves |
| --- | --- |
| `test/roundtrip.test.mjs` | Real `.psd` write → read roundtrip: layer names, blend mode, opacity, visibility, masks, pixel fidelity; LUT math; HSL↔RGB; convolution. |
| `test/smoke.test.mjs` | Full app boot in jsdom with a native canvas backend: boot, brush painting onto the active layer, undo/redo pixel restore, selections, menu bar, PSD save → reopen roundtrip, new document, viewport zoom. |
| `test/flows.test.mjs` | Feature flows end-to-end: layers (create/duplicate/opacity/blend/order/delete), masks, selection-aware fill, gradient tool, paint bucket, filters/adjustments, internal clipboard copy/paste, rotate/flip, PNG/JPEG/WebP export. |

## Layout

```
index.html            app shell (topbar, tool rail, dock, status bar, hidden pickers)
css/style.css         dark Photopea-style theme + responsive breakpoints (1150/900/700/420px)
js/app.js             boot + wiring + keyboard shortcuts
js/document.js        document model, layers, undo history, blend-mode mapping
js/psd.js             read/write genuine .psd files (ag-psd)
js/render.js          viewport, checkerboard compositor, rulers, pan/zoom/fit
js/tools.js           every tool (move/brush/selections/fill/type/shape/…)
js/panels.js          layers/history panels, options bar, toasts, status bar
js/dialogs.js         all modal dialogs (new document, adjustments, curves, …)
js/filters.js         convolution engine + named filters
js/adjustments.js     LUTs, curves, hue/sat math
js/selection.js       selection alpha-mask engine (feather-aware)
js/pixelutil.js       pixel helpers   · js/state.js shared UI state   · js/util.js helpers
js/vendor/ag-psd.bundle.mjs   prebuilt ag-psd (MIT)
```

## Notes & limits

- PSD **open** supports what ag-psd supports: 8-bit RGB(A) documents with layers,
  groups (flattened on import), masks and the standard blend modes. Smart objects,
  adjustment layers and vector paths are rasterized or skipped with a notice, never silently corrupted.
- Save writes 8-bit RGB PSDs. Very large documents are refused with a clear toast
  (30 MP pixel cap) to protect the tab from OOM.
- Everything is client-side. There is no server, no account and no telemetry.
- Inspired by the PhotoCraft open-source project. KB EDITOR ships no PhotoCraft binaries;
  the PSD implementation is ag-psd.
