// Modal dialogs. Every adjustment dialog live-previews on the active layer and
// pushes exactly one history entry at open (cancel rolls it back cleanly).

import { $, $$, clamp, copyCanvas, newCanvas } from './util.js';
import { Doc } from './document.js';
import { Render } from './render.js';
import { Selection } from './selection.js';
import { UI } from './state.js';
import { Panels } from './panels.js';
import * as Adjust from './adjustments.js';
import * as Filters from './filters.js';
import { ICONS } from './icons.js';

// ---------- primitives ----------

export const Dialog = {
  open({ title, body, okText = 'OK', cancelText = 'Cancel', onOk, onCancel, width = 380, dismissable = true, okClass = '' }) {
    const root = $('#dialogRoot');
    root.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    const box = document.createElement('div');
    box.className = 'dialog';
    box.style.width = `min(${width}px, calc(100vw - 24px))`;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    box.innerHTML = `
      <div class="dialog-titlebar"><span class="dialog-title">${escapeHtml(title)}</span><button class="dialog-x" aria-label="Close">${ICONS.close}</button></div>
      <div class="dialog-body"></div>
      <div class="dialog-actions"></div>`;
    const bodyEl = box.querySelector('.dialog-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);
    const actions = box.querySelector('.dialog-actions');
    if (cancelText != null) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'dialog-btn';
      cancelBtn.textContent = cancelText;
      cancelBtn.addEventListener('click', () => this._cancel(onCancel));
      actions.appendChild(cancelBtn);
    }
    if (okText != null) {
      const okBtn = document.createElement('button');
      okBtn.className = `dialog-btn dialog-ok ${okClass}`;
      okBtn.textContent = okText;
      okBtn.addEventListener('click', () => {
        const keep = onOk ? onOk(bodyEl) : true;
        if (keep !== false) this._close();
      });
      actions.appendChild(okBtn);
    }
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay && dismissable) this._cancel(onCancel);
    });
    box.querySelector('.dialog-x').addEventListener('click', () => this._cancel(onCancel));
    overlay.appendChild(box);
    root.appendChild(overlay);
    this._current = { overlay, onCancel };
    // Focus the first input for keyboard flow
    const first = box.querySelector('input:not([type=checkbox]), select, textarea, button.dialog-ok');
    first?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this._cancel(onCancel); }
      else if (e.key === 'Enter' && !/TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'checkbox') {
        e.preventDefault();
        const keep = onOk ? onOk(bodyEl) : true;
        if (keep !== false) this._close();
      }
    };
    overlay.addEventListener('keydown', onKey);
    return { bodyEl, box, close: () => this._close() };
  },

  _close() {
    $('#dialogRoot').innerHTML = '';
    this._current = null;
  },

  _cancel(onCancel) {
    try { onCancel?.(); } finally { this._close(); }
  },

  async confirm({ title = 'Confirm', message, okText = 'OK', danger = false }) {
    return new Promise((resolve) => {
      const body = `<p class="dialog-message">${escapeHtml(message)}</p>`;
      this.open({
        title, body, okText,
        okClass: danger ? 'dialog-danger' : '',
        onOk: () => { resolve(true); },
        onCancel: () => resolve(false),
        width: 360,
      });
    });
  },
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Shared live-preview scaffold for layer adjustments/filters. */
const withLayerBackup = (label, fn) => {
  const layer = Doc.activeLayer();
  if (!layer) { Panels.toast('Select a layer first.'); return null; }
  const backup = copyCanvas(layer.canvas);
  const token = Doc.pushHistory(label).token;
  const applyFromBackup = (op) => {
    const ctx = layer.canvas.getContext('2d');
    ctx.save();
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    ctx.drawImage(backup, 0, 0);
    ctx.restore();
    op(layer);
    Render.markDirty();
  };
  const finish = (keep) => {
    if (keep) {
      Render.markDirty();
      Panels.refreshLayers();
    } else {
      const ctx = layer.canvas.getContext('2d');
      ctx.save();
      ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      ctx.drawImage(backup, 0, 0);
      ctx.restore();
      Doc.cancelHistory(token);
      Render.markDirty();
      Panels.refreshLayers();
    }
  };
  fn({ layer, backup, applyFromBackup, finish });
  return layer;
};

