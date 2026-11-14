// UI controller: tool rail, options bar, layers panel, history panel, status bar, toasts.

import { $, $$, clamp, fmtBytes, newCanvas, copyCanvas } from './util.js';
import { Doc, BLEND_MODES } from './document.js';
import { Render } from './render.js';
import { Selection } from './selection.js';
import { UI, swapColors, resetColors } from './state.js';
import { ICONS } from './icons.js';

const FONT_STACKS = [
  ['Inter / System', 'Inter, system-ui, sans-serif'],
  ['Arial', 'Arial, Helvetica, sans-serif'],
  ['Helvetica', 'Helvetica, Arial, sans-serif'],
  ['Georgia', 'Georgia, serif'],
  ['Times New Roman', '“Times New Roman”, Times, serif'],
  ['Palatino', '“Palatino Linotype”, Palatino, serif'],
  ['Courier New', '“Courier New”, Courier, monospace'],
  ['Impact', 'Impact, Charcoal, sans-serif'],
  ['Trebuchet MS', '“Trebuchet MS”, sans-serif'],
  ['Verdana', 'Verdana, sans-serif'],
  ['Comic Sans MS', '“Comic Sans MS”, cursive'],
];

let cropApply = null, cropCancel = null;
let toastTimer = 0;

const checkerPattern = (() => {
  let pattern = null;
  return (ctx) => {
    if (!pattern) {
      const c = newCanvas(12, 12);
      const cctx = c.getContext('2d');
      cctx.fillStyle = '#c9c9c9';
      cctx.fillRect(0, 0, 12, 12);
      cctx.fillStyle = '#9a9a9a';
      cctx.fillRect(0, 0, 6, 6);
      cctx.fillRect(6, 6, 6, 6);
      pattern = ctx.createPattern(c, 'repeat');
    }
    return pattern;
  };
})();

const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

