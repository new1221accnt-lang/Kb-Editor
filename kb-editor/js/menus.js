// Menu bar: File / Edit / Image / Layer / Select / Filter / View / Window / Help.

import { $, $$ } from './util.js';
import { Doc } from './document.js';
import { Render } from './render.js';
import { Selection } from './selection.js';
import { UI } from './state.js';
import { PSD } from './psd.js';
import { Panels } from './panels.js';
import { ClipboardOps } from './clipboard.js';
import * as Filters from './filters.js';
import * as Adjust from './adjustments.js';
import {
  newDocumentDialog, imageSizeDialog, canvasSizeDialog, brightnessContrastDialog, levelsDialog,
  curvesDialog, hueSaturationDialog, exposureDialog, thresholdDialog, posterizeDialog,
  gaussianBlurDialog, motionBlurDialog, noiseDialog, pixelateDialog, unsharpDialog,
  aboutDialog, shortcutsDialog, Dialog,
} from './dialogs.js';

const needLayer = (fn) => () => { if (!Doc.activeLayer()) { Panels.toast('Select a layer first.'); return; } fn(); };

const MENUS = () => [
  {
    label: 'File',
    items: [
      { label: 'New…', shortcut: 'Ctrl+Alt+N', action: () => newDocumentDialog() },
      { label: 'Open…', shortcut: 'Ctrl+O', action: () => $('#fileInput')?.click() },
      { sep: true },
      { label: 'Save as PSD', shortcut: 'Ctrl+S', action: () => PSD.savePsd() },
      { label: 'Export', submenu: [
        { label: 'PNG (lossless)', action: () => PSD.exportImage('png') },
        { label: 'JPEG', action: () => PSD.exportImage('jpeg') },
        { label: 'WebP', action: () => PSD.exportImage('webp') },
      ] },
      { sep: true },
      { label: 'Flatten & Export PNG', action: () => { Doc.flatten(); PSD.exportImage('png'); Panels.refreshAll(); } },
      { sep: true },
      { label: 'Close (new blank canvas)', action: async () => {
        if (Doc.state.dirty) {
          const ok = await Dialog.confirm({ title: 'Close without saving?', message: 'Your document has unsaved changes. Closing will discard them.', okText: 'Discard', danger: true });
          if (!ok) return;
        }
        Doc.newDocument('untitled-1', 1920, 1080, 'white');
        Selection.clear();
        Render.fit();
        Panels.refreshAll();
      } },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo', shortcut: 'Ctrl+Z', disabled: () => !Doc.undoStack.length, action: () => { Doc.undo(); } },
      { label: 'Redo', shortcut: 'Ctrl+Shift+Z', disabled: () => !Doc.redoStack.length, action: () => { Doc.redo(); } },
      { sep: true },
      { label: 'Cut', shortcut: 'Ctrl+X', action: () => { ClipboardOps.copy(true); } },
      { label: 'Copy', shortcut: 'Ctrl+C', action: () => { ClipboardOps.copy(false); } },
      { label: 'Paste', shortcut: 'Ctrl+V', action: () => { ClipboardOps.paste(); } },
      { label: 'Duplicate Layer', shortcut: 'Ctrl+J', action: () => Doc.duplicateLayer() },
      { sep: true },
      { label: 'Fill with Foreground', shortcut: 'Alt+Bksp', action: needLayer(() => ClipboardOps.fill(UI.fg)) },
      { label: 'Fill with Background', shortcut: 'Ctrl+Bksp', action: needLayer(() => ClipboardOps.fill(UI.bg)) },
      { label: 'Clear', shortcut: 'Del', action: () => ClipboardOps.clear() },
    ],
  },
  {
    label: 'Image',
    items: [
      { label: 'Adjustments', submenu: [
        { label: 'Brightness / Contrast…', action: brightnessContrastDialog },
        { label: 'Levels…', action: levelsDialog },
        { label: 'Curves…', shortcut: 'Ctrl+M', action: curvesDialog },
        { label: 'Hue / Saturation…', shortcut: 'Ctrl+U', action: hueSaturationDialog },
        { label: 'Exposure…', action: exposureDialog },
        { sep: true },
        { label: 'Invert', shortcut: 'Ctrl+I', action: needLayer(() => historyFilter('Invert', (l) => Adjust.invert(l))) },
        { label: 'Desaturate', shortcut: 'Ctrl+Shift+U', action: needLayer(() => historyFilter('Desaturate', (l) => Filters.grayscale(l))) },
        { sep: true },
        { label: 'Threshold…', action: thresholdDialog },
        { label: 'Posterize…', action: posterizeDialog },
      ] },
      { sep: true },
      { label: 'Image Size…', action: imageSizeDialog },
      { label: 'Canvas Size…', shortcut: 'Ctrl+Alt+C', action: canvasSizeDialog },
      { sep: true },
      { label: 'Rotate Canvas', submenu: [
        { label: '90° Clockwise', action: () => { Doc.rotateCanvas(90); Selection.clear(); Panels.refreshAll(); } },
        { label: '90° Counter-Clockwise', action: () => { Doc.rotateCanvas(-90); Selection.clear(); Panels.refreshAll(); } },
        { label: '180°', action: () => { Doc.rotateCanvas(180); Selection.clear(); Panels.refreshAll(); } },
      ] },
      { label: 'Flip Canvas Horizontal', action: () => { Doc.flipCanvas(true); Panels.refreshAll(); } },
      { label: 'Flip Canvas Vertical', action: () => { Doc.flipCanvas(false); Panels.refreshAll(); } },
    ],
  },
  {
    label: 'Layer',
    items: [
      { label: 'New Layer', shortcut: 'Ctrl+Shift+N', action: () => Doc.newLayer() },
      { label: 'Duplicate Layer', shortcut: 'Ctrl+J', action: () => Doc.duplicateLayer() },
      { label: 'Delete Layer', action: () => { if (!Doc.deleteLayer()) Panels.toast('A document needs at least one layer.'); } },
      { sep: true },
      { label: 'Add Layer Mask', action: () => Doc.addMask() },
      { label: 'Enable / Disable Mask', action: () => Doc.toggleMask() },
      { label: 'Delete Mask', action: () => Doc.deleteMask() },
      { sep: true },
      { label: 'Merge Down', shortcut: 'Ctrl+E', action: () => Doc.mergeDown() },
      { label: 'Flatten Image', shortcut: 'Ctrl+Shift+E', action: () => { Doc.flatten(); Panels.refreshAll(); } },
      { sep: true },
      { label: 'Arrange', submenu: [
        { label: 'Bring Forward', shortcut: 'Ctrl+]', action: () => { const l = Doc.activeLayer(); if (l) Doc.moveLayer(l.id, +1); } },
        { label: 'Send Backward', shortcut: 'Ctrl+[', action: () => { const l = Doc.activeLayer(); if (l) Doc.moveLayer(l.id, -1); } },
        { sep: true },
        { label: 'Bring to Front', shortcut: 'Ctrl+Shift+]', action: () => { const l = Doc.activeLayer(); if (l) Doc.moveLayerToEdge(l.id, true); } },
        { label: 'Send to Back', shortcut: 'Ctrl+Shift+[', action: () => { const l = Doc.activeLayer(); if (l) Doc.moveLayerToEdge(l.id, false); } },
      ] },
    ],
  },
  {
    label: 'Select',
    items: [
      { label: 'All', shortcut: 'Ctrl+A', action: () => Selection.selectAll() },
      { label: 'Deselect', shortcut: 'Ctrl+D', action: () => Selection.clear() },
      { label: 'Invert', shortcut: 'Ctrl+Shift+I', action: () => Selection.invert() },
      { label: 'Reselect', shortcut: 'Ctrl+Shift+D', action: () => Selection.reselect() },
    ],
  },
  {
    label: 'Filter',
    items: [
      { label: 'Gaussian Blur…', action: gaussianBlurDialog },
      { label: 'Motion Blur…', action: motionBlurDialog },
      { label: 'Unsharp Mask…', action: unsharpDialog },
      { sep: true },
      { label: 'Sharpen', action: needLayer(() => historyFilter('Sharpen', (l) => Filters.sharpen(l, false))) },
      { label: 'Sharpen More', action: needLayer(() => historyFilter('Sharpen More', (l) => Filters.sharpen(l, true))) },
      { label: 'Emboss', action: needLayer(() => historyFilter('Emboss', (l) => Filters.emboss(l))) },
      { label: 'Find Edges', action: needLayer(() => historyFilter('Find Edges', (l) => Filters.findEdges(l))) },
      { sep: true },
      { label: 'Add Noise…', action: noiseDialog },
      { label: 'Pixelate…', action: pixelateDialog },
      { sep: true },
      { label: 'Sepia', action: needLayer(() => historyFilter('Sepia', (l) => Filters.sepia(l))) },
      { label: 'Grayscale', action: needLayer(() => historyFilter('Grayscale', (l) => Filters.grayscale(l))) },
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'Zoom In', shortcut: 'Ctrl++', action: () => Render.zoomAt(1.25) },
      { label: 'Zoom Out', shortcut: 'Ctrl+−', action: () => Render.zoomAt(1 / 1.25) },
      { label: 'Fit on Screen', shortcut: 'Ctrl+0', action: () => Render.fit() },
      { label: 'Actual Pixels', shortcut: 'Ctrl+1', action: () => Render.actualSize() },
      { sep: true },
      { label: 'Rulers', shortcut: 'Ctrl+R', checked: () => UI.showRulers, action: () => { UI.showRulers = !UI.showRulers; } },
      { label: 'Guides', shortcut: 'Ctrl+;', checked: () => UI.showGuides, action: () => { UI.showGuides = !UI.showGuides; } },
      { label: 'Grid', shortcut: "Ctrl+'", checked: () => UI.showGrid, action: () => { UI.showGrid = !UI.showGrid; } },
      { label: 'Clear Guides', action: () => Render.clearGuides() },
    ],
  },
  {
    label: 'Window',
    items: [
      { label: 'Layers panel', action: () => selectDockTab('layers') },
      { label: 'History panel', action: () => selectDockTab('history') },
      { label: 'Toggle panel dock', shortcut: 'Tab', checked: () => UI.showPanels, action: () => {
        UI.showPanels = !UI.showPanels;
        $('#dock')?.classList.toggle('hidden-panels', !UI.showPanels);
      } },
      { sep: true },
      { label: 'Reset layout', action: () => {
        UI.showPanels = true;
        $('#dock')?.classList.remove('hidden-panels');
        selectDockTab('layers');
        Render.fit();
      } },
    ],
  },
  {
    label: 'Help',
    items: [
      { label: 'Keyboard shortcuts', action: shortcutsDialog },
      { label: 'PSD format notes…', action: psdNotesDialog },
      { sep: true },
      { label: 'About KB EDITOR', action: aboutDialog },
    ],
  },
];

