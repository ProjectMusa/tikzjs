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
}

export interface D3EditorPanelHandle {
  controller: D3EditorController | null
}

export const D3EditorPanel = forwardRef<D3EditorPanelHandle, D3EditorPanelProps>(
  function D3EditorPanel({ diagram, onDiagramChange, svgOptions, showGrid }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const controllerRef = useRef<D3EditorController | null>(null)

    useImperativeHandle(ref, () => ({
      get controller() {
        return controllerRef.current
      },
    }))

    // Create editor on mount
    useEffect(() => {
      if (!containerRef.current || !diagram) return

      controllerRef.current = createD3Editor(containerRef.current, diagram, {
        onIRChange: onDiagramChange,
        svgOptions,
        showGrid: showGrid !== false,
      })

      return () => {
        controllerRef.current?.destroy()
        controllerRef.current = null
      }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Update diagram when it changes externally
    useEffect(() => {
      if (diagram && controllerRef.current) {
        controllerRef.current.setDiagram(diagram)
      }
    }, [diagram])

    // Toggle grid visibility
    useEffect(() => {
      if (controllerRef.current) {
        controllerRef.current.setShowGrid(showGrid !== false)
      }
    }, [showGrid])

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
