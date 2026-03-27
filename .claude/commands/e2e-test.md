Run E2E interaction tests against a golden fixture and fix all issues found.

The argument `$ARGUMENTS` is either:
- A golden fixture name (e.g. `05-node-label`) — run all applicable interaction tests against it
- `all` — run all existing E2E fixtures
- Empty — auto-select the next untested golden fixture

## Goal

Verify that the D3 editor's UI interactions (drag, select, control-point drag) produce the **same IR** as calling `irMutator.ts` functions directly. When a test fails, diagnose the root cause and fix it.

The test contract:
```
Parse golden fixture → load in D3 editor → perform UI action → read IR
                     → apply programmatic mutation              → read IR
Both IRs must have matching coordinates (within ±1.5 pt tolerance)
```

---

## Architecture

```
test/e2e/
  fixtures/          ← E2E fixture JSON files (golden fixture + mutation + UI action pairs)
  e2e.spec.ts        ← Playwright test runner

demo/src/pages/Playground.tsx
  window.__tikzjs    ← Test hooks exposed to Playwright:
    .loadFixture(name)      → fetch golden .tikz, parse, enter editor mode
    .getIR()                → current IR from D3 editor controller
    .parseTikz(source)      → parse TikZ to IR in-browser
    .applyMutation(ir, action, args)  → call irMutator function

Key interaction code:
  src/generators/d3/interactions.ts  ← setupDrag(), setupControlPointDrag()
  src/generators/d3/irMutator.ts     ← moveNode(), updateCurveControl(), moveSegmentEndpoint()
  src/generators/d3/highlight.ts     ← control point handle rendering
  src/generators/d3/index.ts         ← createD3Editor() controller
```

### Coordinate conversion chain (for drag simulation)

```
deltaXPt (TikZ pt)
  → deltaXPx = deltaXPt × PT_TO_PX (SVG user units)     PT_TO_PX ≈ 1.8268
  → dxScreen = deltaXPx × ctm.a (screen pixels)          ctm from svg.getScreenCTM()
  → dyScreen = -deltaYPt × PT_TO_PX × ctm.d              y-axis inversion
```

d3-drag v3 uses `mousedown` on element, `mousemove`/`mouseup` on `event.view` (window).

### E2E fixture format

```json
{
  "description": "Human-readable test description",
  "goldenFixture": "05-node-label.tikz",
  "steps": [
    {
      "mutation": {
        "action": "moveNode",
        "target": { "kind": "node", "index": 0 },
        "args": { "deltaXPt": 28.4528, "deltaYPt": 28.4528 }
      },
      "uiAction": {
        "type": "drag",
        "target": { "kind": "node", "index": 0 },
        "deltaXPt": 28.4528,
        "deltaYPt": 28.4528
      }
    }
  ]
}
```

- `target.kind`: `"node"` or `"path"` — element type to find in IR
- `target.index`: Nth element of that kind (across all nesting levels, including inline nodes)
- `mutation.action`: `irMutator.ts` function name
- `uiAction.type`: `"drag"` (node drag), `"drag-cp"` (control point drag), future: `"drag-endpoint"` (segment)
- All coordinates in TikZ pt (1cm = 28.4528pt)

---

## Step 1 — Analyze the target golden fixture

If `$ARGUMENTS` is a fixture name:

```bash
cat test/golden/fixtures/$ARGUMENTS.tikz
```

Parse the fixture to understand its IR structure:

```bash
node -e "
const { preprocess } = require('./dist/preprocessor/index.js');
const { parseExpanded } = require('./dist/parser/index.js');
const fs = require('fs');
const src = fs.readFileSync('test/golden/fixtures/$ARGUMENTS.tikz', 'utf8');
const ir = parseExpanded(preprocess(src));
for (const el of ir.elements) {
  console.log(el.kind, el.id, el.kind === 'node' ? '(name: ' + el.name + ')' : '');
  if (el.kind === 'path') {
    console.log('  segments:', el.segments.map(s => s.kind).join(', '));
    if (el.inlineNodes.length > 0) {
      console.log('  inlineNodes:', el.inlineNodes.map(n => n.id + '(' + n.name + ')').join(', '));
    }
  }
}
"
```

Identify what interaction tests are applicable:

| IR element | Applicable test | Required |
|---|---|---|
| Node with `cs: 'xy'` | `moveNode` drag | Target: `{ kind: "node", index: N }` |
| Path with curve segments | `updateCurveControl` drag-cp | Target: `{ kind: "path", index: N }` |
| Path with line/move segments | `moveSegmentEndpoint` drag-endpoint | Target: `{ kind: "path", index: N }` |
| Node with `cs !== 'xy'` (polar, named) | NOT draggable | Skip — verify lock indicator only |
| Matrix / tikzcd | NOT editable | Skip entirely |

---

## Step 2 — Create or update E2E fixture

If no fixture exists for `$ARGUMENTS`, create one at `test/e2e/fixtures/<name>.json`.

### For node drag tests

Find draggable nodes (inline or standalone) with `position.coord.cs === 'xy'`:

```json
{
  "description": "Drag node <name> in <fixture>",
  "goldenFixture": "<fixture>.tikz",
  "steps": [
    {
      "mutation": {
        "action": "moveNode",
        "target": { "kind": "node", "index": 0 },
        "args": { "deltaXPt": 28.4528, "deltaYPt": 28.4528 }
      },
      "uiAction": {
        "type": "drag",
        "target": { "kind": "node", "index": 0 },
        "deltaXPt": 28.4528,
        "deltaYPt": 28.4528
      }
    }
  ]
}
```

Use `28.4528` (1cm) or `14.2264` (0.5cm) for delta values — large enough to detect but not so large the node goes off-screen.

### For control point drag tests (`drag-cp` type)

Target a path with curve segments. Specify `segIdx` (which segment in the path) and `cpRole` (cp1/cp2/to/move):

```json
{
  "description": "Drag cp1 of bezier curve",
  "goldenFixture": "12-bezier-multi.tikz",
  "steps": [
    {
      "mutation": {
        "action": "updateCurveControl",
        "target": { "kind": "path", "index": 0 },
        "args": { "segIdx": 1, "cpRole": "cp1", "deltaXPt": 14.2264, "deltaYPt": 14.2264 }
      },
      "uiAction": {
        "type": "drag-cp",
        "target": { "kind": "path", "index": 0 },
        "segIdx": 1,
        "cpRole": "cp1",
        "deltaXPt": 14.2264,
        "deltaYPt": 14.2264
      }
    }
  ]
}
```

The test clicks the path element to select it (triggering control point handles), finds the handle by `data-seg-idx` + `data-cp-role`, and drags it.

### For segment endpoint drag tests (future — `drag-endpoint` type)

When `uiAction.type === "drag-endpoint"` is implemented:
- Target a path element, specify `segIdx`
- The test clicks the path to select it, then drags the endpoint handle
- Mutation uses `moveSegmentEndpoint`

---

## Step 3 — Run the E2E test

```bash
npx playwright test --reporter=line -g "$ARGUMENTS"
```

If running all:
```bash
npx playwright test --reporter=line
```

### If tests pass → done

Report: "All E2E tests pass for `$ARGUMENTS`."

### If tests fail → diagnose

Read the error output carefully. Common failure modes:

| Error | Root cause | Fix location |
|---|---|---|
| `Node index N out of range` | Fixture target index doesn't match IR structure | Fix fixture JSON — re-analyze IR |
| `Node X not draggable` | Node has `cs !== 'xy'` (polar, named coords) | Fix fixture — pick a different node or skip |
| `Element has no bounding box` | SVG element exists but has zero dimensions | Check SVG generator — missing geometry |
| `expect(dx).toBeLessThan(1.5)` with dx ≈ deltaXPt | Drag didn't register at all | Check d3-drag setup — event dispatch issue |
| `expect(dx).toBeLessThan(1.5)` with small dx | Coordinate transform is off | Check `interactions.ts` px↔pt conversion, y-axis |
| `Element not found after drag` | Re-render lost the element ID | Check `irMutator.ts` — mutation corrupts IR |
| `No IR after drag` | `window.__tikzjs.getIR()` returns null | Check `Playground.tsx` — editor ref broken |
| `Failed to fetch fixture` | Golden fixture doesn't exist or Vite not serving | Check `demo/vite.config.ts` serveFixtures plugin |

---

