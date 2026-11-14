// Full-boot smoke test: boots the real app in jsdom with a native canvas backend,
// then drives tools, history and the PSD engine end-to-end.
// Run with: node test/smoke.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { buildSync } from 'esbuild';
import { createCanvas, ImageData, Path2D } from '@napi-rs/canvas';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const STANDALONE = process.argv.includes('--standalone');
const html = readFileSync(join(root, STANDALONE ? 'kb-editor-standalone.html' : 'index.html'), 'utf8');

// In index.html mode, bundle the app on the fly; in standalone mode, extract the
// inlined bundle from the generated file itself (proves the artifact contains it).
let bundle;
if (STANDALONE) {
  const m = html.match(/<script id="kb-app-bundle">\n([\s\S]*?)\n<\/script>/);
  if (!m) throw new Error('kb-app-bundle block not found in standalone file');
  bundle = m[1];
} else {
  bundle = buildSync({
    entryPoints: [join(root, 'js/app.js')],
    bundle: true,
    write: false,
    format: 'iife',
    logLevel: 'silent',
  }).outputFiles[0].text;
}

const dom = new JSDOM(html, {
  url: 'https://kb-editor.test/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const win = dom.window;

// ---------- polyfills ----------
// 1) document.createElement('canvas') must return REAL native canvases so that any
//    canvas can be used as a drawImage/createPattern source inside napi-rs contexts.
const patchNapiCanvas = (c) => {
  c.toBlob = (cb) => cb(new win.Blob([c.toBuffer('image/png')], { type: 'image/png' }));
  c.toDataURL = () => 'data:image/png;base64,';
  c.style = {};
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height, right: c.width, bottom: c.height });
  c.addEventListener = () => {};
  c.removeEventListener = () => {};
  c.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  return c;
};
const origCreateElement = win.document.createElement.bind(win.document);
win.document.createElement = (tag, opts) => {
  if (String(tag).toLowerCase() === 'canvas') return patchNapiCanvas(createCanvas(1, 1));
  return origCreateElement(tag, opts);
};

// 2) HTML-parsed canvases (#view, #rulerTop, thumbnails…) get napi backing stores
const napiFor = (el) => {
  const w = Math.max(1, el.width || 300), h = Math.max(1, el.height || 150);
  if (!el.__napi || el.__napi.width !== w || el.__napi.height !== h) el.__napi = createCanvas(w, h);
  return el.__napi;
};
win.HTMLCanvasElement.prototype.getContext = function (kind) {
  if (kind !== '2d') return null;
  return napiFor(this).getContext('2d');
};
win.HTMLCanvasElement.prototype.toBlob = function (cb) {
  const buf = napiFor(this).toBuffer('image/png');
  cb(new win.Blob([buf], { type: 'image/png' }));
};
win.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,'; };
win.Path2D = Path2D;
win.ImageData = ImageData;
// jsdom reports all-zero rects; give the app a real-looking viewport
win.Element.prototype.getBoundingClientRect = function () {
  if (this.id === 'canvasArea' || this.id === 'view') return { left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0 };
  if (this.id === 'rulerTop') return { left: 0, top: 0, right: 1000, bottom: 22, width: 1000, height: 22, x: 0, y: 0 };
  if (this.id === 'rulerLeft') return { left: 0, top: 0, right: 22, bottom: 600, width: 22, height: 600, x: 0, y: 0 };
  return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
};
win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
const rafQueue = [];
win.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
win.cancelAnimationFrame = () => {};
win.devicePixelRatio = 1;
win.URL.createObjectURL = () => 'blob:kb-stub';
win.URL.revokeObjectURL = () => {};
win.HTMLAnchorElement.prototype.click = function () { win.__lastDownload = this.download || 'download'; };
win.Element.prototype.scrollIntoView = function () {};
win.HTMLElement.prototype.setPointerCapture = function () {};
const flushFrames = (n = 3) => { for (let i = 0; i < n; i++) { const q = rafQueue.splice(0, rafQueue.length); for (const cb of q) cb(performance.now() + i * 16); } };

// ---------- boot ----------
win.eval(bundle);
const KB = win.__KB__;
assert.ok(KB, 'app exposed __KB__ debug handle');
assert.equal(KB.Doc.state.layers.length, 1, 'default document has one background layer');
console.log('title after boot:', JSON.stringify(win.document.title));
assert.equal(win.document.title.includes('untitled-1'), true, 'title shows document name');
flushFrames(4);

const $ = (sel) => win.document.querySelector(sel);
assert.ok($('#layerList').children.length >= 1, 'layers panel rendered');
const toolCount = win.document.querySelectorAll('.tool-btn').length;
assert.ok(toolCount >= 14, `tool rail populated (${toolCount} tools)`);
assert.equal(win.document.querySelectorAll('#menuHost .menu-btn').length, 9, 'all 9 menus rendered');
console.log('✓ boot: default document, layers panel, tool rail, menus');

