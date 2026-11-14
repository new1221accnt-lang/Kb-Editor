// Extended end-to-end flows: layers, masks, selections+fill, gradient, bucket,
// filters, adjustments, clipboard, canvas transforms and export paths — all through
// the real app modules booted in jsdom with a native canvas backend.
// Run with: node test/flows.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { buildSync } from 'esbuild';
import { createCanvas, ImageData, Path2D } from '@napi-rs/canvas';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const bundle = buildSync({
  entryPoints: [join(root, 'js/app.js')],
  bundle: true, write: false, format: 'iife', logLevel: 'silent',
}).outputFiles[0].text;

const dom = new JSDOM(html, { url: 'https://kb-editor.test/', runScripts: 'outside-only', pretendToBeVisual: true });
const win = dom.window;

// ---------- canvas / DOM polyfills (same shim as the smoke test) ----------
const patchNapiCanvas = (c) => {
  c.toBlob = (cb) => cb(new win.Blob([c.toBuffer('image/png')], { type: 'image/png' }));
  c.toDataURL = () => 'data:image/png;base64,';
  c.style = {};
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height, right: c.width, bottom: c.height });
  c.addEventListener = () => {};
  return c;
};
const origCreateElement = win.document.createElement.bind(win.document);
win.document.createElement = (tag, opts) => {
  if (String(tag).toLowerCase() === 'canvas') return patchNapiCanvas(createCanvas(1, 1));
  return origCreateElement(tag, opts);
};
const napiFor = (el) => {
  const w = Math.max(1, el.width || 300), h = Math.max(1, el.height || 150);
  if (!el.__napi || el.__napi.width !== w || el.__napi.height !== h) el.__napi = createCanvas(w, h);
  return el.__napi;
};
win.HTMLCanvasElement.prototype.getContext = function (kind) {
  return kind === '2d' ? napiFor(this).getContext('2d') : null;
};
win.HTMLCanvasElement.prototype.toBlob = function (cb) {
  cb(new win.Blob([napiFor(this).toBuffer('image/png')], { type: 'image/png' }));
};
win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
win.Path2D = Path2D;
win.ImageData = ImageData;
win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
const rafQueue = [];
win.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
win.cancelAnimationFrame = () => {};
win.devicePixelRatio = 1;
win.URL.createObjectURL = () => 'blob:kb-stub';
win.URL.revokeObjectURL = () => {};
win.HTMLAnchorElement.prototype.click = function () { win.__lastDownload = this.download || 'download'; };
win.HTMLElement.prototype.setPointerCapture = function () {};
win.Element.prototype.scrollIntoView = function () {};
win.Element.prototype.getBoundingClientRect = function () {
  if (this.id === 'canvasArea' || this.id === 'view') return { left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0 };
  if (this.id === 'rulerTop') return { left: 0, top: 0, right: 1000, bottom: 22, width: 1000, height: 22, x: 0, y: 0 };
  if (this.id === 'rulerLeft') return { left: 0, top: 0, right: 22, bottom: 600, width: 22, height: 600, x: 0, y: 0 };
  return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
};
const flushFrames = (n = 3) => {
  for (let i = 0; i < n; i++) {
    const q = rafQueue.splice(0, rafQueue.length);
    for (const cb of q) cb(performance.now() + i * 16);
  }
};

// ---------- boot ----------
win.eval(bundle);
const KB = win.__KB__;
assert.ok(KB, 'app exposed __KB__ handle');
const { Doc, Render, Selection, Tools, Panels, PSD, ClipboardOps, UI, Filters, Adjust } = KB;

// fresh small doc, client == doc coords
Doc.newDocument('flows', 64, 48, 'white');
Render.view.zoom = 1; Render.view.offX = 0; Render.view.offY = 0;
flushFrames(2);
const $ = (sel) => win.document.querySelector(sel);
const view = $('#view');
const fire = (type, x, y, extra = {}) => {
  const ev = new win.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, pointerType: 'mouse', ...extra });
  view.dispatchEvent(ev);
};
const px = (layer, x, y) => [...layer.canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data];

// ---------- 1. layers: new / duplicate / opacity / blend / order / delete ----------
const base = Doc.activeLayer();
Doc.newLayer('top');
assert.equal(Doc.state.layers.length, 2);
const top = Doc.activeLayer();
Doc.setOpacity(top.id, 0.5);
assert.equal(Doc.layer(top.id).opacity, 0.5);
Doc.setBlendMode(top.id, 'multiply');
assert.equal(Doc.layer(top.id).blendMode, 'multiply');
Doc.duplicateLayer(top.id);
assert.equal(Doc.state.layers.length, 3);
const dup = Doc.activeLayer();
Doc.moveLayer(dup.id, -1);
assert.ok(Doc.layerIndex(dup.id) < Doc.state.layers.length - 1);
Doc.deleteLayer(dup.id);
assert.equal(Doc.state.layers.length, 2);
// can not delete the last layer
Doc.deleteLayer(Doc.activeLayer().id);
Doc.deleteLayer(Doc.activeLayer().id);
assert.equal(Doc.state.layers.length, 1, 'last remaining layer is kept');
Doc.mergeDown(); // merges nothing harmful with one layer — must not throw
console.log('✓ layers: create/duplicate/opacity/blend/order/delete');