/** Generic slider-based adjustment dialog with live preview. */
const sliderDialog = (title, params, apply, transform = (v) => v) => {
  withLayerBackup(title, ({ applyFromBackup, finish }) => {
    const values = {};
    params.forEach((p) => { values[p.key] = p.value; });
    const rows = params.map((p) => `
      <label class="param-row">
        <span class="param-label">${escapeHtml(p.label)}</span>
        <input type="range" class="param-range" data-key="${p.key}" min="${p.min}" max="${p.max}" step="${p.step ?? 1}" value="${p.value}">
        <input type="number" class="param-num" data-key="${p.key}" min="${p.min}" max="${p.max}" step="${p.step ?? 1}" value="${p.value}">
      </label>`).join('');
    const body = `<div class="param-dialog">${rows}</div>`;
    const handle = Dialog.open({
      title, body, okText: 'OK', width: 380,
      onOk: () => { finish(true); return true; },
      onCancel: () => finish(false),
    });
    const sync = (key, value, source) => {
      values[key] = Number(value);
      $$('.param-range[data-key="' + key + '"]', handle.bodyEl).forEach((n) => { if (n !== source) n.value = String(value); });
      $$('.param-num[data-key="' + key + '"]', handle.bodyEl).forEach((n) => { if (n !== source) n.value = String(value); });
      applyFromBackup((layer) => apply(layer, transform({ ...values })));
    };
    $$('.param-range, .param-num', handle.bodyEl).forEach((input) => {
      input.addEventListener('input', () => sync(input.dataset.key, input.value, input));
    });
  });
};

// ============ specific dialogs ============

export const newDocumentDialog = () => {
  const presets = [
    ['HD 1920 × 1080', 1920, 1080],
    ['Full HD 2560 × 1440', 2560, 1440],
    ['4K UHD 3840 × 2160', 3840, 2160],
    ['Square 2048 × 2048', 2048, 2048],
    ['Instagram post 1080 × 1080', 1080, 1080],
    ['Story 1080 × 1920', 1080, 1920],
    ['A4 · 300 dpi (2480 × 3508)', 2480, 3508],
    ['A3 · 300 dpi (3508 × 4961)', 3508, 4961],
    ['Web banner 1600 × 500', 1600, 500],
    ['Custom', 0, 0],
  ];
  const body = `
    <div class="param-dialog">
      <label class="param-row"><span class="param-label">Name</span><input id="ndName" class="param-text" type="text" value="untitled-${Math.floor(Math.random() * 900 + 100)}" spellcheck="false"></label>
      <label class="param-row"><span class="param-label">Preset</span><select id="ndPreset" class="param-select">${presets.map(([l], i) => `<option value="${i}">${l}</option>`).join('')}</select></label>
      <label class="param-row"><span class="param-label">Width</span><input id="ndW" type="number" class="param-num" min="1" max="8000" value="1920"><span class="param-unit">px</span></label>
      <label class="param-row"><span class="param-label">Height</span><input id="ndH" type="number" class="param-num" min="1" max="8000" value="1080"><span class="param-unit">px</span></label>
      <label class="param-row"><span class="param-label">Background</span><select id="ndBg" class="param-select"><option value="white">White</option><option value="transparent">Transparent</option><option value="black">Black</option></select></label>
    </div>`;
  Dialog.open({
    title: 'New Document', body, okText: 'Create', width: 400,
    onOk: (bodyEl) => {
      const w = clamp(Number($('#ndW', bodyEl).value) || 1920, 1, 8000);
      const h = clamp(Number($('#ndH', bodyEl).value) || 1080, 1, 8000);
      Doc.newDocument($('#ndName', bodyEl).value.trim() || 'untitled', w, h, $('#ndBg', bodyEl).value);
      Render.fit();
      Selection.clear();
      Panels.refreshAll();
      return true;
    },
  });
  // Preset wiring
  requestAnimationFrame(() => {
    const preset = $('#ndPreset');
    if (!preset) return;
    preset.addEventListener('change', () => {
      const [, w, h] = presets[Number(preset.value)];
      if (w) { $('#ndW').value = w; $('#ndH').value = h; }
    });
  });
};

