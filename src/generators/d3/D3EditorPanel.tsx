import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import type { IRDiagram } from '../../ir/types.js'
import type { SVGGeneratorOptions } from '../svg/index.js'
import type { D3EditorController } from './index.js'
import { createD3Editor } from './index.js'

export interface D3EditorPanelProps {
  diagram: IRDiagram | null
  onDiagramChange: (diagram: IRDiagram) => void
  svgOptions?: SVGGeneratorOptions
  showGrid?: boolean
  highlightElementId?: string | null
  /** Called when user clicks an element on the canvas. */
  onElementSelect?: (elementId: string | null) => void
}

export interface D3EditorPanelHandle {
  controller: D3EditorController | null
}

export const D3EditorPanel = forwardRef<D3EditorPanelHandle, D3EditorPanelProps>(
  function D3EditorPanel({ diagram, onDiagramChange, svgOptions, showGrid, highlightElementId, onElementSelect }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const controllerRef = useRef<D3EditorController | null>(null)
    // Keep stable refs to callbacks so we don't recreate the controller
    const onDiagramChangeRef = useRef(onDiagramChange)
    onDiagramChangeRef.current = onDiagramChange
    const onElementSelectRef = useRef(onElementSelect)
    onElementSelectRef.current = onElementSelect
    const svgOptionsRef = useRef(svgOptions)
    svgOptionsRef.current = svgOptions

    useImperativeHandle(ref, () => ({
      get controller() {
        return controllerRef.current
      },
    }))

    // Create or recreate editor when diagram becomes available
    useEffect(() => {
      if (!containerRef.current || !diagram) return

      // Destroy previous controller if any
      controllerRef.current?.destroy()

      controllerRef.current = createD3Editor(containerRef.current, diagram, {
        onIRChange: (d) => onDiagramChangeRef.current(d),
        onElementSelect: (id) => onElementSelectRef.current?.(id),
        svgOptions: svgOptionsRef.current,
        showGrid: showGrid !== false,
      })

      // Re-apply highlight if there was one
      if (highlightElementId) {
        controllerRef.current.highlightElement(highlightElementId)
      }

      return () => {
        controllerRef.current?.destroy()
        controllerRef.current = null
      }
    }, [diagram]) // eslint-disable-line react-hooks/exhaustive-deps

    // Toggle grid visibility
    useEffect(() => {
      if (controllerRef.current) {
        controllerRef.current.setShowGrid(showGrid !== false)
      }
    }, [showGrid])

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
