/**
 * Rendering constants for the tikzjs SVG generator.
 *
 * Constants are split into two categories:
 *
 * TIKZ_CONSTANTS — syntax-level, defined by TikZ/TeX specification.
 *   Changing these breaks TikZ rendering fidelity. Never expose as user-overridable.
 *
 * SVGRenderingConstants / DEFAULT_CONSTANTS — generator-level, our rendering decisions.
 *   These are safe to tune; consumers can override via SVGGeneratorOptions.constants.
 */

// ── Syntax-level constants (TikZ/TeX specification) ────────────────────────────

/**
 * Constants whose values are defined by TikZ or TeX semantics.
 * These are ground truth from the PGF manual and tikzlibrary source.
 * Never make these user-overridable.
 */
export const TIKZ_CONSTANTS = Object.freeze({
  /** TeX points per centimeter (exact: 1cm = 28.4527559... pt). */
  PT_PER_CM: 28.4528,

  /** TikZ default inner sep for nodes (pgfmanual §17.5.1). */
  DEFAULT_INNER_SEP_PT: 3.333,

  /** TikZ default line width when `draw` is set without explicit line width. */
  DEFAULT_LINE_WIDTH_PT: 0.4,

  /** tikzcd default column separation: 2cm in pt. */
  DEFAULT_COL_SEP_PT: 56.9,

  /** tikzcd default row separation: 1cm in pt. */
  DEFAULT_ROW_SEP_PT: 28.45,

  /** TikZ default grid step size: 1cm in pt. */
  DEFAULT_GRID_STEP_PT: 28.4528,

  /**
   * TikZ to-path Bézier control arm length factor at looseness=1.
   * Source: tikzlibrarytopaths.code.tex, \pgf@lib@to@d = 0.3915 × dist.
   */
  TO_PATH_LOOSENESS: 0.3915,

  /**
   * Quadratic-to-cubic Bézier elevation factor (mathematical constant: 2/3).
   * Cubic equivalent: C1 = P0 + 2/3*(Q - P0), C2 = P2 + 2/3*(Q - P2).
   */
  QUAD_TO_CUBIC_FACTOR: 2 / 3,

  /**
   * Cubic Bézier control arm factor for TikZ `sin`/`cos` path operations.
   * Source: pgfcorepathconstruct.code.tex — `\pgf@xa=.5523882\pgf@xa`.
   * Approximates a quarter-period sine/cosine wave as a cubic Bézier segment.
   */
  SIN_COS_BEZIER_FACTOR: 0.5523882,
})

// ── Generator-level constants (our rendering decisions) ────────────────────────

/**
 * Generator-level rendering constants. All values here are our choices,
 * not dictated by TikZ semantics. Safe to tune or override per diagram.
 */
export interface SVGRenderingConstants {
  /** Pixels per centimeter. Default: 52 (matches original implementation). */
  CM_TO_PX: number

  /**
   * Pixels per TeX point. Derived: CM_TO_PX / TIKZ_CONSTANTS.PT_PER_CM.
   * Included as a convenience field; keep in sync with CM_TO_PX when overriding.
   */
  PT_TO_PX: number

  /** Padding around the diagram viewBox in pt. */
  DIAGRAM_PADDING_PT: number

  /** Minimum node half-size in px (prevents invisible zero-size nodes). */
  MIN_HALF_SIZE_PX: number

  /** Gap between node border and attached node labels in pt. */
  NODE_LABEL_GAP_PT: number

  /** Gap between edge midpoint and edge label center in px. */
  EDGE_LABEL_GAP_PX: number

  /** Padding around description-style edge label background rect in px. */
  EDGE_LABEL_DESCRIPTION_PAD_PX: number

  /** Factor multiplying edge length for in/out-angle Bézier control arm distance. */
  EDGE_INOUT_DISTANCE_FACTOR: number
}

export const DEFAULT_CONSTANTS: Readonly<SVGRenderingConstants> = Object.freeze({
  CM_TO_PX: 52,
  PT_TO_PX: 52 / 28.4528, // = CM_TO_PX / TIKZ_CONSTANTS.PT_PER_CM

  DIAGRAM_PADDING_PT: 2.4,
  MIN_HALF_SIZE_PX: 1,
  NODE_LABEL_GAP_PT: 3,
  EDGE_LABEL_GAP_PX: 4,
  EDGE_LABEL_DESCRIPTION_PAD_PX: 2,
  EDGE_INOUT_DISTANCE_FACTOR: 0.4,
})
