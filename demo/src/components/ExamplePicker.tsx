import { examples } from '../lib/examples'

interface ExamplePickerProps {
  onSelect: (source: string) => void
}

export function ExamplePicker({ onSelect }: ExamplePickerProps) {
  return (
    <select
      onChange={(e) => {
        const idx = parseInt(e.target.value, 10)
        if (!isNaN(idx)) onSelect(examples[idx].source)
        e.target.value = ''
      }}
      defaultValue=""
      style={{
        background: '#313244',
        color: '#cdd6f4',
        border: '1px solid #45475a',
        borderRadius: 4,
        padding: '4px 8px',
        fontSize: 13,
        cursor: 'pointer',
      }}
    >
      <option value="" disabled>
        Load example...
      </option>
      {examples.map((ex, i) => (
        <option key={i} value={i}>
          {ex.name}
        </option>
      ))}
    </select>
  )
}