// ---------- brush painting respects the active layer + history ----------
// small doc at 100% zoom with no offset so client coords == doc coords
KB.Doc.newDocument('stroke-test', 200, 150, 'white');
KB.Render.view.zoom = 1;
KB.Render.view.offX = 0;
KB.Render.view.offY = 0;
flushFrames(2);
const layer = KB.Doc.activeLayer();
const ctx = layer.canvas.getContext('2d', { willReadFrequently: true });
const before = ctx.getImageData(50, 50, 1, 1).data.slice();
KB.UI.fg = '#ff0000';
KB.Tools.set('brush');
const view = $('#view');
const fire = (type, x, y, extra = {}) => {
  const ev = new win.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, pointerType: 'mouse', ...extra });
  view.dispatchEvent(ev);
};
fire('pointerdown', 50, 50);
fire('pointermove', 70, 50);
fire('pointermove', 90, 50);
fire('pointerup', 90, 50);
const after = ctx.getImageData(50, 50, 1, 1).data;
assert.ok(after[0] > 150 && after[1] < 90, `painted red stroke (got rgb ${after[0]},${after[1]},${after[2]})`);
assert.notDeepEqual([...after], [...before]);
console.log('✓ brush: paints onto the active layer');

// undo restores pixels
const freshCtx = () => KB.Doc.activeLayer().canvas.getContext('2d', { willReadFrequently: true });
KB.Doc.undo();
const undone = freshCtx().getImageData(50, 50, 1, 1).data;
assert.deepEqual([...undone], [...before], 'undo restores the pre-stroke state');
KB.Doc.redo();
const redone = freshCtx().getImageData(50, 50, 1, 1).data;
assert.ok(redone[0] > 150 && redone[1] < 90, 'redo re-applies the stroke');
console.log('✓ history: undo/redo roundtrip on pixels');

// ---------- selections ----------
KB.Selection.clear();
KB.Selection.rect(4, 4, 100, 80, 'new');
assert.equal(KB.Selection.hasSelection(), true);
assert.ok(KB.Selection.alphaAt(20, 20) > 200, 'inside selection is opaque');
assert.equal(KB.Selection.alphaAt(500, 500), 0, 'outside selection is transparent');
KB.Selection.invert();
assert.ok(KB.Selection.alphaAt(500, 500) > 200, 'inverted selection covers the outside');
KB.Selection.clear();
console.log('✓ selection: rect + invert on the alpha mask');

// ---------- menu bar opens ----------
const fileBtn = [...win.document.querySelectorAll('#menuHost .menu-btn')].find((b) => b.textContent === 'File');
fileBtn.click();
const dropdown = win.document.body.querySelector('.menu-dropdown');
assert.ok(dropdown, 'File menu opens');
assert.ok(dropdown.textContent.includes('Save as PSD'));
KB.Menus.closeAll();
assert.equal(win.document.body.querySelector('.menu-dropdown'), null, 'menu closes');
console.log('✓ menus: File menu opens and lists PSD save');

// ---------- save a real PSD end-to-end ----------
KB.PSD.savePsd();
assert.equal(win.__lastDownload, `${KB.Doc.state.name}.psd`, 'PSD save downloads a .psd file');
assert.equal(KB.Doc.state.dirty, false, 'save clears the dirty flag');
console.log('✓ psd: save produces untitled-1.psd and clears dirty flag');

// rebuild a PSD buffer directly to verify reopening works
const { writePsd } = await import('../js/vendor/ag-psd.bundle.mjs');
const testPsd = writePsd({
  width: 8,
  height: 8,
  children: [{ name: 'Reopened layer', left: 0, top: 0, imageData: { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(200) } }],
});
const reopened = await KB.PSD.openPsd({ name: 'reopen-me.psd', arrayBuffer: async () => testPsd });
assert.equal(reopened, true);
assert.equal(KB.Doc.state.name, 'reopen-me');
assert.ok(KB.Doc.state.layers.some((l) => l.name === 'Reopened layer'), 'opened PSD restores layer names');
console.log('✓ psd: real .psd file reopens with layers intact');

// ---------- new document via dialog command path ----------
KB.Doc.newDocument('smoke-test', 64, 48, 'white');
assert.equal(KB.Doc.state.width, 64);
assert.equal(KB.Doc.state.height, 48);
assert.ok(KB.Doc.memoryEstimate() > 0);
console.log('✓ document: new document command path works');

// ---------- zoom & render frames ----------
KB.Render.fit();
KB.Render.zoomAt(1.5);
flushFrames(3);
assert.ok(KB.Render.view.zoom > 0, 'viewport zoom is finite');
console.log('✓ render: fit/zoom/composite frames run');

console.log('\nSMOKE TEST PASSED — KB EDITOR boots and the core flows work.');
process.exit(0);
