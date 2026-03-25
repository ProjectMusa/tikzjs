Run one cycle of the D3 editor improvement loop — fix rendering parity, interaction bugs, and UI issues in the demo app.

## Goal

The D3 interactive editor (demo app) must render golden fixtures **identically** to the SVG generator's static output. When a user selects a golden fixture in the editor, the D3-rendered canvas should match the preview panel pixel-for-pixel (minus the grid/highlight overlays).

Future goal: edit-step fixtures that test IR mutations and verify the resulting SVG.

---

## Priority order

Each cycle must follow this strict priority:

1. **Fix a rendering parity issue** — D3 editor output differs from SVG preview for a golden fixture
2. **Fix an interaction bug** — drag, select, highlight, or control-point drag misbehaves
3. **Add an edit-step test fixture** — test that IR mutations produce correct SVG output
4. **Improve UI/UX** — inspector, toolbar, grid, or layout improvements

Never skip to lower priorities when higher ones have known issues.

---

## Step 1 — Check rendering parity

### Important: `generateSVG()` and `generateSVGElement()` are the same code path

`generateSVG()` is literally `generateSVGElement().svg.outerHTML` (line 165-166 of `svg/index.ts`).
Comparing their outputs will always match — **this is NOT a useful parity check**.

The real parity issues come from:
1. **SVG namespace bugs** — `createElement()` vs `createElementNS(SVG_NS, ...)` in emitters. Elements created without the SVG namespace render correctly when serialized to string (browser re-parses), but are **invisible** in the D3 editor's live DOM. This is the most dangerous class of bug because it's invisible to string-based tests.
2. **Missing `data-ir-id`/`data-ir-kind` attributes** on emitter output — elements render but aren't interactive or selectable in the D3 editor.
3. **Options mismatch** between preview panel and D3 editor (math renderers, document context).

### Automated checks to run

#### Check 1: SVG namespace audit

Grep all emitters for `createElement(` without `NS` — every SVG element MUST use `createElementNS`:

```bash
grep -n 'document\.createElement(' src/generators/svg/*.ts
```

Any hit that isn't creating an HTML element (like `<style>`) is a bug. SVG elements (`path`, `g`, `circle`, `rect`, `line`, `text`, `tspan`, `use`, `clipPath`, `marker`, `pattern`, `defs`) MUST use `createElementNS(SVG_NS, ...)`.

#### Check 2: data-ir-id coverage audit

For each IR element kind, verify the emitter tags its root SVG element:

```bash
# List all IR element kinds
grep "kind:" src/ir/types.ts | grep -oP "'[^']+'" | sort -u

# Check which emitters set data-ir-id
grep -n 'data-ir-id' src/generators/svg/*.ts
```

Every element kind that produces SVG output should have `data-ir-id` and `data-ir-kind` on its root element. Missing tags mean elements render but are invisible to the D3 editor's selection/highlight system.

#### Check 3: Options parity

Compare the SVG options passed by the preview panel (`tikzBrowser.ts` → `browserSvgOptions()`) vs the D3 editor (`Playground.tsx` → `editorSvgOptions`). They should be identical.

### Key parity issues to look for

| Issue | Root cause area | How to detect |
|---|---|---|
| **Invisible elements in live DOM** | `createElement()` without SVG namespace | `grep 'createElement(' src/generators/svg/*.ts` |
| **Elements not selectable/highlightable** | Missing `data-ir-id`/`data-ir-kind` attrs | Audit emitters vs IR kinds |
| Missing math rendering in D3 | Math renderer options not passed | Compare `browserSvgOptions()` vs `editorSvgOptions` |
| Different node sizes | Document context differs | Compare document creation in both paths |
| Missing arrow markers | Marker dedup uses different doc context | Check marker output in live DOM |

### If a parity issue is found → fix it

1. Identify the root cause (namespace bug, missing attribute, or option mismatch)
2. Fix in the relevant emitter or demo file
3. Verify the fix doesn't break golden tests: `npm test`
4. Check both preview and editor mode in the demo app

---

## Step 2 — Check interactions

