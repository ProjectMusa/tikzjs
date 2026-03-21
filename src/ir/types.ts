// ── Source locations ─────────────────────────────────────────────────────────

export interface SourcePos {
  offset: number
  line: number
  col: number
}

export interface SourceSpan {
  start: SourcePos
  end: SourcePos
}

// ── Coordinate Systems ────────────────────────────────────────────────────────

/**
 * XY coordinate in TeX points (pt).
 * All dimensional values in the IR are stored in pt to avoid unit-conversion
 * constants leaking into the IR layer.
 */
export interface XYCoord {
  cs: 'xy'
  x: number // pt
  y: number // pt
}

/** Polar coordinate — angle in degrees, radius in pt. */
export interface PolarCoord {
  cs: 'polar'
  angle: number // degrees
  radius: number // pt
}

/** Reference to an anchor on a named node, e.g. (myNode.east). */
export interface NodeAnchorCoord {
  cs: 'node-anchor'
  nodeName: string
  anchor: string // 'center' | 'north' | 'south' | 'east' | 'west' | 'north east' | ...
}

/** calc library expression, e.g. ($(A)!0.5!(B)$). */
export interface CalcCoord {
  cs: 'calc'
  expr: CalcExpr
}

/**
 * TikZ `positioning` library: `below=of NODE`, `above=of NODE`, etc.
 * Places the new node's anchor (opposite of direction) at NODE's border + distancePt gap.
 * distancePt=undefined means use the diagram's `node distance` setting.
 */
export interface NodePlacementCoord {
  cs: 'node-placement'
  refName: string
  direction: 'above' | 'below' | 'left' | 'right' | 'above left' | 'above right' | 'below left' | 'below right'
  distancePt?: number
}

export type Coord = XYCoord | PolarCoord | NodeAnchorCoord | CalcCoord | NodePlacementCoord

/**
 * How the coordinate is applied relative to the current point.
 * - 'absolute'       — coordinate is in global canvas space
 * - 'relative'       — coordinate is offset from current point, and current
 *                      point is updated afterwards (++ prefix)
 * - 'relative-pass'  — coordinate is offset from current point, but current
 *                      point is NOT updated (+ prefix)
 */
export type CoordMode = 'absolute' | 'relative' | 'relative-pass'

/** A coordinate reference as it appears in TikZ source. */
export interface CoordRef {
  mode: CoordMode
  coord: Coord
  span?: SourceSpan
}

// ── Calc Expressions ──────────────────────────────────────────────────────────

export type CalcExpr =
  | { kind: 'coord'; ref: CoordRef }
  | { kind: 'add'; a: CalcExpr; b: CalcExpr }
  | { kind: 'sub'; a: CalcExpr; b: CalcExpr }
  | { kind: 'scale'; factor: number; expr: CalcExpr }
  | { kind: 'midpoint'; t: number; a: CalcExpr; b: CalcExpr }
  | { kind: 'perpendicular'; a: CalcExpr; b: CalcExpr; through: CalcExpr }

// ── Options ───────────────────────────────────────────────────────────────────

/** A single key=value pair from a TikZ option list, preserved for round-trip. */
export interface RawOption {
  key: string
  value?: string | RawOption[] // composite values like decoration={...}
  span?: SourceSpan
}

/** Arrow tip specification (arrows.meta syntax). */
export interface ArrowTipSpec {
  kind: string // 'Stealth' | 'Latex' | 'To' | 'Hook' | '>' | 'none' | ...
  reversed?: boolean
  options?: Record<string, string>
  count?: number // stacked tip count (2 = double arrowhead)
}

/**
 * Resolved style — all values inherited from the scope chain flattened.
 * Populated by styleResolver.ts; raw source preserved in rawOptions.
 */
export interface ResolvedStyle {
  // Current color (from `color=X` option) — inherited by child scopes.
  // When `draw` or `fill` resolves to 'currentColor', this value is used instead of black.
  color?: string

  // Stroke
  draw?: string // CSS color string or 'none'
  drawWidth?: number // pt
  drawDash?: 'solid' | 'dashed' | 'dotted' | 'densely dashed' | 'loosely dashed' | string
  lineCap?: 'butt' | 'round' | 'rect'
  lineJoin?: 'miter' | 'round' | 'bevel'

  // Fill
  fill?: string // CSS color string or 'none'

  // Arrow tips
  arrowStart?: ArrowTipSpec
  arrowEnd?: ArrowTipSpec

  // Node geometry
  shape?: string // 'rectangle' | 'circle' | 'ellipse' | 'coordinate' | ...
  innerSep?: number // pt
  outerSep?: number // pt
  minimumWidth?: number // pt
  minimumHeight?: number // pt
  minimumSize?: number // pt (sets both width and height)
  nodeDistance?: number // pt — TikZ `node distance`, for `below=of NODE` positioning

  // Text
  textColor?: string
  align?: 'left' | 'center' | 'right'
  fontSize?: number // pt

