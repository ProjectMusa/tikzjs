/**
 * Factory functions for creating IR elements.
 *
 * These are called from the PEG grammar actions and from the tikzcd preprocessor
 * to construct the IRDiagram elements. Using factory functions instead of direct
 * object literals makes it easy to assign unique IDs and enforce invariants.
 */

import {
  IRDiagram,
  IRNode,
  IRNamedCoordinate,
  IRPath,
  IRScope,
  IRMatrix,
  IREdge,
  IRTikzcdArrow,
  IRKnot,
  IRElement,
  CoordRef,
  PathSegment,
  ResolvedStyle,
  RawOption,
  EdgeRouting,
  EdgeLabel,
  XYCoord,
  SourceSpan,
  StyleDefinition,
  NodePlacementCoord,
} from '../ir/types.js'
import { KnotEnvironment, strandDrawWidth } from '../preprocessor/knotPreprocessor.js'

// ── ID generation ─────────────────────────────────────────────────────────────

let _idCounter = 0

export function resetIdCounter(): void {
  _idCounter = 0
}

export function nextId(prefix = 'el'): string {
  return `${prefix}_${++_idCounter}`
}

// ── Coordinate factories ──────────────────────────────────────────────────────

export function xyCoord(x: number, y: number): XYCoord {
  return { cs: 'xy', x, y }
}

export function coordRef(
  x: number,
  y: number,
  mode: CoordRef['mode'] = 'absolute'
): CoordRef {
  return { mode, coord: xyCoord(x, y) }
}

export function nodeAnchorRef(
  nodeName: string,
  anchor = 'center',
  mode: CoordRef['mode'] = 'absolute'
): CoordRef {
  return { mode, coord: { cs: 'node-anchor', nodeName, anchor } }
}

export function polarRef(
  angle: number,
  radius: number,
  mode: CoordRef['mode'] = 'absolute'
): CoordRef {
  return { mode, coord: { cs: 'polar', angle, radius } }
}

/** Simple dimension string → pt (only handles common units; used for placement distances). */
function parsePlacementDist(s: string): number {
  const m = s.trim().match(/^([\d.]+)\s*(cm|mm|pt|in|em|ex)$/)
  if (!m) return 0
  const v = parseFloat(m[1])
  switch (m[2]) {
    case 'cm':  return v * 28.4528
    case 'mm':  return v * 2.84528
    case 'in':  return v * 72.27
    case 'em':  return v * 10
    case 'ex':  return v * 4.3
    default:    return v
  }
}

/**
 * Scan rawOptions for TikZ `positioning` library options: `below=of NODE`, `above=DIST of NODE`, etc.
 * Returns a CoordRef with NodePlacementCoord if found, otherwise null.
 */
export function extractPlacementRef(rawOptions: RawOption[]): CoordRef | null {
  const DIRS = new Set(['above', 'below', 'left', 'right', 'above left', 'above right', 'below left', 'below right'])
  for (const opt of rawOptions) {
    if (!DIRS.has(opt.key)) continue
    const val = (opt.value as string || '').trim()
    // Match: "of NODENAME" or "DIST of NODENAME"
    const m = /^(?:([\d.]+\s*(?:cm|mm|pt|in|em|ex))\s+)?of\s+(.+)$/i.exec(val)
    if (!m) continue
    const distPt = m[1] ? parsePlacementDist(m[1]) : 0 // 0 = use diagram node distance
    const coord: NodePlacementCoord = {
      cs: 'node-placement',
      refName: m[2].trim(),
      direction: opt.key as NodePlacementCoord['direction'],
      distancePt: distPt,
    }
    return { mode: 'absolute', coord }
  }
  return null
}

// ── Element factories ─────────────────────────────────────────────────────────

export function makeNode(
  position: CoordRef,
  label: string,
  style: ResolvedStyle,
  rawOptions: RawOption[],
  opts: { name?: string; anchor?: string; span?: SourceSpan } = {}
): IRNode {
  return {
    kind: 'node',
    id: nextId('node'),
    name: opts.name,
    label,
    position,
    anchor: opts.anchor ?? 'center',
    style,
    rawOptions,
    span: opts.span,
  }
}

export function makeCoordinate(
  position: CoordRef,
  opts: { name?: string; span?: SourceSpan } = {}
): IRNamedCoordinate {
  return {
    kind: 'coordinate',
    id: nextId('coord'),
    name: opts.name,
    position,
    span: opts.span,
  }
}

export function makePath(
  segments: PathSegment[],
  style: ResolvedStyle,
  rawOptions: RawOption[],
  inlineNodes: IRNode[] = [],
  span?: SourceSpan
): IRPath {
  return {
    kind: 'path',
    id: nextId('path'),
    segments,
    style,
    rawOptions,
    inlineNodes,
    span,
  }
}

export function makeScope(
  children: IRElement[],
  style: ResolvedStyle,
  rawOptions: RawOption[],
  span?: SourceSpan
): IRScope {
  return {
    kind: 'scope',
    id: nextId('scope'),
    style,
    rawOptions,
    children,
    span,
  }
}

