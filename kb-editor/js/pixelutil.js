// Pixel-processing helpers shared by filters and adjustments.
// Everything respects an active selection (non-destructive blend back through the mask).

import { newCanvas, copyCanvas } from './util.js';
import { Selection } from './selection.js';

const getData = (canvas) => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
const putData = (canvas, img) => canvas.getContext('2d').putImageData(img, 0, 0);

/**
 * Run `fn(imageData)` over the layer's pixels. `fn` mutates the passed ImageData in place.
 * The result is alpha-blended back through the selection, if any.
 */
export const applyToLayerPixels = (layer, fn) => {
  const src = getData(layer.canvas);
  const work = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  fn(work);
  const sel = Selection.alpha();
  if (sel) {
    const s = src.data, d = work.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = sel[i + 3] * (1 / 255);
      if (a >= 1) continue;
      if (a <= 0) { d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2]; d[i + 3] = s[i + 3]; continue; }
      const ia = 1 - a;
      d[i] = Math.round(d[i] * a + s[i] * ia);
      d[i + 1] = Math.round(d[i + 1] * a + s[i + 1] * ia);
      d[i + 2] = Math.round(d[i + 2] * a + s[i + 2] * ia);
      d[i + 3] = Math.round(d[i + 3] * a + s[i + 3] * ia);
    }
  }
  putData(layer.canvas, work);
};

/**
 * Run `fn(srcCanvas) -> resultCanvas` (e.g. a blur drawn with ctx.filter) and composite the
 * result back over the layer, clipped to the selection if there is one.
 */
export const applyCanvasOp = (layer, fn) => {
  const backup = copyCanvas(layer.canvas);
  const result = fn(backup) || backup;
  const ctx = layer.canvas.getContext('2d');
  ctx.save();
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  ctx.drawImage(backup, 0, 0);
  if (Selection.hasSelection() && Selection.mask) {
    const clipped = newCanvas(result.width, result.height);
    const cctx = clipped.getContext('2d');
    cctx.drawImage(result, 0, 0);
    cctx.globalCompositeOperation = 'destination-in';
    cctx.drawImage(Selection.mask, 0, 0);
    ctx.drawImage(clipped, 0, 0);
  } else {
    ctx.drawImage(result, 0, 0);
  }
  ctx.restore();
};

/** Apply a 256-entry per-channel LUT to the layer (rgb only; alpha preserved). */
export const applyLUT = (layer, lutR, lutG, lutB) => {
  applyToLayerPixels(layer, (img) => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lutR[d[i]];
      d[i + 1] = lutG[d[i + 1]];
      d[i + 2] = lutB[d[i + 2]];
    }
  });
};
