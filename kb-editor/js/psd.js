// The real PSD engine: reads and writes actual Photoshop .psd files in the browser,
// powered by ag-psd (MIT). Handles layers, masks, blend modes, opacity, visibility and
// groups (groups are rendered to their appearance and imported as single layers).

import { readPsd, writePsd } from './vendor/ag-psd.bundle.mjs';
import { Doc, createLayer, blendModeToCanvas, MAX_PIXELS } from './document.js';
import { Render } from './render.js';
import { Panels } from './panels.js';
import { Selection } from './selection.js';
import { newCanvas, downloadBlob, downloadCanvas, clamp } from './util.js';

const PSD_BLEND_TO_CANVAS = (m) => blendModeToCanvas(m);

/** Normalize any ag-psd mask canvas (grayscale or RGBA) to our internal alpha-mask format. */
const alphaMaskFromGray = (maskCanvas, docW, docH, offsetX = 0, offsetY = 0) => {
  const out = newCanvas(docW, docH);
  const ctx = out.getContext('2d');
  const mx = offsetX, my = offsetY;
  const src = newCanvas(maskCanvas.width, maskCanvas.height);
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(maskCanvas, 0, 0);
  const img = sctx.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  const oimg = ctx.createImageData(src.width, src.height);
  const o = oimg.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) | 0;
    o[i] = 255; o[i + 1] = 255; o[i + 2] = 255; o[i + 3] = lum;
  }
  const tmp = newCanvas(src.width, src.height);
  tmp.getContext('2d').putImageData(oimg, 0, 0);
  ctx.drawImage(tmp, mx, my);
  return out;
};

/** Render an ag-psd node (layer or group) into a full-size canvas, applying masks/opacity/blend. Used for group flattening. */
const renderNodeToCanvas = (node, docW, docH, drawNode) => {
  const c = newCanvas(docW, docH);
  const ctx = c.getContext('2d');
  for (const child of [...(node.children || [])].reverse()) {
    drawNode(ctx, child);
  }
  return c;
};

