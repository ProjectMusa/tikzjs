import { useRef, useEffect } from 'react'
import type { IRDiagram, SVGGeneratorOptions, D3EditorController } from 'tikzjs'
import { createD3Editor } from 'tikzjs'

interface D3EditorProps {
  diagram: IRDiagram | null
  onDiagramChange: (diagram: IRDiagram) => void
  svgOptions?: SVGGeneratorOptions
}

export function D3EditorPanel({ diagram, onDiagramChange, svgOptions }: D3EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<D3EditorController | null>(null)

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current || !diagram) return

    controllerRef.current = createD3Editor(containerRef.current, diagram, {
      onIRChange: onDiagramChange,
      svgOptions,
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

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1e1e2e',
        overflow: 'auto',
      }}
    />
  )
}
