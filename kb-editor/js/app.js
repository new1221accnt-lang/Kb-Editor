// KB EDITOR — boot and global command wiring.

import { $, $$, clamp } from './util.js';
import { Doc } from './document.js';
import { Render } from './render.js';
import { Selection } from './selection.js';
import { Tools, TOOLS } from './tools.js';
import { Panels } from './panels.js';
import { Menus } from './menus.js';
import { PSD } from './psd.js';
import { ClipboardOps } from './clipboard.js';
import { UI, swapColors, resetColors } from './state.js';
import { ICONS } from './icons.js';
import {
  newDocumentDialog, curvesDialog, hueSaturationDialog, shortcutsDialog, Dialog,
} from './dialogs.js';
import * as Filters from './filters.js';
import * as Adjust from './adjustments.js';

const canvas = $('#view');
const container = $('#canvasArea');

// ---------- build the tool rail ----------
const rail = $('#toolButtons');
for (const tool of TOOLS) {
  const btn = document.createElement('button');
  btn.className = 'tool-btn';
  btn.dataset.tool = tool.id;
  btn.title = tool.title;
  btn.setAttribute('aria-label', tool.name);
  btn.innerHTML = `${ICONS[tool.id] || ''}<span class="tool-key">${tool.key.replace('2', '')}</span>`;
  btn.addEventListener('click', () => Tools.set(tool.id));
  rail.appendChild(btn);
}

// ---------- subsystems ----------
Render.init(canvas, container, $('#rulerTop'), $('#rulerLeft'), $('#rulerCorner'));
Panels.init();
Tools.init(canvas);
Panels.bindCropHandlers(() => Tools.applyCrop(), () => Tools.cancelCrop());
Menus.init();

// Document → UI plumbing (crop/resize changes selection size too)
let lastDims = { w: Doc.state.width, h: Doc.state.height };
Doc.onChange(() => {
  Render.markDirty();
  if (Doc.state.width !== lastDims.w || Doc.state.height !== lastDims.h) {
    lastDims = { w: Doc.state.width, h: Doc.state.height };
    Selection.setDocSize(Doc.state.width, Doc.state.height);
  }
  Panels.refreshAll();
});

// ---------- default document ----------
Doc.newDocument('untitled-1', 1920, 1080, 'white');
Render.fit();
Selection.setDocSize(Doc.state.width, Doc.state.height);
Panels.refreshAll();
Tools.set('move');
Panels.renderOptions('move');

// ---------- file open ----------
const fileInput = $('#fileInput');
fileInput?.addEventListener('change', async () => {
  const files = [...fileInput.files];
  fileInput.value = '';
  for (const file of files) {
    try { await PSD.openFile(file); }
    catch (err) { console.error(err); Panels.toast(`Could not open “${file.name}”.`); }
  }
});

$('#btnOpen')?.addEventListener('click', () => fileInput?.click());
$('#btnSave')?.addEventListener('click', () => PSD.savePsd());
$('#btnExport')?.addEventListener('click', () => PSD.exportImage('png'));

// Drag & drop anywhere on the window
window.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])];
  for (const file of files) {
    try { await PSD.openFile(file); }
    catch (err) { console.error(err); Panels.toast(`Could not open “${file.name}”.`); }
  }
});

// Paste an image from the clipboard with Ctrl/Cmd+V (system or internal clipboard)
window.addEventListener('paste', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
  e.preventDefault();
  ClipboardOps.paste();
});

