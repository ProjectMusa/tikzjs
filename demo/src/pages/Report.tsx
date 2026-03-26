import { useState } from 'react'

export function Report() {
  const [loadError, setLoadError] = useState(false)
  const base = import.meta.env.BASE_URL

  if (loadError) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#cdd6f4',
          flexDirection: 'column',
          gap: 16,
          padding: 32,
        }}
      >
        <h2 style={{ margin: 0 }}>Golden Diff Report not available</h2>
        <p style={{ color: '#a6adc8', maxWidth: 500, textAlign: 'center', lineHeight: 1.6 }}>
          The report is generated during CI or by running:
        </p>
        <code
          style={{
            background: '#313244',
            padding: '8px 16px',
            borderRadius: 6,
            fontSize: 14,
          }}
        >
          make cdiff-demo
        </code>
        <p style={{ color: '#6c7086', fontSize: 13 }}>
          This runs the Python/OpenCV comparison and outputs the report to gh-pages/report/.
        </p>
      </div>
    )
  }

  return (
    <iframe
      src={`${base}report/index.html`}
      onError={() => setLoadError(true)}
      onLoad={(e) => {
        // Detect SPA fallback (Vite dev) or 404 — report page won't have id="root"
        try {
          const doc = (e.target as HTMLIFrameElement).contentDocument
          if (!doc) return
          const isEmpty = doc.title === '' && doc.body?.children.length === 0
          const isSpaFallback = !!doc.getElementById('root')
          if (isEmpty || isSpaFallback) setLoadError(true)
        } catch {
          // cross-origin — report loaded successfully from a different origin
        }
      }}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
      }}
      title="Golden Diff Report"
    />
  )
}
