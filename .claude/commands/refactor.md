# /refactor — Unified Per-Kind Handler Refactor Plan

Execute the tikzjs refactoring end-to-end. The goal is a **per-IR-kind handler architecture** where each IR element type defines how it is rendered, interacted with, mutated, previewed during editing, listed in the inspector panel, and edited via forms.

Information flows **one direction**: TikZ source → IR → generators (SVG, D3, TikZ).

## Completed (SVG Generator)

Steps 1–5 of the original SVG refactor are done:
- ✅ Centralized constants (`constants.ts`)
- ✅ Constants threaded via `SVGGeneratorOptions`
- ✅ Target-agnostic code in `src/generators/core/`
- ✅ `RenderContext` + `SVGRendererRegistry` with per-kind handlers
- ✅ Public API exports

---

## Architecture: Per-Kind Handler Pattern

Each IR element kind (`node`, `path`, `edge`, `matrix`, `scope`, `coordinate`, `knot`) gets a **D3ElementHandler** that centralizes all behavior for that kind:

```typescript
// src/generators/d3/elementHandlers/types.ts

export interface D3ElementHandler<T extends IRElement = IRElement> {
  /** Which IR kind this handler covers. */
  kind: T['kind']

  // ── Rendering ──────────────────────────────────────

  /** Create the click zone for this element (path-following or bbox rect). */
  createClickZone(el: T, svgGroup: SVGElement, doc: Document): SVGElement | null

  /** Create selection overlay (highlight, control handles). */
  createHighlight(
    el: T, svgGroup: SVGElement, svg: SVGSVGElement,
    ctx: HighlightContext,
  ): HighlightResult

  /** Visual feedback during drag. Return updated transform string. */
  createDragPreview(el: T, svgGroup: SVGElement, delta: DragDelta): void

  // ── Interactions ───────────────────────────────────

  /** Whether this element is draggable (e.g., nodes with cs:'xy'). */
  isDraggable(el: T): boolean

  /** Available mutations for this element kind. */
  mutations: MutationDef<T>[]

  /** Keyboard actions when this element is selected. */
  keyActions?: KeyAction<T>[]

  // ── Inspector Panel ────────────────────────────────

  /** One-line summary for the element list (icon + label). */
  listSummary(el: T): { icon: string; label: string; sublabel?: string }

  /** Tree view: expandable child items (e.g., path segments, node labels). */
  treeChildren?(el: T): TreeChild[]

  /** Editor form fields for the inspector detail panel. */
  editorFields(el: T): EditorField[]
}
```

### Supporting Types

```typescript
export interface DragDelta {
  dxPt: number; dyPt: number     // delta in TikZ pt
  dxPx: number; dyPx: number     // delta in SVG px
  startPtX: number; startPtY: number
}

export interface HighlightContext {
  nodeRegistry: NodeGeometryRegistry
  diagram: IRDiagram
}

export interface HighlightResult {
  overlays: SVGElement[]          // highlight overlay elements
  handles?: SVGElement[]          // draggable control point handles
}

export interface MutationDef<T> {
  id: string                      // 'move', 'delete', 'edit-label', etc.
  apply(el: T, diagram: IRDiagram, params: any): IRDiagram
}

export interface KeyAction<T> {
  key: string                     // 'Delete', 'F2', 'ArrowUp', etc.
  ctrl?: boolean; shift?: boolean; alt?: boolean
  action: string                  // mutation id or special action
  params?: any | ((el: T) => any)
}

export interface TreeChild {
  id: string
  label: string
  icon?: string
  children?: TreeChild[]
}

export interface EditorField {
  key: string                     // IR field path (e.g., 'style.textColor')
  label: string
  type: 'text' | 'number' | 'color' | 'select' | 'coordinate' | 'boolean'
  options?: { value: string; label: string }[]   // for 'select' type
  readOnly?: boolean
}
```

---

## Step 1 — Create handler types and registry

**Create `src/generators/d3/elementHandlers/types.ts`:**
- All interfaces above
- Export `D3ElementHandler`, `DragDelta`, `HighlightContext`, etc.

**Create `src/generators/d3/elementHandlers/registry.ts`:**
```typescript
export interface D3ElementHandlerRegistry {
  node: D3ElementHandler<IRNode>
  path: D3ElementHandler<IRPath>
  edge: D3ElementHandler<IREdge>
  matrix: D3ElementHandler<IRMatrix>
  scope: D3ElementHandler<IRScope>
  coordinate: D3ElementHandler<IRCoordinate>
  knot: D3ElementHandler<IRKnot>
}

export const defaultD3Registry: D3ElementHandlerRegistry = {
  node: nodeHandler,
  path: pathHandler,
  edge: edgeHandler,
  matrix: matrixHandler,
  scope: scopeHandler,
  coordinate: coordinateHandler,
  knot: knotHandler,
}
```

