// Node smoke tests for the PSD engine glue and the pure adjustment math.
// Run with: npm test

import assert from 'node:assert/strict';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { readPsd, writePsd, initializeCanvas } from '../js/vendor/ag-psd.bundle.mjs';

// ag-psd needs a canvas factory even for raw image data paths (used in Node tests only;
// browsers provide a real canvas).
initializeCanvas(createCanvas);
import { buildLevelsLUT, buildCurvesLUT, buildBrightnessContrastLUT, rgbToHsl, hslToRgb } from '../js/adjustments.js';
import { KERNELS, convolve3x3 } from '../js/filters.js';

const W = 6, H = 4;
const px = (fn) => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const [r, g, b, a] = fn(x, y);
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { width: W, height: H, data };
};

// ─── 1. PSD roundtrip: layers, blend modes, opacity, visibility, masks ───
{
  const red = px(() => [255, 0, 0, 255]);
  const maskData = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) maskData[i] = i % 2 === 0 ? 255 : 0; // zebra mask
  const psd = {
    width: W,
    height: H,
    children: [
      {
        name: 'Top multiply',
        left: 0,
        top: 0,
        imageData: red,
        blendMode: 'multiply',
        opacity: 0.5,
        hidden: false,
      },
      {
        name: 'Hidden normal',
        left: 0,
        top: 0,
        imageData: px(() => [0, 255, 0, 255]),
        blendMode: 'normal',
        opacity: 1,
        hidden: true,
        mask: { left: 0, top: 0, imageData: { width: W, height: H, data: maskData } },
      },
    ],
  };
  const buffer = writePsd(psd);
  const back = readPsd(buffer, { useImageData: true });
  assert.equal(back.children.length, 2, 'two layers written');
  const names = back.children.map((c) => c.name).sort();
  assert.deepEqual(names, ['Hidden normal', 'Top multiply']);
  const top = back.children.find((c) => c.name === 'Top multiply');
  assert.equal(top.blendMode, 'multiply');
  assert.ok(Math.abs(top.opacity - 0.5) < 0.01, `opacity roundtrip ≈ ${top.opacity}`);
  const hidden = back.children.find((c) => c.name === 'Hidden normal');
  assert.equal(hidden.hidden, true);
  assert.ok(hidden.mask, 'layer mask survived the roundtrip');
  const backMask = hidden.mask.imageData;
  assert.equal(backMask.width, W);
  const maskSum = backMask.data.reduce((a, b) => a + b, 0);
  assert.ok(maskSum > 0, 'mask data preserved');
  // Pixel content roundtrip
  const backRed = top.imageData;
  assert.deepEqual([...backRed.data.slice(0, 4)], [255, 0, 0, 255]);
  console.log('✓ PSD write → read roundtrip (layers, blend mode, opacity, visibility, mask)');
}

// ─── 2. Composite is skipped for unsupported files but layer structure survives ───
{
  const empty = writePsd({ width: 2, height: 2, children: [{ name: 'Empty layer' }] });
  const back = readPsd(empty, { skipCompositeImageData: true, skipThumbnail: true });
  assert.equal(back.children[0].name, 'Empty layer');
  console.log('✓ Empty layer roundtrip');
}

// ─── 3. LUT math ───
{
  const id = buildLevelsLUT({});
  assert.equal(id[0], 0);
  assert.equal(id[128], 128);
  assert.equal(id[255], 255);
  const bright = buildLevelsLUT({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 64, outWhite: 255 });
  assert.equal(bright[0], 64);
  assert.equal(bright[255], 255);
  const gammaUp = buildLevelsLUT({ gamma: 2 });
  assert.ok(gammaUp[64] > 64, 'gamma > 1 lifts midtones');
  const bc = buildBrightnessContrastLUT(0, 100);
  assert.ok(bc[200] > 200, 'positive contrast pushes high values up');
  assert.ok(bc[55] < 55, 'positive contrast pushes low values down');
  const curve = buildCurvesLUT([[0, 0], [0.5, 0.75], [1, 1]]);
  assert.ok(curve[128] > 128, 'midtone pulled up by the curve point');
  const flat = buildCurvesLUT([[0, 1], [1, 1]]);
  assert.ok(flat.every((v) => v === 255));
  console.log('✓ levels / brightness-contrast / curves LUTs');
}

// ─── 4. HSL roundtrip ───
{
  for (const [r, g, b] of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [18, 200, 99], [0, 0, 0], [255, 255, 255]]) {
    const [h, s, l] = rgbToHsl(r, g, b);
    const [r2, g2, b2] = hslToRgb(h, s, l);
    const drift = Math.abs(r - r2) + Math.abs(g - g2) + Math.abs(b - b2);
    assert.ok(drift <= 3, `HSL roundtrip off by ${drift} for rgb(${r},${g},${b})`);
  }
  console.log('✓ HSL ↔ RGB roundtrip');
}

// ─── 5. Convolution sanity (sharpen kernel on a flat image is a no-op) ───
{
  const img = { width: 3, height: 3, data: new Uint8ClampedArray(3 * 3 * 4) };
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] = img.data[i + 1] = img.data[i + 2] = 120; img.data[i + 3] = 255; }
  convolve3x3(img, KERNELS.sharpen, 1, 0);
  assert.equal(img.data[0], 120);
  assert.equal(img.data[(4) * 4], 120);
  console.log('✓ 3×3 convolution on a flat field');
}

console.log('\nAll KB EDITOR engine tests passed.');
