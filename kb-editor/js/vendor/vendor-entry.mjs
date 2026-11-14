// Re-exports ag-psd's bindings as named ESM exports.
import agPsd from 'ag-psd';
export const readPsd = agPsd.readPsd;
export const writePsd = agPsd.writePsd;
export const writePsdUint8Array = agPsd.writePsdUint8Array;
export const initializeCanvas = agPsd.initializeCanvas;
export const getLayerCanvas = agPsd.getLayerCanvas;
export const getCompositeCanvas = agPsd.getCompositeCanvas;
export default agPsd;
