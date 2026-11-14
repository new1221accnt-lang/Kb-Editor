// Shared mutable UI state (active tool, colors, option values). Kept dependency-free
// so every module can import it without import cycles.

export const UI = {
  tool: 'move',
  fg: '#111111',
  bg: '#ffffff',
  // Brush-like tools
  brushSize: 18,
  brushHardness: 0.75, // 0..1
  brushOpacity: 1,     // 0..1
  eraserSize: 36,
  // Gradient
  gradientStyle: 'fg-bg',   // 'fg-bg' | 'fg-transparent'
  gradientShape: 'linear',  // 'linear' | 'radial'
  // Wand
  wandTolerance: 32,
  wandContiguous: true,
  wandSampleAll: false,
  // Bucket
  bucketTolerance: 32,
  bucketContiguous: true,
  // Type
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 92,
  fontBold: false,
  fontItalic: false,
  // Shape
  shapeKind: 'rect',        // 'rect' | 'ellipse' | 'line'
  shapeFill: true,
  shapeStroke: false,
  shapeStrokeWidth: 4,
  // Marquee
  marqueeFeather: 0,
  // Crop aspect (0 = free, e.g. 1 = square, 0.75 = 4:3)
  cropAspect: 0,
  // Move
  moveAutoSelect: true,
  // Eyedropper sample size (1, 3 or 5)
  eyedropperSample: 1,
  // Gradient
  gradientReverse: false,
  // When set to a layer id, the brush paints that layer's mask instead of the layer
  editingMaskFor: null,
  // View flags
  showRulers: true,
  showGuides: true,
  showGrid: false,
  showPanels: true,
};

export const swapColors = () => { const t = UI.fg; UI.fg = UI.bg; UI.bg = t; };
export const resetColors = () => { UI.fg = '#111111'; UI.bg = '#ffffff'; };
