// Selection engine: full-document alpha masks + marching-ants rendering.
// Rect/ellipse/polygon selections carry a crisp vector path; wand selections carry a
// prebuilt parity-split boundary bitmap ("crawling" pixel ants).

import { clamp, newCanvas, copyCanvas } from './util.js';

const W = () => Selection._width;
const H = () => Selection._height;

export const Selection = {
  mask: null,        // canvas full doc size, alpha = selected amount, rgb = white
  kind: null,        // 'rect' | 'ellipse' | 'polygon' | 'wand' | 'all' | null
  path: null,        // Path2D in document coordinates (vector selections)
  boundaryEven: null, // parity-split boundary canvases (wand)
  boundaryOdd: null,
  lastMask: null,    // canvas (reselect)
  lastKind: null,
  active: false,
  _img: null,        // cached ImageData
  _width: 0,
  _height: 0,
  _listeners: [],

  onChange(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter((f) => f !== fn); }; },
  _changed() {
    this._img = null;
    for (const fn of this._listeners) { try { fn(); } catch (e) { console.error(e); } }
  },

  setDocSize(w, h) {
    this._width = w;
    this._height = h;
    if (this.mask && (this.mask.width !== w || this.mask.height !== h)) {
      // Document resized/cropped: scale the mask to match (crops align, resizes stretch).
      const c = newCanvas(w, h);
      c.getContext('2d').drawImage(this.mask, 0, 0, w, h);
      this.mask = c;
      this._rebuildAfterGeometryChange();
    }
  },

  _rebuildAfterGeometryChange() {
    this.path = null;
    if (this.kind === 'wand' || (!this.path && this.active && this.mask)) this._buildBoundary();
  },

  _ensureMask() {
    if (!this.mask || this.mask.width !== this._width || this.mask.height !== this._height) {
      this.mask = newCanvas(this._width, this._height);
    }
    return this.mask;
  },

  _modeFromEvent(e) {
    if (e?.shiftKey) return 'add';
    if (e?.altKey) return 'subtract';
    return 'new';
  },

  _composeShape(shapePath, mode, feather = 0) {
    const mask = this._ensureMask();
    const ctx = mask.getContext('2d');
    const draw = (target, composite, blur) => {
      target.save();
      target.globalCompositeOperation = composite;
      if (blur > 0) target.filter = `blur(${blur}px)`;
      target.fillStyle = '#ffffff';
      target.fill(shapePath);
      target.restore();
    };
    if (mode === 'new') ctx.clearRect(0, 0, mask.width, mask.height);
    // fill() honors ctx.filter, giving a feathered edge when feather > 0
    draw(ctx, mode === 'subtract' ? 'destination-out' : 'source-over', feather);
    this.active = true;
    this.kind = shapePath.__kind || 'polygon';
    this.path = mode === 'subtract' ? null : shapePath;
    if (!this.path) this._buildBoundary();
    this._changed();
  },

  rect(x, y, w, h, mode = 'new', feather = 0) {
    const p = new Path2D();
    p.rect(x, y, w, h);
    p.__kind = 'rect';
    this._composeShape(p, mode, feather);
  },

  ellipse(cx, cy, rx, ry, mode = 'new', feather = 0) {
    const p = new Path2D();
    p.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
    p.__kind = 'ellipse';
    this._composeShape(p, mode, feather);
  },

  polygon(points, close = true, mode = 'new', feather = 0) {
    if (!points.length) return;
    const p = new Path2D();
    p.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) p.lineTo(points[i][0], points[i][1]);
    if (close) p.closePath();
    p.__kind = 'polygon';
    this._composeShape(p, mode, feather);
  },

  selectAll() {
    const mask = this._ensureMask();
    const ctx = mask.getContext('2d');
    ctx.clearRect(0, 0, mask.width, mask.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, mask.width, mask.height);
    this.active = true;
    this.kind = 'all';
    this.path = null;
    this.boundaryEven = this.boundaryOdd = null;
    this._changed();
  },

  clear() {
    if (this.mask) {
      this.lastMask = copyCanvas(this.mask);
      this.lastKind = this.kind;
    }
    this.mask = null;
    this.path = null;
    this.boundaryEven = this.boundaryOdd = null;
    this.active = false;
    this.kind = null;
    this._changed();
  },

  reselect() {
    if (!this.lastMask) return false;
    this.mask = copyCanvas(this.lastMask);
    this.active = true;
    this.kind = this.lastKind || 'polygon';
    this.path = null;
    this._buildBoundary();
    this._changed();
    return true;
  },

  invert() {
    if (!this.active || !this.mask) { this.selectAll(); return; }
    const mask = this._ensureMask();
    const ctx = mask.getContext('2d');
    // alpha' = 255 - alpha : fill white, punch out current mask
    const t = copyCanvas(mask);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, mask.width, mask.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, mask.width, mask.height);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(t, 0, 0);
    ctx.restore();
    this.kind = 'wand'; // treat as bitmap selection for ants
    this.path = null;
    this._buildBoundary();
    this._changed();
  },

  /** Build a selection mask from a wand flood fill over RGBA bytes. */
  wand(data, width, height, sx, sy, tolerance, contiguous) {
    sx = clamp(Math.floor(sx), 0, width - 1);
    sy = clamp(Math.floor(sy), 0, height - 1);
    const idx = (x, y) => (y * width + x) * 4;
    const seed = idx(sx, sy);
    const sr = data[seed], sg = data[seed + 1], sb = data[seed + 2], sa = data[seed + 3];
    const match = (i) =>
      Math.abs(data[i] - sr) <= tolerance &&
      Math.abs(data[i + 1] - sg) <= tolerance &&
      Math.abs(data[i + 2] - sb) <= tolerance &&
      Math.abs(data[i + 3] - sa) <= tolerance;
    const out = new Uint8ClampedArray(width * height); // 0 or 255
    if (contiguous) {
      const stack = [sx, sy];
      while (stack.length) {
        const y = stack.pop(), x = stack.pop();
        const i = idx(x, y);
        if (out[y * width + x] || !match(i)) continue;
        out[y * width + x] = 255;
        if (x > 0) stack.push(x - 1, y);
        if (x < width - 1) stack.push(x + 1, y);
        if (y > 0) stack.push(x, y - 1);
        if (y < height - 1) stack.push(x, y + 1);
      }
    } else {
      for (let p = 0, i = 0; p < width * height; p++, i += 4) {
        if (match(i)) out[p] = 255;
      }
    }
    // Convert to alpha canvas (used as a "new" selection; combine later if needed)
    const canvas = newCanvas(width, height);
    const cctx = canvas.getContext('2d');
    const img = cctx.createImageData(width, height);
    for (let p = 0, i = 0; p < out.length; p++, i += 4) {
      if (out[p]) { img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = 255; }
    }
    cctx.putImageData(img, 0, 0);
    return canvas;
  },

  /** Replace the current selection with a pre-built full-document alpha canvas (handles add/subtract). */
  fromPixelMask(canvas, mode = 'new') {
    const mask = this._ensureMask();
    const ctx = mask.getContext('2d');
    if (mode === 'new') ctx.clearRect(0, 0, mask.width, mask.height);
    ctx.save();
    ctx.globalCompositeOperation = mode === 'subtract' ? 'destination-out' : 'source-over';
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
    this.active = true;
    this.kind = 'wand';
    this.path = null;
    this._buildBoundary();
    this._changed();
  },

  /** Boundary pixels → parity-split black/white canvases for crawling ants. */
  _buildBoundary() {
    this.boundaryEven = null;
    this.boundaryOdd = null;
    if (!this.mask) return;
    const w = this.mask.width, h = this.mask.height;
    const ctx = this.mask.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h).data;
    const mk = () => newCanvas(w, h);
    const evB = mk(), evW = mk(), odB = mk(), odW = mk();
    const evBctx = evB.getContext('2d'), evWctx = evW.getContext('2d'), odBctx = odB.getContext('2d'), odWctx = odW.getContext('2d');
    const evBimg = evBctx.createImageData(w, h), evWimg = evWctx.createImageData(w, h);
    const odBimg = odBctx.createImageData(w, h), odWimg = odWctx.createImageData(w, h);
    const at = (x, y) => (y * w + x) * 4 + 3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (img[at(x, y)] <= 127) continue;
        const border =
          x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
          img[at(x - 1, y)] <= 127 || img[at(x + 1, y)] <= 127 ||
          img[at(x, y - 1)] <= 127 || img[at(x, y + 1)] <= 127;
        if (!border) continue;
        const o = (y * w + x) * 4;
        const put = (im, a) => { im.data[o] = im.data[o + 1] = im.data[o + 2] = a; im.data[o + 3] = 255; };
        if ((x + y) % 2 === 0) { put(evBimg, 0); put(evWimg, 255); }
        else { put(odBimg, 0); put(odWimg, 255); }
      }
    }
    evBctx.putImageData(evBimg, 0, 0);
    evWctx.putImageData(evWimg, 0, 0);
    odBctx.putImageData(odBimg, 0, 0);
    odWctx.putImageData(odWimg, 0, 0);
    this.boundaryEven = { black: evB, white: evW };
    this.boundaryOdd = { black: odB, white: odW };
  },

  /** Cached alpha bytes of the mask (255 = selected). Null when there is no selection. */
  alpha() {
    if (!this.active || !this.mask) return null;
    if (!this._img) {
      this._img = this.mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, this.mask.width, this.mask.height);
    }
    return this._img.data;
  },

  alphaAt(x, y) {
    const d = this.alpha();
    if (!d) return 255;
    const i = ((clamp(y, 0, this._height - 1) | 0) * this._width + clamp(x, 0, this._width - 1) | 0) * 4 + 3;
    return d[i];
  },

  hasSelection() { return this.active && !!this.mask; },

  bounds() {
    if (!this.active || !this.mask) return null;
    const d = this.alpha();
    const w = this._width, h = this._height;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 127) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  },
};
