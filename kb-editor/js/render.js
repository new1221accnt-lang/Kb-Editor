// Rendering engine: document compositor + viewport (zoom/pan), checkerboard, rulers,
// guides, grid and marching ants. One rAF loop draws everything.

import { clamp, newCanvas } from './util.js';
import { Doc, blendModeToCanvas, renderLayerWithMask } from './document.js';
import { Selection } from './selection.js';
import { UI } from './state.js';

const niceStep = (minPx, zoom) => {
  const target = minPx / zoom;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) {
    if (pow * m >= target) return pow * m;
  }
  return pow * 10;
};

export const Render = {
  canvas: null,
  ctx: null,
  rulerTop: null,
  rulerLeft: null,
  corner: null,
  container: null,
  composite: null,
  compositeDirty: true,
  view: { zoom: 1, offX: 0, offY: 0 },
  guides: [],
  overlay: null,      // fn(ctx, view) called each frame after the document is drawn
  mouse: null,        // logical canvas-relative px {x, y}
  _checker: null,
  _antsPhase: 0,
  _lastAnts: 0,
  _temp: null,        // reusable composite scratch
  _dpr: 1,
  _rect: null,

  init(canvas, container, rulerTop, rulerLeft, corner) {
    this.canvas = canvas;
    this.container = container;
    this.rulerTop = rulerTop;
    this.rulerLeft = rulerLeft;
    this.corner = corner;
    this.ctx = canvas.getContext('2d');
    this._checker = this._makeChecker();
    this._dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this._bindWheel();
    this._bindRulerDrags();
    requestAnimationFrame((t) => this._frame(t));
  },

  resize() {
    const rect = this.container.getBoundingClientRect();
    this._rect = rect;
    const dpr = this._dpr;
    for (const c of [this.canvas]) {
      c.width = Math.max(1, Math.round(rect.width * dpr));
      c.height = Math.max(1, Math.round(rect.height * dpr));
      c.style.width = `${rect.width}px`;
      c.style.height = `${rect.height}px`;
    }
    if (this.rulerTop) {
      this.rulerTop.width = Math.round(rect.width * dpr);
      this.rulerTop.height = Math.round(22 * dpr);
      this.rulerTop.style.width = `${rect.width}px`;
      this.rulerTop.style.height = '22px';
    }
    if (this.rulerLeft) {
      this.rulerLeft.width = Math.round(22 * dpr);
      this.rulerLeft.height = Math.round(rect.height * dpr);
      this.rulerLeft.style.width = '22px';
      this.rulerLeft.style.height = `${rect.height}px`;
    }
  },

  _makeChecker() {
    const c = newCanvas(16, 16);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#cfcfcf';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#a8a8a8';
    ctx.fillRect(0, 0, 8, 8);
    ctx.fillRect(8, 8, 8, 8);
    return this.ctx.createPattern(c, 'repeat');
  },

  markDirty() { this.compositeDirty = true; },

  getComposite() {
    if (this.compositeDirty) this._rebuildComposite();
    return this.composite;
  },

  setDocSize(w, h) {
    if (!this.composite) this.composite = newCanvas(w, h);
    if (this.composite.width !== w || this.composite.height !== h) {
      this.composite = newCanvas(w, h);
      this._temp = null;
    }
    this.markDirty();
  },

  _rebuildComposite() {
    const { width, height, layers } = Doc.state;
    this.setDocSize(width, height);
    const ctx = this.composite.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    if (!this._temp || this._temp.width !== width || this._temp.height !== height) {
      this._temp = newCanvas(width, height);
    }
    const tmp = this._temp;
    for (const layer of layers) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = clamp(layer.opacity, 0, 1);
      ctx.globalCompositeOperation = blendModeToCanvas(layer.blendMode);
      if (layer.mask && layer.maskEnabled !== false) {
        const tctx = tmp.getContext('2d');
        tctx.clearRect(0, 0, width, height);
        tctx.save();
        tctx.globalCompositeOperation = 'source-over';
        tctx.drawImage(layer.canvas, layer._px || 0, layer._py || 0);
        tctx.globalCompositeOperation = 'destination-in';
        tctx.drawImage(layer.mask, 0, 0);
        tctx.restore();
        ctx.drawImage(tmp, 0, 0);
      } else {
        ctx.drawImage(layer.canvas, layer._px || 0, layer._py || 0);
      }
      ctx.restore();
    }
    this.compositeDirty = false;
  },

  // ---------- viewport math ----------

  screenToDoc(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left, sy = clientY - rect.top;
    return {
      x: (sx - this.view.offX) / this.view.zoom,
      y: (sy - this.view.offY) / this.view.zoom,
      sx, sy,
    };
  },

  docToScreen(x, y) {
    return { x: x * this.view.zoom + this.view.offX, y: y * this.view.zoom + this.view.offY };
  },

  fit(padding = 48) {
    const rect = this.container.getBoundingClientRect();
    const { width, height } = Doc.state;
    if (!width || !height) return;
    const zoom = clamp(Math.min((rect.width - padding) / width, (rect.height - padding) / height), 0.02, 4);
    this.view.zoom = zoom;
    this.view.offX = (rect.width - width * zoom) / 2;
    this.view.offY = (rect.height - height * zoom) / 2;
  },

  actualSize() {
    const rect = this.container.getBoundingClientRect();
    this.view.zoom = 1;
    this.view.offX = (rect.width - Doc.state.width) / 2;
    this.view.offY = (rect.height - Doc.state.height) / 2;
  },

  zoomAt(factor, cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    const px = cx ?? rect.width / 2, py = cy ?? rect.height / 2;
    const before = { x: (px - this.view.offX) / this.view.zoom, y: (py - this.view.offY) / this.view.zoom };
    this.view.zoom = clamp(this.view.zoom * factor, 0.02, 32);
    this.view.offX = px - before.x * this.view.zoom;
    this.view.offY = py - before.y * this.view.zoom;
  },

  setZoom(zoom, cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    const px = cx ?? rect.width / 2, py = cy ?? rect.height / 2;
    const before = { x: (px - this.view.offX) / this.view.zoom, y: (py - this.view.offY) / this.view.zoom };
    this.view.zoom = clamp(zoom, 0.02, 32);
    this.view.offX = px - before.x * this.view.zoom;
    this.view.offY = py - before.y * this.view.zoom;
  },

  panBy(dx, dy) {
    this.view.offX += dx;
    this.view.offY += dy;
  },

  clearGuides() { this.guides = []; },

  // ---------- frame ----------

  _frame(ts) {
    requestAnimationFrame((t) => this._frame(t));
    if (!this.canvas) return;
    const rect = this._rect || this.container.getBoundingClientRect();
    if (this.compositeDirty) this._rebuildComposite();
    const dpr = this._dpr;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // backdrop
    ctx.fillStyle = '#1b1b1c';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const { offX, offY, zoom } = this.view;
    const dw = Doc.state.width * zoom, dh = Doc.state.height * zoom;

    // document drop shadow + checkerboard
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#000';
    ctx.fillRect(offX, offY, dw, dh);
    ctx.restore();
    ctx.save();
    ctx.translate(offX, offY);
    ctx.fillStyle = this._checker;
    ctx.fillRect(0, 0, dw, dh);
    ctx.restore();

    // the document itself
    ctx.save();
    ctx.imageSmoothingEnabled = zoom < 4;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.composite, offX, offY, dw, dh);
    ctx.restore();

    // grid
    if (UI.showGrid) this._drawGrid(ctx, dw, dh);

    // guides
    if (UI.showGuides) this._drawGuides(ctx, rect);

    // selection marching ants
    this._drawAnts(ctx, ts);

    // tool overlay (crop box, transform box, …)
    if (this.overlay) {
      try { this.overlay(ctx, this.view); } catch (e) { console.error('overlay error', e); }
    }

    this._drawRulers(rect);
  },

  _drawGrid(ctx, dw, dh) {
    const step = niceStep(48, this.view.zoom);
    const { offX, offY, zoom } = this.view;
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 190, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= Doc.state.width; x += step) {
      const sx = Math.round(offX + x * zoom) + 0.5;
      ctx.moveTo(sx, offY); ctx.lineTo(sx, offY + dh);
    }
    for (let y = 0; y <= Doc.state.height; y += step) {
      const sy = Math.round(offY + y * zoom) + 0.5;
      ctx.moveTo(offX, sy); ctx.lineTo(offX + dw, sy);
    }
    ctx.stroke();
    ctx.restore();
  },

  _drawGuides(ctx, rect) {
    const { offX, offY, zoom } = this.view;
    ctx.save();
    ctx.strokeStyle = '#27d3ff';
    ctx.lineWidth = 1;
    const inProgress = this._guideDrag ? [this._guideDrag] : [];
    for (const g of [...this.guides, ...inProgress]) {
      ctx.beginPath();
      if (g.axis === 'h') {
        const sy = Math.round(offY + g.pos * zoom) + 0.5;
        ctx.moveTo(0, sy); ctx.lineTo(rect.width, sy);
      } else {
        const sx = Math.round(offX + g.pos * zoom) + 0.5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, rect.height);
      }
      ctx.stroke();
    }
    ctx.restore();
  },

  _drawAnts(ctx, ts) {
    if (!Selection.hasSelection()) return;
    const now = ts || 0;
    if (now - this._lastAnts > 280) {
      this._antsPhase = (this._antsPhase + 1) % 2;
      this._lastAnts = now;
    }
    const phase = this._antsPhase;
    const { offX, offY, zoom } = this.view;
    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(zoom, zoom);
    if (Selection.path) {
      const dash = 4 / zoom, offset = (phase ? 4 : 0) / zoom;
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([dash, dash]);
      ctx.lineDashOffset = -offset;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.stroke(Selection.path);
      ctx.lineDashOffset = -offset + dash;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke(Selection.path);
      ctx.setLineDash([]);
    } else if (Selection.boundaryEven && Selection.boundaryOdd) {
      ctx.imageSmoothingEnabled = false;
      // Each boundary pixel alternates black↔white with the phase: crawling ants.
      ctx.drawImage(phase === 0 ? Selection.boundaryEven.white : Selection.boundaryEven.black, 0, 0);
      ctx.drawImage(phase === 0 ? Selection.boundaryOdd.black : Selection.boundaryOdd.white, 0, 0);
      ctx.restore();
      return;
    }
    ctx.restore();
  },

  _drawRulers(rect) {
    if (!UI.showRulers || !this.rulerTop) {
      if (this.rulerTop) { this.rulerTop.style.visibility = 'hidden'; this.rulerLeft.style.visibility = 'hidden'; if (this.corner) this.corner.style.visibility = 'hidden'; }
      return;
    }
    this.rulerTop.style.visibility = 'visible';
    this.rulerLeft.style.visibility = 'visible';
    if (this.corner) this.corner.style.visibility = 'visible';
    const dpr = this._dpr;
    const { offX, offY, zoom } = this.view;
    const step = niceStep(56, zoom);
    const drawAxis = (canvas, horizontal) => {
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = horizontal ? rect.width : 22;
      const h = horizontal ? 22 : rect.height;
      ctx.fillStyle = '#2c2c2e';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#3f3f42';
      ctx.beginPath();
      if (horizontal) { ctx.moveTo(0, 21.5); ctx.lineTo(w, 21.5); } else { ctx.moveTo(21.5, 0); ctx.lineTo(21.5, h); }
      ctx.stroke();
      ctx.fillStyle = '#9d9da3';
      ctx.font = '9px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      const docLen = horizontal ? Doc.state.width : Doc.state.height;
      const start = horizontal ? -offX / zoom : -offY / zoom;
      const end = start + (horizontal ? rect.width : rect.height) / zoom;
      const first = Math.floor(start / step) * step;
      for (let v = first; v <= Math.min(docLen, end) + step; v += step) {
        if (v < 0) continue;
        const p = (v * zoom + (horizontal ? offX : offY));
        ctx.strokeStyle = '#8a8a90';
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(Math.round(p) + 0.5, 12); ctx.lineTo(Math.round(p) + 0.5, 21); }
        else { ctx.moveTo(12, Math.round(p) + 0.5); ctx.lineTo(21, Math.round(p) + 0.5); }
        ctx.stroke();
        const label = String(Math.round(v));
        if (horizontal) ctx.fillText(label, p + 3, 2);
        else { ctx.save(); ctx.translate(2, p + 3); ctx.rotate(Math.PI / 2); ctx.fillText(label, 0, 0); ctx.restore(); }
      }
      // mouse marker
      if (this.mouse) {
        const m = horizontal ? this.mouse.x : this.mouse.y;
        ctx.strokeStyle = '#2f8cff';
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(m + 0.5, 0); ctx.lineTo(m + 0.5, 22); } else { ctx.moveTo(0, m + 0.5); ctx.lineTo(22, m + 0.5); }
        ctx.stroke();
      }
    };
    drawAxis(this.rulerTop, true);
    drawAxis(this.rulerLeft, false);
  },

  // ---------- guides ----------

  _bindWheel() {
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        this.zoomAt(Math.exp(-e.deltaY * 0.0016), cx, cy);
      } else {
        this.panBy(-e.deltaX, -e.deltaY);
      }
    }, { passive: false });
  },

  _bindRulerDrags() {
    const startGuide = (axis) => (e) => {
      if (!UI.showRulers) return;
      e.preventDefault();
      const move = (ev) => {
        const rect = this.canvas.getBoundingClientRect();
        if (axis === 'h') {
          const pos = clamp((ev.clientY - rect.top - this.view.offY) / this.view.zoom, 0, Doc.state.height);
          this._guideDrag = { axis, pos };
        } else {
          const pos = clamp((ev.clientX - rect.left - this.view.offX) / this.view.zoom, 0, Doc.state.width);
          this._guideDrag = { axis, pos };
        }
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (this._guideDrag) {
          this.guides.push(this._guideDrag);
          this._guideDrag = null;
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    this.rulerTop?.addEventListener('pointerdown', startGuide('h'));
    this.rulerLeft?.addEventListener('pointerdown', startGuide('v'));
  },
};