## Step 4 — Fix the issue

### Fixture-level fix (wrong target/args)

If the fixture JSON is wrong (bad index, wrong kind, non-draggable node), fix the fixture:
1. Re-analyze the IR structure (Step 1)
2. Update the fixture JSON with correct target
3. Re-run the test

### Interaction-level fix (drag doesn't work)

If the drag dispatches correctly but the IR doesn't update:

1. Check `setupDrag()` in `interactions.ts`:
   - Does it find the element? (`findNode(diagram, irId)` must work for inline nodes)
   - Does `isDraggable(node)` return true?
   - Is `moveNode()` called with correct coordinates?

2. Check `moveNode()` in `irMutator.ts`:
   - Does it find the node? (inline nodes require searching path.inlineNodes)
   - Does it update both `node.position.coord` AND the path move segment (for inline nodes)?

3. Check coordinate conversion in `interactions.ts`:
   - `pxToPt(dxPx)` for x delta
   - `-pxToPt(dyPx)` for y delta (y-axis inversion)
   - d3-drag container must be the zoom group for correct coordinate space

### Rendering-level fix (element not visible / no bounding box)

1. Check the SVG generator emits `data-ir-id` and `data-ir-kind` for the element kind
2. Check the renderer adds `d3-draggable` class: `buildElementMap()` in `renderer.ts`
3. Check SVG namespace: elements must use `createElementNS(SVG_NS, ...)` not `createElement()`

### Round-trip fix (IR correct after drag but wrong after re-render)

If the IR is correct immediately after drag but gets corrupted during re-render:
1. Check `handleDiagramChange()` in `Playground.tsx` — it generates TikZ and re-parses
2. This is a TikZ generator bug. Check `elementEmitter.ts` for the relevant element kind
3. Run the round-trip test: `npm run test:d3 -- -t "roundtrip.*$ARGUMENTS"`

### Test infra fix (hooks/events broken)

1. Check `window.__tikzjs` is exposed: the `useEffect` in Playground.tsx depends on `[diagram]`
2. Check `editorPanelRef.current?.controller` returns a D3EditorController
3. Check that `loadFixture()` actually enters editor mode and renders SVG
4. Check mousedown/mousemove/mouseup event dispatch — d3-drag v3 uses mouse events, NOT pointer events

---

## Step 5 — Add missing interaction types (if needed)

If the fixture requires a UI action type not yet supported in `e2e.spec.ts`:

### Currently supported types

- `drag` — node drag via `moveNode`
- `drag-cp` — control point drag via `updateCurveControl` (clicks path to select, then drags handle)

### Adding `drag-endpoint` (segment endpoint drag — not yet implemented)

Similar pattern to `drag-cp` but targets path segment endpoints, uses `moveSegmentEndpoint`.
Would need: click path to select → find endpoint handle → drag it.

---

## Step 6 — Verify all tests pass

```bash
npx playwright test --reporter=line
npm test  # Ensure Jest tests still pass
```

---

## Step 7 — Commit

Only commit if there are meaningful changes:

```bash
git add test/e2e/ src/ demo/ && git status
git commit -m "test(e2e): ..." # or "fix(d3): ..."
```

---

## Guardrails

- Keep `irMutator.ts` functions **pure** — no DOM, no `document`, no `SVGElement`
- The E2E test dispatches mouse events, NOT pointer events (d3-drag v3 requirement)
- Coordinate tolerance is 1.5pt — if a test consistently fails at ~1pt, investigate rounding
- Do NOT modify SVG generator to fix D3 editor bugs — fix the D3 side
- Do NOT change `irMutator.ts` function signatures without updating all callers AND fixtures
- Always run `npm test` after any code changes to verify golden tests
- Do NOT edit files in `/manuals/`
- The `window.__tikzjs` hooks are for testing only — keep them minimal

---

## End of cycle

Report what was done:

- "E2E test created for `<fixture>`: `<what interactions tested>`"
- "E2E test passed for `<fixture>`: all interactions verified"
- "Fixed E2E failure: `<fixture>` × `<action>` — `<root cause>` → `<fix location>`"
- "Added interaction type `<type>` to E2E runner: `<what it tests>`"
- "No applicable interactions for `<fixture>` — `<reason>` (skipped)"