export const Panels = {
  init() {
    this.root = document.documentElement;
    // Populate the blend-mode dropdown
    const blendHost = $('#blendSelect');
    if (blendHost && !blendHost.options.length) {
      for (const mode of BLEND_MODES) {
        const opt = document.createElement('option');
        opt.value = mode;
        opt.textContent = mode.replace(/\b\w/g, (c) => c.toUpperCase());
        blendHost.appendChild(opt);
      }
    }
    // Dock tabs
    $$('.dock-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (window.innerWidth <= 900) {
          const dock = $('#dock');
          const already = dock.classList.contains('open') && btn.classList.contains('active');
          dock.classList.toggle('open', !already);
        }
        $$('.dock-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
        $('#dockLayers').classList.toggle('active', tab === 'layers');
        $('#dockHistory').classList.toggle('active', tab === 'history');
      });
    });
    // Mobile dock close on backdrop / outside click
    $('#dockClose')?.addEventListener('click', () => $('#dock').classList.remove('open'));
    $('#dockFab')?.addEventListener('click', () => $('#dock').classList.toggle('open'));

    // Zoom controls
    $('#zoomOut')?.addEventListener('click', () => Render.zoomAt(1 / 1.25));
    $('#zoomIn')?.addEventListener('click', () => Render.zoomAt(1.25));
    $('#zoomFit')?.addEventListener('click', () => Render.fit());
    $('#zoom100')?.addEventListener('click', () => Render.actualSize());

    // Swatches
    $('#fgSwatch')?.addEventListener('click', () => $('#fgPicker').click());
    $('#bgSwatch')?.addEventListener('click', () => $('#bgPicker').click());
    $('#fgPicker')?.addEventListener('input', (e) => { UI.fg = e.target.value; this.updateSwatches(); });
    $('#bgPicker')?.addEventListener('input', (e) => { UI.bg = e.target.value; this.updateSwatches(); });
    $('#swapColors')?.addEventListener('click', () => { swapColors(); this.updateSwatches(); });
    $('#resetColors')?.addEventListener('click', () => { resetColors(); this.updateSwatches(); });

    // Layer panel controls
    $('#opacityRange')?.addEventListener('input', (e) => {
      const layer = Doc.activeLayer();
      if (!layer) return;
      layer.opacity = clamp(Number(e.target.value) / 100, 0, 1);
      Doc.state.dirty = true;
      Doc.state.revision++;
      Render.markDirty();
      $('#opacityValue').textContent = `${Math.round(layer.opacity * 100)}%`;
      Doc._notify('revision');
    });
    const opacityHistory = () => {
      const layer = Doc.activeLayer();
      if (layer) Doc.pushHistory('Layer Opacity');
    };
    $('#opacityRange')?.addEventListener('pointerdown', opacityHistory);
    $('#opacityRange')?.addEventListener('keydown', opacityHistory);
    $('#blendSelect')?.addEventListener('focus', () => { if (Doc.activeLayer()) Doc.pushHistory('Blend Mode'); });
    $('#blendSelect')?.addEventListener('change', (e) => {
      const layer = Doc.activeLayer();
      if (layer) { layer.blendMode = e.target.value; Doc.state.dirty = true; Doc.state.revision++; Render.markDirty(); Doc._notify('revision'); }
    });

    // Layer action buttons
    $('#btnNewLayer')?.addEventListener('click', () => { Doc.newLayer(); });
    $('#btnDuplicateLayer')?.addEventListener('click', () => Doc.duplicateLayer());
    $('#btnDeleteLayer')?.addEventListener('click', () => {
      if (!Doc.deleteLayer()) this.toast('A document needs at least one layer.');
    });
    $('#btnAddMask')?.addEventListener('click', () => Doc.addMask());
    $('#btnMoveUp')?.addEventListener('click', () => { const l = Doc.activeLayer(); if (l) Doc.moveLayer(l.id, +1); });
    $('#btnMoveDown')?.addEventListener('click', () => { const l = Doc.activeLayer(); if (l) Doc.moveLayer(l.id, -1); });

    this.updateSwatches();
    this.setHint('Space+drag pans · Ctrl/⌘ + scroll zooms · Alt+click picks a color');
  },

  bindCropHandlers(apply, cancel) { cropApply = apply; cropCancel = cancel; },

  setActiveTool(id) {
    $$('.tool-btn').forEach((b) => b.classList.toggle('active', b.dataset.tool === id));
  },

  // ============ options bar ============

  renderOptions(toolId) {
    const host = $('#optionsBar');
    if (!host) return;
    host.innerHTML = '';
    const add = (node) => host.appendChild(node);
    const html = (strings, ...v) => el(strings.join(''));
    const row = (inner) => el(`<div class="opt-group">${inner}</div>`);
    const range = (id, label, min, max, value, fmt = (v) => v) => {
      const wrap = html`<label class="opt-field"><span class="opt-label">${label}</span><input id="${id}" type="range" min="${min}" max="${max}" value="${value}"><span class="opt-value" id="${id}Value">${fmt(value)}</span></label>`;
      return wrap;
    };

    switch (toolId) {
      case 'move': {
        const r = row(`<label class="opt-check"><input type="checkbox" id="optAutoSelect" ${UI.moveAutoSelect ? 'checked' : ''}><span>Auto-select layer</span></label>
          <button class="opt-btn" data-cmd="fwd" title="Bring forward">↑ Forward</button>
          <button class="opt-btn" data-cmd="back" title="Send backward">↓ Back</button>
          <button class="opt-btn" data-cmd="front" title="Bring to front">⇈ To front</button>
          <button class="opt-btn" data-cmd="backmost" title="Send to back">⇊ To back</button>`);
        r.querySelector('#optAutoSelect').addEventListener('change', (e) => { UI.moveAutoSelect = e.target.checked; });
        r.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => {
          const l = Doc.activeLayer(); if (!l) return;
          const cmd = b.dataset.cmd;
          if (cmd === 'fwd') Doc.moveLayer(l.id, +1);
          else if (cmd === 'back') Doc.moveLayer(l.id, -1);
          else if (cmd === 'front') Doc.moveLayerToEdge(l.id, true);
          else Doc.moveLayerToEdge(l.id, false);
        }));
        add(r);
        break;
      }
      case 'marquee-rect': case 'marquee-ellipse': case 'lasso': {
        const r = row(`<label class="opt-field"><span class="opt-label">Feather</span><input id="optFeather" type="number" min="0" max="250" value="${UI.marqueeFeather}" class="opt-num">px</label>
          <button class="opt-btn" data-sel="all">Select all</button>
          <button class="opt-btn" data-sel="invert">Invert</button>
          <button class="opt-btn" data-sel="none">Deselect</button>`);
        r.querySelector('#optFeather').addEventListener('change', (e) => { UI.marqueeFeather = clamp(Number(e.target.value) || 0, 0, 250); });
        r.querySelector('[data-sel="all"]').addEventListener('click', () => Selection.selectAll());
        r.querySelector('[data-sel="invert"]').addEventListener('click', () => Selection.invert());
        r.querySelector('[data-sel="none"]').addEventListener('click', () => Selection.clear());
        add(r);
        break;
      }
      case 'wand': {
        const r = row(`<label class="opt-field"><span class="opt-label">Tolerance</span><input id="optTol" type="range" min="0" max="255" value="${UI.wandTolerance}"><span class="opt-value" id="optTolValue">${UI.wandTolerance}</span></label>
          <label class="opt-check" title="Select connected pixels only"><input type="checkbox" id="optCont" ${UI.wandContiguous ? 'checked' : ''}><span>Contiguous</span></label>
          <label class="opt-check" title="Sample the merged image instead of the active layer"><input type="checkbox" id="optAll" ${UI.wandSampleAll ? 'checked' : ''}><span>Sample all layers</span></label>
          <button class="opt-btn" data-sel="none">Deselect</button>`);
        r.querySelector('#optTol').addEventListener('input', (e) => { UI.wandTolerance = Number(e.target.value); $('#optTolValue').textContent = e.target.value; });
        r.querySelector('#optCont').addEventListener('change', (e) => { UI.wandContiguous = e.target.checked; });
        r.querySelector('#optAll').addEventListener('change', (e) => { UI.wandSampleAll = e.target.checked; });
        r.querySelector('[data-sel="none"]').addEventListener('click', () => Selection.clear());
        add(r);
        break;
      }
      case 'crop': {
        const r = row(`<label class="opt-field"><span class="opt-label">Ratio</span><select id="optRatio" class="opt-select">
            <option value="0" ${UI.cropAspect === 0 ? 'selected' : ''}>Free</option>
            <option value="1" ${UI.cropAspect === 1 ? 'selected' : ''}>1 : 1</option>
            <option value="0.75" ${UI.cropAspect === 0.75 ? 'selected' : ''}>4 : 3</option>
            <option value="1.5" ${UI.cropAspect === 1.5 ? 'selected' : ''}>3 : 2</option>
            <option value="0.5625" ${UI.cropAspect === 0.5625 ? 'selected' : ''}>16 : 9</option>
            <option value="1.25" ${UI.cropAspect === 1.25 ? 'selected' : ''}>5 : 4</option>
          </select></label>
          <button class="opt-btn opt-accent" id="cropOk" title="Apply crop (Enter)">${ICONS.check} Apply</button>
          <button class="opt-btn" id="cropCancel" title="Cancel (Esc)">${ICONS.close}</button>`);
        r.querySelector('#optRatio').addEventListener('change', (e) => { UI.cropAspect = Number(e.target.value); });
        r.querySelector('#cropOk').addEventListener('click', () => cropApply?.());
        r.querySelector('#cropCancel').addEventListener('click', () => cropCancel?.());
        add(r);
        break;
      }
      case 'eyedropper': {
        const r = row(`<label class="opt-field"><span class="opt-label">Sample</span><select id="optSample" class="opt-select">
            <option value="1" ${UI.eyedropperSample === 1 ? 'selected' : ''}>Point sample</option>
            <option value="3" ${UI.eyedropperSample === 3 ? 'selected' : ''}>3 × 3 average</option>
            <option value="5" ${UI.eyedropperSample === 5 ? 'selected' : ''}>5 × 5 average</option>
          </select></label>`);
        r.querySelector('#optSample').addEventListener('change', (e) => { UI.eyedropperSample = Number(e.target.value); });
        add(r);
        break;
      }
      case 'brush': case 'eraser': {
        const isEraser = toolId === 'eraser';
        const size = isEraser ? UI.eraserSize : UI.brushSize;
        const r = row(`
          <label class="opt-field"><span class="opt-label">Size</span><input id="optSize" type="range" min="1" max="300" value="${size}"><span class="opt-value" id="optSizeValue">${size}px</span></label>
          <label class="opt-field"><span class="opt-label">Hardness</span><input id="optHard" type="range" min="0" max="100" value="${Math.round(UI.brushHardness * 100)}"><span class="opt-value" id="optHardValue">${Math.round(UI.brushHardness * 100)}%</span></label>
          <label class="opt-field"><span class="opt-label">Opacity</span><input id="optOpacity" type="range" min="1" max="100" value="${Math.round(UI.brushOpacity * 100)}"><span class="opt-value" id="optOpacityValue">${Math.round(UI.brushOpacity * 100)}%</span></label>`);
        r.querySelector('#optSize').addEventListener('input', (e) => {
          if (isEraser) UI.eraserSize = Number(e.target.value); else UI.brushSize = Number(e.target.value);
          $('#optSizeValue').textContent = `${e.target.value}px`;
        });
        r.querySelector('#optHard').addEventListener('input', (e) => { UI.brushHardness = Number(e.target.value) / 100; $('#optHardValue').textContent = `${e.target.value}%`; });
        r.querySelector('#optOpacity').addEventListener('input', (e) => { UI.brushOpacity = Number(e.target.value) / 100; $('#optOpacityValue').textContent = `${e.target.value}%`; });
        add(r);
        break;
      }
      case 'gradient': {
        const r = row(`
          <label class="opt-field"><span class="opt-label">Colors</span><select id="optGradStyle" class="opt-select">
            <option value="fg-bg" ${UI.gradientStyle === 'fg-bg' ? 'selected' : ''}>Foreground → Background</option>
            <option value="fg-transparent" ${UI.gradientStyle === 'fg-transparent' ? 'selected' : ''}>Foreground → Transparent</option>
          </select></label>
          <label class="opt-field"><span class="opt-label">Shape</span><select id="optGradShape" class="opt-select">
            <option value="linear" ${UI.gradientShape === 'linear' ? 'selected' : ''}>Linear</option>
            <option value="radial" ${UI.gradientShape === 'radial' ? 'selected' : ''}>Radial</option>
          </select></label>
          <label class="opt-check"><input type="checkbox" id="optGradReverse" ${UI.gradientReverse ? 'checked' : ''}><span>Reverse</span></label>`);
        r.querySelector('#optGradStyle').addEventListener('change', (e) => { UI.gradientStyle = e.target.value; });
        r.querySelector('#optGradShape').addEventListener('change', (e) => { UI.gradientShape = e.target.value; });
        r.querySelector('#optGradReverse').addEventListener('change', (e) => { UI.gradientReverse = e.target.checked; });
        add(r);
        break;
      }
      case 'bucket': {
        const r = row(`<label class="opt-field"><span class="opt-label">Tolerance</span><input id="optBucketTol" type="range" min="0" max="255" value="${UI.bucketTolerance}"><span class="opt-value" id="optBucketTolValue">${UI.bucketTolerance}</span></label>
          <label class="opt-check"><input type="checkbox" id="optBucketCont" ${UI.bucketContiguous ? 'checked' : ''}><span>Contiguous</span></label>`);
        r.querySelector('#optBucketTol').addEventListener('input', (e) => { UI.bucketTolerance = Number(e.target.value); $('#optBucketTolValue').textContent = e.target.value; });
        r.querySelector('#optBucketCont').addEventListener('change', (e) => { UI.bucketContiguous = e.target.checked; });
        add(r);
        break;
      }
      case 'type': {
        const options = FONT_STACKS.map(([label, stack]) => `<option value="${stack.replace(/"/g, '&quot;')}" ${UI.fontFamily === stack ? 'selected' : ''}>${label}</option>`).join('');
        const r = row(`<label class="opt-field"><span class="opt-label">Font</span><select id="optFont" class="opt-select">${options}</select></label>
          <label class="opt-field"><span class="opt-label">Size</span><input id="optFontSize" type="number" min="4" max="800" value="${UI.fontSize}" class="opt-num">px</label>
          <button class="opt-btn opt-toggle ${UI.fontBold ? 'on' : ''}" id="optBold" title="Bold"><b>B</b></button>
          <button class="opt-btn opt-toggle ${UI.fontItalic ? 'on' : ''}" id="optItalic" title="Italic"><i>I</i></button>`);
        r.querySelector('#optFont').addEventListener('change', (e) => { UI.fontFamily = e.target.value; });
        r.querySelector('#optFontSize').addEventListener('change', (e) => { UI.fontSize = clamp(Number(e.target.value) || 92, 4, 800); });
        r.querySelector('#optBold').addEventListener('click', (e) => { UI.fontBold = !UI.fontBold; e.currentTarget.classList.toggle('on', UI.fontBold); });
        r.querySelector('#optItalic').addEventListener('click', (e) => { UI.fontItalic = !UI.fontItalic; e.currentTarget.classList.toggle('on', UI.fontItalic); });
        add(r);
        break;
      }
      case 'shape': {
        const r = row(`<label class="opt-field"><span class="opt-label">Shape</span><select id="optShapeKind" class="opt-select">
            <option value="rect" ${UI.shapeKind === 'rect' ? 'selected' : ''}>Rectangle</option>
            <option value="ellipse" ${UI.shapeKind === 'ellipse' ? 'selected' : ''}>Ellipse</option>
            <option value="line" ${UI.shapeKind === 'line' ? 'selected' : ''}>Line</option>
          </select></label>
          <label class="opt-check"><input type="checkbox" id="optShapeFill" ${UI.shapeFill ? 'checked' : ''}><span>Fill</span></label>
          <label class="opt-check"><input type="checkbox" id="optShapeStroke" ${UI.shapeStroke ? 'checked' : ''}><span>Stroke</span></label>
          <label class="opt-field"><span class="opt-label">Width</span><input id="optStrokeWidth" type="number" min="1" max="200" value="${UI.shapeStrokeWidth}" class="opt-num">px</label>`);
        r.querySelector('#optShapeKind').addEventListener('change', (e) => { UI.shapeKind = e.target.value; });
        r.querySelector('#optShapeFill').addEventListener('change', (e) => { UI.shapeFill = e.target.checked; });
        r.querySelector('#optShapeStroke').addEventListener('change', (e) => { UI.shapeStroke = e.target.checked; });
        r.querySelector('#optStrokeWidth').addEventListener('change', (e) => { UI.shapeStrokeWidth = clamp(Number(e.target.value) || 4, 1, 200); });
        add(r);
        break;
      }
      case 'hand': case 'zoom': {
        const r = row(`<button class="opt-btn" data-zoom="out">−</button><button class="opt-btn" data-zoom="in">+</button>
          <button class="opt-btn" data-zoom="fit">Fit</button><button class="opt-btn" data-zoom="100">100%</button>`);
        r.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
          const z = b.dataset.zoom;
          if (z === 'in') Render.zoomAt(1.25); else if (z === 'out') Render.zoomAt(1 / 1.25);
          else if (z === 'fit') Render.fit(); else Render.actualSize();
        }));
        add(r);
        break;
      }
      default: {
        add(row(`<span class="opt-label">KB EDITOR</span>`));
      }
    }
  },

  showCropActions(show) {
    // Crop ✓/✗ are rendered by the crop options bar itself; nothing else to do.
  },

  // ============ swatches / brush cursor ============

  updateSwatches() {
    const fg = $('#fgSwatch'), bg = $('#bgSwatch');
    if (fg) fg.style.background = UI.fg;
    if (bg) bg.style.background = UI.bg;
    const fgp = $('#fgPicker'), bgp = $('#bgPicker');
    if (fgp) fgp.value = toHex6(UI.fg);
    if (bgp) bgp.value = toHex6(UI.bg);
  },

  showBrushCursor(x, y, diameter) {
    const c = $('#brushCursor');
    if (!c) return;
    c.style.display = 'block';
    c.style.width = `${Math.max(2, diameter)}px`;
    c.style.height = `${Math.max(2, diameter)}px`;
    c.style.transform = `translate(${x - Math.max(2, diameter) / 2}px, ${y - Math.max(2, diameter) / 2}px)`;
  },

  hideBrushCursor() {
    const c = $('#brushCursor');
    if (c) c.style.display = 'none';
  },

  // ============ layers panel ============

  refreshLayers() {
    const list = $('#layerList');
    if (!list) return;
    list.innerHTML = '';
    const checker = checkerPattern;
    const layers = Doc.state.layers;
    // Top of Photoshop stack = end of array → render reversed
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      const row = document.createElement('div');
      row.className = 'layer-row' + (layer.id === Doc.state.activeId ? ' active' : '');
      row.dataset.id = layer.id;
      row.innerHTML = `
        <button class="layer-eye" title="Toggle visibility" aria-label="Toggle layer visibility">${layer.visible ? ICONS.eye : ICONS.eyeOff}</button>
        <canvas class="layer-thumb" width="52" height="40" aria-hidden="true"></canvas>
        <div class="layer-meta">
          <div class="layer-name" title="${escapeAttr(layer.name)}">${escapeHtml(layer.name)}</div>
          <div class="layer-sub">${escapeHtml(layer.blendMode)} · ${Math.round(layer.opacity * 100)}%</div>
        </div>
        ${layer.mask ? `<button class="layer-mask ${UI.editingMaskFor === layer.id ? 'editing' : ''}" title="Layer mask — click to paint it"><canvas width="34" height="28"></canvas></button>` : ''}
        <div class="layer-reorder">
          <button class="reorder-btn" data-dir="1" title="Bring forward" aria-label="Bring forward">${ICONS.chevronUp}</button>
          <button class="reorder-btn" data-dir="-1" title="Send backward" aria-label="Send backward">${ICONS.chevronDown}</button>
        </div>`;
      // Thumbnail
      const thumb = row.querySelector('.layer-thumb');
      const tctx = thumb.getContext('2d');
      tctx.fillStyle = checker(tctx) || '#888';
      tctx.fillRect(0, 0, thumb.width, thumb.height);
      const scale = Math.min(thumb.width / layer.canvas.width, thumb.height / layer.canvas.height, 1);
      const dw = Math.max(1, Math.round(layer.canvas.width * scale));
      const dh = Math.max(1, Math.round(layer.canvas.height * scale));
      tctx.imageSmoothingQuality = 'high';
      tctx.drawImage(layer.canvas, (thumb.width - dw) / 2, (thumb.height - dh) / 2, dw, dh);
      // Mask thumbnail
      const maskBtn = row.querySelector('.layer-mask');
      if (maskBtn) {
        const mcanvas = maskBtn.querySelector('canvas');
        const mctx = mcanvas.getContext('2d');
        mctx.fillStyle = '#000';
        mctx.fillRect(0, 0, mcanvas.width, mcanvas.height);
        const ms = Math.min(mcanvas.width / layer.mask.width, mcanvas.height / layer.mask.height);
        const mw = Math.max(1, layer.mask.width * ms), mh = Math.max(1, layer.mask.height * ms);
        mctx.drawImage(layer.mask, (mcanvas.width - mw) / 2, (mcanvas.height - mh) / 2, mw, mh);
        maskBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          UI.editingMaskFor = UI.editingMaskFor === layer.id ? null : layer.id;
          this.toast(UI.editingMaskFor ? 'Painting the mask — light paint reveals, dark paint conceals. Click again to stop.' : 'Back to painting pixels.');
          this.refreshLayers();
        });
      }
      // Eye toggle
      row.querySelector('.layer-eye').addEventListener('click', (e) => {
        e.stopPropagation();
        Doc.setVisibility(layer.id, !layer.visible);
      });
      // Select layer
      row.addEventListener('click', () => Doc.setActive(layer.id));
      // Rename on double click
      row.querySelector('.layer-name').addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const input = document.createElement('input');
        input.className = 'layer-rename';
        input.value = layer.name;
        const nameEl = row.querySelector('.layer-name');
        nameEl.replaceWith(input);
        input.focus();
        input.select();
        const commit = () => { Doc.renameLayer(layer.id, input.value); };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
          ev.stopPropagation();
          if (ev.key === 'Enter') input.blur();
          else if (ev.key === 'Escape') { input.value = layer.name; input.blur(); }
        });
      });
      // Reorder
      row.querySelectorAll('.reorder-btn').forEach((btn) => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        Doc.moveLayer(layer.id, Number(btn.dataset.dir));
      }));
      list.appendChild(row);
    }
    // Sync the opacity/blend controls to the active layer
    const active = Doc.activeLayer();
    const opacity = $('#opacityRange'), opacityValue = $('#opacityValue'), blend = $('#blendSelect');
    if (active) {
      if (opacity && document.activeElement !== opacity) opacity.value = String(Math.round(active.opacity * 100));
      if (opacityValue) opacityValue.textContent = `${Math.round(active.opacity * 100)}%`;
      if (blend) blend.value = active.blendMode;
    }
  },

  // ============ history panel ============

  refreshHistory() {
    const list = $('#historyList');
    if (!list) return;
    list.innerHTML = '';
    const entries = Doc.undoStack;
    const head = document.createElement('div');
    head.className = 'history-row head';
    head.innerHTML = `<span>Now</span>`;
    const headBtn = () => { /* clicking "Now" redoes everything */ while (Doc.redoStack.length) Doc.redo(); };
    head.addEventListener('click', headBtn);
    // Entries listed oldest → newest above "Now"
    entries.forEach((snap, i) => {
      const row = document.createElement('button');
      row.className = 'history-row';
      row.innerHTML = `<span>${escapeHtml(snap.label)}</span>`;
      row.title = 'Revert to before this edit';
      row.addEventListener('click', () => {
        // undo pops pre-action snapshots; pop exactly through this entry
        let steps = Doc.undoStack.length - i;
        while (steps-- > 0) Doc.undo();
      });
      list.appendChild(row);
    });
    list.appendChild(head);
    list.scrollTop = list.scrollHeight;
  },

  // ============ status bar / titles / toasts ============

  setZoomLabel() {
    const label = $('#zoomLabel');
    if (label) label.textContent = `${Math.round(Render.view.zoom * 100)}%`;
  },

  setDocTitle(name, dirty) {
    document.title = `${dirty ? '● ' : ''}${name || 'untitled'} — KB EDITOR`;
    const t = $('#docTitle');
    if (t) t.textContent = name || 'untitled';
  },

  setDirty(dirty) {
    this.setDocTitle(Doc.state.name, dirty);
    $('#btnSave')?.classList.toggle('attention', !!dirty);
  },

  setDocStats() {
    const s = $('#docStats');
    if (!s) return;
    const { width, height } = Doc.state;
    s.textContent = `${width} × ${height}px · ${fmtBytes(Doc.memoryEstimate())} · ${Doc.state.layers.length} layer${Doc.state.layers.length === 1 ? '' : 's'}`;
  },

  setHint(text) {
    const h = $('#hint');
    if (h) h.textContent = text;
  },

  toast(msg, ms = 3400) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  },

  refreshAll() {
    this.refreshLayers();
    this.refreshHistory();
    this.setDocStats();
    this.setDirty(Doc.state.dirty);
    this.setDocTitle(Doc.state.name, Doc.state.dirty);
  },
};

const toHex6 = (hex) => {
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const m = hex.replace('#', '');
  if (m.length === 3) return '#' + [...m].map((c) => c + c).join('');
  return '#111111';
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escapeAttr = escapeHtml;
