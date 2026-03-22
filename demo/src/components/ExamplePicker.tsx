import { examples, goldenExamples } from '../lib/examples'

interface ExamplePickerProps {
  onSelect: (source: string) => void
}

export function ExamplePicker({ onSelect }: ExamplePickerProps) {
  const allExamples = [...examples, ...goldenExamples]

  return (
    <select
      onChange={(e) => {
        const idx = parseInt(e.target.value, 10)
        if (!isNaN(idx)) onSelect(allExamples[idx].source)
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
      <optgroup label="Examples">
        {examples.map((ex, i) => (
          <option key={`ex-${i}`} value={i}>
            {ex.name}
          </option>
        ))}
      </optgroup>
      {goldenExamples.length > 0 && (
        <optgroup label="Golden Tests">
          {goldenExamples.map((ex, i) => (
            <option key={`gt-${i}`} value={examples.length + i}>
              {ex.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )
}