**Verification:** `npm run build` — types compile, no runtime changes yet.

---

## Step 2 — Extract `nodeHandler`

**Create `src/generators/d3/elementHandlers/nodeHandler.ts`:**

Extract from scattered locations into one handler:

| Method | Current location | What it does |
|--------|-----------------|--------------|
| `createClickZone` | `index.ts` click zone loop | bbox rect with padding |
| `createHighlight` | `highlight.ts` `addNodeHighlight()` | border overlay + label overlay |
| `createDragPreview` | `interactions.ts` `setupDrag` drag handler | delta translate on `<g>` |
| `isDraggable` | `irMutator.ts` `isDraggable()` | checks `cs === 'xy'` |
| `mutations` | `irMutator.ts` `moveNode`, `updateNodeLabel`, `removeElement` | move, edit-label, delete |
| `keyActions` | `interactions.ts` `setupKeyboard` | Delete, F2, arrows |
| `listSummary` | `IRInspector.tsx` `elementSummary()` | circle icon + label text |
| `treeChildren` | `IRInspector.tsx` `ElementTreeRow` node case | style props, labels |
| `editorFields` | NEW | position x/y, label, shape, draw/fill/textColor |

Then wire `nodeHandler` into the registry and call it from `index.ts` (click zones), `highlight.ts`, `interactions.ts` (drag), etc. Keep the old code paths as fallbacks for kinds that haven't been extracted yet.

**Verification:** `npm test` + `npx playwright test --reporter=line`

---

## Step 3 — Extract `pathHandler`

**Create `src/generators/d3/elementHandlers/pathHandler.ts`:**

