Run one cycle of the continuous tikzjs SVG rendering improvement loop.

## Library roadmap

tikzjs aims for full support of these libraries. When choosing what to fix or implement, **prefer work that advances these targets**:

### Tier 1 — Full support (deepen what exists)
| Library | Status | Key gaps |
|---|---|---|
| **tikzcd** | ✅ Core works | Arrow styles (`Rightarrow`, `hookrightarrow`, `dashrightarrow`), `phantom`, `description`, crossing over, `shift left/right`, label auto-placement, row/column-specific sep |
| **knots** | ⚠️ Basic | Higher-level strand ops (arc, cycle), `end tolerance`, crossing auto-detection from overlapping strands, `draft mode`, `ignore endpoint` |
| **calc** | ✅ Core works | Perpendicular intersection `(A |- B)` / `(A -| B)`, projection `!(axis)`, `let \p1 = ... in` |

### Tier 2 — Add support (commonly used, not yet implemented)
| Library | What to implement |
|---|---|
| **decorations.pathreplacing** | `brace`, `show path construction`, `calligraphic brace` — parse `decorate` option + decoration spec, emit SVG path replacement |
| **decorations.pathmorphing** | `snake`, `zigzag`, `coil`, `bumps`, `random steps` — path morphing applied post-segment |
| **decorations.markings** | `mark=at position ... with { ... }` — place nodes/arrows at parametric positions along a path |
| **fit** | `\node[fit=(a)(b)(c)]` — compute bounding box of named nodes, size the fit node to enclose them |
| **backgrounds** | `on background layer`, `show background rectangle` — render scoped content behind main layer |
| **automata** | `state`, `accepting`, `initial` node styles + `initial text`, `accepting by arrow` |
| **shapes.geometric** | `regular polygon`, `star`, `trapezium`, `semicircle`, `cylinder`, `isosceles triangle`, `kite`, `dart` |
| **shapes.misc** | `cross out`, `strike out`, `rounded rectangle` |

### Tier 3 — 3D projection
| Library | What to implement |
|---|---|
| **tikz-3d** | Custom z-vector (`z={(-.5,-.3)}`), `canvas is xy plane at z=`, perspective projection, 3D rotations, `\tdplotsetmaincoords` |

### Out of scope (skip these)
`pgfplots`, `spy`, `external`, `\includegraphics`, raw TeX macro programming (`\pgfmathsetmacro` beyond basic expressions), `tikzpeople`, `circuitikz`.

---

## Priority order

Each cycle must follow this strict priority:

1. **Fix a failing golden test** (highest priority)
2. **Fix a failing extra fixture** — including implementing the missing feature if needed
3. **Proactively implement a roadmap feature** — pick the highest-tier gap, write a fixture, implement, promote
4. **Add a new fixture** that exposes a gap — prefer ones that currently fail and require a fix
5. **Promote an easy extra fixture** only if nothing above applies

Never cherry-pick easy passes just to boost fixture count. The goal is to improve rendering quality, not fixture quantity.

---

## Step 1 — Check current test status

```bash
npm test 2>&1 | tail -40
```

### If there are FAILING golden tests → fix one

1. Identify the first failing fixture name.
2. Run `/fix-fixture <name>` to diagnose and fix it.
3. Verify with `npm test` before moving on.

---

## Step 2 — If all tests pass: scan ALL extra fixtures for failures or feature gaps

The extra fixture library has two layers:
- **Root batch** (`test/extra/fixtures/001-080.tikz`) — use `make cdiff-extra BATCH=`
- **Numbered batches** (`test/extra/fixtures/0/` through `test/extra/fixtures/4/`) — use `make cdiff-extra BATCH=N`

Scan all of them to find fixtures that are **failing or have high structural diff**:

```bash
# Root fixtures (001–080)
make cdiff-extra BATCH= 2>&1 | grep -E "FAIL|diff=[1-9][0-9]" | head -10

# Numbered batches
for BATCH in 0 1 2 3 4; do
  echo "=== BATCH $BATCH ===" && \
  make cdiff-extra BATCH=$BATCH 2>&1 | grep -E "FAIL|diff=[1-9][0-9]" | head -10
done
```

### Classify the failure

For each candidate fixture, **classify the root cause** before deciding to skip or fix:

