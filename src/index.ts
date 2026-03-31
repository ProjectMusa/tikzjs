/**
 * tikzjs public API.
 *
 * This module provides the main entry points for parsing TikZ source
 * and generating output.
 *
 * Usage:
 *   import { parse, generate, roundTrip } from 'tikzjs'
 *
 *   // Parse TikZ to IR
 *   const diagram = parse('\\draw (0,0) -- (1,1);')
 *
 *   // Generate SVG
 *   const svg = generate('\\draw (0,0) -- (1,1);')
 *
 *   // Or parse first, then generate (allows IR inspection/manipulation)
 *   const ir = parse('\\draw[->] (A) -- (B);')
 *   const svg = generateFromIR(ir)
 */

// Re-export everything from the CJS-safe core module
export {
  parse, generate, generateFromIR, generateTikZFromIR,
  runWorker, Generate, serializeIR, deserializeIR,
  generateSVGElement, generateTikZ, DEFAULT_CONSTANTS, defaultMathRenderer,
  moveNode, findNode, isDraggable, collectNodes, findElement,
  updateCurveControl, moveSegmentEndpoint, updateNodeLabel, updateEdgeLabel,
  removeElement, addNode, duplicateElement, setStyleProp,
} from './core.js'

export type {
  IRDiagram, IRElement, ExpandedDoc,
  SVGGeneratorOptions, SVGElementResult,
  TikZGeneratorOptions, SVGRenderingConstants,
  SVGRendererRegistry, RenderContext, ElementRenderResult,
  MathRenderer, MathResult,
} from './core.js'

// D3 editor exports — browser-only (depend on ESM-only d3-selection/d3-zoom).
// These work in bundler environments (Vite, webpack) but will fail with Node.js CJS require().
// For Node.js CJS scripts, use require('./dist/core.js') instead.
export { createD3Editor } from './generators/d3/index.js'
export type { D3EditorController, D3EditorOptions } from './generators/d3/index.js'
export { EditorStore } from './generators/d3/editorStore.js'
export type { EditorState, EditorStoreApi } from './generators/d3/editorStore.js'
export { D3EditorPanel } from './generators/d3/D3EditorPanel.js'
export type { D3EditorPanelProps, D3EditorPanelHandle } from './generators/d3/D3EditorPanel.js'
export { IRInspector } from './generators/d3/IRInspector.js'
export type { IRInspectorProps } from './generators/d3/IRInspector.js'
