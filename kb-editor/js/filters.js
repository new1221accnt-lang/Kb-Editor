// Filters: convolution kernels, noise, pixelation, blurs. All selection-aware via pixelutil.

import { clamp, clamp255, newCanvas, copyCanvas } from './util.js';
import { applyToLayerPixels, applyCanvasOp, applyLUT } from './pixelutil.js';

export const KERNELS = {
  sharpen: [0, -1, 0, -1, 5, -1, 0, -1, 0],
  sharpenStrong: [ -1, -1, -1, -1, 9, -1, -1, -1, -1 ],
  emboss: [-2, -1, 0, -1, 1, 1, 0, 1, 2],
  findEdges: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
  boxBlur3: [1, 1, 1, 1, 1, 1, 1, 1, 1],
};

/** Convolve an ImageData in place with a 3×3 kernel. */
export const convolve3x3 = (img, kernel, divisor = null, bias = 0) => {
  const { width, height, data } = img;
  const k = kernel;
  const div = divisor ?? (k.reduce((a, b) => a + b, 0) || 1);
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - 1), y1 = y, y2 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - 1), x2 = Math.min(width - 1, x + 1);
      const rows = [
        (y0 * width + x0) * 4, (y0 * width + x) * 4, (y0 * width + x2) * 4,
        (y1 * width + x0) * 4, (y1 * width + x) * 4, (y1 * width + x2) * 4,
        (y2 * width + x0) * 4, (y2 * width + x) * 4, (y2 * width + x2) * 4,
      ];
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let p = 0; p < 9; p++) sum += src[rows[p] + c] * k[p];
        data[i + c] = clamp255(sum / div + bias);
      }
      data[i + 3] = src[i + 3];
    }
  }
  return img;
};

export const gaussianBlur = (layer, radius) => {
  radius = clamp(radius, 0.1, 120);
  applyCanvasOp(layer, (src) => {
    const out = newCanvas(src.width, src.height);
    const ctx = out.getContext('2d');
    ctx.filter = `blur(${radius}px)`;
    // Draw twice so edges don't bleed transparency into the middle.
    ctx.drawImage(src, 0, 0);
    ctx.filter = 'none';
    return out;
  });
};

export const motionBlur = (layer, size = 16, angleDeg = 0) => {
  size = clamp(Math.round(size), 1, 200);
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  applyCanvasOp(layer, (src) => {
    const out = newCanvas(src.width, src.height);
    const ctx = out.getContext('2d');
    const steps = size;
    ctx.globalAlpha = 1 / steps;
    for (let s = 0; s < steps; s++) {
      const t = (s / (steps - 1 || 1)) - 0.5;
      ctx.drawImage(src, Math.round(dx * t * size), Math.round(dy * t * size));
    }
    return out;
  });
};

export const sharpen = (layer, strong = false) => {
  applyToLayerPixels(layer, (img) => convolve3x3(img, strong ? KERNELS.sharpenStrong : KERNELS.sharpen, 1, 0));
};

export const emboss = (layer) => {
  applyToLayerPixels(layer, (img) => convolve3x3(img, KERNELS.emboss, 1, 128));
};

export const findEdges = (layer) => {
  applyToLayerPixels(layer, (img) => convolve3x3(img, KERNELS.findEdges, 1, 0));
};

/** Unsharp mask: out = src + (src − blur(src)) · amount, with a threshold. */
export const unsharpMask = (layer, radius = 2, amount = 0.8, threshold = 4) => {
  radius = clamp(radius, 0.1, 60);
  amount = clamp(amount, 0, 5);
  const src = copyCanvas(layer.canvas);
  const blurred = newCanvas(src.width, src.height);
  const bctx = blurred.getContext('2d');
  bctx.filter = `blur(${radius}px)`;
  bctx.drawImage(src, 0, 0);
  const sctx = src.getContext('2d', { willReadFrequently: true });
  const s = sctx.getImageData(0, 0, src.width, src.height);
  const b = bctx.getImageData(0, 0, blurred.width, blurred.height);
  applyToLayerPixels(layer, (img) => {
    // We mutate `img` (a copy of the layer) toward the unsharp result.
    const d = img.data, sd = s.data, bd = b.data;
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const diff = sd[i + c] - bd[i + c];
        if (Math.abs(diff) < threshold) { d[i + c] = sd[i + c]; continue; }
        d[i + c] = clamp255(sd[i + c] + diff * amount);
      }
    }
  });
};

/** Uniform additive noise. amount 0..1 */
export const addNoise = (layer, amount = 0.25, monochrome = false) => {
  amount = clamp(amount, 0, 1) * 255;
  applyToLayerPixels(layer, (img) => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (monochrome) {
        const n = (Math.random() * 2 - 1) * amount;
        d[i] = clamp255(d[i] + n);
        d[i + 1] = clamp255(d[i + 1] + n);
        d[i + 2] = clamp255(d[i + 2] + n);
      } else {
        d[i] = clamp255(d[i] + (Math.random() * 2 - 1) * amount);
        d[i + 1] = clamp255(d[i + 1] + (Math.random() * 2 - 1) * amount);
        d[i + 2] = clamp255(d[i + 2] + (Math.random() * 2 - 1) * amount);
      }
    }
  });
};

/** Blocky pixelation by drawing through a tiny intermediate canvas. */
export const pixelate = (layer, size = 8) => {
  size = clamp(Math.round(size), 1, 256);
  applyCanvasOp(layer, (src) => {
    const out = newCanvas(src.width, src.height);
    const ctx = out.getContext('2d');
    const tw = Math.max(1, Math.round(src.width / size));
    const th = Math.max(1, Math.round(src.height / size));
    const tmp = newCanvas(tw, th);
    tmp.getContext('2d').drawImage(src, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, tw, th, 0, 0, out.width, out.height);
    return out;
  });
};

/** Desaturate in place (Rec. 709 luma). */
export const grayscale = (layer) => {
  applyToLayerPixels(layer, (img) => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = clamp255(y);
    }
  });
};

/** Sepia tone. */
export const sepia = (layer) => {
  applyToLayerPixels(layer, (img) => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      d[i] = clamp255(0.393 * r + 0.769 * g + 0.189 * b);
      d[i + 1] = clamp255(0.349 * r + 0.686 * g + 0.168 * b);
      d[i + 2] = clamp255(0.272 * r + 0.534 * g + 0.131 * b);
    }
  });
};