export const imageSizeDialog = () => {
  const { width, height } = Doc.state;
  const body = `
    <div class="param-dialog">
      <label class="param-row"><span class="param-label">Width</span><input id="isW" type="number" class="param-num" min="1" max="8000" value="${width}"><span class="param-unit">px</span></label>
      <label class="param-row"><span class="param-label">Height</span><input id="isH" type="number" class="param-num" min="1" max="8000" value="${height}"><span class="param-unit">px</span></label>
      <label class="opt-check param-check"><input type="checkbox" id="isLock" checked><span>Keep aspect ratio</span></label>
      <p class="param-note">Current: ${width} × ${height}px (${(width * height / 1e6).toFixed(1)} MP)</p>
    </div>`;
  Dialog.open({
    title: 'Image Size', body, okText: 'Resize', width: 380,
    onOk: (bodyEl) => {
      try {
        Doc.resizeImage(Number($('#isW', bodyEl).value), Number($('#isH', bodyEl).value));
        Selection.setDocSize(Doc.state.width, Doc.state.height);
        Render.fit();
        Panels.refreshAll();
        return true;
      } catch (err) {
        Panels.toast(err.message);
        return false;
      }
    },
  });
  requestAnimationFrame(() => {
    const w = $('#isW'), h = $('#isH'), lock = $('#isLock');
    if (!w || !h) return;
    const ratio = width / height;
    w.addEventListener('input', () => { if (lock.checked) h.value = Math.max(1, Math.round(Number(w.value || 1) / ratio)); });
    h.addEventListener('input', () => { if (lock.checked) w.value = Math.max(1, Math.round(Number(h.value || 1) * ratio)); });
  });
};

export const canvasSizeDialog = () => {
  const { width, height } = Doc.state;
  const cells = [[-1, 1], [0, 1], [1, 1], [-1, 0], [0, 0], [1, 0], [-1, -1], [0, -1], [1, -1]];
  const body = `
    <div class="param-dialog">
      <label class="param-row"><span class="param-label">Width</span><input id="csW" type="number" class="param-num" min="1" max="8000" value="${width}"><span class="param-unit">px</span></label>
      <label class="param-row"><span class="param-label">Height</span><input id="csH" type="number" class="param-num" min="1" max="8000" value="${height}"><span class="param-unit">px</span></label>
      <div class="param-label" style="margin-bottom:6px">Anchor</div>
      <div class="anchor-grid" id="csAnchor">
        ${cells.map(([ax, ay], i) => `<button class="anchor-cell ${ax === 0 && ay === 0 ? 'on' : ''}" data-ax="${ax}" data-ay="${ay}" aria-label="Anchor ${i + 1}"></button>`).join('')}
      </div>
      <p class="param-note">The canvas grows around the image; existing content keeps its position.</p>
    </div>`;
  let anchor = { ax: 0, ay: 0 };
  Dialog.open({
    title: 'Canvas Size', body, okText: 'Resize', width: 380,
    onOk: (bodyEl) => {
      const w = clamp(Number($('#csW', bodyEl).value) || width, 1, 8000);
      const h = clamp(Number($('#csH', bodyEl).value) || height, 1, 8000);
      // anchor -1 (left/top) → content stays at left/top (offset 0); 1 → right/bottom (offset max)
      const ax = { '-1': 0, 0: 0.5, 1: 1 }[String(anchor.ax)];
      const ay = { '-1': 0, 0: 0.5, 1: 1 }[String(anchor.ay)];
      Doc.resizeCanvas(w, h, ax, ay);
      Selection.setDocSize(w, h);
      Panels.refreshAll();
      return true;
    },
  });
  requestAnimationFrame(() => {
    const grid = $('#csAnchor');
    if (!grid) return;
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.anchor-cell');
      if (!cell) return;
      anchor = { ax: Number(cell.dataset.ax), ay: Number(cell.dataset.ay) };
      grid.querySelectorAll('.anchor-cell').forEach((c) => c.classList.toggle('on', c === cell));
    });
  });
};

export const brightnessContrastDialog = () => sliderDialog('Brightness / Contrast', [
  { key: 'brightness', label: 'Brightness', min: -100, max: 100, value: 0 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, value: 0 },
], (layer, v) => Adjust.brightnessContrast(layer, v.brightness, v.contrast));