export function makeMatrix(
  position: CoordRef,
  rows: (IRNode | null)[][],
  style: ResolvedStyle,
  rawOptions: RawOption[],
  opts: {
    name?: string
    columnSep?: number
    rowSep?: number
    span?: SourceSpan
  } = {}
): IRMatrix {
  return {
    kind: 'matrix',
    id: nextId('matrix'),
    name: opts.name,
    position,
    rows,
    style,
    rawOptions,
    columnSep: opts.columnSep,
    rowSep: opts.rowSep,
    span: opts.span,
  }
}

export function makeEdge(
  from: string,
  to: string,
  routing: EdgeRouting,
  style: ResolvedStyle,
  rawOptions: RawOption[],
  opts: {
    fromAnchor?: string
    toAnchor?: string
    labels?: EdgeLabel[]
    span?: SourceSpan
  } = {}
): IREdge {
  return {
    kind: 'edge',
    id: nextId('edge'),
    from,
    to,
    fromAnchor: opts.fromAnchor,
    toAnchor: opts.toAnchor,
    routing,
    labels: opts.labels ?? [],
    style,
    rawOptions,
    span: opts.span,
  }
}

export function makeTikzcdArrow(
  from: string,
  to: string,
  rowDelta: number,
  colDelta: number,
  style: ResolvedStyle,
  rawOptions: RawOption[],
  opts: {
    fromAnchor?: string
    toAnchor?: string
    labels?: EdgeLabel[]
    routing?: EdgeRouting
    span?: SourceSpan
  } = {}
): IRTikzcdArrow {
  return {
    kind: 'edge',
    tikzcdKind: true,
    id: nextId('arrow'),
    from,
    to,
    fromAnchor: opts.fromAnchor,
    toAnchor: opts.toAnchor,
    routing: opts.routing ?? makeBendRouting(rawOptions),
    labels: opts.labels ?? [],
    style,
    rawOptions,
    rowDelta,
    colDelta,
    span: opts.span,
  }
}

/** Infer edge routing from raw options (bend left/right, in/out). */
function makeBendRouting(rawOptions: RawOption[]): EdgeRouting {
  for (const opt of rawOptions) {
    if (opt.key === 'bend left') {
      return { kind: 'bend', direction: 'left', angle: opt.value ? parseFloat(opt.value as string) : 30 }
    }
    if (opt.key === 'bend right') {
      return { kind: 'bend', direction: 'right', angle: opt.value ? parseFloat(opt.value as string) : 30 }
    }
    if (opt.key === 'loop' || opt.key.startsWith('loop ')) {
      return { kind: 'loop', direction: 'above' }
    }
  }
  return { kind: 'straight' }
}

// ── Knot factory ──────────────────────────────────────────────────────────────

export function makeKnot(id: string, env: KnotEnvironment): IRKnot {
  return {
    kind: 'knot',
    id,
    strands: env.strands.map(s => ({
      segments: s.segments,
      drawWidth: strandDrawWidth(s.optStr),
    })),
    clipWidth: env.clipWidth,
    flipCrossings: env.flipCrossings,
    style: {},
  }
}

// ── Diagram factory ───────────────────────────────────────────────────────────

export function makeDiagram(
  kind: IRDiagram['kind'],
  elements: IRElement[],
  globalStyle: ResolvedStyle,
  globalRawOptions: RawOption[],
  styleRegistry: Record<string, StyleDefinition>,
  nodeRegistry: Record<string, string>
): IRDiagram {
  return {
    version: 1,
    kind,
    globalStyle,
    globalRawOptions,
    styleRegistry,
    nodeRegistry,
    elements,
  }
}

// ── Segment factories ─────────────────────────────────────────────────────────

export function moveSegment(to: CoordRef): PathSegment {
  return { kind: 'move', to }
}

export function lineSegment(to: CoordRef): PathSegment {
  return { kind: 'line', to }
}

export function hvLineSegment(to: CoordRef, hvFirst: boolean): PathSegment {
  return { kind: 'hv-line', to, hvFirst }
}

export function curveSegment(
  controls: [CoordRef] | [CoordRef, CoordRef],
  to: CoordRef
): PathSegment {
  return { kind: 'curve', controls, to }
}

export function toSegment(to: CoordRef, rawOptions: RawOption[]): PathSegment {
  return { kind: 'to', to, rawOptions }
}

export function closeSegment(): PathSegment {
  return { kind: 'close' }
}

export function arcSegment(
  startAngle: number,
  endAngle: number,
  xRadius: number,
  yRadius?: number
): PathSegment {
  return { kind: 'arc', startAngle, endAngle, xRadius, yRadius }
}

export function nodeOnPathSegment(nodeId: string, pos?: number): PathSegment {
  return { kind: 'node-on-path', nodeId, pos }
}

export function circleSegment(radius: number): PathSegment {
  return { kind: 'circle', radius }
}

export function ellipseSegment(xRadius: number, yRadius: number): PathSegment {
  return { kind: 'ellipse', xRadius, yRadius }
}

export function parabolaSegment(to: CoordRef, bendAtEnd: boolean, bend?: CoordRef): PathSegment {
  return { kind: 'parabola', to, bendAtEnd, bend }
}

export function sinSegment(to: CoordRef): PathSegment {
  return { kind: 'sin', to }
}

export function cosSegment(to: CoordRef): PathSegment {
  return { kind: 'cos', to }
}
