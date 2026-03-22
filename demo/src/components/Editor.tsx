import CodeMirror from '@uiw/react-codemirror'

interface EditorProps {
  value: string
  onChange: (value: string) => void
}

export function Editor({ value, onChange }: EditorProps) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      height="100%"
      theme="dark"
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