export const levelsDialog = () => sliderDialog('Levels', [
  { key: 'inBlack', label: 'Black point', min: 0, max: 254, value: 0 },
  { key: 'inWhite', label: 'White point', min: 1, max: 255, value: 255 },
  { key: 'gamma', label: 'Gamma', min: 0.1, max: 9.99, step: 0.01, value: 1 },
  { key: 'outBlack', label: 'Output black', min: 0, max: 255, value: 0 },
  { key: 'outWhite', label: 'Output white', min: 0, max: 255, value: 255 },
], (layer, v) => Adjust.levelsAdjustment(layer, v));

export const hueSaturationDialog = () => sliderDialog('Hue / Saturation', [
  { key: 'hue', label: 'Hue', min: -180, max: 180, value: 0 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, value: 0 },
  { key: 'lightness', label: 'Lightness', min: -100, max: 100, value: 0 },
], (layer, v) => Adjust.hueSaturation(layer, v.hue, v.saturation, v.lightness));

export const exposureDialog = () => sliderDialog('Exposure', [
  { key: 'ev', label: 'Exposure (stops)', min: -4, max: 4, step: 0.05, value: 0 },
], (layer, v) => Adjust.exposure(layer, v.ev));

export const thresholdDialog = () => sliderDialog('Threshold', [
  { key: 'level', label: 'Threshold level', min: 0, max: 255, value: 128 },
], (layer, v) => Adjust.threshold(layer, v.level));

export const posterizeDialog = () => sliderDialog('Posterize', [
  { key: 'levels', label: 'Levels', min: 2, max: 32, value: 4 },
], (layer, v) => Adjust.posterize(layer, v.levels));

export const gaussianBlurDialog = () => sliderDialog('Gaussian Blur', [
  { key: 'radius', label: 'Radius', min: 0.1, max: 120, step: 0.1, value: 2 },
], (layer, v) => Filters.gaussianBlur(layer, v.radius));

export const motionBlurDialog = () => sliderDialog('Motion Blur', [
  { key: 'size', label: 'Distance', min: 1, max: 200, value: 16 },
  { key: 'angle', label: 'Angle (°)', min: -180, max: 180, value: 0 },
], (layer, v) => Filters.motionBlur(layer, v.size, v.angle));

export const noiseDialog = () => sliderDialog('Add Noise', [
  { key: 'amount', label: 'Amount', min: 1, max: 100, value: 12 },
], (layer, v) => Filters.addNoise(layer, v.amount / 100, false));

export const pixelateDialog = () => sliderDialog('Pixelate', [
  { key: 'size', label: 'Cell size', min: 2, max: 128, value: 8 },
], (layer, v) => Filters.pixelate(layer, v.size));

export const unsharpDialog = () => sliderDialog('Unsharp Mask', [
  { key: 'radius', label: 'Radius', min: 0.1, max: 60, step: 0.1, value: 2 },
  { key: 'amount', label: 'Amount', min: 0, max: 500, value: 80 },
  { key: 'threshold', label: 'Threshold', min: 0, max: 32, value: 4 },
], (layer, v) => Filters.unsharpMask(layer, v.radius, v.amount / 100, v.threshold));

