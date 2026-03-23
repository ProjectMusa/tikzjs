# tikzjs — Project Rules for Claude

## Pipeline Architecture

This project is a multi-stage TikZ → IR → output pipeline with multiple generators:

```
TikZ source
  → Preprocessor  (macro expansion, \tikzset, \foreach, tikzcd extraction)
  → Parser        (Peggy PEG grammar → IRDiagram plain objects)
  → Generators:
      → SVG Generator   (IRDiagram → SVG string/DOM, two-pass rendering)
      → TikZ Generator  (IRDiagram → TikZ source, round-trip serializer)
      → D3 Editor       (IRDiagram → interactive SVG with drag/select/inspect)
```

Never conflate stages. Style resolution happens in the parser (via `optionParser` + `styleResolver`).
Pixel coordinate resolution happens in the generator (`coordResolver.ts`). The IR holds
symbolic coordinates (pt units) only — never pixels.

## Source Layout

```
src/
  index.ts                      — public API (parse, generate, exports)
  ir/types.ts                   — all IR type definitions
  preprocessor/                 — macro expansion, tikzcd extraction, \foreach
  parser/                       — Peggy grammar, option/style resolution, IR factory
  math/                         — MathJax rendering abstraction
  generators/
    core/                       — target-agnostic utilities shared by all generators
      coordResolver.ts          — CoordResolver, NodeGeometryRegistry, ptToPx, anchor math
      boundingBox.ts            — BoundingBox merge/pad/viewBox utilities
    svg/                        — SVG string/DOM generator (two-pass rendering)
      index.ts                  — generateSVG(), generateSVGElement(), renderPass()
      constants.ts              — TIKZ_CONSTANTS (spec-level) + SVGRenderingConstants (tunable)
      renderContext.ts          — RenderContext, ElementRenderResult interfaces
      rendererRegistry.ts       — SVGRendererRegistry, per-kind handler dispatch
      nodeEmitter.ts            — IRNode → SVG <g> with shapes, labels, anchors
      pathEmitter.ts            — IRPath → SVG <path> with all segment kinds
      edgeEmitter.ts            — IREdge → SVG <path> with arrow markers
      matrixEmitter.ts          — IRMatrix → cell layout (tikzcd support)
      knotEmitter.ts            — IRKnot → knot diagram rendering
      styleEmitter.ts           — ResolvedStyle → SVG attributes + transforms
      markerDefs.ts             — arrow marker deduplication registry
      patternDefs.ts            — fill pattern definitions
      coordResolver.ts          — re-export shim → core/coordResolver
      boundingBox.ts            — re-export shim → core/boundingBox
    tikz/                       — TikZ source generator (IR → TikZ round-trip)
      index.ts                  — generateTikZ() entry point
      coordEmitter.ts           — CoordRef → TikZ coordinate string
      optionEmitter.ts          — RawOption[] → [key=value,...] string
      elementEmitter.ts         — per-kind IR element → TikZ command strings
    d3/                         — D3.js interactive editor (browser-only)
      index.ts                  — createD3Editor() controller factory
      renderer.ts               — renderDiagram() using generateSVGElement() (no innerHTML)
      grid.ts                   — coordinate grid overlay (TikZ pt units)
      highlight.ts              — SVG-native selection highlights (invert-color overlays)
      interactions.ts           — drag, select behaviors + CSS injection
      irMutator.ts              — safe IR mutation (moveNode, findNode, isDraggable)
      D3EditorPanel.tsx         — React component wrapper for createD3Editor
      IRInspector.tsx           — React IR inspector panel (Elements + Tree modes)
```

## Build & Test Commands

```bash
npm run gen          # Regenerate parser from grammar — MUST run after editing _tikzjs.pegjs
npm run build        # Compile TypeScript → dist/
npm test             # All tests (unit + golden)
npm run test:unit    # Unit tests only
npm run test:golden  # Golden SVG comparison tests only
npm run golden       # Generate golden refs via pdflatex + dvisvgm (requires TeX Live)
```

**Critical:** Any edit to `src/parser/_tikzjs.pegjs` requires `npm run gen` before testing.
The generated `src/parser/_tikzjs.js` is committed and must be kept in sync.

## IR Rules

- All IR types live in `src/ir/types.ts`. Do not scatter type definitions elsewhere.
- IR objects are plain TypeScript interfaces — no class instances, no methods, no `_parent` back-pointers.
- All coordinates in the IR are in TeX points (pt). Never store pixel values in IR.
- Discriminated unions use a `kind` field: `{ kind: 'node' | 'path' | 'scope' | ... }`.
- Use factory functions from `src/parser/factory.ts` to create IR elements — never construct objects inline.
  Factory functions handle ID generation and required field defaults.
- `IRDiagram` is fully JSON-serializable. Keep it that way.

## Grammar Rules

