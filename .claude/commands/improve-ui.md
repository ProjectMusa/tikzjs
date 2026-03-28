Run one cycle of the D3 editor UI improvement loop — verify and fix event-to-mutation mappings, add missing UI actions, and improve editor UX.

## Goal

The D3 editor UI is a thin mapping layer: DOM events → `irMutator.ts` functions → re-render.
This skill ensures that mapping is correct, complete, and produces the right visual results.

The rendering correctness itself is handled by `/improve-d3`. This skill focuses on the **interaction layer**: does the right thing happen when the user clicks, drags, or edits?

---

## Architecture

```
DOM event (D3)                    irMutator function              Re-render
─────────────────────────────────────────────────────────────────────────────
drag node             →  moveNode(ir, id, x, y)              →  full re-render
drag control point    →  updateCurveControl(ir, ...)          →  full re-render
drag line endpoint    →  moveSegmentEndpoint(ir, ...)         →  full re-render
click element         →  (selection only, no IR change)       →  highlight overlay
click background      →  (deselection)                       →  clear overlay
double-click node     →  updateNodeLabel(ir, id, label)      →  full re-render
delete key            →  removeElement(ir, id)                →  full re-render
change style (future) →  setStyleProp(ir, id, key, value)    →  full re-render
```

Key files:
- **`interactions.ts`** — `setupDrag()`, `setupSelection()`, `setupControlPointDrag()` — the event→mutation wiring
- **`irMutator.ts`** — the pure mutation functions (the contract)
- **`highlight.ts`** — visual feedback for selection (overlays, control point handles)
- **`index.ts`** — `createD3Editor()` — orchestrates render + interactions, click zones
- **`D3EditorPanel.tsx`** — React wrapper, passes options and callbacks
- **`Playground.tsx`** — demo app page, owns state and round-trip (IR→TikZ source→re-parse)

---

## Verification: always use `/e2e-test`

After **every** code change in this skill, verify correctness by running E2E tests:

```bash
npx playwright test --reporter=line          # all E2E tests
npx playwright test --reporter=line -g "NAME" # specific fixture
npm test                                      # Jest golden + unit tests
```

Or use the `/e2e-test` skill:
- `/e2e-test all` — run all E2E fixtures and fix failures
- `/e2e-test <fixture-name>` — run tests for a specific golden fixture

The E2E tests verify that UI interactions (drag, control-point drag, label edit) produce the **same IR** as calling `irMutator` functions directly. If you add a new UI action, create a corresponding E2E fixture in `test/e2e/fixtures/` and run `/e2e-test` to verify it.

**Do not proceed to the next step or commit without passing E2E + Jest tests.**

---

## Priority order

1. **Fix a broken event→mutation mapping** — an existing UI action produces wrong IR changes
2. **Fix coordinate transform bugs** — px↔pt conversion, y-axis inversion, viewBox scaling
3. **Fix the round-trip** — IR mutation → TikZ source generation → re-parse produces different IR
4. **Add a missing UI action** — wire a new event to an existing or new irMutator function
5. **Improve UX** — visual feedback, cursors, keyboard shortcuts, undo/redo

---

## Step 1 — Audit existing event→mutation mappings

### Node drag (`setupDrag` in `interactions.ts`)

Verify for several golden fixtures:
- [ ] Drag delta correctly converts from SVG px to TikZ pt via `pxToPt()`
- [ ] Y-axis inversion is applied (SVG y increases downward, TikZ y increases upward)
- [ ] `moveNode()` is called with correct pt coordinates
- [ ] Visual feedback during drag matches final position after re-render
- [ ] Non-draggable nodes (cs !== 'xy') are not draggable and show lock cursor
- [ ] After drag-end, the `onIRChange` callback fires and triggers full re-render
- [ ] Edges connected to the dragged node reconnect correctly after re-render

### Control point drag (`setupControlPointDrag` in `interactions.ts`)

- [ ] Handle dot moves with cursor during drag
- [ ] Handle line updates endpoint during drag
- [ ] `updateCurveControl()` is called with correct pt coordinates on drag-end
- [ ] The correct `cpRole` ('cp1', 'cp2', 'to') is passed
- [ ] After drag-end, curve re-renders with updated control points
- [ ] Click on handle doesn't propagate to SVG background (no deselection)

### Selection (`setupSelection` in `interactions.ts`)

- [ ] Click on element calls `controller.highlightElement(id)` and `onSelect(id)`
- [ ] Click on background calls `highlightElement(null)` and `onSelect(null)`
- [ ] Click doesn't propagate from element to background
- [ ] Selected element shows correct overlay (from `highlight.ts`)

### Round-trip (`handleDiagramChange` in `Playground.tsx`)

- [ ] After IR mutation, `generateTikZSource()` produces valid TikZ
- [ ] The generated TikZ re-parses to equivalent IR (coordinates preserved)
- [ ] Source code in the editor panel updates to match the mutation
- [ ] SVG preview updates to match the mutated IR

### If a mapping bug is found → fix it