/** Interactive curves editor: RGB master + per-channel curves, histogram backdrop. */
export const curvesDialog = () => {
  withLayerBackup('Curves', ({ layer, backup, applyFromBackup, finish }) => {
    const curvesState = {
      rgb: [[0, 0], [1, 1]],
      r: [[0, 0], [1, 1]],
      g: [[0, 0], [1, 1]],
      b: [[0, 0], [1, 1]],
    };
    let channel = 'rgb';
    const body = `
      <div class="curves-dialog">
        <div class="curves-toolbar">
          <label class="param-label" for="cvChannel">Channel</label>
          <select id="cvChannel" class="opt-select">
            <option value="rgb">RGB</option><option value="r">Red</option><option value="g">Green</option><option value="b">Blue</option>
          </select>
          <button class="opt-btn" id="cvReset" type="button">Reset</button>
        </div>
        <canvas id="cvCanvas" width="220" height="220" aria-label="Curve editor"></canvas>
        <p class="param-note">Click the curve to add a point. Drag to bend it. Double-click a point to remove it.</p>
      </div>`;
    const handle = Dialog.open({
      title: 'Curves', body, okText: 'OK', width: 300,
      onOk: () => { finish(true); return true; },
      onCancel: () => finish(false),
    });
    const canvas = $('#cvCanvas', handle.bodyEl);
    const ctx = canvas.getContext('2d');
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = 220 * dpr;
    canvas.height = 220 * dpr;
    canvas.style.width = '220px';
    canvas.style.height = '220px';

    // Histogram of the backed-up layer (luminance, 48 bins)
    const histogram = (() => {
      const bins = new Float32Array(48);
      const src = backup.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, backup.width, backup.height).data;
      for (let i = 0; i < src.length; i += 4) {
        const y = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
        bins[Math.min(47, (y / 256 * 48) | 0)]++;
      }
      const max = Math.max(...bins, 1);
      return [...bins].map((v) => v / max);
    })();

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, 220, 220);
      ctx.fillStyle = '#1e1e20';
      ctx.fillRect(0, 0, 220, 220);
      // histogram
      ctx.fillStyle = 'rgba(160,160,170,0.28)';
      histogram.forEach((v, i) => {
        const h = v * 130;
        ctx.fillRect(8 + (i * 204) / 48, 212 - h, 204 / 48 - 1, h);
      });
      // grid + diagonal
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      for (const t of [0.25, 0.5, 0.75]) {
        ctx.beginPath(); ctx.moveTo(8 + t * 204, 8); ctx.lineTo(8 + t * 204, 212); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(8, 8 + t * 204); ctx.lineTo(212, 8 + t * 204); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.moveTo(8, 212); ctx.lineTo(212, 8); ctx.stroke();
      // curve
      const pts = curvesState[channel];
      const lut = Adjust.buildCurvesLUT(pts);
      ctx.strokeStyle = channel === 'r' ? '#ff6b5e' : channel === 'g' ? '#4ade80' : channel === 'b' ? '#60a5fa' : '#f5f5f5';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 256; i++) {
        const x = 8 + (i / 255) * 204;
        const y = 212 - (lut[i] / 255) * 204;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      // points
      for (const [px, py] of pts) {
        ctx.beginPath();
        ctx.arc(8 + px * 204, 212 - py * 204, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#2f8cff';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };

    const apply = () => applyFromBackup((l) => Adjust.curves(l, curvesState));
    const posFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = clamp((e.clientX - rect.left - 8) / 204, 0, 1);
      const y = clamp(1 - (e.clientY - rect.top - 8) / 204, 0, 1);
      return [x, y];
    };
    let dragIndex = -1;
    canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = posFromEvent(e);
      const pts = curvesState[channel];
      // near an existing point? start dragging it
      for (let i = 0; i < pts.length; i++) {
        if (Math.hypot(pts[i][0] - x, pts[i][1] - y) < 0.06) { dragIndex = i; canvas.setPointerCapture(e.pointerId); return; }
      }
      if (pts.length >= 10) return;
      // add a point in sorted order
      const next = [...pts, [x, y]].sort((a, b) => a[0] - b[0]);
      curvesState[channel] = next;
      dragIndex = next.findIndex((p) => p[0] === x && p[1] === y);
      canvas.setPointerCapture(e.pointerId);
      draw();
      apply();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragIndex < 0) return;
      const [x, y] = posFromEvent(e);
      const pts = curvesState[channel];
      if (dragIndex === 0) pts[0] = [clamp(x, 0, 0.05), y];
      else if (dragIndex === pts.length - 1) pts[pts.length - 1] = [clamp(x, 0.95, 1), y];
      else pts[dragIndex] = [clamp(x, 0.03, 0.97), y];
      draw();
      apply();
    });
    canvas.addEventListener('pointerup', () => { dragIndex = -1; });
    canvas.addEventListener('dblclick', (e) => {
      const [x, y] = posFromEvent(e);
      const pts = curvesState[channel];
      for (let i = 1; i < pts.length - 1; i++) {
        if (Math.hypot(pts[i][0] - x, pts[i][1] - y) < 0.06) {
          pts.splice(i, 1);
          draw();
          apply();
          return;
        }
      }
    });
    const channelSel = $('#cvChannel', handle.bodyEl);
    channelSel.addEventListener('change', () => { channel = channelSel.value; draw(); });
    $('#cvReset', handle.bodyEl).addEventListener('click', () => {
      for (const k of Object.keys(curvesState)) curvesState[k] = [[0, 0], [1, 1]];
      draw();
      apply();
    });
    draw();
    apply();
  });
};

