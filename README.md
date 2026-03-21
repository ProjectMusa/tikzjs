# tikzjs

A pure JavaScript/TypeScript engine that converts [TikZ](https://ctan.org/pkg/pgf) source code to SVG — no LaTeX installation required.

**Live demo:** [https://projectmusa.github.io/tikzjs/](https://projectmusa.github.io/tikzjs/)

## How it works

tikzjs is a three-stage pipeline:

```
TikZ source
  → Preprocessor  (macro expansion, \tikzset, \foreach, tikzcd extraction)
  → Parser        (Peggy PEG grammar → IR)
  → SVG Generator (IR → SVG string, two-pass rendering)
```

Math rendering is handled by MathJax. The intermediate representation (IR) is a plain JSON-serializable format with all coordinates in TeX points.

## Install

```bash
npm install
```

This runs `postinstall` which generates the parser and compiles TypeScript automatically.

## Usage

```js
const { parse, generate } = require('tikzjs')

const ir = parse(`\\begin{tikzpicture}
  \\draw[->] (0,0) -- (1,1);
  \\node[circle, draw] at (2,0) {Hello};
\\end{tikzpicture}`)

const svg = generate(ir)
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
- **Arrows:** `->`, `<->`, `Stealth`, `Latex`, `|` and custom tip specs
- **Styles:** `draw`, `fill`, `thick`/`thin`/`ultra thick`, `dashed`, `dotted`, colors, opacity
- **Coordinate systems:** Cartesian, polar, 3D `(x,y,z)`, relative (`+`/`++`), `calc` expressions
- **Math functions:** `sqrt()`, `sin()`, `cos()`, `abs()`, `pi` in coordinate expressions
- **Positioning:** `above=of`, `right=of`, `below left=of`, `node distance`, `right of=`
- **Node shapes:** `circle`, `rectangle`, `diamond`, `ellipse`, `rounded corners`
- **Scope & transforms:** `\begin{scope}`, `scale`, `xshift`, `yshift`, `rotate`
- **Loops:** `\foreach \x in {1,...,5}`
- **Styles:** `\tikzset`, `\tikzstyle`, `.style`, `every node/.style`
- **Matrices:** `\matrix`, tikzcd (`\begin{tikzcd}`)
- **Edges:** `edge`, `bend left`/`right`, `in`/`out`, self-loops
- **Other:** `\def` macros, `double` borders, `fill opacity`, `draw opacity`, `line cap`, `line join`, `dash pattern`

## Testing

Golden tests compare rendered SVGs against TeX Live reference outputs. There are 65 golden fixtures and ~480 extra validation fixtures.

```bash
npm run golden       # Generate golden refs (requires TeX Live)
make cdiff           # Visual diff of all golden fixtures
make cdiff-extra     # Visual diff of extra fixtures
```

## License

ISC