| Method | Current location |
|--------|-----------------|
| `createClickZone` | `index.ts` — clone `<path>` with thick transparent stroke |
| `createHighlight` | `highlight.ts` `addPathHighlight()` — segment overlays + CP handles |
| `createDragPreview` | N/A (paths aren't dragged as a whole) |
| `isDraggable` | always false |
| `mutations` | `updateCurveControl`, `moveSegmentEndpoint`, `removeElement` |
| `keyActions` | Delete |
| `listSummary` | `IRInspector.tsx` — path icon + segment count |
| `treeChildren` | `IRInspector.tsx` — per-segment tree (line, curve, arc, etc.) |
| `editorFields` | segments list, draw color, line width, dash pattern |

**Verification:** `npm test` + `npx playwright test --reporter=line`

---

## Step 4 — Extract `edgeHandler`

**Create `src/generators/d3/elementHandlers/edgeHandler.ts`:**

| Method | Current location |
|--------|-----------------|
| `createClickZone` | `index.ts` — same as path (clone `<path>` with thick stroke) |
| `createHighlight` | `highlight.ts` — edge highlight (similar to path) |
| `isDraggable` | false |
| `mutations` | `updateEdgeLabel`, `removeElement` |
| `keyActions` | Delete, F2 (edit label) |
| `listSummary` | source → target + label |
| `treeChildren` | labels, arrow tips |
| `editorFields` | arrow style, label text, bend angle |

**Verification:** `npm test` + `npx playwright test --reporter=line`

---

## Step 5 — Extract remaining handlers

**Create handlers for `matrix`, `scope`, `coordinate`, `knot`:**

These are simpler — mostly just `listSummary`, `treeChildren`, and `editorFields`. Most don't have complex interactions (no drag, minimal mutations).

**Verification:** `npm test` + `npx playwright test --reporter=line`

---

## Step 6 — Refactor `interactions.ts` to use registry

Replace the scattered kind checks with registry dispatch:

```typescript
// Before (scattered):
if (kind === 'node') { /* node drag logic */ }
else if (kind === 'path') { /* path logic */ }

// After (registry dispatch):
const handler = registry[kind]
if (handler?.isDraggable(el)) {
  setupDragForElement(el, handler, svgGroup, ...)
}
```

Refactor each interaction entry point:
- `setupDrag()` → delegates to `handler.isDraggable()` + `handler.createDragPreview()`
- `setupSelection()` → delegates to `handler.createHighlight()`
- `setupKeyboard()` → collects `handler.keyActions` for the selected element
- Click zone creation in `index.ts render()` → delegates to `handler.createClickZone()`

**Target:** `interactions.ts` shrinks from ~870 lines to ~300 lines of generic dispatch.

**Verification:** `npm test` + `npx playwright test --reporter=line`

---

## Step 7 — Refactor `highlight.ts` to use registry

Replace `addNodeHighlight()`, `addPathHighlight()`, etc. with:

```typescript
export function highlightElement(svg, id, elementMap, registry, ctx) {
  clearHighlights(svg)
  const el = findElement(ctx.diagram, id)
  if (!el) return
  const handler = registry[el.kind]
  if (!handler) return
  const svgGroup = elementMap.get(id)
  if (!svgGroup) return
  const result = handler.createHighlight(el, svgGroup, svg, ctx)
  // append result.overlays and result.handles to SVG
}
```

**Target:** `highlight.ts` shrinks from ~420 lines to ~80 lines of generic dispatch + utilities.

**Verification:** `npm test` + `npx playwright test --reporter=line`

---

## Step 8 — Refactor `IRInspector.tsx` to use registry

Replace the two large switch statements with registry calls:

```tsx
// Element list mode:
function ElementRow({ el, handler }) {
  const { icon, label, sublabel } = handler.listSummary(el)
  return <div>...</div>
}

// Tree mode:
function ElementTreeRow({ el, handler }) {
  const children = handler.treeChildren?.(el) ?? []
  return <TreeNode label={handler.listSummary(el).label} children={children} />
}

// Detail/editor panel (new):
function ElementEditor({ el, handler, onMutate }) {
  const fields = handler.editorFields(el)
  return <Form fields={fields} onChange={(key, value) => onMutate(el, key, value)} />
}
```

**Target:** `IRInspector.tsx` shrinks from ~640 lines to ~200 lines of generic components.

**Verification:** `npm test` + `npx playwright test --reporter=line`

---

## Step 9 — Add editor forms

With `editorFields` defined per handler, build the generic form renderer:

**Create `src/generators/d3/EditorForm.tsx`:**
- Renders fields based on type: text input, number input, color picker, coordinate pair, select dropdown
- On change, calls `handler.mutations.find(m => m.id === 'set-style-prop')` or similar
- Each field maps to a specific IR field path

Wire into the inspector panel as a third mode (Elements | Tree | **Editor**) or as an inline expandable section per selected element.

**Verification:** manual testing + `npm test`

---

## Step 10 — Clean up dead code

After all handlers are extracted and wired:
- Delete old scattered kind checks from `interactions.ts`, `highlight.ts`, `IRInspector.tsx`
- Delete duplicate helper functions that are now handler methods
- Verify no unused exports remain

**Verification:** `npm test` + `npx playwright test --reporter=line` + `npm run build`

---

## Step 11 — Export new types from public API

Add to `src/index.ts`:
```typescript
export type { D3ElementHandler, D3ElementHandlerRegistry } from './generators/d3/elementHandlers/types.js'
export { defaultD3Registry } from './generators/d3/elementHandlers/registry.js'
```

Add `registry?: Partial<D3ElementHandlerRegistry>` to `D3EditorOptions`, allowing consumers to override per-kind behavior.

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/generators/d3/elementHandlers/types.ts` | Handler interfaces, supporting types |
| `src/generators/d3/elementHandlers/registry.ts` | `D3ElementHandlerRegistry`, `defaultD3Registry` |
| `src/generators/d3/elementHandlers/nodeHandler.ts` | Node kind: drag, highlight, inspector, editor |
| `src/generators/d3/elementHandlers/pathHandler.ts` | Path kind: click zone, CP handles, segments |
| `src/generators/d3/elementHandlers/edgeHandler.ts` | Edge kind: labels, arrows |
| `src/generators/d3/elementHandlers/matrixHandler.ts` | Matrix kind: cell layout |
| `src/generators/d3/elementHandlers/scopeHandler.ts` | Scope kind: children |
| `src/generators/d3/elementHandlers/coordinateHandler.ts` | Coordinate kind: position |
| `src/generators/d3/elementHandlers/knotHandler.ts` | Knot kind: crossings |
| `src/generators/d3/EditorForm.tsx` | Generic form renderer from `editorFields` |

## Files to Refactor

| File | Change |
|------|--------|
| `src/generators/d3/index.ts` | Click zones → `handler.createClickZone()` |
| `src/generators/d3/interactions.ts` | Drag/select/keyboard → handler dispatch |
| `src/generators/d3/highlight.ts` | Overlays → `handler.createHighlight()` |
| `src/generators/d3/IRInspector.tsx` | Switch statements → handler dispatch |
| `src/generators/d3/irMutator.ts` | Keep as pure functions, referenced by handler `mutations` |

## Verification

After each step:
1. `npx tsc --noEmit` — no TypeScript errors
2. `npm test` — all Jest tests pass
3. `npx playwright test --reporter=line` — all E2E tests pass
4. `make cdiff` — no golden regressions

## Guardrails

- One handler extraction per step — do NOT batch
- Keep `irMutator.ts` as pure functions (no DOM, no SVG) — handlers reference them, don't absorb them
- Keep backward compatibility: if a handler method returns `null`, fall back to existing behavior
- Do NOT change IR types (`src/ir/types.ts`) — handlers adapt to IR, not the other way around
- Do NOT change SVG generator output — D3 handlers consume SVG generator output, they don't replace it