| Category | Examples | Action |
|---|---|---|
| **Missing path operation** | `plot`, `parabola`, `sin/cos`, `grid`, `svg` op | Implement via `/add-path-op` |
| **Missing style option** | `text width`, `anchor`, `align`, `shadow`, `pattern` | Implement via `/add-option` |
| **Missing node shape** | `trapezium`, `star`, `regular polygon`, `cylinder` | Add shape — see "Implementing a node shape" below |
| **Missing coordinate form** | barycentric, perpendicular intersection `(\| )`, tangent | Add to grammar + `coordResolver.ts` |
| **Missing preprocessor feature** | `\tikzset` key handler, `\pgfmathparse`, `let` op | Add to preprocessor or grammar |
| **Missing arrow tip** | `Stealth`, `Latex`, `Bar`, `Hooks`, custom tips | Add to `MarkerRegistry` |
| **Missing decoration** | `snake`, `brace`, `zigzag`, `markings` | Implement decoration support (see below) |
| **Missing library feature** | `fit`, `backgrounds`, `automata` styles, tikzcd arrow styles | Implement the library feature (see roadmap) |
| **Rendering bug** | wrong anchor, wrong clipping, wrong bend | Debug and fix in generator |
| **Truly out-of-scope** | `\includegraphics`, `pgfplots`, `spy`, `circuitikz`, raw TeX macros | **Skip** |

**Only skip fixtures in the "truly out-of-scope" category.** Everything else is fair game.

### Pick the most impactful failing fixture

From the failing fixtures across all batches, pick one that:
- Advances a **Tier 1 or Tier 2 roadmap library** (strongly preferred)
- Has a clear, identifiable root cause from the classification above
- Exercises a feature that would fix multiple other fixtures too (prefer high-leverage fixes)

For the chosen fixture, run the visual diff:
```bash
make cdiff-one-extra NAME=NNN BATCH=B   # use BATCH= (empty) for root fixtures
```

Read both PNGs to understand what's missing, then proceed to **Step 2a**.

---

### Step 2a — Implement the missing feature

This is the core of the improvement loop. Based on the classification:

#### Missing path operation → use `/add-path-op`

1. Run `/tikz-ref <operation>` to understand the TikZ semantics
2. Run `/add-path-op <operation>` to implement end-to-end (grammar → buildSegments → resolvePending → IR type → emitter)
3. After implementation, re-run the fixture diff to verify

#### Missing style option → use `/add-option`

1. Run `/tikz-ref <option>` to understand syntax and defaults
2. Run `/add-option <option>` to implement end-to-end (IR type → optionParser → emitter)
3. After implementation, re-run the fixture diff to verify

#### Missing node shape

1. Run `/tikz-ref <shape>` to understand anchors, geometry, and parameters
2. Read an existing shape implementation in `src/generators/svg/nodeEmitter.ts` to understand the pattern
3. Add the shape to `nodeEmitter.ts`:
   - Shape path rendering (SVG `<path>` or `<polygon>`)
   - Anchor computation (at minimum: center, north, south, east, west, and the 4 corners)
   - Shape-specific parameters (e.g., `regular polygon sides`, `star points`) — add to `ResolvedStyle` in `src/ir/types.ts` and parse in `optionParser.ts`
4. Test with the fixture

#### Missing coordinate form

1. Run `/tikz-ref <coordinate type>` to understand the syntax
2. Add a grammar rule in `_tikzjs.pegjs` for parsing the coordinate form
3. Add resolution logic in `src/generators/svg/coordResolver.ts`
4. Run `npm run gen && npm run build && npm test`

#### Missing preprocessor feature

1. Run `/tikz-ref <feature>` to understand the TeX semantics
2. Identify where in the preprocessor pipeline to add it (`src/preprocessor/`)
3. Implement the transformation
4. Test with the fixture

#### Missing arrow tip

1. Run `/tikz-ref <tip name>` to understand the geometry
2. Add the tip to `src/generators/svg/markerRegistry.ts` (use `ensureMarker()` pattern)
3. Map the TikZ tip name to the SVG marker definition
4. Test with the fixture

#### Missing decoration

Decorations are a major feature area. Approach incrementally:

1. Run `/tikz-ref <decoration name>` to understand semantics
2. **If decoration infrastructure doesn't exist yet:**
   - Add `decorate` option parsing in `optionParser.ts` (boolean flag + decoration spec)
   - Add `decoration` field to `ResolvedStyle` in `src/ir/types.ts` (name, amplitude, segment length, etc.)
   - Create `src/generators/svg/decorationEmitter.ts` for path replacement/morphing
   - Wire it into the path rendering pipeline in `pathEmitter.ts` (after segments are resolved, before SVG emission)
3. **If infrastructure exists, add the specific decoration:**
   - Add the decoration name to the dispatch in `decorationEmitter.ts`
   - Implement the path transformation (e.g., `snake` → sinusoidal wave along path, `brace` → curly brace shape)
   - Handle decoration-specific options (`amplitude`, `segment length`, `mirror`, etc.)