// Warn before discarding unsaved work
window.addEventListener('beforeunload', (e) => {
  if (Doc.state.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------- global keyboard shortcuts ----------
const inEditable = (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
};

const quickAdjust = (label, fn) => {
  const layer = Doc.activeLayer();
  if (!layer) { Panels.toast('Select a layer first.'); return; }
  Doc.pushHistory(label);
  fn(layer);
  Doc.state.dirty = true;
  Doc.state.revision++;
  Doc._notify('structure');
  Render.markDirty();
  Panels.refreshLayers();
};

const isMac = navigator.platform.toUpperCase().includes('MAC');
const modOf = (e) => (isMac ? e.metaKey : e.ctrlKey);

window.addEventListener('keydown', (e) => {
  if (inEditable(e)) return;
  const mod = modOf(e);
  const key = e.key.toLowerCase();
  const shift = e.shiftKey;

  const toolFor = { v: 'move', m: 'marquee-rect', l: 'lasso', w: 'wand', c: 'crop', i: 'eyedropper', b: 'brush', e: 'eraser', g: 'gradient', k: 'bucket', t: 'type', u: 'shape', h: 'hand', z: 'zoom' };

  if (mod) {
    switch (key) {
      case 'z': e.preventDefault(); shift ? Doc.redo() : Doc.undo(); return;
      case 'y': e.preventDefault(); Doc.redo(); return;
      case 's':
        e.preventDefault();
        if (shift) PSD.exportImage('png'); else PSD.savePsd();
        return;
      case 'o': e.preventDefault(); fileInput?.click(); return;
      case 'n': e.preventDefault(); newDocumentDialog(); return;
      case 'a': e.preventDefault(); Selection.selectAll(); return;
      case 'd': e.preventDefault(); Selection.clear(); return;
      case 'i': e.preventDefault(); if (shift) Selection.invert(); else quickAdjust('Invert', (l) => Adjust.invert(l)); return;
      case 'j': e.preventDefault(); Doc.duplicateLayer(); return;
      case 'e': e.preventDefault(); if (shift) { Doc.flatten(); Panels.refreshAll(); } else Doc.mergeDown(); return;
      case 'm': e.preventDefault(); curvesDialog(); return;
      case 'u': e.preventDefault(); if (shift) quickAdjust('Desaturate', (l) => Filters.grayscale(l)); else hueSaturationDialog(); return;
      case 'x': e.preventDefault(); ClipboardOps.copy(true); return;
      case 'c': e.preventDefault(); ClipboardOps.copy(false); return;
      case 'v': e.preventDefault(); ClipboardOps.paste(); return;
      case '0': e.preventDefault(); Render.fit(); return;
      case '1': e.preventDefault(); Render.actualSize(); return;
      case '=': case '+': e.preventDefault(); Render.zoomAt(1.25); return;
      case '-': e.preventDefault(); Render.zoomAt(1 / 1.25); return;
      case 'r': e.preventDefault(); UI.showRulers = !UI.showRulers; return;
      case ';': e.preventDefault(); UI.showGuides = !UI.showGuides; return;
      case "'": e.preventDefault(); UI.showGrid = !UI.showGrid; return;
      case ']': e.preventDefault(); { const l = Doc.activeLayer(); if (l) shift ? Doc.moveLayerToEdge(l.id, true) : Doc.moveLayer(l.id, +1); } return;
      case '[': e.preventDefault(); { const l = Doc.activeLayer(); if (l) shift ? Doc.moveLayerToEdge(l.id, false) : Doc.moveLayer(l.id, -1); } return;
    }
    return;
  }

  if (e.altKey && e.key === 'Backspace') { e.preventDefault(); ClipboardOps.fill(UI.fg); return; }
  if (e.key === 'Backspace' && modOf(e)) { e.preventDefault(); ClipboardOps.fill(UI.bg); return; }

  switch (e.key) {
    case 'Delete': case 'Backspace': e.preventDefault(); ClipboardOps.clear(); return;
    case 'Enter': if (Tools.pendingCrop) { e.preventDefault(); Tools.applyCrop(); } return;
    case 'Escape':
      if (Tools.pendingCrop) { Tools.cancelCrop(); return; }
      Menus.closeAll();
      return;
    case 'Tab': e.preventDefault(); togglePanels(); return;
    case 'x': swapColors(); Panels.updateSwatches(); return;
    case 'd': resetColors(); Panels.updateSwatches(); return;
    case '[': adjustBrushSize(-4); return;
    case ']': adjustBrushSize(+4); return;
    case 'F1': e.preventDefault(); shortcutsDialog(); return;
  }

  if (toolFor[key] && !e.altKey) {
    e.preventDefault();
    if (key === 'm') {
      Tools.set(UI.tool === 'marquee-rect' ? 'marquee-ellipse' : 'marquee-rect');
    } else {
      Tools.set(toolFor[key]);
    }
  }
});

const adjustBrushSize = (delta) => {
  if (UI.tool === 'eraser') UI.eraserSize = clamp(UI.eraserSize + delta, 1, 500);
  else UI.brushSize = clamp(UI.brushSize + delta, 1, 500);
  Panels.renderOptions(UI.tool);
};

const togglePanels = () => {
  UI.showPanels = !UI.showPanels;
  $('#dock')?.classList.toggle('hidden-panels', !UI.showPanels);
};

// Zoom level readout
setInterval(() => Panels.setZoomLabel(), 150);

// ---------- fatal error overlay ----------
const fatal = $('#fatal');
const showFatal = (detail) => {
  if (!fatal) return;
  fatal.hidden = false;
  const d = $('#fatalDetail');
  if (d) d.textContent = String(detail || 'Unknown error');
};
window.addEventListener('error', (e) => showFatal(e.error?.message || e.message));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason?.message || e.reason));
$('#fatalReload')?.addEventListener('click', () => window.location.reload());

// ---------- debug / support handle ----------
window.__KB__ = { Doc, Render, Selection, Tools, Panels, PSD, Menus, ClipboardOps, UI, Filters, Adjust };

// ---------- dismiss the loading screen ----------
window.__KB_BOOTED__ = true;
clearTimeout(window.__KB_BOOT_TIMER__);
const loading = $('#loading');
if (loading) {
  requestAnimationFrame(() => {
    setTimeout(() => {
      loading.classList.add('done');
      setTimeout(() => loading.remove(), 650);
    }, 120);
  });
}
