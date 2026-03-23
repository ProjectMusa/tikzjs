# tikzjs

A pure JavaScript/TypeScript engine that converts [TikZ](https://ctan.org/pkg/pgf) source code to SVG — no LaTeX installation required.

**Live demo:** [https://projectmusa.github.io/tikzjs/](https://projectmusa.github.io/tikzjs/)

## How it works

tikzjs is a multi-stage pipeline with a JSON-serializable intermediate representation (IR):

```
TikZ source
  → Preprocessor  (macro expansion, \tikzset, \foreach, tikzcd extraction)
  → Parser        (Peggy PEG grammar → IR)
  → Generators:
      → SVG Generator   (IR → SVG string or live DOM)
      → TikZ Generator  (IR → TikZ source for round-tripping)
      → D3 Editor       (IR → interactive SVG with drag, select, inspect)
```

All coordinates in the IR are in TeX points. Math rendering is handled by MathJax.

## Install

```bash
npm install tikzjs
```

## Usage

### Basic: TikZ → SVG

```ts
import { parse, generate, generateFromIR } from 'tikzjs'

// One-step: TikZ source → SVG string
const svg = generate(`\\begin{tikzpicture}
  \\draw[->] (0,0) -- (1,1);
  \\node[circle, draw] at (2,0) {Hello};
\\end{tikzpicture}`)

// Two-step: parse to IR, then generate (allows IR inspection/manipulation)
const diagram = parse(`\\begin{tikzpicture}
  \\draw[->] (0,0) -- (1,1);
\\end{tikzpicture}`)
const svg2 = generateFromIR(diagram)
```

### Round-trip: TikZ → IR → TikZ

```ts
import { parse, generateTikZFromIR } from 'tikzjs'

const diagram = parse(`\\begin{tikzpicture}
  \\node[circle, draw] (a) at (0,0) {A};
  \\node[circle, draw] (b) at (2,0) {B};
  \\draw[->] (a) -- (b);
\\end{tikzpicture}`)

const tikzSource = generateTikZFromIR(diagram)
```

### Interactive D3 editor (browser)

```ts
import { parse, createD3Editor } from 'tikzjs'

const diagram = parse(`\\begin{tikzpicture}
  \\node[circle, draw] (a) at (0,0) {A};
  \\node[circle, draw] (b) at (2,0) {B};
  \\draw[->] (a) -- (b);
\\end{tikzpicture}`)

const editor = createD3Editor(document.getElementById('canvas'), diagram, {
  onIRChange: (updatedDiagram) => {
    // Called after each interaction (e.g., drag end)
    console.log('IR updated:', updatedDiagram)
  },
  onElementSelect: (elementId) => {
    console.log('Selected:', elementId)
  },
})

// Programmatic control
editor.highlightElement('node-1')
editor.setShowGrid(false)
editor.setDiagram(newDiagram)
```

### React components

```tsx
import { D3EditorPanel, IRInspector } from 'tikzjs'

function MyEditor({ diagram, onChange }) {
  const [selectedId, setSelectedId] = useState(null)

  return (
    <div style={{ display: 'flex' }}>
      <D3EditorPanel
        diagram={diagram}
        onDiagramChange={onChange}
        showGrid={true}
        highlightElementId={selectedId}
        onElementSelect={setSelectedId}
      />
      <IRInspector
        diagram={diagram}
        selectedElementId={selectedId}
        onSelectElement={setSelectedId}
      />
    </div>
  )
}
```

## Build & test

```bash
npm run gen          # Regenerate parser from grammar (required after editing .pegjs)
npm run build        # Compile TypeScript → dist/
npm test             # All tests (unit + golden)
npm run test:unit    # Unit tests only
npm run test:golden  # Golden SVG comparison tests only
```

## Supported features

- **Path operations:** lines (`--`), curves (`.. controls ..`), `to`, `rectangle`, `circle`, `ellipse`, `arc`, `grid`, `parabola`, `sin`, `cos`
- **Nodes:** `\node`, `\coordinate`, inline path nodes, anchors, label positioning
- **Node shapes:** `circle`, `rectangle`, `diamond`, `ellipse`, `regular polygon`, `rounded corners`
- **Arrows:** `->`, `<->`, `Stealth`, `Latex`, `|` and custom tip specs
- **Styles:** `draw`, `fill`, `thick`/`thin`/`ultra thick`, `dashed`, `dotted`, colors, opacity, `double` borders
- **Coordinate systems:** Cartesian, polar, 3D `(x,y,z)`, relative (`+`/`++`), `calc` expressions
- **Math functions:** `sqrt()`, `sin()`, `cos()`, `abs()`, `pi` in coordinate expressions
- **Positioning:** `above=of`, `right=of`, `below left=of`, `node distance`, `right of=`
- **Scope & transforms:** `\begin{scope}`, `scale`, `xscale`, `yscale`, `xshift`, `yshift`, `rotate`
- **Loops:** `\foreach \x in {1,...,5}`
- **Styles:** `\tikzset`, `\tikzstyle`, `.style`, `every node/.style`
- **Matrices:** `\matrix`, tikzcd (`\begin{tikzcd}`)
- **Edges:** `edge`, `bend left`/`right`, `in`/`out`, self-loops
- **Libraries:** `automata` (state style), `fit`, `knots`
- **Other:** `\def` macros, `fill opacity`, `draw opacity`, `line cap`, `line join`, `dash pattern`, `inner xsep`/`ysep`

## Testing

Golden tests compare rendered SVGs against TeX Live reference outputs. There are 97 golden fixtures.

```bash
npm run golden       # Generate golden refs (requires TeX Live)
make cdiff           # Visual diff of all golden fixtures
```

## API Reference

### Core functions

| Function | Description |
|----------|-------------|
| `parse(tikzSource)` | Parse TikZ source → `IRDiagram` |
| `generate(tikzSource, opts?)` | TikZ source → SVG string |
| `generateFromIR(diagram, opts?)` | `IRDiagram` → SVG string |
| `generateSVGElement(diagram, opts?)` | `IRDiagram` → live SVG DOM element |
| `generateTikZ(diagram, opts?)` | `IRDiagram` → TikZ source string |
| `generateTikZFromIR(diagram, opts?)` | `IRDiagram` → TikZ source string |
| `serializeIR(diagram)` | `IRDiagram` → JSON string |
| `deserializeIR(json)` | JSON string → `IRDiagram` |

### D3 Interactive editor

| Export | Description |
|--------|-------------|
| `createD3Editor(container, diagram, opts?)` | Create interactive editor, returns `D3EditorController` |
| `D3EditorPanel` | React component wrapping the D3 editor |
| `IRInspector` | React component for inspecting IR elements (Elements + Tree modes) |

### IR utilities

| Export | Description |
|--------|-------------|
| `moveNode(diagram, nodeId, x, y)` | Update node position in IR |
| `findNode(diagram, nodeId)` | Find a node by ID |
| `findElement(diagram, id)` | Find any element by ID |
| `isDraggable(node)` | Check if a node has `xy` coordinates |
| `collectNodes(elements)` | Flatten all nodes from element tree |

## License

ISC
