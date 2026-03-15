# /refactor — SVG Generator Refactor Plan

Execute the tikzjs SVG generator refactoring end-to-end. The goal is to:

1. **Keep existing behavior stable** — only preserve currently-passing tests; some golden tests fail before this refactor and that is acceptable.
2. **Make the IR flexible for multiple render targets** — move target-agnostic code to `src/generators/core/` so D3, canvas, or other renderers can reuse it.
3. **Centralize magic numbers** — distinguish TikZ/TeX syntax-level constants (never override) from generator-level tuning decisions (safe to override via options).
4. **Modularize rendering** — polymorphic per-kind handlers in a registry, overridable by consumers.

After **each step**, run `npm test` and confirm no regressions among currently-passing tests.

---

## Step 1 — Centralize magic numbers (`constants.ts`)

Create `src/generators/svg/constants.ts` with two categories:

**`TIKZ_CONSTANTS`** — syntax-level, defined by TikZ/TeX spec. Never exposed as user options:
- `PT_PER_CM: 28.4528` — TeX unit definition
- `DEFAULT_INNER_SEP_PT: 3.333` — pgfmanual §17.5.1
- `DEFAULT_LINE_WIDTH_PT: 0.4` — TikZ default line width
- `DEFAULT_COL_SEP_PT: 56.9` — tikzcd default (2cm)
- `DEFAULT_ROW_SEP_PT: 28.45` — tikzcd default (1cm)
- `DEFAULT_GRID_STEP_PT: 28.4528` — TikZ default grid step (1cm)
- `TO_PATH_LOOSENESS: 0.3915` — TikZ to-path control arm factor
- `QUAD_TO_CUBIC_FACTOR: 2/3` — mathematical Bézier elevation

**`SVGRenderingConstants`** — generator-level tuning, exposed via `SVGGeneratorOptions.constants`:
- `CM_TO_PX: 52` — pixel scale (1cm = 52px)
- `PT_TO_PX: 52 / 28.4528` — derived from CM_TO_PX
- `DIAGRAM_PADDING_PT: 2.4` — viewBox padding
- `MIN_HALF_SIZE_PX: 1` — guard against zero-size nodes
- `NODE_LABEL_GAP_PT: 3` — attached label clearance
- `EDGE_LABEL_GAP_PX: 4` — label-to-arrow gap
- `EDGE_LABEL_DESCRIPTION_PAD_PX: 2` — description label bg padding
- `EDGE_INOUT_DISTANCE_FACTOR: 0.4` — in/out angle control arm scale

Replace every raw numeric literal in each emitter with the appropriate constant. **Critical fix** in `matrixEmitter.ts`: the inline `52 / 28.4528` that bypasses `ptToPx()` must be replaced with `constants.PT_TO_PX`.

## Step 2 — Thread `constants` through generator options

- Add `constants?: Partial<SVGRenderingConstants>` to `SVGGeneratorOptions`
- In `generateSVG`: merge `const C = { ...DEFAULT_CONSTANTS, ...(opts.constants ?? {}) }`
- Pass `C` into all emitter calls

## Step 3 — Move target-agnostic code to `src/generators/core/`

- **Create `src/generators/core/boundingBox.ts`** — exact copy of `svg/boundingBox.ts`, no DOM/SVG deps
- **Create `src/generators/core/coordResolver.ts`** — move `CoordResolver`, `NodeGeometryRegistry`, `getAnchorPosition`, `clipToNodeBoundary`, `ptToPx`, `pxToPt`
- **Convert old files to thin re-export shims:**
  ```typescript
  // src/generators/svg/coordResolver.ts
  export * from '../core/coordResolver.js'
  ```

## Step 4 — Introduce `RenderContext` + `SVGRendererRegistry`

**Create `src/generators/svg/renderContext.ts`:**
```typescript
export interface ElementRenderResult {
  pathElements: Element[]
  nodeElements: Element[]
  bboxes: BoundingBox[]
}
export interface RenderContext {
  document: Document
  coordResolver: CoordResolver
  nodeRegistry: NodeGeometryRegistry
  markerRegistry: MarkerRegistry
  mathRenderer: MathRenderer
  constants: SVGRenderingConstants
  inheritedStyle: ResolvedStyle
  registry: SVGRendererRegistry
  pass: 1 | 2
}
```