For the current set of golden fixtures, verify these interactions work:

### Selection
- [ ] Clicking a node highlights it with invert-color overlay
- [ ] Clicking a path highlights it with control point handles
- [ ] Clicking canvas background deselects
- [ ] IR Inspector syncs with selection (if open)

### Drag
- [ ] Dragging a node with `cs: 'xy'` moves it smoothly
- [ ] Non-draggable nodes (named coordinates, relative positions) show lock indicator
- [ ] After drag-end, edges reconnect correctly (full re-render)
- [ ] Source code updates in the editor panel after drag

### Control point drag
- [ ] Path control points are draggable
- [ ] Bezier curves update during control point drag
- [ ] After control-point drag-end, IR is updated and source code regenerated

### Grid
- [ ] Grid toggles on/off correctly
- [ ] Grid coordinates match TikZ pt units
- [ ] Grid doesn't interfere with element interaction

### If an interaction bug is found → fix it

1. Identify which module owns the behavior:
   - Selection: `interactions.ts` → `setupSelection()`
   - Drag: `interactions.ts` → `setupDrag()`
   - Control points: `interactions.ts` → `setupControlPointDrag()` + `highlight.ts`
   - Grid: `grid.ts` → `insertGrid()`
   - IR mutation: `irMutator.ts` → `moveNode()`, `findNode()`
2. Fix the bug
3. Verify on at least 3 different fixture types (simple nodes, paths with curves, tikzcd matrix)

---

## Step 3 — Edit-step test fixtures

Edit-step fixtures test that IR mutations produce correct SVG. They live in `test/d3/`.

### Architecture: IR as the edit contract

All edits are standardized as **pure IR mutation functions** in `src/generators/d3/irMutator.ts`.
The UI layer (D3 events) is just a thin mapping to these functions — it is never tested directly.

```
UI event → irMutator function → IR (mutated) → generateSVG() → compare ref
```

No browser, no Playwright, no DOM. Tests are pure Node.js: parse → mutate → generate → compare.

### The mutation catalog (`irMutator.ts`)

Every edit the UI can perform MUST have a corresponding named function here.
This is the contract between the UI and the test infrastructure.

| IR mutation function | UI action | Status |
|---|---|---|
| `moveNode(ir, id, x, y)` | Drag node | Exists |
| `updateNodeLabel(ir, id, label)` | Edit label text | Exists |
| `updateCurveControl(ir, pathId, segIdx, cpRole, x, y)` | Drag bezier control point | Exists |
| `removeElement(ir, id)` | Delete selected element | To implement |
| `addNode(ir, pos, label)` | Click to add node | To implement |
| `setOption(ir, id, key, value)` | Change style in inspector | To implement |
| `moveSegmentEndpoint(ir, pathId, segIdx, x, y)` | Drag line/path endpoint | To implement |

When adding a new UI edit action:
1. Add the mutation function to `irMutator.ts` first (pure `(IRDiagram, params) → boolean`)
2. Write an edit-step fixture that tests it
3. Then wire the UI event to call the function

### Fixture format

```
test/d3/
  fixtures/
    <name>.json       # test definition
  refs/
    <name>.svg        # expected SVG after all steps
```

Each `.json` fixture:
```json
{
  "description": "Dragging node A from (1,1) to (2,3)",
  "source": "\\begin{tikzpicture}\n\\node (A) at (1,1) {Hello};\n\\draw (A) -- (2,2);\n\\end{tikzpicture}",
  "steps": [
    { "action": "moveNode", "nodeId": "A", "to": { "x": 56.9056, "y": 85.3584 } }
  ]
}
```

- `source`: TikZ source to parse
- `steps`: array of IR mutation actions (coordinates in pt, matching IR units)
- Each step's `action` field maps 1:1 to an `irMutator.ts` function name

### Adding a new edit-step fixture

1. Write the `.json` fixture with source and mutation steps
2. Run the test to generate the reference SVG:
   ```bash
   npm run test:d3 -- --update-refs
   ```
3. Visually inspect the generated ref SVG
4. Commit both the fixture and ref

