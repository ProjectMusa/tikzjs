import { useState, useEffect, useRef, useCallback } from 'react'
import { Editor } from '../components/Editor'
import { Preview } from '../components/Preview'
import { D3EditorPanel } from '../components/D3Editor'
import { ExamplePicker } from '../components/ExamplePicker'
import { examples } from '../lib/examples'
import type { IRDiagram } from 'tikzjs'
import { browserMathRenderer, browserMathModeRenderer, browserScriptMathModeRenderer } from '../lib/browserMath'

const STORAGE_KEY = 'tikzjs-demo-source'
const DEBOUNCE_MS = 400

type ViewMode = 'preview' | 'editor'

function getInitialSource(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return saved
  } catch {}
  return examples[0].source
}

export function Playground() {
  const [source, setSource] = useState(getInitialSource)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<ViewMode>('preview')
  const [diagram, setDiagram] = useState<IRDiagram | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const renderRef = useRef<typeof import('../lib/tikzBrowser') | null>(null)
  const tikzGenRef = useRef<typeof import('../lib/tikzGenBrowser') | null>(null)

  // Lazy-load the tikz renderer and generator
  useEffect(() => {
    Promise.all([
      import('../lib/tikzBrowser'),
      import('../lib/tikzGenBrowser'),
    ]).then(([renderMod, genMod]) => {
      renderRef.current = renderMod
      tikzGenRef.current = genMod
      doRender(source, renderMod)
    })
  }, [])

  const doRender = useCallback((src: string, mod?: typeof import('../lib/tikzBrowser') | null) => {
    const renderer = mod ?? renderRef.current
    if (!renderer) return
    try {
      const result = renderer.renderTikz(src)
      setSvg(result)
      setError(null)
      // Also parse for D3 editor
      const ir = renderer.parseTikz(src)
      setDiagram(ir)
    } catch (e: any) {
      setSvg('')
      setError(e.message || String(e))
      setDiagram(null)
    }
  }, [])

  const handleChange = useCallback(
    (value: string) => {
      setSource(value)
      try {
        localStorage.setItem(STORAGE_KEY, value)
      } catch {}
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => doRender(value), DEBOUNCE_MS)
    },
    [doRender],
  )

  const handleExample = useCallback(
    (src: string) => {
      setSource(src)
      try {
        localStorage.setItem(STORAGE_KEY, src)
      } catch {}
      doRender(src)
    },
    [doRender],
  )

  // Called when D3 editor mutates the IR (e.g., node drag)
  const handleDiagramChange = useCallback(
    (updatedDiagram: IRDiagram) => {
      setDiagram(updatedDiagram)
      // Generate TikZ source from the mutated IR
      if (tikzGenRef.current) {
        try {
          const newSource = tikzGenRef.current.generateTikZSource(updatedDiagram)
          setSource(newSource)
          try {
            localStorage.setItem(STORAGE_KEY, newSource)
          } catch {}
          // Also update SVG preview
          const renderer = renderRef.current
          if (renderer) {
            const result = renderer.renderTikzFromIR(updatedDiagram)
            setSvg(result)
            setError(null)
          }
        } catch (e: any) {
          setError(e.message || String(e))
        }
      }
    },
    [],
  )

  const buttonStyle = (active: boolean) => ({
    background: active ? '#45475a' : 'transparent',
    color: active ? '#cdd6f4' : '#6c7086',
    border: '1px solid #45475a',
    borderRadius: 4,
    padding: '3px 10px',
    fontSize: 12,
    cursor: 'pointer' as const,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '6px 12px',
          background: '#181825',
          borderBottom: '1px solid #333',
          flexShrink: 0,
        }}
      >
        <ExamplePicker onSelect={handleExample} />
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={buttonStyle(mode === 'preview')} onClick={() => setMode('preview')}>
            Preview
          </button>
          <button style={buttonStyle(mode === 'editor')} onClick={() => setMode('editor')}>
            Editor
          </button>
        </div>
        <span style={{ color: '#6c7086', fontSize: 12 }}>
          {mode === 'preview'
            ? 'Edit TikZ code on the left, see SVG on the right'
            : 'Drag nodes to reposition them — changes update the source'}
        </span>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'hidden', borderRight: '1px solid #333' }}>
          <Editor value={source} onChange={handleChange} />
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {mode === 'preview' ? (
            <Preview svg={svg} error={error} />
          ) : (
            <D3EditorPanel
              diagram={diagram}
              onDiagramChange={handleDiagramChange}
              svgOptions={{
                document: window.document.implementation.createHTMLDocument(''),
                mathRenderer: browserMathRenderer,
                mathModeRenderer: browserMathModeRenderer,
                scriptMathModeRenderer: browserScriptMathModeRenderer,
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