// ---------- 2. masks: add / toggle / delete ----------
Doc.newLayer('masked');
const ml = Doc.activeLayer();
Doc.addMask(ml.id);
assert.ok(Doc.layer(ml.id).mask, 'mask attached');
Doc.toggleMask(ml.id);
assert.equal(Doc.layer(ml.id).maskEnabled, false);
Doc.toggleMask(ml.id);
assert.equal(Doc.layer(ml.id).maskEnabled, true);
Doc.deleteMask(ml.id);
assert.equal(Doc.layer(ml.id).mask, null);
console.log('✓ masks: add/toggle/delete');

// ---------- 3. selection-aware fill ----------
Doc.newDocument('flows2', 32, 32, 'white');
Selection.clear();
Selection.rect(4, 4, 8, 8, 'new');
ClipboardOps.fill('#ff0000');
const fillLayer = Doc.activeLayer();
assert.equal(px(fillLayer, 6, 6)[0], 255, 'inside selection filled red');
assert.equal(px(fillLayer, 6, 6)[1], 0);
assert.equal(px(fillLayer, 20, 20)[0], 255, 'outside selection untouched (still white)');
assert.equal(px(fillLayer, 20, 20)[1], 255);
Selection.clear();
console.log('✓ fill: restricted to the selection');

// ---------- 4. gradient via tool events ----------
Doc.newDocument('flows3', 32, 8, 'white');
UI.fg = '#000000'; UI.bg = '#ffffff'; UI.gradientReverse = false; UI.gradientShape = 'linear'; UI.gradientStyle = 'fg-bg';
Tools.set('gradient');
fire('pointerdown', 0, 4);
fire('pointermove', 31, 4);
fire('pointerup', 31, 4);
const gl = Doc.activeLayer();
const left = px(gl, 0, 4)[0], right = px(gl, 31, 4)[0];
assert.ok(left < 60, `gradient starts near black (${left})`);
assert.ok(right > 195, `gradient ends near white (${right})`);
console.log('✓ gradient: drag produces an fg→bg ramp');

// ---------- 5. bucket fill ----------
Doc.newDocument('flows4', 16, 16, 'white');
UI.fg = '#00ff00';
Tools.set('bucket');
fire('pointerdown', 8, 8);
fire('pointerup', 8, 8);
const bl = Doc.activeLayer();
assert.equal(px(bl, 8, 8)[1], 255, 'bucket filled the contiguous region green');
assert.equal(px(bl, 8, 8)[0], 0);
console.log('✓ bucket: contiguous flood fill works');

// ---------- 6. filters + adjustments mutate pixels ----------
Doc.newDocument('flows5', 24, 24, 'white');
const fl = Doc.activeLayer();
const fctx = fl.canvas.getContext('2d');
fctx.fillStyle = 'rgb(10, 200, 30)'; fctx.fillRect(0, 0, 24, 24);
Adjust.invert(fl);
const inv = px(fl, 3, 3);
assert.ok(inv[0] > 240 && inv[1] < 60 && inv[2] > 220, `invert applied (${inv})`);
Adjust.invert(fl);
Filters.grayscale(fl);
const gray = px(fl, 3, 3);
assert.ok(Math.abs(gray[0] - gray[1]) <= 2 && Math.abs(gray[1] - gray[2]) <= 2, `grayscale is neutral (${gray})`);
Filters.sepia(fl);
const sep = px(fl, 3, 3);
assert.ok(sep[0] > sep[2], `sepia warms the image (${sep})`);
console.log('✓ adjustments/filters: invert, grayscale, sepia');

// ---------- 7. copy → paste internal clipboard ----------
Doc.newDocument('flows6', 24, 24, 'white');
const cl = Doc.activeLayer();
cl.canvas.getContext('2d').fillStyle = 'rgb(255,0,0)';
cl.canvas.getContext('2d').fillRect(2, 2, 6, 6);
assert.equal(ClipboardOps.copy(false), true);
await ClipboardOps.paste();
assert.equal(Doc.state.layers.length, 2, 'paste adds a layer');
assert.equal(Doc.activeLayer().name, 'Pasted');
console.log('✓ clipboard: copy/paste creates a new layer');

// ---------- 8. canvas transforms ----------
Doc.newDocument('flows7', 40, 20, 'white');
Doc.rotateCanvas(90);
assert.equal(Doc.state.width, 20);
assert.equal(Doc.state.height, 40);
Doc.rotateCanvas(-90);
Doc.rotateCanvas(180);
Doc.flipCanvas(true);
Doc.flipCanvas(false);
assert.equal(Doc.state.width, 40);
console.log('✓ canvas: rotate/flip transform the document');

// ---------- 9. export paths do not throw ----------
PSD.exportImage('jpeg');
assert.equal(win.__lastDownload.endsWith('.jpg'), true, `jpeg export downloads (${win.__lastDownload})`);
PSD.exportImage('webp');
assert.equal(win.__lastDownload.endsWith('.webp'), true);
PSD.exportImage('png');
assert.equal(win.__lastDownload.endsWith('.png'), true);
console.log('✓ export: PNG/JPEG/WebP paths complete');

console.log('\nALL FEATURE-FLOW TESTS PASSED');
process.exit(0);
