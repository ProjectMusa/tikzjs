/**
 * D3 Element Handler types — per-IR-kind handler architecture.
 *
 * Each IR element kind gets a handler that centralizes:
 * - Click zone creation (for interaction targeting)
 * - Highlight/selection overlays (visual feedback)
 * - Drag preview (visual feedback during editing)
 * - Draggability checks
 * - Available mutations
 * - Keyboard actions
 * - Inspector panel: list summary, tree children, editor fields
 */

import type { IRDiagram, IRElement } from '../../../ir/types.js'
import type { NodeGeometryRegistry } from '../../core/coordResolver.js'

// ── Rendering ────────────────────────────────────────────────────────────────

export interface HighlightContext {
  nodeRegistry: NodeGeometryRegistry
  diagram: IRDiagram
}

export interface HighlightResult {
  /** Overlay elements (selection borders, path overlays). */
  overlays: SVGElement[]
  /** Draggable control point handles (for paths/edges). */
  handles?: SVGElement[]
}

export interface DragDelta {
  /** Delta in TikZ pt. */
  dxPt: number
  dyPt: number
  /** Delta in SVG px. */
  dxPx: number
  dyPx: number
  /** Starting position in TikZ pt. */
  startPtX: number
  startPtY: number
}

// ── Interactions ─────────────────────────────────────────────────────────────

export interface MutationDef<T extends IRElement = IRElement> {
  /** Unique mutation id: 'move', 'delete', 'edit-label', etc. */
  id: string
  /** Apply the mutation. Returns true if the diagram was modified. */
  apply(el: T, diagram: IRDiagram, params: any): boolean
}

export interface KeyAction<T extends IRElement = IRElement> {
  /** Key name (e.g., 'Delete', 'F2', 'ArrowUp'). */
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  /** Mutation id to invoke, or 'select-none' / 'open-editor' for special actions. */
  action: string
  /** Static params or a function that computes params from the element. */
  params?: any | ((el: T) => any)
}

// ── Inspector Panel ──────────────────────────────────────────────────────────

export interface ListSummary {
  /** Short icon string (e.g., unicode or SVG path). */
  icon: string
  /** Primary label text. */
  label: string
  /** Secondary label (e.g., coordinate, segment count). */
  sublabel?: string
}

export interface TreeChild {
  id: string
  label: string
  icon?: string
  children?: TreeChild[]
}

export interface EditorField {
  /** IR field path (e.g., 'style.textColor', 'position.coord.x'). */
  key: string
  /** Display label. */
  label: string
  type: 'text' | 'number' | 'color' | 'select' | 'coordinate' | 'boolean'
  /** Options for 'select' type. */
  options?: { value: string; label: string }[]
  readOnly?: boolean
}

// ── Handler Interface ────────────────────────────────────────────────────────

export interface D3ElementHandler<T extends IRElement = IRElement> {
  /** Which IR kind this handler covers. */
  kind: T['kind']

  // ── Rendering ──────────────────────────────────────

  /** Create the click zone for this element. Returns null to skip. */
  createClickZone(el: T, svgGroup: SVGElement, doc: Document): SVGElement | null

  /** Create selection overlay (highlight, control handles). */
  createHighlight(
    el: T,
    svgGroup: SVGElement,
    svg: SVGSVGElement,
    ctx: HighlightContext,
  ): HighlightResult | null

  /** Visual feedback during drag. */
  createDragPreview(el: T, svgGroup: SVGElement, delta: DragDelta): void

  // ── Interactions ───────────────────────────────────

  /** Whether this element is draggable. */
  isDraggable(el: T): boolean

  /** Available mutations for this element kind. */
  mutations: MutationDef<T>[]

  /** Keyboard actions when this element is selected. */
  keyActions?: KeyAction<T>[]

  // ── Inspector Panel ────────────────────────────────

  /** One-line summary for the element list. */
  listSummary(el: T): ListSummary

  /** Tree view: expandable child items. */
  treeChildren?(el: T): TreeChild[]

  /** Editor form fields for the inspector detail panel. */
  editorFields(el: T): EditorField[]
}
