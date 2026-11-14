// Cut / copy / paste / clear — internal clipboard + best-effort system clipboard.

import { newCanvas } from './util.js';
import { Doc, createLayer } from './document.js';
import { Selection } from './selection.js';
import { Render } from './render.js';
import { Panels } from './panels.js';
import { UI } from './state.js';

let internalClipboard = null; // canvas

export const ClipboardOps = {
  /** Copy the active layer (clipped to the selection, if any) into the clipboard. */
  copy(cut = false) {
    const layer = Doc.activeLayer();
    if (!layer) { Panels.toast('Select a layer first.'); return false; }
    const bounds = Selection.hasSelection() ? Selection.bounds() : { x: 0, y: 0, w: layer.canvas.width, h: layer.canvas.height };
    if (!bounds || bounds.w <= 0 || bounds.h <= 0) { Panels.toast('The selection is empty.'); return false; }
    const out = newCanvas(bounds.w, bounds.h);
    const ctx = out.getContext('2d');
    ctx.drawImage(layer.canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
    if (Selection.hasSelection() && Selection.mask) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(Selection.mask, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
    }
    internalClipboard = out;
    // Best-effort: also share with the system clipboard so pasting into Photoshop etc. works.
    try {
      out.toBlob(async (blob) => {
        if (!blob || !navigator.clipboard?.write) return;
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } catch { /* permission denied — internal clipboard still works */ }
      }, 'image/png');
    } catch { /* ClipboardItem unsupported */ }
    if (cut) this.clear();
    return true;
  },

  /** Delete the selected pixels from the active layer (or the whole layer if no selection). */
  clear() {
    const layer = Doc.activeLayer();
    if (!layer) return;
    Doc.pushHistory('Clear');
    const ctx = layer.canvas.getContext('2d');
    if (Selection.hasSelection() && Selection.mask) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(Selection.mask, 0, 0);
      ctx.restore();
    } else {
      ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    }
    Doc.state.dirty = true;
    Doc.state.revision++;
    Doc._notify('structure');
    Render.markDirty();
  },

  /** Fill the selection (or whole layer) with a color. */
  fill(hex) {
    const layer = Doc.activeLayer();
    if (!layer) { Panels.toast('Select a layer first.'); return; }
    Doc.pushHistory('Fill');
    const ctx = layer.canvas.getContext('2d');
    const { width, height } = layer.canvas;
    if (Selection.hasSelection() && Selection.mask) {
      const tmp = newCanvas(width, height);
      const tctx = tmp.getContext('2d');
      tctx.fillStyle = hex;
      tctx.fillRect(0, 0, width, height);
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(Selection.mask, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    } else {
      ctx.save();
      ctx.fillStyle = hex;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
    Doc.state.dirty = true;
    Doc.state.revision++;
    Doc._notify('structure');
    Render.markDirty();
  },

  /** Paste: prefer the system clipboard image, fall back to the internal one. */
  async paste() {
    let bitmap = null;
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith('image/'));
          if (type) {
            const blob = await item.getType(type);
            bitmap = await createImageBitmap(blob);
            break;
          }
        }
      }
    } catch { /* fall through to internal clipboard */ }

    const { width: dw, height: dh } = Doc.state;
    const layer = (() => {
      if (bitmap) {
        const scale = Math.min(1, dw / bitmap.width, dh / bitmap.height);
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = newCanvas(w, h);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        // center on the document
        const full = newCanvas(dw, dh);
        full.getContext('2d').drawImage(canvas, Math.round((dw - w) / 2), Math.round((dh - h) / 2));
        return createLayer('Pasted', full);
      }
      if (internalClipboard) {
        const full = newCanvas(dw, dh);
        const ctx = full.getContext('2d');
        ctx.drawImage(internalClipboard, Math.round((dw - internalClipboard.width) / 2), Math.round((dh - internalClipboard.height) / 2));
        return createLayer('Pasted', full);
      }
      return null;
    })();

    if (!layer) { Panels.toast('Nothing to paste — copy an image first.'); return; }
    Doc.pushHistory('Paste');
    Doc.addLayer(layer);
    Render.markDirty();
    Panels.refreshLayers();
    Panels.toast('Pasted as a new layer.');
  },
};
