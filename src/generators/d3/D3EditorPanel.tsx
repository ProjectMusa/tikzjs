import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import type { IRDiagram } from '../../ir/types.js'
import type { SVGGeneratorOptions } from '../svg/index.js'
import type { D3EditorController } from './index.js'
import { createD3Editor } from './index.js'
import { EditorStore } from './editorStore.js'

export interface D3EditorPanelProps {
  diagram: IRDiagram | null
  onDiagramChange: (diagram: IRDiagram) => void
  svgOptions?: SVGGeneratorOptions
  showGrid?: boolean
  /** Show the keyboard shortcut help overlay. */
  showHelp?: boolean
  highlightElementId?: string | null
  /** Called when user clicks an element on the canvas. */
  onElementSelect?: (elementId: string | null) => void
}

export interface D3EditorPanelHandle {
  controller: D3EditorController | null
}

export const D3EditorPanel = forwardRef<D3EditorPanelHandle, D3EditorPanelProps>(
  function D3EditorPanel({ diagram, onDiagramChange, svgOptions, showGrid, showHelp, highlightElementId, onElementSelect }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const controllerRef = useRef<D3EditorController | null>(null)
    // EditorStore persists across editor destroy/recreate cycles,
    // preserving undo/redo history, zoom transform, and selection.
    const storeRef = useRef<EditorStore | null>(null)
    // Keep stable refs to callbacks so we don't recreate the controller
    const onDiagramChangeRef = useRef(onDiagramChange)
    onDiagramChangeRef.current = onDiagramChange
    const onElementSelectRef = useRef(onElementSelect)
    onElementSelectRef.current = onElementSelect
    const svgOptionsRef = useRef(svgOptions)
    svgOptionsRef.current = svgOptions
    // Track whether the diagram change originated from the editor itself
    // so we can skip setDiagram (which would wipe undo/redo).
    const internalChangeRef = useRef(false)

    useImperativeHandle(ref, () => ({
      get controller() {
        return controllerRef.current
      },
    }))

    // Destroy controller on unmount
    useEffect(() => {
      return () => {
        controllerRef.current?.destroy()
        controllerRef.current = null
      }
    }, [])

    // Create editor when diagram first becomes available, and handle updates.
    useEffect(() => {
      if (!containerRef.current || !diagram) return

      // Skip internal changes — the editor already has the updated diagram
      if (internalChangeRef.current) {
        internalChangeRef.current = false
        return
      }

      if (controllerRef.current) {
        // Editor exists — external change (e.g., text editor). Update via setDiagram.
        controllerRef.current.setDiagram(diagram)
        return
      }

      // First time: create the store and editor
      if (!storeRef.current) {
        storeRef.current = new EditorStore(diagram, showGrid !== false)
      }

      controllerRef.current = createD3Editor(containerRef.current, diagram, {
        store: storeRef.current,
        onIRChange: (d) => {
          internalChangeRef.current = true
          onDiagramChangeRef.current(d)
        },
        onElementSelect: (id) => onElementSelectRef.current?.(id),
        svgOptions: svgOptionsRef.current,
        showGrid: showGrid !== false,
      })

      // Re-apply highlight if there was one
      if (highlightElementId) {
        controllerRef.current.highlightElement(highlightElementId)
      }
    }, [diagram]) // eslint-disable-line react-hooks/exhaustive-deps

    // Toggle grid visibility
    useEffect(() => {
      if (controllerRef.current) {
        controllerRef.current.setShowGrid(showGrid !== false)
      }
    }, [showGrid])

    // Toggle help overlay
    useEffect(() => {
      if (controllerRef.current) {
        controllerRef.current.setShowHelp(!!showHelp)
      }
    }, [showHelp])

    // Highlight element on canvas
    useEffect(() => {
      if (controllerRef.current) {
        controllerRef.current.highlightElement(highlightElementId ?? null)
      }
    }, [highlightElementId])

    return (
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#d0d0d0',
          overflow: 'auto',
        }}
      />
    )
  },
)
