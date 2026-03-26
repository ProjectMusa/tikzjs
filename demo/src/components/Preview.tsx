import { theme } from '../theme'

interface PreviewProps {
  svg: string
  error: string | null
}

export function Preview({ svg, error }: PreviewProps) {
  if (error) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: theme.bg,
          color: theme.error,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Render Error</div>
        <pre
          style={{
            fontSize: 13,
            maxWidth: '100%',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: theme.text,
            background: theme.codeBg,
            padding: 12,
            borderRadius: 6,
          }}
        >
          {error}
        </pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: theme.muted,
          background: theme.preview,
        }}
      >
        Type TikZ code to see the preview
      </div>
    )
  }

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme.preview,
        padding: 24,
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
