// Inline SVG icons (original, stroke = currentColor, 24×24 grid). No external assets.

const svg = (inner, viewBox = '0 0 24 24') =>
  `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const fill = (inner) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${inner}</svg>`;

export const ICONS = {
  move: svg('<path d="M12 2v20M2 12h20"/><path d="M12 2l-2.5 2.5M12 2l2.5 2.5M12 22l-2.5-2.5M12 22l2.5-2.5M2 12l2.5-2.5M2 12l2.5 2.5M22 12l-2.5-2.5M22 12l-2.5 2.5"/>'),
  'marquee-rect': svg('<rect x="3.5" y="5.5" width="17" height="13" rx="0.5" stroke-dasharray="3.2 2.6"/>'),
  'marquee-ellipse': svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5" stroke-dasharray="3.2 2.6"/>'),
  lasso: svg('<path d="M7.5 4c-3 2.5-4 6-2.5 9.5 1.6 3.6 5.5 5 9.2 4.2 3.3-.7 5.3-3 4.8-5.5-.5-2.7-4.2-3.9-7.5-3.2C7.6 10.2 5.9 8.4 7.5 4z"/><path d="M15.5 17.5c.5 1.8.2 2.8-1 3.4"/>'),
  wand: svg('<path d="M5 19l9.5-9.5"/><path d="M15.5 3l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6L15.5 3z" fill="currentColor" stroke="none"/><path d="M20 9l.45 1.25L21.7 10.7l-1.25.45L20 12.4l-.45-1.25-1.25-.45 1.25-.45L20 9z" fill="currentColor" stroke="none"/>'),
  crop: svg('<path d="M7 2v15h15"/><path d="M2 7h15v15"/>'),
  eyedropper: svg('<path d="M14.5 5.5l4 4L9 19H5v-4l9.5-9.5z"/><path d="M12.5 7.5l4 4"/><path d="M17 3l1.2-1.2a1.2 1.2 0 0 1 1.7 1.7L18.7 4.7 17 3z"/>'),
  brush: svg('<path d="M4 20c2.5.3 4.5-.3 5.8-1.8L19 9a2.83 2.83 0 0 0-4-4l-9.2 9.2C4.4 15.6 3.6 17.5 4 20z"/><path d="M13 7l4 4"/>'),
  eraser: svg('<path d="M6.5 20.5H20"/><path d="M8 18l-4.2-4.2a2 2 0 0 1 0-2.8l7.8-7.8a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 18"/><path d="M7.6 8.4l8 8"/>'),
  gradient: fill('<path d="M4 17a8 8 0 0 1 16 0H4z" opacity="0.28"/><path d="M4 17h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none" opacity="0.9"/><path d="M6.5 12.5l1 1M12 10v1.5M17.5 12.5l-1 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>'),
  bucket: svg('<path d="M10.5 3.5l7 7-8.5 8.5a2 2 0 0 1-2.8 0l-4.2-4.2a2 2 0 0 1 0-2.8l8.5-8.5"/><path d="M7.5 8.5l7 7"/><path d="M19 14s2 2.2 2 3.6a2 2 0 0 1-4 0C17 16.2 19 14 19 14z"/>'),
  type: svg('<path d="M5 6V4.5h14V6"/><path d="M12 4.5V20"/><path d="M9 20h6"/>'),
  shape: svg('<rect x="3.5" y="6" width="10" height="9" rx="0.5"/><ellipse cx="16" cy="15.5" rx="4.5" ry="3.5"/>'),
  hand: svg('<path d="M8 11.5V6a1.5 1.5 0 0 1 3 0v4.5"/><path d="M11 10.5V4.5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 10.8V6a1.5 1.5 0 0 1 3 0v6.5c0 4-2.2 7-6 7-3 0-4.2-1.3-5.7-4.5L4 12.6c-.6-1.3.9-2.6 2-1.4l2 2"/>'),
  zoom: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M8 10.5h5M10.5 8v5"/>'),
  // ui icons
  eye: svg('<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  eyeOff: svg('<path d="M4 4l16 16"/><path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17.2 17.2 0 0 1-3 3.6M6.4 6.9A16.4 16.4 0 0 0 2.5 12S6 18 12 18c.9 0 1.7-.15 2.5-.4"/><path d="M9.9 9.9a2.8 2.8 0 0 0 4 4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  duplicate: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="1.5"/><path d="M15.5 5.5v-1a2 2 0 0 0-2-2h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1"/>'),
  trash: svg('<path d="M4 7h16"/><path d="M9.5 7V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3V7"/><path d="M6.5 7l1 13a2 2 0 0 0 2 1.9h5a2 2 0 0 0 2-1.9l1-13"/>'),
  mask: svg('<rect x="3.5" y="5" width="17" height="14" rx="6.5"/><circle cx="9.2" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="14.8" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  chevronUp: svg('<path d="M6 14l6-6 6 6"/>'),
  chevronDown: svg('<path d="M6 10l6 6 6-6"/>'),
  check: svg('<path d="M4.5 12.5l5 5L19.5 6.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  swap: svg('<path d="M7 4L3.5 7.5 7 11"/><path d="M3.5 7.5H17"/><path d="M17 13l3.5 3.5L17 20"/><path d="M20.5 16.5H7"/>'),
  resetColors: svg('<path d="M6 6h7v7H6z"/><path d="M11 11h7v7h-7z" fill="currentColor" fill-opacity="0.45"/>'),
  folderOpen: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>'),
  save: svg('<path d="M5 3h11l4 4v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20V4.5A1.5 1.5 0 0 1 5.5 3z"/><path d="M8 3v5h7V3"/><rect x="8" y="13" width="8" height="6.5"/>'),
  download: svg('<path d="M12 3v12"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4 17.5v2A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-2"/>'),
  layers: svg('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 17l9 5 9-5"/>'),
  history: svg('<path d="M3.5 12a8.5 8.5 0 1 1 2.5 6"/><path d="M3.5 12H7M3.5 12V8.5"/><path d="M12 8v4.5l3 1.8"/>'),
  sliders: svg('<path d="M5 7h6M15 7h4M5 17h10M19 17h0"/><circle cx="13" cy="7" r="1.6"/><circle cx="17" cy="17" r="1.6"/>'),
  image: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10.5" r="1.4"/><path d="M5.5 17.5l5-5 4 4 3-3 3.5 3.5"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r="0.4" fill="currentColor"/>'),
  keyboard: svg('<rect x="2.5" y="7" width="19" height="10" rx="1.5"/><path d="M6 11h.01M10 11h.01M14 11h.01M18 11h.01M8.5 14h7"/>'),
};