  // Node labels (label=pos:text option)
  nodeLabels?: Array<{ position: string; text: string }>

  // Transform
  rotate?: number // degrees
  xshift?: number // pt
  yshift?: number // pt
  xslant?: number // dimensionless shear factor
  yslant?: number // dimensionless shear factor
  scale?: number
  xscale?: number
  yscale?: number

  // Path geometry
  opacity?: number // 0..1
  fillOpacity?: number
  drawOpacity?: number
  roundedCorners?: number // pt, or 0 for sharp
  double?: boolean // TikZ `double` — draw a second concentric border ring
  doubleDistance?: number // pt — gap between the two borders (default 0.6pt)

  // Edge routing
  bend?: number // degrees, positive = bend left, negative = bend right
  bendDirection?: 'left' | 'right'
  looseness?: number
  inAngle?: number // degrees
  outAngle?: number // degrees
  loop?: boolean
  loopDirection?: 'left' | 'right' | 'above' | 'below' | number

  // Label placement
  labelPos?: number | 'midway' | 'near start' | 'near end' | 'at start' | 'at end'
  sloped?: boolean
  swap?: boolean // flip label to other side

  // Raw pass-through for unknown or unrecognized options
  extra?: Record<string, string>
}

// ── Path Segments ─────────────────────────────────────────────────────────────

export interface MoveSegment {
  kind: 'move'
  to: CoordRef
}

export interface LineSegment {
  kind: 'line'
  to: CoordRef
}

/**
 * Orthogonal line segment ('-|' or '|-').
 * hvFirst=true  means horizontal then vertical ('-|')
 * hvFirst=false means vertical then horizontal ('|-')
 */
export interface HVLineSegment {
  kind: 'hv-line'
  to: CoordRef
  hvFirst: boolean
}

export interface CurveSegment {
  kind: 'curve'
  controls: [CoordRef] | [CoordRef, CoordRef]
  to: CoordRef
}

export interface ArcSegment {
  kind: 'arc'
  startAngle: number // degrees
  endAngle: number // degrees
  xRadius: number // pt
  yRadius?: number // pt (if omitted, same as xRadius → circle arc)
}

/**
 * 'to' path operation — uses TikZ's to-path mechanism.
 * The routing is specified via rawOptions (bend left, in=, out=, etc.).
 */
export interface ToSegment {
  kind: 'to'
  to: CoordRef
  rawOptions: RawOption[]
}

/** Inline node placed on a path. */
export interface NodeOnPathSegment {
  kind: 'node-on-path'
  nodeId: string // references IRNode.id in IRPath.inlineNodes
  pos?: number // 0..1 position along the preceding segment
}

export interface ClosePathSegment {
  kind: 'close'
}

export interface CircleSegment {
  kind: 'circle'
  radius: number // pt
}

export interface EllipseSegment {
  kind: 'ellipse'
  xRadius: number // pt
  yRadius: number // pt
}

export interface ParabolaSegment {
  kind: 'parabola'
  to: CoordRef
  bend?: CoordRef // explicit bend point
  bendAtEnd: boolean
}

export interface SinSegment {
  kind: 'sin'
  to: CoordRef
}

export interface CosSegment {
  kind: 'cos'
  to: CoordRef
}

export type PathSegment =
  | MoveSegment
  | LineSegment
  | HVLineSegment
  | CurveSegment
  | ArcSegment
  | ToSegment
  | NodeOnPathSegment
  | ClosePathSegment
  | CircleSegment
  | EllipseSegment
  | ParabolaSegment
  | SinSegment
  | CosSegment

// ── IR Elements ───────────────────────────────────────────────────────────────

/**
 * A standalone node: \node[opts] (name) at (coord) {label};
 * Also produced by tikzcd cell parsing.
 */
export interface IRNode {
  kind: 'node'
  id: string // unique generated id
  name?: string // the (alias) if given
  label: string // raw LaTeX for the label content
  position: CoordRef
  /**
   * Which anchor of the node sits at 'position'.
   * Default is 'center'. When 'above' option is set, anchor='south', etc.
   */
  anchor: string
  style: ResolvedStyle
  rawOptions: RawOption[]
  span?: SourceSpan
}

/**
 * Named coordinate: \coordinate (name) at (coord);
 * Has no geometry of its own — purely a named point.
 */
export interface IRNamedCoordinate {
  kind: 'coordinate'
  id: string
  name?: string
  position: CoordRef
  span?: SourceSpan
}

/**
 * A TikZ path: \draw[opts] <segments>;
 * Inline nodes declared with the 'node' path operation are stored in inlineNodes
 * and referenced from segments via NodeOnPathSegment.nodeId.
 */
export interface IRPath {
  kind: 'path'
  id: string
  segments: PathSegment[]
  style: ResolvedStyle
  rawOptions: RawOption[]
  inlineNodes: IRNode[]
  span?: SourceSpan
}

