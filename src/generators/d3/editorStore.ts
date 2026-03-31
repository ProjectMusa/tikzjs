/**
 * EditorStore — persistent state for the D3 editor that survives re-renders.
 *
 * Uses zustand/vanilla for framework-agnostic state management and zundo
 * (temporal middleware) for automatic undo/redo tracking.
 *
 * IR state (diagram) is tracked by undo/redo.
 * UI state (zoom, viewBox, highlight, grid) is NOT tracked — it persists
 * across re-renders but is not part of the undo history.
 */

import { createStore, type StoreApi } from 'zustand/vanilla'
import { temporal, type TemporalState } from 'zundo'
import { zoomIdentity, type ZoomTransform } from 'd3-zoom'
import type { IRDiagram } from '../../ir/types.js'

// ── IR state (undo/redo tracked) ─────────────────────────────────────────────

interface IRState {
  diagram: IRDiagram
}

// ── UI state (not tracked by undo/redo) ──────────────────────────────────────

interface UIState {
  zoomTransform: ZoomTransform
  viewBox: string | null
  highlightedId: string | null
  gridVisible: boolean
}

// ── Combined store state ─────────────────────────────────────────────────────

export interface EditorState extends IRState, UIState {}

export type EditorStoreApi = StoreApi<EditorState> & {
  temporal: StoreApi<TemporalState<IRState>>
}

const MAX_UNDO = 50

// ── Factory ──────────────────────────────────────────────────────────────────

export function createEditorStore(diagram: IRDiagram, showGrid = true): EditorStoreApi {
  return createStore<EditorState>()(
    temporal(
      (set) => ({
        // IR state
        diagram,
        // UI state
        zoomTransform: zoomIdentity,
        viewBox: null,
        highlightedId: null,
        gridVisible: showGrid,
      }),
      {
        // Only track the diagram for undo/redo, not UI state
        partialize: (state): IRState => ({ diagram: state.diagram }),
        limit: MAX_UNDO,
        // Use value equality on the serialized diagram so identical
        // states don't create duplicate undo entries
        equality: (a, b) => JSON.stringify(a.diagram) === JSON.stringify(b.diagram),
      },
    ),
  ) as EditorStoreApi
}

// ── Convenience wrapper ──────────────────────────────────────────────────────
// Wraps the zustand store API in a class-like interface so existing call sites
// in index.ts / D3EditorPanel.tsx need minimal changes.

export class EditorStore {
  readonly api: EditorStoreApi

  constructor(diagram: IRDiagram, showGrid = true) {
    this.api = createEditorStore(diagram, showGrid)
  }

  get diagram(): IRDiagram {
    return this.api.getState().diagram
  }

  set diagram(d: IRDiagram) {
    this.api.setState({ diagram: d })
  }

  get zoomTransform(): ZoomTransform {
    return this.api.getState().zoomTransform
  }

  set zoomTransform(t: ZoomTransform) {
    this.api.setState({ zoomTransform: t })
  }

  get viewBox(): string | null {
    return this.api.getState().viewBox
  }

  set viewBox(v: string | null) {
    this.api.setState({ viewBox: v })
  }

  get highlightedId(): string | null {
    return this.api.getState().highlightedId
  }

  set highlightedId(id: string | null) {
    this.api.setState({ highlightedId: id })
  }

  get gridVisible(): boolean {
    return this.api.getState().gridVisible
  }

  set gridVisible(v: boolean) {
    this.api.setState({ gridVisible: v })
  }

  /**
   * Apply an IR mutation. Interactions mutate the diagram in-place
   * (same object ref as store.diagram), so by the time this is called
   * the store's current state is already mutated. To give zundo a
   * proper before/after diff we:
   *   1. Pause tracking
   *   2. Restore the pre-mutation snapshot (so store holds the "old" state)
   *   3. Resume tracking
   *   4. Set the new state — zundo now sees old→new correctly
   */
  applyMutation(preMutationSnapshot: string, updatedDiagram: IRDiagram): void {
    const temporal = this.api.temporal.getState()
    temporal.pause()
    this.api.setState({ diagram: JSON.parse(preMutationSnapshot) })
    temporal.resume()
    this.api.setState({ diagram: updatedDiagram })
  }

  /** Undo the last IR mutation. Returns the restored diagram, or null. */
  undo(): IRDiagram | null {
    const { pastStates } = this.api.temporal.getState()
    if (pastStates.length === 0) return null
    this.api.temporal.getState().undo()
    this.api.setState({ highlightedId: null })
    return this.api.getState().diagram
  }

  /** Redo the last undone mutation. Returns the restored diagram, or null. */
  redo(): IRDiagram | null {
    const { futureStates } = this.api.temporal.getState()
    if (futureStates.length === 0) return null
    this.api.temporal.getState().redo()
    this.api.setState({ highlightedId: null })
    return this.api.getState().diagram
  }

  /** Replace the diagram entirely (external change). Clears undo/redo. */
  setDiagram(diagram: IRDiagram): void {
    this.api.temporal.getState().clear()
    this.api.setState({
      diagram,
      viewBox: null,
      zoomTransform: zoomIdentity,
    })
  }

  get canUndo(): boolean {
    return this.api.temporal.getState().pastStates.length > 0
  }

  get canRedo(): boolean {
    return this.api.temporal.getState().futureStates.length > 0
  }
}