// Apply an adjustment/filter that needs to modify a layer in one undo step.
const historyFilter = (label, fn) => {
  const layer = Doc.activeLayer();
  Doc.pushHistory(label);
  fn(layer);
  Doc.state.dirty = true;
  Doc.state.revision++;
  Doc._notify('structure');
  Render.markDirty();
  Panels.refreshLayers();
};

const selectDockTab = (tab) => {
  $$('.dock-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#dockLayers')?.classList.toggle('active', tab === 'layers');
  $('#dockHistory')?.classList.toggle('active', tab === 'history');
  $('#dock')?.classList.add('open');
};

const psdNotesDialog = () => {
  Dialog.open({
    title: 'PSD Format Notes',
    okText: 'Got it',
    cancelText: null,
    width: 460,
    body: `
      <div class="about-grid">
        <div><strong>Reading</strong><span>PSD &amp; PSB — layers, layer masks, blend modes, opacity, visibility, groups (flattened to their appearance). 16/32-bit files are read and converted to 8-bit for editing.</span></div>
        <div><strong>Writing</strong><span>Documents are saved as real, spec-compliant PSD files (8-bit RGB). Layers, masks, blend modes, opacity and visibility round-trip. Adjustment layers are baked into a flattened base on open. Layer effects (shadows, glows…) are not re-created on save.</span></div>
        <div><strong>Text</strong><span>Text is imported as pixels (re-editable with the Type tool as new layers). Saved text layers are plain pixel layers.</span></div>
        <div><strong>Privacy</strong><span>Everything runs locally in your browser. No file ever leaves your device.</span></div>
      </div>`,
  });
};

