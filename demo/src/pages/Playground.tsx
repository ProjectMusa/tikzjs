import { useState, useEffect, useRef, useCallback } from 'react'
import { theme } from '../theme'
import { Editor } from '../components/Editor'
import { Preview } from '../components/Preview'
import { D3EditorPanel, IRInspector, moveNode, updateCurveControl, moveSegmentEndpoint, updateNodeLabel, updateEdgeLabel, removeElement, addNode } from 'tikzjs'
import type { D3EditorPanelHandle } from 'tikzjs'
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

export function Playground({ isDark }: { isDark: boolean }) {
  const [source, setSource] = useState(getInitialSource)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<ViewMode>('preview')
  const [diagram, setDiagram] = useState<IRDiagram | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const renderRef = useRef<typeof import('../lib/tikzBrowser') | null>(null)
  const tikzGenRef = useRef<typeof import('../lib/tikzGenBrowser') | null>(null)
  // When set, any CodeMirror onChange whose value matches this string skips
  // the debounced re-parse, because the source change originated from the D3
  // editor (not user typing). Using the actual string instead of a boolean
  // flag avoids races if CodeMirror fires onChange more than once per update.
  const suppressReparseSourceRef = useRef<string | null>(null)

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
      // Skip re-parse if this change came from the D3 editor — it already
      // has the correct IR and re-parsing would wipe the undo stack.
      if (suppressReparseSourceRef.current !== null && value === suppressReparseSourceRef.current) {
        suppressReparseSourceRef.current = null
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
        return
      }
      suppressReparseSourceRef.current = null
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

  // Called when D3 editor mutates the IR (e.g., node drag, undo, redo)
  const handleDiagramChange = useCallback(
    (updatedDiagram: IRDiagram) => {
      // Cancel any pending debounced re-parse from the text editor —
      // the D3 editor is the source of truth now.
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      setDiagram(updatedDiagram)
      // Generate TikZ source from the mutated IR
      if (tikzGenRef.current) {
        try {
          const newSource = tikzGenRef.current.generateTikZSource(updatedDiagram)
          suppressReparseSourceRef.current = newSource
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
      // Sync undo/redo button state
      const store = editorPanelRef.current?.controller?.store
      if (store) {
        setCanUndo(store.canUndo)
        setCanRedo(store.canRedo)
      }
    },
    [],
  )

  const [showGrid, setShowGrid] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [showInspector, setShowInspector] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const syncUndoRedo = useCallback(() => {
    const store = editorPanelRef.current?.controller?.store
    if (store) {
      setCanUndo(store.canUndo)
      setCanRedo(store.canRedo)
    }
  }, [])
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const editorPanelRef = useRef<D3EditorPanelHandle>(null)

  const handleUndo = useCallback(() => {
    editorPanelRef.current?.controller?.undo()
    syncUndoRedo()
  }, [syncUndoRedo])

  const handleRedo = useCallback(() => {
    editorPanelRef.current?.controller?.redo()
    syncUndoRedo()
  }, [syncUndoRedo])

  const editorSvgOptions = {
    document: window.document.implementation.createHTMLDocument(''),
    mathRenderer: browserMathRenderer,
    mathModeRenderer: browserMathModeRenderer,
    scriptMathModeRenderer: browserScriptMathModeRenderer,
  }

  // Expose test hooks for Playwright E2E tests
  useEffect(() => {
    const tikzjs = {
      /** Load a golden fixture by filename, parse it, and enter editor mode. */
      async loadFixture(filename: string) {
        const resp = await fetch(`/tikzjs/fixtures/${filename}`)
        if (!resp.ok) throw new Error(`Failed to fetch fixture: ${filename}`)
        const src = await resp.text()
        const renderer = renderRef.current
        if (!renderer) throw new Error('Renderer not loaded')
        const ir = renderer.parseTikz(src)
        setSource(src)
        setDiagram(ir)
        setMode('editor')
        // Return a promise that resolves after React renders
        return new Promise<void>(resolve => setTimeout(resolve, 200))
      },
      /** Get the current IR from the D3 editor controller. */
      getIR(): IRDiagram | null {
        return editorPanelRef.current?.controller?.getDiagram() ?? diagram
      },
      /** Parse TikZ source to IR (for computing expected state in-browser). */
      parseTikz(source: string): IRDiagram | null {
        const renderer = renderRef.current
        if (!renderer) return null
        return renderer.parseTikz(source)
      },
      /** Apply a programmatic IR mutation (for comparison with UI result). */
      applyMutation(ir: IRDiagram, action: string, args: any): boolean {
        switch (action) {
          case 'moveNode':
            return moveNode(ir, args.nodeId, args.x, args.y)
          case 'updateCurveControl':
            return updateCurveControl(ir, args.pathId, args.segIdx, args.cpRole, args.x, args.y)
          case 'moveSegmentEndpoint':
            return moveSegmentEndpoint(ir, args.pathId, args.segIdx, args.x, args.y)
          case 'updateNodeLabel':
            return updateNodeLabel(ir, args.nodeId, args.label)
          case 'updateEdgeLabel':
            return updateEdgeLabel(ir, args.edgeId, args.labelIndex, args.label)
          case 'removeElement':
            return removeElement(ir, args.elementId)
          case 'addNode':
            return !!addNode(ir, args.x, args.y, args.label)
          default:
            return false
        }
      },
    }
    ;(window as any).__tikzjs = tikzjs
    return () => { delete (window as any).__tikzjs }
  }, [diagram])

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
        <span className="toolbar-hint" style={{ color: theme.muted, fontSize: 12, marginLeft: 12 }}>
          Edit TikZ code on the left, see SVG on the right
        </span>
        <div style={{ flex: 1 }} />
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
      </div>
      <div className="split-panel">
        <div style={{ flex: 1, overflow: 'hidden', borderRight: `1px solid ${theme.border}` }}>
          <Editor value={source} onChange={handleChange} isDark={isDark} />
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Preview svg={svg} error={error} />
        </div>
      </div>

      {/* Full-screen editor overlay */}
      {mode === 'editor' && (
        <div
          className="editor-overlay"
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
              ref={editorPanelRef}
              diagram={diagram}
              onDiagramChange={handleDiagramChange}
              svgOptions={editorSvgOptions}
              showGrid={showGrid}
              showHelp={showHelp}
              highlightElementId={selectedElementId}
              onElementSelect={setSelectedElementId}
            />
          </div>

          {/* IR Inspector side panel */}
          {showInspector && (
            <div
              className="editor-inspector"
              style={{
                borderLeft: `1px solid ${theme.border}`,
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
            className="editor-toolbar"
            style={{
              background: theme.panel,
              borderLeft: `1px solid ${theme.border}`,
            }}
          >
            {/* Close editor — always on top */}
            <button
              className="toolbar-btn"
              title="Close Editor"
              onClick={() => setMode('preview')}
              style={{ color: theme.muted }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <line x1="2" y1="2" x2="12" y2="12" />
                <line x1="12" y1="2" x2="2" y2="12" />
              </svg>
            </button>

            {/* Separator */}
            <div className="toolbar-sep" style={{ borderColor: theme.border }} />

            {/* Grid toggle */}
            <button
              className="toolbar-btn"
              title={showGrid ? 'Hide Grid' : 'Show Grid'}
              onClick={() => setShowGrid(!showGrid)}
              style={{
                background: showGrid ? theme.activeBtn : undefined,
                color: showGrid ? theme.text : theme.muted,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <line x1="0" y1="4.7" x2="14" y2="4.7" />
                <line x1="0" y1="9.3" x2="14" y2="9.3" />
                <line x1="4.7" y1="0" x2="4.7" y2="14" />
                <line x1="9.3" y1="0" x2="9.3" y2="14" />
              </svg>
            </button>
            {/* Help / keyboard shortcuts toggle */}
            <button
              className="toolbar-btn"
              title={showHelp ? 'Hide Shortcuts' : 'Show Shortcuts'}
              onClick={() => setShowHelp(!showHelp)}
              style={{
                background: showHelp ? theme.activeBtn : undefined,
                color: showHelp ? theme.text : theme.muted,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="7" cy="7" r="6" />
                <path d="M5.2 5.4a1.8 1.8 0 0 1 3.4.8c0 1.2-1.6 1.4-1.6 2.4" strokeLinecap="round" />
                <circle cx="7" cy="10.8" r="0.5" fill="currentColor" stroke="none" />
              </svg>
            </button>
            {/* IR Inspector toggle */}
            <button
              className="toolbar-btn"
              title={showInspector ? 'Hide IR Inspector' : 'Show IR Inspector'}
              onClick={() => setShowInspector(!showInspector)}
              style={{
                background: showInspector ? theme.activeBtn : undefined,
                color: showInspector ? theme.text : theme.muted,
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

            {/* Spacer pushes undo/redo to bottom */}
            <div style={{ flex: 1 }} />

            {/* Separator */}
            <div className="toolbar-sep" style={{ borderColor: theme.border }} />

            {/* Undo */}
            <button
              className="toolbar-btn"
              title="Undo (Ctrl+Z)"
              disabled={!canUndo}
              onClick={handleUndo}
              style={{ color: canUndo ? theme.text : theme.muted, opacity: canUndo ? 1 : 0.35 }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 5.5h6a3 3 0 0 1 0 6H7" />
                <path d="M5.5 3L3 5.5 5.5 8" />
              </svg>
            </button>
            {/* Redo */}
            <button
              className="toolbar-btn"
              title="Redo (Ctrl+Y)"
              disabled={!canRedo}
              onClick={handleRedo}
              style={{ color: canRedo ? theme.text : theme.muted, opacity: canRedo ? 1 : 0.35 }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5.5H5a3 3 0 0 0 0 6h2" />
                <path d="M8.5 3L11 5.5 8.5 8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
