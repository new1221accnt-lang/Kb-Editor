// Adjustments: pure, testable curve/LUT builders + the layer-level operations.

import { clamp, clamp255 } from './util.js';
import { applyToLayerPixels, applyLUT } from './pixelutil.js';

/** 256-entry LUT mapping 0..255 → 0..255. */
export const buildLevelsLUT = ({ inBlack = 0, inWhite = 255, gamma = 1, outBlack = 0, outWhite = 255 } = {}) => {
  const lut = new Uint8ClampedArray(256);
  const span = Math.max(1, inWhite - inBlack);
  const ospan = outWhite - outBlack;
  const invGamma = 1 / clamp(gamma, 0.1, 9.99);
  for (let i = 0; i < 256; i++) {
    let v = clamp((i - inBlack) / span, 0, 1);
    v = Math.pow(v, invGamma);
    lut[i] = clamp255(outBlack + v * ospan);
  }
  return lut;
};

export const buildBrightnessContrastLUT = (brightness = 0, contrast = 0) => {
  const lut = new Uint8ClampedArray(256);
  const b = clamp(brightness, -100, 100) * 2.55;
  const c = clamp(contrast, -100, 100) * 2.55;
  const f = (259 * (c + 255)) / (255 * (259 - c) || 1);
  for (let i = 0; i < 256; i++) lut[i] = clamp255(f * (i - 128) + 128 + b);
  return lut;
};

/** Catmull-Rom interpolation through control points [[0..1, 0..1], …] → 256-entry LUT. */
export const buildCurvesLUT = (points) => {
  const lut = new Uint8ClampedArray(256);
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  if (!pts.length) { for (let i = 0; i < 256; i++) lut[i] = i; return lut; }
  if (pts.length === 1) { lut.fill(clamp255(Math.round(pts[0][1] * 255))); return lut; }
  const get = (i) => pts[clamp(i, 0, pts.length - 1)];
  let seg = 0;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    while (seg < pts.length - 2 && x > pts[seg + 1][0]) seg++;
    const p0 = get(seg - 1), p1 = get(seg), p2 = get(seg + 1), p3 = get(seg + 2);
    const span = Math.max(1e-6, p2[0] - p1[0]);
    const t = clamp((x - p1[0]) / span, 0, 1);
    const t2 = t * t, t3 = t2 * t;
    const y =
      0.5 *
      ((2 * p1[1]) +
        (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
    lut[i] = clamp255(Math.round(y * 255));
  }
  return lut;
};

export const identityCurves = () => [{ rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] }][0];

export const levelsAdjustment = (layer, params) => applyLUT(layer, buildLevelsLUT(params), buildLevelsLUT(params), buildLevelsLUT(params));
export const brightnessContrast = (layer, brightness, contrast) => {
  const lut = buildBrightnessContrastLUT(brightness, contrast);
  applyLUT(layer, lut, lut, lut);
};

/** curves: { rgb: [[x,y]…], r: [...], g: [...], b: [...] } */
export const curves = (layer, curvesState) => {
  const lum = buildCurvesLUT(curvesState.rgb);
  const lr = buildCurvesLUT(curvesState.r);
  const lg = buildCurvesLUT(curvesState.g);
  const lb = buildCurvesLUT(curvesState.b);
  const lutR = new Uint8ClampedArray(256), lutG = new Uint8ClampedArray(256), lutB = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    lutR[i] = lum[lr[i]];
    lutG[i] = lum[lg[i]];
    lutB[i] = lum[lb[i]];
  }
  applyLUT(layer, lutR, lutG, lutB);
};

const buildExposureLUTs = (ev) => {
  const lut = new Uint8ClampedArray(256);
  const gain = Math.pow(2, clamp(ev, -6, 6));
  for (let i = 0; i < 256; i++) lut[i] = clamp255(Math.round(i * gain));
  return lut;
};
export const exposure = (layer, ev) => { const lut = buildExposureLUTs(ev); applyLUT(layer, lut, lut, lut); };

export const invert = (layer) => {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = 255 - i;
  applyLUT(layer, lut, lut, lut);
};

export const threshold = (layer, level = 128) => {
  const t = clamp(level, 0, 255);
  applyToLayerPixels(layer, (img) => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      const v = y >= t ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  });
};

export const posterize = (layer, levels = 4) => {
  const n = clamp(Math.round(levels), 2, 255);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp255(Math.round((Math.round((i / 255) * (n - 1)) / (n - 1)) * 255));
  applyLUT(layer, lut, lut, lut);
};

/* ---------- HSL machinery (hue/saturation/lightness) ---------- */

export const rgbToHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
};

export const hslToRgb = (h, s, l) => {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [clamp255(Math.round((r + m) * 255)), clamp255(Math.round((g + m) * 255)), clamp255(Math.round((b + m) * 255))];
};

/** hue −180..180, saturation −100..100, lightness −100..100 */
export const hueSaturation = (layer, hue = 0, saturation = 0, lightness = 0) => {
  applyToLayerPixels(layer, (img) => {
    const d = img.data;
    const sMul = saturation >= 0 ? 1 + saturation / 100 : 1 + saturation / 100;
    const lAdd = lightness / 100 * 0.5;
    for (let i = 0; i < d.length; i += 4) {
      let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      h += hue;
      s = clamp(s * sMul, 0, 1);
      l = clamp(l + lAdd, 0, 1);
      const [r, g, b] = hslToRgb(h, s, l);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  });
};