let openMenu = null;

export const Menus = {
  init() {
    const host = $('#menuHost');
    if (!host) return;
    host.innerHTML = '';
    for (const menu of MENUS()) {
      const btn = document.createElement('button');
      btn.className = 'menu-btn';
      btn.textContent = menu.label;
      btn.setAttribute('aria-haspopup', 'true');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (openMenu === btn) return this.closeAll();
        this.open(btn, menu);
      });
      btn.addEventListener('pointerenter', () => {
        if (openMenu && openMenu !== btn) this.open(btn, menu);
      });
      host.appendChild(btn);
    }
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.menu-dropdown') && !e.target.closest('.menu-btn')) this.closeAll();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeAll();
    });
  },

  open(btn, menu) {
    this.closeAll();
    openMenu = btn;
    btn.classList.add('open');
    const panel = document.createElement('div');
    panel.className = 'menu-dropdown';
    panel.setAttribute('role', 'menu');
    for (const item of menu.items) panel.appendChild(renderItem(item, () => this.closeAll()));
    document.body.appendChild(panel);
    const rect = btn.getBoundingClientRect();
    const pw = panel.offsetWidth;
    panel.style.left = `${Math.min(rect.left, window.innerWidth - pw - 8)}px`;
    panel.style.top = `${rect.bottom + 4}px`;
  },

  closeAll() {
    openMenu?.classList.remove('open');
    openMenu = null;
    $$('.menu-dropdown').forEach((d) => d.remove());
  },
};