// ============ info dialogs ============

export const aboutDialog = () => {
  Dialog.open({
    title: 'About KB EDITOR',
    okText: 'Close',
    cancelText: null,
    width: 440,
    body: `
      <div class="about-dialog">
        <div class="about-logo">${LOGO_SVG}</div>
        <p class="about-name">KB <strong>EDITOR</strong></p>
        <p class="about-tag">Photoshop-compatible image editing in your browser — with a real PSD engine.</p>
        <div class="about-grid">
          <div><strong>Formats</strong><span>PSD · PSB · PNG · JPEG · WebP · GIF · BMP · AVIF</span></div>
          <div><strong>Layers</strong><span>Blend modes · opacity · masks · reordering</span></div>
          <div><strong>Plus</strong><span>25+ blend modes, adjustments, filters, curves, guides, history</span></div>
        </div>
        <p class="about-fine">The PSD engine is built on <a href="https://github.com/Agamnentzar/ag-psd" target="_blank" rel="noopener">ag-psd</a> (MIT), implemented to Adobe’s published PSD/PSB file-format specification.<br>Inspired by the PhotoCraft open-source project. KB EDITOR is free and runs entirely on your device — files never leave your machine.</p>
      </div>`,
  });
};

export const shortcutsDialog = () => {
  const rows = [
    ['V', 'Move tool'], ['M', 'Marquee — press again to switch shape'], ['L', 'Lasso'], ['W', 'Magic wand'],
    ['C', 'Crop'], ['I', 'Eyedropper'], ['B', 'Brush'], ['E', 'Eraser'], ['G', 'Gradient'], ['K', 'Paint bucket'],
    ['T', 'Type'], ['U', 'Shape'], ['H', 'Hand'], ['Z', 'Zoom'],
    ['Ctrl/⌘ + Z', 'Undo'], ['Ctrl/⌘ + Shift + Z', 'Redo'], ['Ctrl/⌘ + Y', 'Redo (alternate)'],
    ['Ctrl/⌘ + S', 'Save as PSD'], ['Ctrl/⌘ + O', 'Open…'], ['Ctrl/⌘ + Alt + N', 'New document'],
    ['Ctrl/⌘ + A', 'Select all'], ['Ctrl/⌘ + D', 'Deselect'], ['Ctrl/⌘ + Shift + I', 'Invert selection'], ['Ctrl/⌘ + Shift + D', 'Reselect'],
    ['Ctrl/⌘ + J', 'Duplicate layer'], ['Ctrl/⌘ + E', 'Merge down'], ['Ctrl/⌘ + Shift + E', 'Flatten image'],
    ['Ctrl/⌘ + Shift + N', 'New layer'], ['Delete / Backspace', 'Clear selected pixels'],
    ['[ / ]', 'Brush / eraser smaller / larger'], ['X', 'Swap foreground / background'], ['D', 'Reset colors'],
    ['Space + drag', 'Pan'], ['Ctrl/⌘ + scroll', 'Zoom'], ['Ctrl/⌘ + 0', 'Fit on screen'], ['Ctrl/⌘ + 1', 'Actual pixels (100%)'],
    ['Alt + click', 'Pick color with paint tools'], ['Shift + drag', 'Add to selection'], ['Enter', 'Apply crop'], ['Esc', 'Cancel / close'],
  ];
  Dialog.open({
    title: 'Keyboard Shortcuts',
    okText: 'Close',
    cancelText: null,
    width: 520,
    body: `<div class="shortcuts-grid">${rows.map(([k, d]) => `<kbd>${escapeHtml(k)}</kbd><span>${escapeHtml(d)}</span>`).join('')}</div>`,
  });
};

const LOGO_SVG = `<svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="KB EDITOR logo">
  <rect width="72" height="72" rx="16" fill="url(#kbg)"/>
  <g stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M24 22v28"/>
    <path d="M40 24l-11.5 11L40 47"/>
    <path d="M47 24v.01M52 36h.01M47 48v.01" stroke-width="4.2"/>
  </g>
  <defs><linearGradient id="kbg" x1="0" y1="0" x2="72" y2="72"><stop stop-color="#2f8cff"/><stop offset="1" stop-color="#0bc5ea"/></linearGradient></defs>
</svg>`;