/**
 * A scope environment: \begin{scope}[opts] ... \end{scope}
 * Children inherit the scope's style.
 */
export interface IRScope {
  kind: 'scope'
  id: string
  style: ResolvedStyle
  rawOptions: RawOption[]
  children: IRElement[]
  span?: SourceSpan
}

/**
 * A matrix of nodes (tikzcd or \matrix library).
 * rows[r][c] = IRNode at row r, column c (0-indexed). null = empty cell.
 */
export interface IRMatrix {
  kind: 'matrix'
  id: string
  name?: string
  position: CoordRef
  style: ResolvedStyle
  rawOptions: RawOption[]
  rows: (IRNode | null)[][]
  columnSep?: number // pt
  rowSep?: number // pt
  span?: SourceSpan
}

// ── Edges ─────────────────────────────────────────────────────────────────────

export type EdgeRouting =
  | { kind: 'straight' }
  | { kind: 'bend'; direction: 'left' | 'right'; angle: number }
  | { kind: 'in-out'; inAngle: number; outAngle: number }
  | { kind: 'loop'; direction: 'left' | 'right' | 'above' | 'below' | number }

export interface EdgeLabel {
  text: string // raw LaTeX
  position: number | 'midway' | 'near start' | 'near end' | 'at start' | 'at end'
  swap?: boolean // label on the other side (tikzcd ' modifier)
  placement?: 'above' | 'below' | 'left' | 'right' // absolute TikZ path node positioning
  description?: boolean // tikzcd `description` style: label at midpoint with white background
  style?: ResolvedStyle
}

/**
 * A semantic edge between two named nodes.
 * Separate from IRPath because edges are topology (from→to) while
 * paths are geometry (sequence of segments). This separation enables
 * graph manipulation: move a node → update all IREdge.from/to refs →
 * regenerate SVG paths from the generator.
 */
export interface IREdge {
  kind: 'edge'
  id: string
  from: string // node id (references IRDiagram.nodeRegistry)
  fromAnchor?: string
  to: string // node id
  toAnchor?: string
  routing: EdgeRouting
  labels: EdgeLabel[]
  style: ResolvedStyle
  rawOptions: RawOption[]
  span?: SourceSpan
}

/**
 * A tikzcd arrow: \ar[direction, opts]{label}
 * Extends IREdge with grid-space direction information.
 */
export interface IRTikzcdArrow extends IREdge {
  tikzcdKind: true
  // Direction in grid space: positive rowDelta = downward, positive colDelta = rightward
  rowDelta: number
  colDelta: number
}

// ── Knot diagram ──────────────────────────────────────────────────────────────

/** One cubic bezier segment stored in the IR (coordinates in TeX points). */
export interface IRKnotBezier {
  x0: number; y0: number    // start
  cx1: number; cy1: number  // control point 1
  cx2: number; cy2: number  // control point 2
  x3: number; y3: number    // end
}

export interface IRKnotStrand {
  segments: IRKnotBezier[]
  drawWidth: number  // pt
}

/**
 * A \begin{knot}...\end{knot} environment from the `knots` TikZ library.
 * Rendered with over/under crossing effects: first strand over by default,
 * flipCrossings[i] indexes (0-based) the crossings where later strand goes over.
 */
export interface IRKnot {
  kind: 'knot'
  id: string
  strands: IRKnotStrand[]
  clipWidth: number       // multiplier for the white-gap stroke (default 5)
  flipCrossings: number[] // 0-based crossing indices where over/under is flipped
  style: ResolvedStyle
}

export type IRElement =
  | IRNode
  | IRNamedCoordinate
  | IRPath
  | IRScope
  | IRMatrix
  | IREdge
  | IRTikzcdArrow
  | IRKnot

// ── Style Registry ────────────────────────────────────────────────────────────

/** A named style definition from \tikzset or \tikzstyle. */
export interface StyleDefinition {
  name: string
  rawOptions: RawOption[]
  /** For '.append style' — base style to extend rather than replace. */
  base?: string
}

// ── Root Diagram ──────────────────────────────────────────────────────────────

/**
 * The root IR object for a complete TikZ diagram.
 * Fully JSON-serializable — no class instances, no circular references.
 */
export interface IRDiagram {
  /** Schema version for forward-compatibility. */
  version: 1
  kind: 'tikzpicture' | 'tikz-inline'
  /** Options on the environment itself, e.g. \begin{tikzpicture}[scale=2]. */
  globalStyle: ResolvedStyle
  globalRawOptions: RawOption[]
  /**
   * Style registry from \tikzset / \tikzstyle declarations.
   * Keyed by style name.
   */
  styleRegistry: Record<string, StyleDefinition>
  /**
   * Node name → node id mapping for O(1) edge resolution.
   * Populated during parsing for all IRNode.name values.
   */
  nodeRegistry: Record<string, string>
  /** All diagram elements in document order. */
  elements: IRElement[]
}
