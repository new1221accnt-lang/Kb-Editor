// Document model: layers, history, canvas-level operations.
// A layer is full-canvas-sized (offsets are only a transient move preview), which keeps
// brushes, filters, masks and transforms simple and correct for an in-browser editor.

import { clamp, copyCanvas, newCanvas, uid } from './util.js';

export const MAX_DIM = 8000;
export const MAX_PIXELS = 30_000_000; // guard against tab OOM (canvas = w*h*4 bytes)
export const UNDO_LIMIT = 25;

const cloneLayer = (layer) => ({
  id: layer.id,
  name: layer.name,
  visible: layer.visible,
  opacity: layer.opacity,
  blendMode: layer.blendMode,
  canvas: copyCanvas(layer.canvas),
  mask: layer.mask ? copyCanvas(layer.mask) : null,
  maskEnabled: layer.maskEnabled !== false,
});

export const createLayer = (name, canvas) => ({
  id: uid(),
  name: name || 'Layer',
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  canvas,
  mask: null,
  maskEnabled: true,
});

const emit = (type) => Doc._notify(type);

export const Doc = {
  state: {
    width: 1920,
    height: 1080,
    name: 'untitled-1',
    layers: [],
    activeId: null,
    dirty: false,
    revision: 0,
  },
  undoStack: [],
  redoStack: [],
  _listeners: [],
  _tokenCounter: 0,

  onChange(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter((f) => f !== fn); }; },
  _notify(type) { for (const fn of this._listeners) { try { fn(type); } catch (e) { console.error('listener error', e); } } },

  // ---------- document lifecycle ----------

  newDocument(name, width, height, background = 'white') {
    width = clamp(Math.round(width) || 1, 1, MAX_DIM);
    height = clamp(Math.round(height) || 1, 1, MAX_DIM);
    const base = newCanvas(width, height);
    if (background === 'white') {
      const ctx = base.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    } else if (background === 'black') {
      const ctx = base.getContext('2d');
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
    }
    const layer = createLayer(background === 'transparent' ? 'Layer 1' : 'Background', base);
    this.state = { width, height, name: name || 'untitled-1', layers: [layer], activeId: layer.id, dirty: false, revision: 0 };
    this.undoStack = [];
    this.redoStack = [];
    emit('structure');
    return this.state;
  },

  /** Replace the document with imported content. `layers` are bottom→top. */
  fromImport(name, width, height, layers) {
    this.state = {
      width, height, name: name || 'imported',
      layers,
      activeId: layers.length ? layers[layers.length - 1].id : null,
      dirty: false,
      revision: 0,
    };
    this.undoStack = [];
    this.redoStack = [];
    emit('structure');
    return this.state;
  },

  /** Total bytes the layer stack holds (rough, for the status bar). */
  memoryEstimate() {
    let bytes = this.state.width * this.state.height * 4;
    for (const l of this.state.layers) {
      bytes += l.canvas.width * l.canvas.height * 4;
      if (l.mask) bytes += l.mask.width * l.mask.height * 4;
    }
    return bytes;
  },

  // ---------- layer queries ----------

  layerIndex(id) { return this.state.layers.findIndex((l) => l.id === id); },
  layer(id) { return this.state.layers.find((l) => l.id === id) || null; },
  activeLayer() { return this.layer(this.state.activeId); },
  setActive(id) {
    if (id && !this.layer(id)) return;
    this.state.activeId = id;
    emit('active');
  },

  // ---------- history ----------

  snapshot(label) {
    return {
      token: ++this._tokenCounter,
      label,
      width: this.state.width,
      height: this.state.height,
      activeId: this.state.activeId,
      layers: this.state.layers.map(cloneLayer),
    };
  },

  restore(snap) {
    this.state.width = snap.width;
    this.state.height = snap.height;
    this.state.layers = snap.layers.map(cloneLayer); // clone again so redo/undo snapshots stay independent
    this.state.activeId = this.layer(snap.activeId) ? snap.activeId : (this.state.layers[this.state.layers.length - 1]?.id ?? null);
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
  },

  pushHistory(label = 'Edit') {
    this.undoStack.push(this.snapshot(label));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    emit('history');
    return this.undoStack[this.undoStack.length - 1];
  },

  /** Remove the history entry we just pushed (used when a live-preview dialog is cancelled). */
  cancelHistory(token) {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && top.token === token) this.undoStack.pop();
    emit('history');
  },

  undo() {
    if (!this.undoStack.length) return false;
    const snap = this.undoStack.pop();
    this.redoStack.push(this.snapshot(snap.label));
    this.restore(snap);
    emit('history');
    return true;
  },

  redo() {
    if (!this.redoStack.length) return false;
    const snap = this.redoStack.pop();
    this.undoStack.push(this.snapshot(snap.label));
    this.restore(snap);
    emit('history');
    return true;
  },

  // ---------- layer operations ----------

  addLayer(layer, { activate = true } = {}) {
    this.state.layers.push(layer);
    if (activate) this.state.activeId = layer.id;
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
    return layer;
  },

  /** Insert a new transparent layer directly above the active one. */
  newLayer(name) {
    this.pushHistory('New Layer');
    const canvas = newCanvas(this.state.width, this.state.height);
    const layer = createLayer(name || this._uniqueName('Layer'), canvas);
    const idx = this.state.activeId ? this.layerIndex(this.state.activeId) + 1 : this.state.layers.length;
    this.state.layers.splice(idx, 0, layer);
    this.state.activeId = layer.id;
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
    return layer;
  },

  _uniqueName(base) {
    const names = new Set(this.state.layers.map((l) => l.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  },

  duplicateLayer(id) {
    const src = this.layer(id || this.state.activeId);
    if (!src) return null;
    this.pushHistory('Duplicate Layer');
    const copy = cloneLayer(src);
    copy.id = uid();
    copy.name = this._uniqueName(src.name.replace(/ copy( \d+)?$/, '') + ' copy');
    const idx = this.layerIndex(src.id) + 1;
    this.state.layers.splice(idx, 0, copy);
    this.state.activeId = copy.id;
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
    return copy;
  },

  deleteLayer(id) {
    const target = id || this.state.activeId;
    const idx = this.layerIndex(target);
    if (idx < 0 || this.state.layers.length <= 1) {
      return false;
    }
    this.pushHistory('Delete Layer');
    this.state.layers.splice(idx, 1);
    if (this.state.activeId === target) {
      this.state.activeId = this.state.layers[Math.min(idx, this.state.layers.length - 1)].id;
    }
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
    return true;
  },

  /** Move a layer up (+1, toward top) or down (-1) in the stack. */
  moveLayer(id, dir) {
    const idx = this.layerIndex(id);
    if (idx < 0) return false;
    const to = idx + dir;
    if (to < 0 || to >= this.state.layers.length) return false;
    this.pushHistory(dir > 0 ? 'Bring Forward' : 'Send Backward');
    const [layer] = this.state.layers.splice(idx, 1);
    this.state.layers.splice(to, 0, layer);
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
    return true;
  },

  moveLayerToEdge(id, toTop) {
    const idx = this.layerIndex(id);
    if (idx < 0) return false;
    this.pushHistory(toTop ? 'Bring to Front' : 'Send to Back');
    const [layer] = this.state.layers.splice(idx, 1);
    if (toTop) this.state.layers.push(layer); else this.state.layers.unshift(layer);
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
    return true;
  },

  renameLayer(id, name) {
    const layer = this.layer(id);
    if (!layer || !name.trim()) return;
    this.pushHistory('Rename Layer');
    layer.name = name.trim();
    this.state.dirty = true;
    emit('structure');
  },

  setVisibility(id, visible) {
    const layer = this.layer(id);
    if (!layer) return;
    layer.visible = visible;
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
  },

  setOpacity(id, opacity) {
    const layer = this.layer(id);
    if (!layer) return;
    layer.opacity = clamp(opacity, 0, 1);
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
  },

  setBlendMode(id, mode) {
    const layer = this.layer(id);
    if (!layer) return;
    layer.blendMode = mode;
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
  },

  /** Composite the active layer onto the one below it (same stacking rules as render). */
  mergeDown(id, drawComposite) {
    const sourceId = id || this.state.activeId;
    const idx = this.layerIndex(sourceId);
    if (idx <= 0) return false;
    this.pushHistory('Merge Down');
    const upper = this.state.layers[idx];
    const lower = this.state.layers[idx - 1];
    const ctx = lower.canvas.getContext('2d');
    ctx.save();
    ctx.globalAlpha = clamp(upper.opacity, 0, 1);
    ctx.globalCompositeOperation = blendModeToCanvas(upper.blendMode);
    ctx.drawImage(renderLayerWithMask(upper, this.state.width, this.state.height), 0, 0);
    ctx.restore();
    // A merged layer keeps the lower layer's mask only if it has one; merging masks isn't meaningful here.
    this.state.layers.splice(idx, 1);
    this.state.activeId = lower.id;
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
    return true;
  },

  flatten() {
    if (!this.state.layers.length) return false;
    this.pushHistory('Flatten Image');
    const flat = newCanvas(this.state.width, this.state.height);
    const ctx = flat.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    for (const layer of this.state.layers) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = clamp(layer.opacity, 0, 1);
      ctx.globalCompositeOperation = blendModeToCanvas(layer.blendMode);
      ctx.drawImage(renderLayerWithMask(layer, this.state.width, this.state.height), 0, 0);
      ctx.restore();
    }
    const merged = createLayer('Background', flat);
    this.state.layers = [merged];
    this.state.activeId = merged.id;
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
    return true;
  },

  // ---------- masks ----------

  addMask(id) {
    const layer = this.layer(id || this.state.activeId);
    if (!layer) return false;
    this.pushHistory('Add Layer Mask');
    const mask = newCanvas(this.state.width, this.state.height);
    const ctx = mask.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, mask.width, mask.height); // white = fully visible
    layer.mask = mask;
    layer.maskEnabled = true;
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
    return true;
  },

  toggleMask(id) {
    const layer = this.layer(id || this.state.activeId);
    if (!layer || !layer.mask) return false;
    this.pushHistory(layer.maskEnabled ? 'Disable Mask' : 'Enable Mask');
    layer.maskEnabled = !layer.maskEnabled;
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
    return true;
  },

  deleteMask(id) {
    const layer = this.layer(id || this.state.activeId);
    if (!layer || !layer.mask) return false;
    this.pushHistory('Delete Mask');
    layer.mask = null;
    layer.maskEnabled = true;
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
    return true;
  },

  // ---------- canvas operations ----------

  /** Crop the whole document to (x, y, w, h) in document pixels. */
  cropRect(x, y, w, h) {
    x = Math.round(x); y = Math.round(y);
    w = clamp(Math.round(w), 1, MAX_DIM); h = clamp(Math.round(h), 1, MAX_DIM);
    this.pushHistory('Crop');
    for (const layer of this.state.layers) {
      layer.canvas = cropDraw(layer.canvas, x, y, w, h);
      if (layer.mask) layer.mask = cropDraw(layer.mask, x, y, w, h);
    }
    this.state.width = w;
    this.state.height = h;
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
  },

  /** Resize the canvas without scaling content. anchorX/anchorY in 0..1 (0=left/top, 0.5=center, 1=right/bottom). */
  resizeCanvas(w, h, anchorX = 0.5, anchorY = 0.5) {
    w = clamp(Math.round(w), 1, MAX_DIM); h = clamp(Math.round(h), 1, MAX_DIM);
    this.pushHistory('Canvas Size');
    const dx = Math.round((w - this.state.width) * anchorX);
    const dy = Math.round((h - this.state.height) * anchorY);
    for (const layer of this.state.layers) {
      const nc = newCanvas(w, h);
      nc.getContext('2d').drawImage(layer.canvas, dx, dy);
      layer.canvas = nc;
      if (layer.mask) {
        const nm = newCanvas(w, h);
        nm.getContext('2d').drawImage(layer.mask, dx, dy);
        layer.mask = nm;
      }
    }
    this.state.width = w;
    this.state.height = h;
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
  },

  /** Rescale content and canvas (image size). */
  resizeImage(w, h) {
    w = clamp(Math.round(w), 1, MAX_DIM); h = clamp(Math.round(h), 1, MAX_DIM);
    if (w * h > MAX_PIXELS) {
      throw new Error(`Refusing to create a ${w}×${h} document (pixel cap is ${(MAX_PIXELS / 1e6).toFixed(0)} MP).`);
    }
    this.pushHistory('Image Size');
    for (const layer of this.state.layers) {
      const nc = newCanvas(w, h);
      const ctx = nc.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(layer.canvas, 0, 0, w, h);
      layer.canvas = nc;
      if (layer.mask) {
        const nm = newCanvas(w, h);
        nm.getContext('2d').drawImage(layer.mask, 0, 0, w, h);
        layer.mask = nm;
      }
    }
    this.state.width = w;
    this.state.height = h;
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
  },

  rotateCanvas(dir) { // 90 | -90 | 180
    this.pushHistory('Rotate Canvas');
    const inW = this.state.width, inH = this.state.height;
    const outW = dir === 180 ? inW : inH;
    const outH = dir === 180 ? inH : inW;
    for (const layer of this.state.layers) {
      const nc = newCanvas(outW, outH);
      const ctx = nc.getContext('2d');
      ctx.translate(outW / 2, outH / 2);
      ctx.rotate((dir * Math.PI) / 180);
      ctx.drawImage(layer.canvas, -inW / 2, -inH / 2);
      layer.canvas = nc;
      if (layer.mask) {
        const nm = newCanvas(outW, outH);
        const mctx = nm.getContext('2d');
        mctx.translate(outW / 2, outH / 2);
        mctx.rotate((dir * Math.PI) / 180);
        mctx.drawImage(layer.mask, -inW / 2, -inH / 2);
        layer.mask = nm;
      }
    }
    this.state.width = outW;
    this.state.height = outH;
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
  },

  flipCanvas(horizontal) {
    this.pushHistory(horizontal ? 'Flip Canvas Horizontal' : 'Flip Canvas Vertical');
    const flipOne = (src) => {
      const nc = newCanvas(src.width, src.height);
      const ctx = nc.getContext('2d');
      ctx.translate(horizontal ? src.width : 0, horizontal ? 0 : src.height);
      ctx.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
      ctx.drawImage(src, 0, 0);
      return nc;
    };
    for (const layer of this.state.layers) {
      layer.canvas = flipOne(layer.canvas);
      if (layer.mask) layer.mask = flipOne(layer.mask);
    }
    this.state.dirty = true;
    this.state.revision++;
    emit('structure');
  },
};

