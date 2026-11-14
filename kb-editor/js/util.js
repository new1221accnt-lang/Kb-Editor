// Small shared helpers for KB EDITOR. No dependencies.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
export const lerp = (a, b, t) => a + (b - a) * t;

let idCounter = 1;
export const uid = () => `kb${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export const debounce = (fn, wait = 120) => {
  let t = 0;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
};

export const throttle = (fn, wait = 60) => {
  let last = 0, pending = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn(...args);
    } else if (!pending) {
      pending = setTimeout(() => {
        pending = 0;
        last = Date.now();
        fn(...args);
      }, wait - (now - last));
    }
  };
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtBytes = (n) => {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
};

export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export const downloadCanvas = (canvas, filename, type = 'image/png', quality = 0.92) => {
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, filename);
  }, type, quality);
};

export const newCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
export const newCtx = (w, h) => newCanvas(w, h).getContext('2d', { willReadFrequently: true });

export const copyCanvas = (src) => {
  const c = newCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
};

/** Crop a canvas to (left, top, right, bottom). Negative bounds clip to the source. */
export const cropCanvas = (src, left, top, right, bottom) => {
  const w = Math.max(1, right - left);
  const h = Math.max(1, bottom - top);
  const c = newCanvas(w, h);
  c.getContext('2d').drawImage(src, -left, -top);
  return c;
};

/** Deep-copy helper for Float32/Uint8 arrays and plain data. */
export const deepCopy = (v) => {
  if (v == null || typeof v !== 'object') return v;
  if (v instanceof Uint8ClampedArray || v instanceof Uint8Array || v instanceof Uint16Array || v instanceof Float32Array) {
    return new v.constructor(v);
  }
  if (Array.isArray(v)) return v.map(deepCopy);
  const out = {};
  for (const k of Object.keys(v)) out[k] = deepCopy(v[k]);
  return out;
};

export const isMac = typeof navigator !== 'undefined' && (navigator.platform || '').toUpperCase().includes('MAC');
export const MOD = isMac ? 'metaKey' : 'ctrlKey';
export const modLabel = isMac ? '⌘' : 'Ctrl';
