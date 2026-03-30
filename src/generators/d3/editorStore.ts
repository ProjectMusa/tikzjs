/**
 * EditorStore — persistent state for the D3 editor that survives re-renders.
 *
 * Holds the undo/redo history, current diagram, zoom transform, and selection.
 * Lives outside the render cycle so full SVG re-renders don't wipe state.
 */

import { zoomIdentity, type ZoomTransform } from 'd3-zoom'
import type { IRDiagram } from '../../ir/types.js'

const MAX_UNDO = 50
const UNDO_DEBOUNCE_MS = 300

export class EditorStore {
  private undoStack: string[] = []
  private redoStack: string[] = []
  private lastMutationTime = 0

  diagram: IRDiagram
  zoomTransform: ZoomTransform = zoomIdentity
  viewBox: string | null = null
  highlightedId: string | null = null
  gridVisible: boolean

  constructor(diagram: IRDiagram, showGrid = true) {
    this.diagram = diagram
    this.gridVisible = showGrid
  }

  /** Snapshot current diagram to undo stack before a mutation. */
  snapshot(force = false): void {
    const now = Date.now()
    if (force || now - this.lastMutationTime > UNDO_DEBOUNCE_MS) {
      this.undoStack.push(JSON.stringify(this.diagram))
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift()
      this.redoStack.length = 0
    }
    this.lastMutationTime = now
  }

  /** Apply a mutation: snapshot, update diagram. */
  applyMutation(updatedDiagram: IRDiagram, forceSnapshot = false): void {
    this.snapshot(forceSnapshot)
    this.diagram = updatedDiagram
  }

  /** Undo the last mutation. Returns the restored diagram, or null if nothing to undo. */
  undo(): IRDiagram | null {
    if (this.undoStack.length === 0) return null
    this.redoStack.push(JSON.stringify(this.diagram))
    this.diagram = JSON.parse(this.undoStack.pop()!)
    this.highlightedId = null
    return this.diagram
  }

  /** Redo the last undone mutation. Returns the restored diagram, or null if nothing to redo. */
  redo(): IRDiagram | null {
    if (this.redoStack.length === 0) return null
    this.undoStack.push(JSON.stringify(this.diagram))
    this.diagram = JSON.parse(this.redoStack.pop()!)
    this.highlightedId = null
    return this.diagram
  }

  /** Replace the diagram entirely (external change). Clears undo/redo. */
  setDiagram(diagram: IRDiagram): void {
    this.diagram = diagram
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.viewBox = null
    this.zoomTransform = zoomIdentity
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }
}