- There is exactly ONE `{{ }}` global initializer block in `_tikzjs.pegjs`. Peggy silently ignores
  a second `{{ }}` block — all helpers (`buildSegments`, `resolvePending`, etc.) must be in the first one.
- The per-parse `{ }` initializer uses the `options` object to receive `styleRegistry`, `tikzcdGrids`,
  and `nodeRegistry` from the caller. Never use module-level globals for parse state.
- Adding a new path operation follows this pattern:
  1. Add grammar rule `xxx_op` returning `{ kind: 'op-xxx', ... }`
  2. Add `'op-xxx'` case in `buildSegments()` → push `{ _pendingXxx: ... }` onto rawSegs
  3. Add `_pendingXxx` case in `resolvePending()` → consume next coord and emit final segment
  4. Handle `kind: 'xxx'` in `src/generators/svg/pathEmitter.ts`
  5. Run `npm run gen` to regenerate `_tikzjs.js`

## tikzcd Pipeline

tikzcd is **not** converted to raw TikZ. The preprocessor:

1. Extracts `\begin{tikzcd}...\end{tikzcd}` → parses into `TikzcdGrid` (structured cells + arrows)
2. Replaces the environment with `\tikzjsTikzcd{id}` placeholder in the source string
3. Passes the `Map<id, TikzcdGrid>` to the parser via `options.tikzcdGrids`

The parser's `tikzcd_statement` rule consumes the placeholder and calls `buildMatrixFromGrid()`
to produce `IRMatrix` + `IRTikzcdArrow[]` directly. No intermediate TikZ emission.

## Edit Rules

**DO NOT** change anything in the `/manuals` directory

## SVG Generator Rules

- Two-pass rendering in `src/generators/svg/index.ts`:
  - Pass 1: render matrices and standalone nodes → populate `NodeGeometryRegistry`
  - Pass 2: render paths and edges → use registry for anchor resolution and line clipping
- Paths are inserted BEFORE nodes in the SVG output (so nodes render on top).
- All SVG elements carry `data-ir-id` and `data-ir-kind` attributes for D3 interactivity.
- Arrow markers are deduplicated via `MarkerRegistry` — use `ensureMarker()`, never write `<marker>` directly.
- Coordinate system: SVG y-axis is inverted vs TikZ. Apply `PT_TO_PX` conversion in `coordResolver.ts` only.
- `generateSVGElement()` returns a live DOM tree (no serialization); `generateSVG()` wraps it as a string.

## D3 Editor Rules

- The D3 editor reuses the SVG generator's live DOM output via `generateSVGElement()` — no innerHTML roundtrip.
- Element lookup uses `data-ir-id` attributes set by the SVG generator; no position-matching heuristics.
- Highlight overlays use SVG-native shapes with `mix-blend-mode: difference` for invert-color visibility.
  CSS `outline` does NOT work on SVG elements — never use it for SVG highlighting.
- Only nodes with `cs: 'xy'` coordinates are draggable. Others show a lock indicator.
- The `grid.ts`, `highlight.ts`, and `interactions.ts` modules are separate concerns — keep them decoupled.
- React components (`D3EditorPanel.tsx`, `IRInspector.tsx`) are optional; the core API is `createD3Editor()`.

## TikZ Generator Rules

- Uses `rawOptions` (not `ResolvedStyle`) for option emission — preserves original key-value pairs.
- IR coordinates are in pt; TikZ defaults to cm. Divide by `PT_PER_CM` (28.4528) when emitting.
- tikzcd matrices emit `\begin{tikzcd}` with arrow direction strings reconstructed from `rowDelta`/`colDelta`.

## Testing Rules

- Golden tests live in `test/golden/`. Fixture `.tikz` files go in `fixtures/`, reference SVGs in `refs/`.
- Golden refs are generated by TeX Live (`scripts/generateGolden.sh`) and committed to the repo.
- When adding a new fixture, run `npm run golden` to generate its ref before committing.
- The `moduleNameMapper` in `jest.config.js` strips `.js` only from relative imports (`^\\.{1,2}/.*`).
- Use `make cdiff` for testing
  Do **not** make it match all paths — it breaks `entities/lib/decode.js` inside jsdom/parse5.
- Unit tests use `resetIds: true` in options where deterministic IR IDs are needed.

## Code Style

- Prettier config: single quotes, 2-space indent, no semicolons, 120-char lines.
- Use section separator comments: `// ── Section Name ──────────────────────────`
- Export all public types from `src/index.ts`. Do not import internal types from external consumers.
- Prefer `interface` over `type` for IR object definitions. Use `type` for unions and aliases.

## TikZ Reference

When behavior is ambiguous, consult in this order:

1. `pgfmanual.pdf` — authoritative TikZ syntax and option names (available on CTAN)
2. pgf source: `texmf-dist/tex/generic/pgf/` — TeX implementation is ground truth
3. tikzjax in browser — quick visual check without local TeX