const renderItem = (item, close) => {
  if (item.sep) {
    const sep = document.createElement('div');
    sep.className = 'menu-sep';
    return sep;
  }
  const disabled = item.disabled?.() ?? false;
  const btn = document.createElement('button');
  btn.className = 'menu-item' + (disabled ? ' disabled' : '');
  btn.setAttribute('role', 'menuitem');
  const check = item.checked ? (item.checked() ? '✓' : '') : '';
  btn.innerHTML = `<span class="menu-check">${check}</span><span class="menu-label">${item.label}</span>${item.shortcut ? `<kbd class="menu-kbd">${item.shortcut}</kbd>` : ''}${item.submenu ? '<span class="menu-caret">▸</span>' : ''}`;
  if (item.submenu) {
    let sub = null;
    const showSub = () => {
      if (sub) return;
      sub = document.createElement('div');
      sub.className = 'menu-dropdown menu-sub';
      for (const child of item.submenu) sub.appendChild(renderItem(child, () => { close(); }));
      document.body.appendChild(sub);
      const rect = btn.getBoundingClientRect();
      sub.style.left = `${Math.min(rect.right - 4, window.innerWidth - sub.offsetWidth - 8)}px`;
      sub.style.top = `${rect.top - 6}px`;
    };
    const hideSub = () => { sub?.remove(); sub = null; };
    btn.addEventListener('pointerenter', showSub);
    btn.addEventListener('pointerleave', (e) => {
      if (sub && !sub.contains(e.relatedTarget)) hideSub();
    });
    btn.addEventListener('click', (e) => { e.stopPropagation(); showSub(); });
    return btn;
  }
  if (!disabled) {
    btn.addEventListener('click', () => {
      close();
      item.action?.();
    });
  }
  return btn;
};