export const PSD = {
  async openFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.psd') || name.endsWith('.psb')) {
      return this.openPsd(file);
    }
    // Generic raster formats the browser can decode
    const bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > MAX_PIXELS) {
      bitmap.close?.();
      Panels.toast('That image is too large to open (30 MP pixel cap).');
      return false;
    }
    const canvas = newCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const layer = createLayer(file.name.replace(/\.[^.]+$/, ''), canvas);
    Doc.fromImport(file.name.replace(/\.[^.]+$/, ''), canvas.width, canvas.height, [layer]);
    Render.fit();
    Render.markDirty();
    return true;
  },

  async openPsd(file) {
    const buffer = await file.arrayBuffer();
    let psd;
    try {
      psd = readPsd(buffer);
    } catch (err) {
      console.error('PSD read failed', err);
      Panels.toast(`Could not read “${file.name}”: ${err?.message || err}`);
      return false;
    }
    const w = psd.width, h = psd.height;
    if (!w || !h || w > 16000 || h > 16000 || w * h > MAX_PIXELS) {
      Panels.toast('That PSD is too large to open (30 MP pixel cap).');
      return false;
    }
    const docName = file.name.replace(/\.(psd|psb)$/i, '');
    const imported = [];
    let skippedAdjustments = 0;
    let sawEmpty = false;

    // Draw an ag-psd node (or subtree) into a target context with position/mask/clip applied.
    const drawNode = (ctx, node) => {
      if (node.hidden) return;
      ctx.save();
      ctx.globalAlpha = clamp(node.opacity ?? 1, 0, 1);
      ctx.globalCompositeOperation = PSD_BLEND_TO_CANVAS(node.blendMode);
      const hasOwnBitmap = !!node.canvas && !node.children;
      if (node.children) {
        // group: render children to a scratch canvas, then apply the group's own mask, then draw it
        const scratch = renderNodeToCanvas(node, w, h, drawNode);
        let toDraw = scratch;
        if (node.mask && !node.mask.disabled) {
          const tmp = newCanvas(w, h);
          const tctx = tmp.getContext('2d');
          tctx.drawImage(scratch, 0, 0);
          tctx.globalCompositeOperation = 'destination-in';
          tctx.drawImage(alphaMaskFromGray(node.mask.canvas, w, h, node.mask.left || 0, node.mask.top || 0), 0, 0);
          toDraw = tmp;
        }
        ctx.drawImage(toDraw, 0, 0);
        ctx.restore();
        return;
      }
      if (hasOwnBitmap) {
        let toDraw = node.canvas;
        if (node.mask && !node.mask.disabled && node.mask.canvas) {
          const tmp = newCanvas(w, h);
          const tctx = tmp.getContext('2d');
          tctx.drawImage(node.canvas, node.left || 0, node.top || 0);
          tctx.globalCompositeOperation = 'destination-in';
          tctx.drawImage(alphaMaskFromGray(node.mask.canvas, w, h, node.mask.left || 0, node.mask.top || 0), 0, 0);
          if (node.realMask && node.realMask.canvas && !node.realMask.disabled) {
            tctx.drawImage(alphaMaskFromGray(node.realMask.canvas, w, h, node.realMask.left || 0, node.realMask.top || 0), 0, 0);
            // destination-in twice: both masks must keep a pixel
          }
          toDraw = tmp;
          ctx.drawImage(toDraw, 0, 0);
        } else {
          ctx.drawImage(toDraw, node.left || 0, node.top || 0);
        }
      } else {
        skippedAdjustments++;
      }
      ctx.restore();
    };

    const makeLayer = (node) => {
      // Raw pixels without opacity/blend/mask so the live layer controls work in KB EDITOR.
      const canvas = newCanvas(w, h);
      drawNode(canvas.getContext('2d'), { ...node, opacity: 1, blendMode: 'normal', mask: undefined, realMask: undefined });
      const layer = createLayer(node.name || 'Layer', canvas);
      layer.visible = !node.hidden;
      layer.opacity = clamp(node.opacity ?? 1, 0, 1);
      layer.blendMode = node.blendMode || 'normal';
      if (node.mask && !node.mask.disabled && node.mask.canvas) {
        layer.mask = alphaMaskFromGray(node.mask.canvas, w, h, node.mask.left || 0, node.mask.top || 0);
        layer.maskEnabled = true;
      }
      return layer;
    };

    // Collect layers in top→bottom Photoshop order, then flip for our bottom→top array.
    const nodes = [...(psd.children || [])];
    for (const node of [...nodes].reverse()) {
      if (node.children) {
        // Group: flatten appearance into a single layer
        const canvas = newCanvas(w, h);
        drawNode(canvas.getContext('2d'), node);
        const layer = createLayer(`${node.name || 'Group'} (group)`, canvas);
        layer.visible = !node.hidden;
        imported.push(layer);
        continue;
      }
      if (!node.canvas && !node.children) { skippedAdjustments++; continue; }
      imported.push(makeLayer(node));
    }

    // If any canvas-less layers were skipped (adjustment/fill layers), bake the composite
    // in underneath so the imported document looks exactly like the original.
    if (skippedAdjustments > 0 && psd.canvas) {
      const comp = newCanvas(w, h);
      comp.getContext('2d').drawImage(psd.canvas, 0, 0);
      const layer = createLayer('Flattened composite (import fallback)', comp);
      imported.unshift(layer); // bottom of the stack
    }

    if (!imported.length) {
      // Blank or fully unsupported file: at least keep the composite if present
      if (psd.canvas) {
        const comp = newCanvas(w, h);
        comp.getContext('2d').drawImage(psd.canvas, 0, 0);
        imported.push(createLayer('Composite', comp));
        sawEmpty = true;
      } else {
        Panels.toast('This PSD contains no readable layers.');
        return false;
      }
    }

    Doc.fromImport(docName, w, h, imported);
    Selection.clear();
    Render.fit();
    Render.markDirty();
    if (skippedAdjustments > 0) {
      Panels.toast(`Imported with a flattened base: ${skippedAdjustments} adjustment/fill layer${skippedAdjustments > 1 ? 's' : ''} can't be edited as layers.`);
    } else if (sawEmpty) {
      Panels.toast('No layer bitmaps found — using the composite image.');
    }
    return true;
  },

  /** Write the current document to a real .psd and download it. */
  savePsd() {
    const { width, height, name, layers } = Doc.state;
    const children = [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      const trimmed = trimTransparent(layer.canvas);
      const child = {
        name: layer.name,
        left: trimmed ? trimmed.x : 0,
        top: trimmed ? trimmed.y : 0,
        canvas: trimmed ? trimmed.canvas : undefined,
        imageData: undefined,
        opacity: clamp(layer.opacity, 0, 1),
        hidden: !layer.visible,
        blendMode: layer.blendMode || 'normal',
      };
      if (layer.mask) {
        child.mask = {
          left: 0,
          top: 0,
          disabled: layer.maskEnabled === false,
          canvas: alphaMaskToGray(layer.mask),
        };
      }
      children.push(child);
    }
    let data;
    try {
      data = writePsd({ width, height, children, canvas: Render.getComposite() });
    } catch (err) {
      console.error('PSD write failed', err);
      Panels.toast(`Saving the PSD failed: ${err?.message || err}`);
      return false;
    }
    downloadBlob(new Blob([data], { type: 'application/octet-stream' }), `${sanitize(name)}.psd`);
    Doc.state.dirty = false;
    Panels.setDirty(false);
    Panels.toast('Saved as PSD — opens in Photoshop.');
    return true;
  },

  /** Export a flat PNG/JPEG/WebP of the composite. */
  exportImage(kind) {
    const { name } = Doc.state;
    const comp = Render.getComposite();
    const base = sanitize(name);
    if (kind === 'png') { downloadCanvas(comp, `${base}.png`, 'image/png'); return; }
    if (kind === 'webp') { downloadCanvas(comp, `${base}.webp`, 'image/webp', 0.92); return; }
    // JPEG: no alpha — flatten onto white
    const flat = newCanvas(comp.width, comp.height);
    const ctx = flat.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(comp, 0, 0);
    downloadCanvas(flat, `${base}.jpg`, 'image/jpeg', 0.92);
  },

  /** Rough flatten for clipboard/export (same as composite). */
  compositeCanvas() {
    return Render.getComposite();
  },
};

const sanitize = (name) => (name || 'untitled').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'untitled';

/** Crop a canvas to its non-transparent bounding box. Returns null when fully transparent. */
const trimTransparent = (canvas) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[(row + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const out = newCanvas(w, h);
  out.getContext('2d').drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return { canvas: out, x: minX, y: minY };
};

/** Alpha mask → opaque grayscale canvas (white reveal / black conceal) for PSD export. */
const alphaMaskToGray = (maskCanvas) => {
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = maskCanvas;
  const img = ctx.getImageData(0, 0, width, height);
  const out = newCanvas(width, height);
  const octx = out.getContext('2d');
  const oimg = octx.createImageData(width, height);
  const d = img.data, o = oimg.data;
  for (let i = 0; i < d.length; i += 4) {
    o[i] = o[i + 1] = o[i + 2] = d[i + 3];
    o[i + 3] = 255;
  }
  octx.putImageData(oimg, 0, 0);
  return out;
};