4. Test with the fixture

#### Missing library feature (fit, backgrounds, automata, etc.)

These require understanding the library's TeX implementation. Follow this pattern:

1. Run `/tikz-ref <library feature>` to understand semantics
2. **Determine the implementation layer:**
   - Pure style aliases (e.g., automata `state` = `circle, draw, minimum size=...`) → add to a style preset in `optionParser.ts` or `styleResolver.ts`
   - Node computation (e.g., `fit`) → add logic in `nodeEmitter.ts` that reads referenced nodes from `NodeGeometryRegistry`
   - Layering (e.g., `backgrounds`) → add SVG group ordering in `src/generators/svg/index.ts`
   - Special syntax (e.g., tikzcd `phantom`) → grammar or preprocessor change
3. Implement minimally — get the fixture working, don't over-engineer
4. Test with the fixture

#### tikzcd enhancement

tikzcd is already well-supported. Common gaps and where to fix them:

| Gap | Where to fix |
|---|---|
| Arrow styles (`Rightarrow`, `hookrightarrow`, etc.) | `src/preprocessor/tikzcdPreprocessor.ts` (arrow parsing) + `markerRegistry.ts` (tip shapes) |
| `phantom` nodes | `tikzcdPreprocessor.ts` (cell parsing) — set node to invisible |
| `description` (label style) | `tikzcdPreprocessor.ts` → pass style to cell node |
| `crossing over` | `tikzcdPreprocessor.ts` → add white background stroke under the arrow |
| `shift left/right` | `tikzcdPreprocessor.ts` (arrow option) → offset arrow path perpendicular to direction |
| Row/column-specific sep | `tikzcdPreprocessor.ts` (option parsing) → pass to `IRMatrix` |

#### knot enhancement

| Gap | Where to fix |
|---|---|
| Arc/cycle strand ops | `knotPreprocessor.ts` (path parsing) — decompose arcs to Bézier |
| Crossing auto-detection | `knotEmitter.ts` — compute strand intersections from Bézier segments |
| `end tolerance` | `knotEmitter.ts` — snap nearby endpoints together |
| Strand colors/styles | `knotPreprocessor.ts` → `knotEmitter.ts` — propagate per-strand styles |

#### Rendering bug (no new feature needed)

1. Run `/fix-fixture` on the extra fixture to diagnose
2. Fix the bug in the relevant generator/parser code
3. Verify the fix doesn't break other fixtures

### Step 2b — Implementation guidelines

When implementing a new feature:

- **Look up the manual first.** Run `/tikz-ref <feature>` before writing any code. Understand what TikZ actually does — don't guess.
- **Check existing code for patterns.** Before implementing a new shape/op/option, read how a similar existing one works and follow the same pattern.
- **Run `npm run gen` after grammar edits.** This is critical and easy to forget.
- **Test incrementally.** After each pipeline stage change, run `npm run build` to catch type errors early.
- **Keep IR clean.** New IR types go in `src/ir/types.ts`. Use factory functions from `src/parser/factory.ts`. Keep everything JSON-serializable.
- **Coordinate units.** IR stores pt. SVG conversion happens in `coordResolver.ts` only.
- **For library features:** Start with the minimal viable implementation that makes the fixture pass. Library features can be deepened in subsequent cycles.

### Step 2c — Verify and promote

Once the code fix is in, re-run the diff and apply the full visual checklist:

```bash
make cdiff-one-extra NAME=NNN BATCH=B
```

Read both PNGs and check visually:
- [ ] **Node sizes**: circles/rectangles same size as ref?
- [ ] **Arrowhead sizes**: proportional, not too large/small?
- [ ] **Edge connections**: edges touch node borders correctly?
- [ ] **Orthogonal paths**: `-|`/`|-` paths clip to node borders and form correct L-shaped connectors?
- [ ] **Double arrowheads**: stacked tips match?
- [ ] **Label positions**: correct positions (above/below/midway)? Inline nodes on `-|`/`|-` at corner point?
- [ ] **Self-loops**: `loop above/below/left/right` correct size (narrow teardrop, not oversized)?
- [ ] **Colors and fill**: correct?
- [ ] **Line styles**: dashed/dotted match?
- [ ] **Rounded corners**: nodes with `rounded corners` render as rounded rectangles?
- [ ] **Overall layout**: positions and spacing equivalent?

**If the fixture now passes** (diff ≤ 5%, or 5–8% with font-only gap, AND visual checklist passes):
→ **Promote it as a new golden fixture**:

```bash
# Copy the fixture (strip any %!preamble blocks first)
cp test/extra/fixtures/BATCH/NNN.tikz test/golden/fixtures/NN-<description>.tikz

# Generate the golden reference
npm run golden

# Run all tests to confirm
npm test
```

**Also check if the fix improved other extra fixtures:**
```bash
make cdiff-extra BATCH=B 2>&1 | grep -E "PASS|diff=[0-5]\." | head -20
```
Promote any newly-passing fixtures too (up to 3 promotions per cycle).

If it still fails visually or diff > 8%: commit the code fix alone (it still improves overall rendering), and note the remaining gap.

---

## Step 3 — Proactively implement a roadmap feature

If no extra fixtures are failing with a fixable root cause, **proactively advance the roadmap** instead of just adding easy fixtures:

1. Check the roadmap table above. Pick the highest-tier library with gaps.
2. Write a focused fixture that exercises the gap (use `/tikz-ref` + `/new-fixture`).
3. Implement the feature to make the fixture pass.
4. Generate golden ref and run tests.

This step ensures tikzjs keeps improving even when extra fixtures are clean.

---

## Step 4 — If no roadmap work applies: add a new fixture

### 4a. Scan extra fixtures for near-passes that reveal real gaps

```bash
# Root fixtures
make cdiff-extra BATCH= 2>&1 | grep -E "diff=[1-4]\." | head -10

# Numbered batches
for BATCH in 0 1 2 3 4; do
  make cdiff-extra BATCH=$BATCH 2>&1 | grep -E "diff=[1-4]\." | head -10
done
```

For a specific candidate:
```bash
make cdiff-one-extra NAME=NNN BATCH=B   # BATCH= (empty) for root
```

Read both PNGs and apply the **visual checklist** (be strict — reject if any fail):

- [ ] **Node sizes**: circles/rectangles same size as ref?
- [ ] **Arrowhead sizes**: proportional, not too large/small?
- [ ] **Edge connections**: edges touch node borders (not overshooting/falling short)?
- [ ] **Orthogonal paths**: `-|`/`|-` paths clip to node borders and form correct L-shaped connectors?
- [ ] **Double arrowheads**: stacked tips rendered correctly?
- [ ] **Label positions**: at correct positions (above/below/midway/near start)? Inline nodes on `-|`/`|-` at corner?
- [ ] **Self-loops**: `loop above/below/left/right` correct size (narrow teardrop)?
- [ ] **Colors and fill**: correct colors and opacity?
- [ ] **Line styles**: dashed/dotted patterns match?
- [ ] **Rounded corners**: nodes with `rounded corners` render as rounded rectangles?
- [ ] **Overall layout**: positions and spacing equivalent?

Decision:
- diff ≤ 5% AND all checklist items pass → promote it
- diff 5–8% AND only font rendering differs → promote it (font gap is acceptable)
- diff > 8% OR any checklist item fails → diagnose the root cause and fix it (go back to Step 2a)
- Truly out-of-scope → skip

### 4b. Fallback: write a focused fixture from scratch

Identify a gap in existing golden fixtures:

```bash
ls test/golden/fixtures/
```

Use `/tikz-ref <feature>` to look up correct syntax, then `/new-fixture <name>`.

---

## Step 5 — Commit

```bash
git add -A && git status
```

Only commit if there are meaningful changes:

```bash
git commit -m "fix: ..." # or "feat: ..."
```

---

## Guardrails

- Implement at most ONE new feature per cycle (keep diffs reviewable). A "feature" is one path op, one shape, one option, one decoration, one library capability, etc.
- Promoting multiple fixtures that benefit from the same fix is fine (up to 3).
- Add at most ONE new fixture from scratch per cycle.
- Do NOT refactor more than once every 5 cycles (check git log).
- Do NOT edit files in `/manuals/`.
- If `npm run golden` fails (no TeX Live), skip golden generation and note it.
- If a feature implementation stalls after 3 attempts at the same sub-problem, commit whatever partial progress you have and document the remaining gap.
- When implementing a new feature, always verify existing golden tests still pass before committing.
- For library features that span multiple files, build and test after each file change — don't batch all changes and hope they compile.

---

## End of cycle

Report what was done:

- "Implemented `<feature>` (new path op / shape / option / arrow tip / decoration / library): <what it does>"
- "Fixed fixture `X`: <root cause in 5 words>"
- "Fixed extra fixture `X`: implemented <feature>, promoted to golden"
- "Added fixture `X`: <what it tests and why it was chosen>"
- "Roadmap progress: implemented `<library>` `<feature>` — <what works now>"
- "No fixable failures found, promoted easy fixture `X`"
- "Partial progress on `<feature>`: <what works, what remains>"
- "No action: <reason>"
