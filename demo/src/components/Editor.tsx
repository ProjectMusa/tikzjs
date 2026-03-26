import CodeMirror from '@uiw/react-codemirror'

interface EditorProps {
  value: string
  onChange: (value: string) => void
  isDark: boolean
}

export function Editor({ value, onChange, isDark }: EditorProps) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      height="100%"
      theme={isDark ? 'dark' : 'light'}
      basicSetup={{
        lineNumbers: true,
        bracketMatching: true,
        foldGutter: false,
        highlightActiveLine: true,
      }}
      style={{ height: '100%', fontSize: 14 }}
    />
  )
}
