// Tool engine: pointer handling, pinch-zoom, brush engine, all tool implementations.

import { clamp, clamp255, copyCanvas, newCanvas, uid } from './util.js';
import { Doc } from './document.js';
import { Selection } from './selection.js';
import { Render } from './render.js';
import { UI } from './state.js';
import { Panels } from './panels.js';

export const TOOLS = [
  { id: 'move', name: 'Move', key: 'v', title: 'Move (V)' },
  { id: 'marquee-rect', name: 'Rect. Marquee', key: 'm', title: 'Rectangular Marquee (M)' },
  { id: 'marquee-ellipse', name: 'Elliptical Marquee', key: 'm2', title: 'Elliptical Marquee (M again)' },
  { id: 'lasso', name: 'Lasso', key: 'l', title: 'Lasso Select (L)' },
  { id: 'wand', name: 'Magic Wand', key: 'w', title: 'Magic Wand (W)' },
  { id: 'crop', name: 'Crop', key: 'c', title: 'Crop (C)' },
  { id: 'eyedropper', name: 'Eyedropper', key: 'i', title: 'Eyedropper (I) — Alt+click works with any paint tool' },
  { id: 'brush', name: 'Brush', key: 'b', title: 'Brush (B)' },
  { id: 'eraser', name: 'Eraser', key: 'e', title: 'Eraser (E)' },
  { id: 'gradient', name: 'Gradient', key: 'g', title: 'Gradient (G)' },
  { id: 'bucket', name: 'Paint Bucket', key: 'k', title: 'Paint Bucket (K)' },
  { id: 'type', name: 'Type', key: 't', title: 'Horizontal Type (T)' },
  { id: 'shape', name: 'Shape', key: 'u', title: 'Shape (U)' },
  { id: 'hand', name: 'Hand', key: 'h', title: 'Hand Pan (H) — hold Space anytime' },
  { id: 'zoom', name: 'Zoom', key: 'z', title: 'Zoom (Z) — Ctrl/⌘+Scroll also zooms' },
];

const cursorFor = {
  move: 'default', 'marquee-rect': 'crosshair', 'marquee-ellipse': 'crosshair', lasso: 'crosshair',
  wand: 'crosshair', crop: 'crosshair', eyedropper: 'crosshair', brush: 'none', eraser: 'none',
  gradient: 'crosshair', bucket: 'crosshair', type: 'text', shape: 'crosshair', hand: 'grab', zoom: 'zoom-in',
};

// ---------- shared helpers ----------