**Create `src/generators/svg/rendererRegistry.ts`:**
- One typed handler per IR element kind
- `defaultSVGRegistry` wraps existing emitter functions
- Each handler checks `ctx.pass` and returns `null` for the wrong pass
- Scope handler inlines the dispatch loop (avoids circular import with `index.ts`)
- Path handler handles both passes: pass 1 registers inline nodes, pass 2 renders geometry

**Refactor `src/generators/svg/index.ts`:**
```typescript
export function renderPass(elements: IRElement[], ctx: RenderContext): ElementRenderResult {
  const accum = { pathElements: [], nodeElements: [], bboxes: [] }
  for (const el of elements) {
    const handler = ctx.registry[el.kind as keyof SVGRendererRegistry]
    if (!handler) continue
    const result = (handler as (el: IRElement, ctx: RenderContext) => ElementRenderResult | null)(el, ctx)
    if (result) { /* push to accum */ }
  }
  return accum
}
// In generateSVG:
const r1 = renderPass(diagram.elements, { ...baseCtx, pass: 1 })
const r2 = renderPass(diagram.elements, { ...baseCtx, pass: 2 })
```

## Step 5 — Export new types from public API

Add to `src/index.ts`:
```typescript
export type { SVGRenderingConstants } from './generators/svg/constants.js'
export { DEFAULT_CONSTANTS } from './generators/svg/constants.js'
export type { SVGRendererRegistry } from './generators/svg/rendererRegistry.js'
export type { RenderContext, ElementRenderResult } from './generators/svg/renderContext.js'
```

Add `registry?: Partial<SVGRendererRegistry>` to `SVGGeneratorOptions`.

## Step 6 (deferred) — D3 / canvas renderer

When a second render target is needed:
- Create `src/generators/d3/` importing from `src/generators/core/` only
- Extract traversal kernel into `src/generators/core/traversal.ts` at that point
- Do NOT do this now — no premature abstraction

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/generators/svg/constants.ts` | **Create** — `TIKZ_CONSTANTS` + `SVGRenderingConstants` + `DEFAULT_CONSTANTS` |
| `src/generators/svg/renderContext.ts` | **Create** — `RenderContext`, `ElementRenderResult` |
| `src/generators/svg/rendererRegistry.ts` | **Create** — `SVGRendererRegistry`, `defaultSVGRegistry` |
| `src/generators/core/coordResolver.ts` | **Create** — moved from `svg/coordResolver.ts` |
| `src/generators/core/boundingBox.ts` | **Create** — moved from `svg/boundingBox.ts` |
| `src/generators/svg/index.ts` | Refactor: `renderPass()`, `RenderContext`, constants merge, `registry` option |
| `src/generators/svg/matrixEmitter.ts` | Fix inline `52/28.4528`; accept `constants` param |
| `src/generators/svg/nodeEmitter.ts` | Accept `constants` param; remove local constant declarations |
| `src/generators/svg/pathEmitter.ts` | Accept `constants` param; use `TIKZ_CONSTANTS` for path ops |
| `src/generators/svg/edgeEmitter.ts` | Accept `constants` param; use `TIKZ_CONSTANTS` for Bézier math |
| `src/generators/svg/styleEmitter.ts` | Use `TIKZ_CONSTANTS.DEFAULT_LINE_WIDTH_PT` |
| `src/generators/svg/coordResolver.ts` | Thin re-export shim → `../core/coordResolver.js` |
| `src/generators/svg/boundingBox.ts` | Thin re-export shim → `../core/boundingBox.js` |
| `src/index.ts` | Export new types; add `registry?` to `SVGGeneratorOptions` |

## Verification

After each step:
1. `npm test` — currently-passing tests continue to pass
2. `npm run build` — no TypeScript errors
3. After all steps: `make cdiff` — no SVG regressions for currently-passing fixtures