1. Write a test in `test/d3/` that captures the bug
2. Fix the bug in `interactions.ts` or `irMutator.ts`
3. Run `/e2e-test all` to verify all E2E interaction tests still pass
4. Run `npm test` to verify golden tests still pass

---

## Step 2 — Fix coordinate transform bugs

Common coordinate bugs:

| Bug | Symptom | Fix location |
|---|---|---|
| Double y-inversion | Node jumps to mirror position | `setupDrag` — check negation of `dyPt` |
| ViewBox scaling | Drag distance doesn't match cursor | `setupDrag` — D3 event coords may need viewBox scaling |
| PT_TO_PX mismatch | Small offset after drag | `pxToPt()`/`ptToPx()` in `coordResolver.ts` |
| Transform regex failure | Node snaps to (0,0) on drag | `setupDrag` — `transform.replace()` regex doesn't match |

After fixing, run `/e2e-test all` to verify.

---

## Step 3 — Fix the round-trip

The full round-trip is: **IR mutation → generateTikZ() → parse() → IR**

This can break if:
- `generateTikZ()` loses precision on coordinates (pt→cm conversion rounding)
- `generateTikZ()` emits syntax the parser doesn't handle
- Style options are lost during TikZ emission

After fixing, run `/e2e-test all` to verify.

---

## Step 4 — Add a missing UI action

When all existing mappings are correct, add a new one. Follow this order:

### 4a. Check if `irMutator.ts` has the function

If yes → wire the UI event in `interactions.ts`.
If no → implement the mutation function first, write a test fixture, then wire the UI.

### 4b. Candidates for new UI actions

| Action | irMutator function | UI trigger | Status |
|---|---|---|---|
| Edit label | `updateNodeLabel(ir, id, text)` | Double-click node → inline text input | **Implemented + E2E tested** |
| Delete element | `removeElement(ir, id)` | Delete/Backspace key on selected element | Mutation ready, UI not wired |
| Drag line endpoint | `moveSegmentEndpoint(ir, pathId, segIdx, x, y)` | Drag endpoint handle on lines | Mutation ready, UI not wired |
| Nudge node | `moveNode(ir, id, x±δ, y±δ)` | Arrow keys on selected node | Mutation ready, UI not wired |
| Change style | `setStyleProp(ir, id, key, value)` | Inspector panel property edit | Mutation ready, UI not wired |
| Add node | `addNode(ir, pos, label)` | Double-click on empty canvas | To implement |
| Edit edge label | `updateEdgeLabel(ir, edgeId, idx, text)` | Double-click edge label | To implement |

### 4c. Implementation pattern

1. Add/verify the mutation function in `irMutator.ts`
2. Add an edit-step fixture in `test/d3/fixtures/`
3. Wire the DOM event in `interactions.ts`
4. Add visual feedback if needed (in `highlight.ts` or CSS in `injectStyles()`)
5. Create an E2E fixture in `test/e2e/fixtures/` and run `/e2e-test` to verify

---

## Step 5 — UX improvements

If all mappings are correct and no new actions are needed, improve the interaction UX:

### Candidates (pick one per cycle)
- **Drag preview opacity** — currently 0.8, consider a ghost outline instead
- **Snap to grid** — hold Shift during drag to snap to nearest TikZ unit
- **Multi-select** — Shift+click to select multiple elements, drag moves all
- **Undo/redo stack** — store IR snapshots, Ctrl+Z/Ctrl+Y to navigate
- **Keyboard shortcuts** — Escape=deselect, Tab=cycle selection, Ctrl+A=select all
- **Better cursor feedback** — different cursors for different element types
- **Drag constraints** — hold Shift to constrain to horizontal/vertical axis
- **Touch support** — map touch events to the same mutation functions

After implementing, run `/e2e-test all` + `npm test` to verify nothing broke.

---

## Step 6 — Commit

```bash
git add -A && git status
```

Only commit if there are meaningful changes and all tests pass:

```bash
git commit -m "fix(d3): ..." # or "feat(d3): ..."
```

---

## Guardrails

- At most ONE fix or new action per cycle
- Always run `/e2e-test all` + `npm test` after every code change
- Do NOT modify `irMutator.ts` function signatures without updating all callers
- Do NOT add DOM-dependent logic to `irMutator.ts` — it must stay pure (no `document`, no `SVGElement`)
- Do NOT add new event wiring without a corresponding `irMutator.ts` function
- Keep `interactions.ts` thin — compute the mutation parameters, call the irMutator function, trigger re-render
- The coordinate transform (px↔pt, y-axis inversion) happens in `interactions.ts`, NOT in `irMutator.ts`
- Do NOT edit files in `/manuals/`

---

## End of cycle

Report what was done:

- "Fixed mapping: `<event>` → `<mutation>` — `<what was wrong>`"
- "Fixed coordinate transform: `<symptom>` — `<root cause>`"
- "Fixed round-trip: `<what broke>` — `<where fixed>`"
- "Added UI action: `<action>` via `<irMutator function>` — `<how triggered>`"
- "UX improvement: `<what changed>`"
- "All mappings verified — no issues found"