const makeStamp = (() => {
  const cache = new Map();
  return (size, hardness) => {
    const key = `${size}|${hardness}`;
    let c = cache.get(key);
    if (c) return c;
    const r = Math.max(0.5, size / 2);
    c = newCanvas(Math.ceil(r * 2) + 2, Math.ceil(r * 2) + 2);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(r + 1, r + 1, 0, r + 1, r + 1, r);
    const inner = clamp(hardness, 0, 0.99);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(inner, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    if (cache.size > 24) cache.clear();
    cache.set(key, c);
    return c;
  };
})();

const hexToRgb = (hex) => {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const activeLayerOrToast = () => {
  const layer = Doc.activeLayer();
  if (!layer) { Panels.toast('No active layer.'); return null; }
  if (!layer.visible) { Panels.toast('That layer is hidden.'); return null; }
  return layer;
};

const sampleComposite = (x, y, radius = 0) => {
  const comp = Render.getComposite();
  const ctx = comp.getContext('2d', { willReadFrequently: true });
  const xi = clamp(Math.round(x), 0, comp.width - 1), yi = clamp(Math.round(y), 0, comp.height - 1);
  if (radius <= 0) {
    const d = ctx.getImageData(xi, yi, 1, 1).data;
    return [d[0], d[1], d[2]];
  }
  const x0 = clamp(xi - radius, 0, comp.width - 1), y0 = clamp(yi - radius, 0, comp.height - 1);
  const x1 = clamp(xi + radius, 0, comp.width - 1), y1 = clamp(yi + radius, 0, comp.height - 1);
  const d = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const alpha = d[i + 3] / 255;
    r += d[i] * alpha; g += d[i + 1] * alpha; b += d[i + 2] * alpha; a += alpha; n++;
  }
  return a > 0 ? [Math.round(r / a), Math.round(g / a), Math.round(b / a)] : [0, 0, 0];
};

const rgbToHex = (r, g, b) => `#${[r, g, b].map((v) => clamp255(Math.round(v)).toString(16).padStart(2, '0')).join('')}`;

/** Clip a canvas op to the active selection (used by gradient/bucket). */
const clipThroughSelection = (src) => {
  if (!Selection.hasSelection() || !Selection.mask) return src;
  const out = newCanvas(src.width, src.height);
  const ctx = out.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(Selection.mask, 0, 0);
  return out;
};

// ---------- tool state ----------

const state = {
  stroke: null,          // per-pointer stroke record
  pointers: new Map(),   // pointerId -> {x, y} client coords
  pinch: null,           // {startDist, startZoom, startOffX, startOffY, cx, cy}
  spaceHeld: false,
  brushSizeAtStart: 1,
};

const resetStroke = () => { state.stroke = null; Render.overlay = null; };

export const Tools = {
  init(canvas) {
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', (e) => this._onDown(e));
    canvas.addEventListener('pointermove', (e) => this._onMove(e));
    canvas.addEventListener('pointerup', (e) => this._onUp(e));
    canvas.addEventListener('pointercancel', (e) => this._onUp(e));
    canvas.addEventListener('pointerleave', () => { Render.mouse = null; Panels.hideBrushCursor(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => this._onKeyUp(e));
  },

  set(id) {
    if (id === UI.tool) return;
    UI.tool = id;
    this.canvas.style.cursor = cursorFor[id] || 'default';
    Panels.setActiveTool(id);
    Panels.renderOptions(id);
    Panels.setHint(this.hintFor(id));
    if (!id.startsWith('brush') && id !== 'eraser') Panels.hideBrushCursor();
  },

  current() { return UI.tool; },

  hintFor(id) {
    const H = {
      move: 'Drag to move the layer · hold Shift for straight lines, Alt to duplicate',
      'marquee-rect': 'Drag a rectangle · Shift adds, Alt subtracts · Esc cancels',
      'marquee-ellipse': 'Drag an ellipse · Shift adds, Alt subtracts · Esc cancels',
      lasso: 'Freehand selection · Shift adds, Alt subtracts',
      wand: 'Click a color region · Shift adds, Alt subtracts',
      crop: 'Drag to crop · Enter applies, Esc cancels',
      eyedropper: 'Click to sample a color · Alt+click samples the background',
      brush: 'Paint · [ and ] resize · Alt+click picks a color',
      eraser: 'Erase to transparency · [ and ] resize',
      gradient: 'Drag where the gradient runs · Esc cancels',
      bucket: 'Click to fill a matching region · Alt+click picks a color',
      type: 'Click to place text · Enter commits, Esc cancels',
      shape: 'Drag to draw · Shift keeps proportions',
      hand: 'Drag to pan · hold Space anytime',
      zoom: 'Click to zoom in · Alt+click to zoom out',
    };
    return H[id] || '';
  },

  // ========== pointer plumbing ==========

  _onKeyDown(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.code === 'Space' && !state.spaceHeld) {
      state.spaceHeld = true;
      this.canvas.style.cursor = 'grab';
      e.preventDefault();
    }
  },

  _onKeyUp(e) {
    if (e.code === 'Space') {
      state.spaceHeld = false;
      this.canvas.style.cursor = cursorFor[UI.tool] || 'default';
    }
  },

  _docPos(e) {
    const p = Render.screenToDoc(e.clientX, e.clientY);
    return { ...p, cx: p.x, cy: p.y };
  },

  _onDown(e) {
    if (e.target !== this.canvas) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two fingers → pinch gesture, cancel any stroke in progress
    if (state.pointers.size === 2) {
      this._abortStroke();
      const [a, b] = [...state.pointers.values()];
      state.pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        zoom: Render.view.zoom,
        offX: Render.view.offX,
        offY: Render.view.offY,
      };
      return;
    }

    const tool = UI.tool;
    const pos = this._docPos(e);

    // Middle mouse button always pans; Space+drag pans with any tool
    if (e.button === 1 || state.spaceHeld) {
      state.stroke = { tool: '__pan', lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId };
      this.canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    // Alt+click with a paint tool picks a color
    if (e.altKey && ['brush', 'eraser', 'gradient', 'bucket'].includes(tool)) {
      this._eyedrop(pos, e);
      return;
    }

    switch (tool) {
      case 'move': return this._downMove(e, pos);
      case 'marquee-rect': return this._downMarquee(e, pos, 'rect');
      case 'marquee-ellipse': return this._downMarquee(e, pos, 'ellipse');
      case 'lasso': return this._downLasso(e, pos);
      case 'wand': return this._wand(pos, e);
      case 'crop': return this._downCrop(e, pos);
      case 'eyedropper': return this._eyedrop(pos, e);
      case 'brush': return this._downBrush(e, pos, false);
      case 'eraser': return this._downBrush(e, pos, true);
      case 'gradient': return this._downGradient(e, pos);
      case 'bucket': return this._bucket(pos, e);
      case 'type': return this._startType(e, pos);
      case 'shape': return this._downShape(e, pos);
      case 'hand':
        state.stroke = { tool: '__pan', lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId };
        this.canvas.style.cursor = 'grabbing';
        return;
      case 'zoom':
        Render.zoomAt(e.altKey ? 1 / 1.6 : 1.6, pos.sx, pos.sy);
        return;
    }
  },

  _onMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    Render.mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    // pinch zoom
    if (state.pinch && state.pointers.has(e.pointerId)) {
      state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...state.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      Render.view.zoom = clamp(state.pinch.zoom * (dist / Math.max(1, state.pinch.dist)), 0.02, 32);
      Render.view.offX = mid.x - ((state.pinch.mid.x - state.pinch.offX) / state.pinch.zoom) * Render.view.zoom;
      Render.view.offY = mid.y - ((state.pinch.mid.y - state.pinch.offY) / state.pinch.zoom) * Render.view.zoom;
      return;
    }
    if (state.pointers.has(e.pointerId)) state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const s = state.stroke;
    // brush cursor preview
    if (['brush', 'eraser'].includes(UI.tool) && !s) {
      Panels.showBrushCursor(e.clientX - rect.left, e.clientY - rect.top, (UI.tool === 'eraser' ? UI.eraserSize : UI.brushSize) * Render.view.zoom);
    }
    if (!s || s.pointerId !== e.pointerId) return;

    if (s.tool === '__pan') {
      Render.panBy(e.clientX - s.lastX, e.clientY - s.lastY);
      s.lastX = e.clientX; s.lastY = e.clientY;
      return;
    }
    const pos = this._docPos(e);
    switch (s.tool) {
      case 'move': return this._moveMove(e, pos);
      case 'marquee': return this._marqueeMove(e, pos);
      case 'lasso': return this._lassoMove(pos);
      case 'crop': return this._cropMove(e, pos);
      case 'brush': return this._brushMove(pos);
      case 'gradient': return this._gradientMove(pos);
      case 'shape': return this._shapeMove(e, pos);
    }
  },

  _onUp(e) {
    state.pointers.delete(e.pointerId);
    if (state.pinch) {
      if (state.pointers.size < 2) state.pinch = null;
      return;
    }
    const s = state.stroke;
    if (s && s.pointerId === e.pointerId) {
      if (s.tool === '__pan') {
        this.canvas.style.cursor = state.spaceHeld ? 'grab' : (cursorFor[UI.tool] || 'default');
        state.stroke = null;
        return;
      }
      const pos = this._docPos(e);
      switch (s.tool) {
        case 'move': return this._moveUp(s);
        case 'marquee': return this._marqueeUp(e, pos);
        case 'lasso': return this._lassoUp(e, pos);
        case 'crop': return this._cropUp(pos);
        case 'brush': return this._brushUp(s);
        case 'gradient': return this._gradientUp(pos);
        case 'shape': return this._shapeUp(pos);
      }
      resetStroke();
    }
  },

  _abortStroke() {
    const s = state.stroke;
    if (s?.tool === 'brush' && s.backup) {
      // restore pre-stroke content
      const layer = Doc.layer(s.layerId);
      if (layer) {
        const target = (s.masked && layer.mask) ? layer.mask : layer.canvas;
        const ctx = target.getContext('2d');
        ctx.clearRect(0, 0, target.width, target.height);
        ctx.drawImage(s.backup, 0, 0);
        Render.markDirty();
      }
      if (s.historyToken) Doc.cancelHistory(s.historyToken);
    }
    if (s?.tool === 'gradient' && s.backup) {
      const layer = Doc.layer(s.layerId);
      if (layer) {
        const ctx = layer.canvas.getContext('2d');
        ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        ctx.drawImage(s.backup, 0, 0);
        Render.markDirty();
      }
      if (s.historyToken) Doc.cancelHistory(s.historyToken);
    }
    resetStroke();
  },

  // ========== Move ==========

  _hitLayer(x, y) {
    const layers = Doc.state.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.visible) continue;
      const ctx = layer.canvas.getContext('2d', { willReadFrequently: true });
      const d = ctx.getImageData(clamp(Math.floor(x), 0, layer.canvas.width - 1), clamp(Math.floor(y), 0, layer.canvas.height - 1), 1, 1).data;
      if (d[3] > 12) return layer;
    }
    return null;
  },

  _downMove(e, pos) {
    let layer = Doc.activeLayer();
    if (UI.moveAutoSelect && pos.x >= 0 && pos.y >= 0 && pos.x < Doc.state.width && pos.y < Doc.state.height) {
      layer = this._hitLayer(pos.x, pos.y) || layer;
    }
    if (!layer) return;
    if (UI.moveAutoSelect) Doc.setActive(layer.id);
    // Alt+drag duplicates
    if (e.altKey) {
      const dup = Doc.duplicateLayer(layer.id);
      if (dup) layer = dup;
    }
    state.stroke = {
      tool: 'move', pointerId: e.pointerId, layerId: layer.id,
      startX: pos.x, startY: pos.y, moved: false,
      historyToken: null,
    };
  },

  _moveMove(e, pos) {
    const s = state.stroke;
    const layer = Doc.layer(s.layerId);
    if (!layer) return;
    let dx = pos.x - s.startX, dy = pos.y - s.startY;
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
    }
    if (!s.historyToken && (Math.round(dx) || Math.round(dy))) {
      s.historyToken = Doc.pushHistory('Move Layer').token;
    }
    layer._px = Math.round(dx);
    layer._py = Math.round(dy);
    s.moved = !!(layer._px || layer._py);
    Render.markDirty();
  },

  _moveUp(s) {
    const layer = Doc.layer(s.layerId);
    if (layer && (layer._px || layer._py)) {
      const dx = layer._px, dy = layer._py;
      const nc = newCanvas(layer.canvas.width, layer.canvas.height);
      nc.getContext('2d').drawImage(layer.canvas, dx, dy);
      layer.canvas = nc;
      layer._px = 0; layer._py = 0;
      Doc.state.dirty = true;
      Doc.state.revision++;
      Doc._notify('structure');
      Render.markDirty();
    } else if (s.historyToken) {
      Doc.cancelHistory(s.historyToken);
    }
    if (layer) { layer._px = 0; layer._py = 0; }
    resetStroke();
  },

  // ========== Marquee ==========

  _downMarquee(e, pos, shape) {
    state.stroke = {
      tool: 'marquee', shape, pointerId: e.pointerId,
      startX: pos.x, startY: pos.y, curX: pos.x, curY: pos.y,
      mode: e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'new',
      additive: e.shiftKey || e.altKey,
    };
    const sx = pos.x, sy = pos.y;
    Render.overlay = (ctx, view) => {
      const s = state.stroke;
      if (!s || s.tool !== 'marquee') return;
      const x = Math.min(s.startX, s.curX), y = Math.min(s.startY, s.curY);
      const w = Math.abs(s.curX - s.startX), h = Math.abs(s.curY - s.startY);
      this._antsRect(ctx, view, x, y, w, h, s.shape);
    };
  },

  _antsRect(ctx, view, x, y, w, h, shape) {
    ctx.save();
    ctx.translate(view.offX, view.offY);
    ctx.scale(view.zoom, view.zoom);
    const dash = 4 / view.zoom;
    ctx.setLineDash([dash, dash]);
    ctx.lineWidth = 1 / view.zoom;
    const path = new Path2D();
    if (shape === 'rect') path.rect(x, y, w, h);
    else path.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineDashOffset = 0;
    ctx.stroke(path);
    ctx.lineDashOffset = dash;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke(path);
    ctx.setLineDash([]);
    ctx.restore();
  },

  _marqueeMove(e, pos) {
    const s = state.stroke;
    let { x: cx, y: cy } = pos;
    if (e.shiftKey && s.shape === 'rect') {
      // square
      const dx = cx - s.startX, dy = cy - s.startY;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      cx = s.startX + Math.sign(dx || 1) * m;
      cy = s.startY + Math.sign(dy || 1) * m;
    }
    s.curX = cx; s.curY = cy;
    Render.markDirty(); // overlay draws on the rAF loop regardless
  },

  _marqueeUp(e, pos) {
    const s = state.stroke;
    const { startX, startY, curX, curY, shape, mode } = s;
    const w = Math.abs(curX - startX), h = Math.abs(curY - startY);
    if (w < 3 && h < 3) {
      if (mode === 'new') Selection.clear();
      resetStroke();
      return;
    }
    const x = Math.min(startX, curX), y = Math.min(startY, curY);
    const feather = clamp(UI.marqueeFeather || 0, 0, 250);
    if (shape === 'rect') Selection.rect(x, y, w, h, mode, feather);
    else Selection.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, mode, feather);
    resetStroke();
    Panels.setHint('Selection made · Edit ▸ Fill, or drag with the Move tool');
  },

  // ========== Lasso ==========

  _downLasso(e, pos) {
    state.stroke = { tool: 'lasso', pointerId: e.pointerId, points: [[pos.x, pos.y]], mode: e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'new' };
    Render.overlay = (ctx, view) => {
      const s = state.stroke;
      if (!s || s.tool !== 'lasso' || s.points.length < 2) return;
      ctx.save();
      ctx.translate(view.offX, view.offY);
      ctx.scale(view.zoom, view.zoom);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4 / view.zoom;
      ctx.setLineDash([4 / view.zoom, 4 / view.zoom]);
      ctx.beginPath();
      ctx.moveTo(s.points[0][0], s.points[0][1]);
      for (const p of s.points) ctx.lineTo(p[0], p[1]);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    };
  },

  _lassoMove(pos) {
    const s = state.stroke;
    const last = s.points[s.points.length - 1];
    if (Math.hypot(pos.x - last[0], pos.y - last[1]) >= Math.max(1.5, 2 / Render.view.zoom)) {
      s.points.push([pos.x, pos.y]);
    }
  },

  _lassoUp(e, pos) {
    const s = state.stroke;
    s.points.push([pos.x, pos.y]);
    if (s.points.length > 8) Selection.polygon(s.points, true, s.mode, clamp(UI.marqueeFeather || 0, 0, 250));
    else if (s.mode === 'new') Selection.clear();
    resetStroke();
  },

  // ========== Wand ==========

  _wand(pos, e) {
    const mode = e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'new';
    let source;
    if (UI.wandSampleAll) {
      source = Render.getComposite();
    } else {
      const layer = Doc.activeLayer();
      if (!layer) { Panels.toast('Pick a layer first (or enable “Sample all layers”).'); return; }
      source = layer.canvas;
    }
    const w = source.width, h = source.height;
    const img = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const maskCanvas = Selection.wand(img, w, h, pos.x, pos.y, UI.wandTolerance, UI.wandContiguous);
    Selection.fromPixelMask(maskCanvas, mode);
  },

  // ========== Crop ==========

  _downCrop(e, pos) {
    state.stroke = { tool: 'crop', pointerId: e.pointerId, startX: pos.x, startY: pos.y, curX: pos.x, curY: pos.y };
    this._updateCropOverlay();
  },

  _updateCropOverlay() {
    Render.overlay = (ctx, view) => {
      const s = state.stroke;
      if (!s || s.tool !== 'crop') return;
      const x = Math.min(s.startX, s.curX), y = Math.min(s.startY, s.curY);
      const w = Math.abs(s.curX - s.startX), h = Math.abs(s.curY - s.startY);
      ctx.save();
      ctx.translate(view.offX, view.offY);
      ctx.scale(view.zoom, view.zoom);
      // dim outside
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const W = Doc.state.width, H = Doc.state.height;
      ctx.fillRect(0, 0, W, y);
      ctx.fillRect(0, y + h, W, H - y - h);
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, W - x - w, h);
      // frame + thirds
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / view.zoom;
      ctx.strokeRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1 / view.zoom;
      ctx.beginPath();
      for (const t of [1 / 3, 2 / 3]) {
        ctx.moveTo(x + w * t, y); ctx.lineTo(x + w * t, y + h);
        ctx.moveTo(x, y + h * t); ctx.lineTo(x + w, y + h * t);
      }
      ctx.stroke();
      ctx.restore();
    };
  },

  _cropMove(e, pos) {
    const s = state.stroke;
    let { x, y } = pos;
    const ratio = UI.cropAspect;
    if (ratio && ratio > 0) {
      const dx = x - s.startX, dy = y - s.startY;
      const m = Math.max(Math.abs(dx), Math.abs(dy) / ratio);
      x = s.startX + Math.sign(dx || 1) * m;
      y = s.startY + Math.sign(dy || 1) * m * ratio;
    }
    s.curX = x; s.curY = y;
  },

  _cropUp(pos) {
    const s = state.stroke;
    const x = Math.min(s.startX, s.curX), y = Math.min(s.startY, s.curY);
    const w = Math.abs(s.curX - s.startX), h = Math.abs(s.curY - s.startY);
    if (w >= 8 && h >= 8) {
      this.pendingCrop = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      Panels.showCropActions(true);
      // keep the overlay visible until the user confirms
      const pending = this.pendingCrop;
      Render.overlay = (ctx, view) => {
        ctx.save();
        ctx.translate(view.offX, view.offY);
        ctx.scale(view.zoom, view.zoom);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        const W = Doc.state.width, H = Doc.state.height;
        ctx.fillRect(0, 0, W, pending.y);
        ctx.fillRect(0, pending.y + pending.h, W, H - pending.y - pending.h);
        ctx.fillRect(0, pending.y, pending.x, pending.h);
        ctx.fillRect(pending.x + pending.w, pending.y, W - pending.x - pending.w, pending.h);
        ctx.strokeStyle = '#2f8cff';
        ctx.lineWidth = 2 / view.zoom;
        ctx.strokeRect(pending.x, pending.y, pending.w, pending.h);
        ctx.restore();
      };
    } else {
      resetStroke();
    }
    state.stroke = null;
  },

  applyCrop() {
    const p = this.pendingCrop;
    if (!p) return;
    Doc.cropRect(p.x, p.y, p.w, p.h);
    Selection.clear();
    this.pendingCrop = null;
    Panels.showCropActions(false);
    Render.overlay = null;
  },

  cancelCrop() {
    this.pendingCrop = null;
    Panels.showCropActions(false);
    Render.overlay = null;
  },

  // ========== Eyedropper ==========

  _eyedrop(pos, e) {
    const radius = (UI.eyedropperSample || 1) - 1; // 1,3,5 → radius 0,1,2
    const [r, g, b] = sampleComposite(pos.x, pos.y, radius);
    const hex = rgbToHex(r, g, b);
    if (e?.altKey) UI.bg = hex; else UI.fg = hex;
    Panels.updateSwatches();
  },

  // ========== Brush / Eraser ==========

  _downBrush(e, pos, erase) {
    const layer = activeLayerOrToast();
    if (!layer) return;
    const size = erase ? UI.eraserSize : UI.brushSize;
    const token = Doc.pushHistory(UI.editingMaskFor === layer.id ? 'Mask Stroke' : erase ? 'Eraser' : 'Brush Stroke').token;
    state.stroke = {
      tool: 'brush', erase, pointerId: e.pointerId,
      layerId: layer.id, lastX: pos.x, lastY: pos.y,
      size, stamp: makeStamp(Math.max(1, Math.round(size)), UI.brushHardness),
      backup: copyCanvas(UI.editingMaskFor === layer.id && layer.mask ? layer.mask : layer.canvas),
      masked: UI.editingMaskFor === layer.id && !!layer.mask,
      historyToken: token,
    };
    this._stampAt(layer, pos.x, pos.y, state.stroke);
    Render.markDirty();
    Panels.hideBrushCursor();
  },

  _stampAt(layer, x, y, s) {
    const paintMask = !s.erase && layer.mask && UI.editingMaskFor === layer.id;
    const target = paintMask ? layer.mask : layer.canvas;
    const ctx = target.getContext('2d');
    ctx.save();
    if (s.erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = UI.brushOpacity;
      ctx.drawImage(s.stamp, x - s.stamp.width / 2, y - s.stamp.height / 2);
    } else if (paintMask) {
      // Painting the layer mask: light color reveals, dark conceals.
      const [fr, fg2, fb] = hexToRgb(UI.fg);
      const luma = 0.2126 * fr + 0.7152 * fg2 + 0.0722 * fb;
      const revealing = luma >= 128;
      const stamp = s.stamp;
      if (revealing) {
        const tmp = newCanvas(stamp.width, stamp.height);
        const tctx = tmp.getContext('2d');
        tctx.drawImage(stamp, 0, 0);
        tctx.globalCompositeOperation = 'source-in';
        tctx.fillStyle = '#ffffff';
        tctx.fillRect(0, 0, tmp.width, tmp.height);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = UI.brushOpacity;
        ctx.drawImage(tmp, x - tmp.width / 2, y - tmp.height / 2);
      } else {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = UI.brushOpacity;
        ctx.drawImage(stamp, x - stamp.width / 2, y - stamp.height / 2);
      }
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = UI.brushOpacity;
      const [r, g, b] = hexToRgb(UI.fg);
      const tmp = newCanvas(s.stamp.width, s.stamp.height);
      const tctx = tmp.getContext('2d');
      tctx.drawImage(s.stamp, 0, 0);
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = `rgb(${r},${g},${b})`;
      tctx.fillRect(0, 0, tmp.width, tmp.height);
      ctx.drawImage(tmp, x - tmp.width / 2, y - tmp.height / 2);
    }
    ctx.restore();
  },

  _brushMove(pos) {
    const s = state.stroke;
    const layer = Doc.layer(s.layerId);
    if (!layer) return;
    const dx = pos.x - s.lastX, dy = pos.y - s.lastY;
    const dist = Math.hypot(dx, dy);
    const spacing = Math.max(0.8, s.size * 0.14);
    if (dist < spacing) return;
    const steps = Math.floor(dist / spacing);
    for (let i = 1; i <= steps; i++) {
      this._stampAt(layer, s.lastX + (dx * i) / steps, s.lastY + (dy * i) / steps, s);
    }
    s.lastX += (dx * steps * spacing) / dist;
    s.lastY += (dy * steps * spacing) / dist;
    Render.markDirty();
  },

  _brushUp(s) {
    const layer = Doc.layer(s.layerId);
    if (layer) {
      Doc.state.dirty = true;
      Doc.state.revision++;
      Doc._notify('structure');
    }
    Render.markDirty();
    resetStroke();
    Panels.refreshLayers();
  },

  // ========== Gradient ==========

  _downGradient(e, pos) {
    const layer = activeLayerOrToast();
    if (!layer) return;
    const token = Doc.pushHistory('Gradient').token;
    state.stroke = {
      tool: 'gradient', pointerId: e.pointerId, layerId: layer.id,
      startX: pos.x, startY: pos.y, curX: pos.x, curY: pos.y,
      backup: copyCanvas(layer.canvas), historyToken: token,
    };
    Render.overlay = (ctx, view) => {
      const s = state.stroke;
      if (!s || s.tool !== 'gradient') return;
      ctx.save();
      ctx.translate(view.offX, view.offY);
      ctx.scale(view.zoom, view.zoom);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2 / view.zoom;
      ctx.setLineDash([5 / view.zoom, 5 / view.zoom]);
      ctx.beginPath();
      ctx.moveTo(s.startX, s.startY);
      ctx.lineTo(s.curX, s.curY);
      ctx.stroke();
      ctx.restore();
    };
  },

  _renderGradient(layer, s) {
    const w = layer.canvas.width, h = layer.canvas.height;
    const ctx = layer.canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(s.backup, 0, 0);
    const [fr, fg, fb] = hexToRgb(UI.gradientReverse ? UI.bg : UI.fg);
    const [tr, tg, tb] = hexToRgb(UI.gradientReverse ? UI.fg : UI.bg);
    const grad = UI.gradientShape === 'radial'
      ? ctx.createRadialGradient(s.startX, s.startY, 0, s.startX, s.startY, Math.max(1, Math.hypot(s.curX - s.startX, s.curY - s.startY)))
      : (() => { const g = ctx.createLinearGradient(s.startX, s.startY, s.curX, s.curY); return g; })();
    if (UI.gradientStyle === 'fg-transparent') {
      grad.addColorStop(0, `rgba(${fr},${fg},${fb},1)`);
      grad.addColorStop(1, `rgba(${fr},${fg},${fb},0)`);
    } else {
      grad.addColorStop(0, `rgb(${fr},${fg},${fb})`);
      grad.addColorStop(1, `rgb(${tr},${tg},${tb})`);
    }
    const fill = newCanvas(w, h);
    const fctx = fill.getContext('2d');
    fctx.fillStyle = grad; // gradient coordinates are in document space; fill uses them correctly
    fctx.fillRect(0, 0, w, h);
    const clipped = clipThroughSelection(fill);
    ctx.drawImage(clipped, 0, 0);
  },

  _gradientMove(pos) {
    const s = state.stroke;
    s.curX = pos.x; s.curY = pos.y;
    const layer = Doc.layer(s.layerId);
    if (layer) { this._renderGradient(layer, s); Render.markDirty(); }
  },

  _gradientUp() {
    const s = state.stroke;
    const layer = Doc.layer(s.layerId);
    if (layer) { this._renderGradient(layer, s); Doc.state.dirty = true; Doc.state.revision++; Doc._notify('structure'); }
    Render.markDirty();
    resetStroke();
    Panels.refreshLayers();
  },

  // ========== Bucket ==========

  _bucket(pos, e) {
    if (e.altKey) return this._eyedrop(pos, e);
    const layer = activeLayerOrToast();
    if (!layer) return;
    const w = layer.canvas.width, h = layer.canvas.height;
    const x = clamp(Math.floor(pos.x), 0, w - 1), y = clamp(Math.floor(pos.y), 0, h - 1);
    Doc.pushHistory('Paint Bucket');
    const ctx = layer.canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h).data;
    const mask = Selection.wand(img, w, h, x, y, UI.bucketTolerance, UI.bucketContiguous);
    const [fr, fg, fb] = hexToRgb(UI.fg);
    const fillC = newCanvas(w, h);
    const fctx = fillC.getContext('2d');
    fctx.fillStyle = `rgb(${fr},${fg},${fb})`;
    fctx.fillRect(0, 0, w, h);
    // clip fill to bucket mask
    const clipped = newCanvas(w, h);
    const cctx = clipped.getContext('2d');
    cctx.drawImage(fillC, 0, 0);
    cctx.globalCompositeOperation = 'destination-in';
    cctx.drawImage(mask, 0, 0);
    // then clip to selection (if any)
    const selClip = clipThroughSelection(clipped);
    ctx.drawImage(selClip, 0, 0);
    Doc.state.dirty = true;
    Doc.state.revision++;
    Doc._notify('structure');
    Render.markDirty();
    Panels.refreshLayers();
  },

  // ========== Type ==========

  _startType(e, pos) {
    const rect = this.canvas.getBoundingClientRect();
    const screen = Render.docToScreen(pos.x, pos.y);
    const area = document.getElementById('canvasArea');
    const ta = document.createElement('textarea');
    ta.className = 'kb-type-input';
    ta.style.left = `${screen.x}px`;
    ta.style.top = `${screen.y}px`;
    ta.style.fontFamily = UI.fontFamily;
    ta.style.fontWeight = UI.fontBold ? '700' : '400';
    ta.style.fontStyle = UI.fontItalic ? 'italic' : 'normal';
    ta.style.fontSize = `${clamp(UI.fontSize * Render.view.zoom, 8, 400)}px`;
    ta.style.color = UI.fg;
    ta.rows = 1;
    ta.placeholder = 'Type…';
    area.appendChild(ta);
    setTimeout(() => ta.focus(), 0);
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const text = ta.value.replace(/\s+$/, '');
      ta.remove();
      if (!text.trim()) return;
      Doc.pushHistory('Type Layer');
      const canvas = newCanvas(Doc.state.width, Doc.state.height);
      const ctx = canvas.getContext('2d');
      ctx.font = `${UI.fontItalic ? 'italic ' : ''}${UI.fontBold ? '700' : '400'} ${UI.fontSize}px ${UI.fontFamily}`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = UI.fg;
      const lines = text.split('\n');
      lines.forEach((line, i) => ctx.fillText(line, pos.x, pos.y + i * UI.fontSize * 1.25));
      Doc.addLayer({ id: uid(), name: text.split('\n')[0].slice(0, 48) || 'Text', visible: true, opacity: 1, blendMode: 'normal', canvas, mask: null, maskEnabled: true });
      Render.markDirty();
      Panels.refreshLayers();
    };
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') { done = true; ta.remove(); }
    });
    ta.addEventListener('blur', commit);
  },

  // ========== Shape ==========

  _downShape(e, pos) {
    state.stroke = { tool: 'shape', pointerId: e.pointerId, startX: pos.x, startY: pos.y, curX: pos.x, curY: pos.y, square: false };
    Render.overlay = (ctx, view) => {
      const s = state.stroke;
      if (!s || s.tool !== 'shape') return;
      ctx.save();
      ctx.translate(view.offX, view.offY);
      ctx.scale(view.zoom, view.zoom);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / view.zoom;
      const r = this._shapeRect(s, s.square);
      ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
      this._shapePath(ctx, r, UI.shapeKind);
      ctx.stroke();
      ctx.restore();
    };
  },

  _shapeRect(s, square) {
    let x = Math.min(s.startX, s.curX), y = Math.min(s.startY, s.curY);
    let w = Math.abs(s.curX - s.startX), h = Math.abs(s.curY - s.startY);
    if (square) { const m = Math.max(w, h); w = m; h = m; x = s.curX >= s.startX ? s.startX : s.startX - m; y = s.curY >= s.startY ? s.startY : s.startY - m; }
    return { x, y, w, h, x1: s.startX, y1: s.startY, x2: s.curX, y2: s.curY };
  },

  _shapePath(ctx, r, kind) {
    ctx.beginPath();
    if (kind === 'rect') ctx.rect(r.x, r.y, r.w, r.h);
    else if (kind === 'ellipse') ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    else if (kind === 'line') { ctx.moveTo(r.x1, r.y1); ctx.lineTo(r.x2, r.y2); }
  },

  _shapeMove(e, pos) {
    const s = state.stroke;
    s.curX = pos.x; s.curY = pos.y;
    s.square = e.shiftKey;
    // update overlay to use the shift-constrained rect — rebuilt inside _shapeRect each frame
    Render.overlay = null; // rebuilt below with the shift flag baked in
    Render.overlay = (ctx, view) => {
      ctx.save();
      ctx.translate(view.offX, view.offY);
      ctx.scale(view.zoom, view.zoom);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / view.zoom;
      ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
      const r = this._shapeRect(s, s.square);
      ctx.beginPath();
      if (UI.shapeKind === 'rect') ctx.rect(r.x, r.y, r.w, r.h);
      else if (UI.shapeKind === 'ellipse') ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      else { ctx.moveTo(r.x1, r.y1); ctx.lineTo(r.x2, r.y2); }
      ctx.stroke();
      ctx.restore();
    };
  },

  _shapeUp(pos) {
    const s = state.stroke;
    const r = this._shapeRect(s, s.square);
    const w = Math.abs(s.curX - s.startX), h = Math.abs(s.curY - s.startY);
    if (Math.max(w, h) < 2) { resetStroke(); return; }
    Doc.pushHistory('Shape');
    const canvas = newCanvas(Doc.state.width, Doc.state.height);
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    if (UI.shapeKind === 'rect') ctx.rect(r.x, r.y, r.w, r.h);
    else if (UI.shapeKind === 'ellipse') ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    else { ctx.moveTo(s.startX, s.startY); ctx.lineTo(s.curX, s.curY); }
    if (UI.shapeKind === 'line') {
      ctx.strokeStyle = UI.fg;
      ctx.lineWidth = Math.max(1, UI.shapeStrokeWidth);
      ctx.lineCap = 'round';
      ctx.stroke();
    } else {
      if (UI.shapeFill) { ctx.fillStyle = UI.fg; ctx.fill(); }
      if (UI.shapeStroke) { ctx.strokeStyle = UI.bg; ctx.lineWidth = Math.max(1, UI.shapeStrokeWidth); ctx.stroke(); }
    }
    Doc.addLayer({ id: uid(), name: UI.shapeKind === 'rect' ? 'Rectangle' : UI.shapeKind === 'ellipse' ? 'Ellipse' : 'Line', visible: true, opacity: 1, blendMode: 'normal', canvas, mask: null, maskEnabled: true });
    Render.markDirty();
    resetStroke();
    Panels.refreshLayers();
  },
};