const cropDraw = (src, x, y, w, h) => {
  const nc = newCanvas(w, h);
  nc.getContext('2d').drawImage(src, -x, -y);
  return nc;
};

/** Render a layer with its mask applied to a fresh full-size canvas. */
export const renderLayerWithMask = (layer, w, h) => {
  if (!layer.mask || layer.maskEnabled === false) return layer.canvas;
  const t = newCanvas(w, h);
  const ctx = t.getContext('2d');
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(layer.mask, 0, 0);
  ctx.restore();
  return t;
};

/** Map Photoshop/ag-psd blend mode names to canvas globalCompositeOperation values. */
export const blendModeToCanvas = (() => {
  const P = {
    'normal': 'source-over',
    'dissolve': 'source-over', // not representable; approximated
    'darken': 'darken',
    'multiply': 'multiply',
    'color burn': 'color-burn',
    'linear burn': 'multiply',       // approximated
    'darker color': 'darken',        // approximated
    'lighten': 'lighten',
    'screen': 'screen',
    'color dodge': 'color-dodge',
    'linear dodge': 'lighter',       // (add), approximated
    'linear dodge (add)': 'lighter',
    'lighter color': 'lighten',      // approximated
    'overlay': 'overlay',
    'soft light': 'soft-light',
    'hard light': 'hard-light',
    'vivid light': 'hard-light',     // approximated
    'linear light': 'hard-light',    // approximated
    'pin light': 'hard-light',       // approximated
    'hard mix': 'hard-light',        // approximated
    'difference': 'difference',
    'exclusion': 'exclusion',
    'subtract': 'difference',        // approximated (no canvas equivalent)
    'divide': 'color-dodge',         // approximated (no canvas equivalent)
    'hue': 'hue',
    'saturation': 'saturation',
    'color': 'color',
    'luminosity': 'luminosity',
    'pass through': 'source-over',
  };
  return (mode) => P[mode] || 'source-over';
})();

/** Reverse map for PSD export: canvas operation → closest Photoshop blend mode. */
export const blendModeFromCanvas = (op) => ({
  'source-over': 'normal',
  darken: 'darken',
  multiply: 'multiply',
  'color-burn': 'color burn',
  lighten: 'lighten',
  screen: 'screen',
  'color-dodge': 'color dodge',
  lighter: 'linear dodge',
  overlay: 'overlay',
  'soft-light': 'soft light',
  'hard-light': 'hard light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
}[op] || 'normal');

export const BLEND_MODES = [
  'normal', 'darken', 'multiply', 'color burn', 'linear burn', 'darker color',
  'lighten', 'screen', 'color dodge', 'linear dodge', 'lighter color',
  'overlay', 'soft light', 'hard light', 'vivid light', 'linear light', 'pin light', 'hard mix',
  'difference', 'exclusion', 'subtract', 'divide',
  'hue', 'saturation', 'color', 'luminosity',
];
