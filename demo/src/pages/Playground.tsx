import { useState, useEffect, useRef, useCallback } from 'react'
import { Editor } from '../components/Editor'
import { Preview } from '../components/Preview'
import { ExamplePicker } from '../components/ExamplePicker'
import { examples } from '../lib/examples'

const STORAGE_KEY = 'tikzjs-demo-source'
const DEBOUNCE_MS = 400

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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const renderRef = useRef<typeof import('../lib/tikzBrowser') | null>(null)

  // Lazy-load the tikz renderer to avoid blocking initial render
  useEffect(() => {
    import('../lib/tikzBrowser').then((mod) => {
      renderRef.current = mod
      // Trigger initial render
      doRender(source, mod)
    })
  }, [])

  const doRender = useCallback((src: string, mod?: typeof import('../lib/tikzBrowser') | null) => {
    const renderer = mod ?? renderRef.current
    if (!renderer) return
    try {
      const result = renderer.renderTikz(src)
      setSvg(result)
      setError(null)
    } catch (e: any) {
      setSvg('')
      setError(e.message || String(e))
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
        <span style={{ color: '#6c7086', fontSize: 12 }}>Edit TikZ code on the left, see SVG on the right</span>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'hidden', borderRight: '1px solid #333' }}>
          <Editor value={source} onChange={handleChange} />
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Preview svg={svg} error={error} />
        </div>
      </div>
    </div>
  )
}