### Test runner logic (to be implemented in `test/d3/d3.test.ts`)

```typescript
import { parse, generateSVG } from '../../src/index'
import { moveNode, updateNodeLabel, updateCurveControl } from '../../src/generators/d3/irMutator'

const mutators = { moveNode, updateNodeLabel, updateCurveControl }

for (const fixture of fixtures) {
  test(fixture.description, () => {
    const ir = parse(fixture.source)
    for (const step of fixture.steps) {
      const fn = mutators[step.action]
      fn(ir, ...step.args)  // args mapped per action type
    }
    const svg = generateSVG(ir)
    expect(svg).toMatchSnapshot() // or compare against ref SVG
  })
}
```

---

## Step 4 — UI improvements

If no parity or interaction issues remain, improve the editor UI:

### Candidates (pick one per cycle)
- **Fixture browser**: show golden fixture names in a categorized list, not just a flat dropdown
- **Side-by-side compare**: show static SVG preview next to D3 editor canvas for parity debugging
- **Undo/redo**: track IR mutations and allow reverting
- **Snap to grid**: when dragging, optionally snap to TikZ unit grid
- **Keyboard shortcuts**: Delete to remove selected element, Escape to deselect, arrow keys to nudge
- **Zoom controls**: mouse wheel zoom, fit-to-view button actually works
- **Better lock indicator**: show why a node is not draggable (tooltip with coordinate type)

### Implementation guidelines
- Keep changes small — one UI improvement per cycle
- Don't break existing interactions
- Test on multiple fixture types after changes

---

## Step 5 — Commit

```bash
git add -A && git status
```

Only commit if there are meaningful changes:

```bash
git commit -m "fix(d3): ..." # or "feat(d3): ..."
```

---

## Guardrails

- At most ONE fix or feature per cycle (keep diffs reviewable)
- Always verify static SVG tests still pass: `npm test`
- Do NOT edit files in `/manuals/`
- Do NOT modify the SVG generator to accommodate D3 quirks — fix the D3 side instead
- The SVG generator is the source of truth for correct rendering; D3 must match it
- When adding edit-step fixtures, start simple (single node drag) before complex (multi-step edits)
- If a fix requires changes to shared code in `src/generators/core/`, verify both SVG and D3 paths

### SVG generator changes — strict rules

The SVG generator (`src/generators/svg/`) is shared by ALL consumers (static output, golden tests, D3 editor).
Changes there have wide blast radius and can break golden tests. Follow these rules:

- **Do NOT change SVG generator code unless the bug is genuinely in the generator** (e.g., wrong namespace on `createElement`, missing `data-ir-id` attribute that all consumers need). These are real generator bugs, not D3-specific accommodations.
- **Prefer fixing D3-side code first.** If the D3 editor misrenders something, the fix belongs in `src/generators/d3/` (renderer, interactions, highlight) or in `demo/` (Playground, options), not in the SVG generator.
- **Never change SVG output structure to make D3 interactivity easier.** The SVG generator produces correct SVG — the D3 layer adapts to whatever it produces.
- **If you must touch the SVG generator**, the change must be a **bug fix that improves all consumers**, not a D3-specific workaround. Examples of legitimate generator fixes:
  - `createElement()` → `createElementNS()` (namespace bug — affects live DOM consumers)
  - Adding missing `data-ir-id`/`data-ir-kind` attributes (spec compliance — all consumers benefit)
  - Fixing incorrect coordinate computation (rendering bug — all consumers benefit)
- **Always run `npm test` after any SVG generator change** — all 200+ golden tests must pass.
- **If unsure whether a change belongs in the generator or D3 layer, default to the D3 layer.**

---

## End of cycle

Report what was done:

- "Fixed parity: `<issue>` — `<root cause in 5 words>`"
- "Fixed interaction: `<behavior>` — `<what was wrong>`"
- "Added edit-step fixture `<name>`: `<what it tests>`"
- "UI improvement: `<what changed>`"
- "No issues found — all golden fixtures render identically in D3 editor"
