import { useState, useEffect, useRef, useCallback } from 'react'
import { theme } from '../theme'
import { Editor } from '../components/Editor'
import { Preview } from '../components/Preview'
import { D3EditorPanel, IRInspector } from 'tikzjs'
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

  const [showGrid, setShowGrid] = useState(true)
  const [showInspector, setShowInspector] = useState(false)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)

  const editorSvgOptions = {
    document: window.document.implementation.createHTMLDocument(''),
    mathRenderer: browserMathRenderer,
    mathModeRenderer: browserMathModeRenderer,
    scriptMathModeRenderer: browserScriptMathModeRenderer,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '6px 12px',
          background: theme.panel,
          borderBottom: `1px solid ${theme.border}`,
          flexShrink: 0,
        }}
      >
        <ExamplePicker onSelect={handleExample} />
        <button
          style={{
            background: 'transparent',
            color: theme.text,
            border: `1px solid ${theme.border}`,
            borderRadius: 4,
            padding: '3px 10px',
            fontSize: 12,
            cursor: 'pointer',
          }}
          onClick={() => setMode(mode === 'editor' ? 'preview' : 'editor')}
        >
          Editor
        </button>
        <span style={{ color: theme.muted, fontSize: 12 }}>
          Edit TikZ code on the left, see SVG on the right
        </span>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'hidden', borderRight: `1px solid ${theme.border}` }}>
          <Editor value={source} onChange={handleChange} />
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Preview svg={svg} error={error} />
        </div>
      </div>

      {/* Full-screen editor overlay */}
      {mode === 'editor' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            background: theme.bg,
          }}
        >
          {/* Main editor area */}
          <div style={{ flex: 1, position: 'relative' }}>
            <D3EditorPanel
              diagram={diagram}
              onDiagramChange={handleDiagramChange}
              svgOptions={editorSvgOptions}
              showGrid={showGrid}
              highlightElementId={selectedElementId}
              onElementSelect={setSelectedElementId}
            />
          </div>

          {/* IR Inspector side panel */}
          {showInspector && (
            <div
              style={{
                width: 320,
                flexShrink: 0,
                borderLeft: `1px solid ${theme.border}`,
                overflow: 'hidden',
              }}
            >
              <IRInspector
                diagram={diagram}
                selectedElementId={selectedElementId}
                onSelectElement={setSelectedElementId}
              />
            </div>
          )}

          {/* Right-side icon toolbar */}
          <div
            style={{
              width: 44,
              flexShrink: 0,
              background: theme.panel,
              borderLeft: `1px solid ${theme.border}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              paddingTop: 8,
              gap: 4,
            }}
          >
            {/* Close editor */}
            <button
              title="Close Editor"
              onClick={() => setMode('preview')}
              style={{
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                color: theme.muted,
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <line x1="2" y1="2" x2="12" y2="12" />
                <line x1="12" y1="2" x2="2" y2="12" />
              </svg>
            </button>
            {/* Separator */}
            <div style={{ width: 24, height: 1, background: theme.border, margin: '4px 0' }} />
            {/* Grid toggle */}
            <button
              title={showGrid ? 'Hide Grid' : 'Show Grid'}
              onClick={() => setShowGrid(!showGrid)}
              style={{
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: showGrid ? theme.activeBtn : 'transparent',
                color: showGrid ? theme.text : theme.muted,
                border: 'none',
                borderRadius: 6,
                fontSize: 16,
                cursor: 'pointer',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <line x1="0" y1="4.7" x2="14" y2="4.7" />
                <line x1="0" y1="9.3" x2="14" y2="9.3" />
                <line x1="4.7" y1="0" x2="4.7" y2="14" />
                <line x1="9.3" y1="0" x2="9.3" y2="14" />
              </svg>
            </button>
            {/* IR Inspector toggle */}
            <button
              title={showInspector ? 'Hide IR Inspector' : 'Show IR Inspector'}
              onClick={() => setShowInspector(!showInspector)}
              style={{
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: showInspector ? theme.activeBtn : 'transparent',
                color: showInspector ? theme.text : theme.muted,
                border: 'none',
                borderRadius: 6,
                fontSize: 16,
                cursor: 'pointer',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="1" y="1" width="12" height="12" rx="1.5" />
                <line x1="9" y1="1" x2="9" y2="13" />
                <line x1="9.5" y1="4" x2="12" y2="4" />
                <line x1="9.5" y1="6.5" x2="12" y2="6.5" />
                <line x1="9.5" y1="9" x2="12" y2="9" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
