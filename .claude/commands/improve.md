Run one cycle of the continuous tikzjs improvement loop.

## Priority order

Each cycle must follow this strict priority:

1. **Fix a failing golden test** (highest priority)
2. **Fix a failing extra fixture** that exercises an important/unimplemented feature
3. **Add a new fixture** that exposes a gap — prefer ones that currently fail and require a fix
4. **Promote an easy extra fixture** only if nothing above applies

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

This gives a full picture of where tikzjs is weakest across all ~500 extra fixtures.

### Pick the most impactful failing extra fixture

From the failing fixtures across all batches, pick one that:
- Has a clear, identifiable root cause (not just unsupported library)
- Exercises a **feature gap** — something tikzjs should support but doesn't yet:
  - Named node edges not connecting properly
  - Missing path operations
  - Wrong coordinate resolution
  - Arrow tips not rendering
  - Node shapes (diamond, ellipse) missing
  - `right of=`, `below of=` positioning broken
  - Colors not propagating
  - Self-loops, bend angles wrong
  - etc.

**Skip** fixtures that fail because of fundamentally unsupported features (e.g. `\includegraphics`, shadings, `yscale=-1` auto-generated code, `decoration={markings}`).

For the chosen fixture, run the visual diff and then fix the root cause:
```bash
make cdiff-one-extra NAME=NNN BATCH=B   # use BATCH= (empty) for root fixtures
```
Then use `/fix-fixture extra/fixtures/BATCH/NNN` (or just the fixture path) to diagnose and implement the fix.

### After fixing — verify and promote

Once the code fix is in, re-run the diff and apply the full visual checklist:

```bash
make cdiff-one-extra NAME=NNN BATCH=B
```

Read both PNGs and check visually:
- [ ] **Node sizes**: circles/rectangles same size as ref?
- [ ] **Arrowhead sizes**: proportional, not too large/small?
- [ ] **Edge connections**: edges touch node borders correctly?
- [ ] **Double arrowheads**: stacked tips match?
- [ ] **Label positions**: correct positions (above/below/midway)?
- [ ] **Colors and fill**: correct?
- [ ] **Line styles**: dashed/dotted match?
- [ ] **Overall layout**: positions and spacing equivalent?

**If the fixture now passes both criteria** (diff ≤ 5%, or 5–8% with font-only gap, AND visual checklist passes):
→ **Promote it as a new golden fixture**:

```bash
# Copy the fixture (strip any %!preamble blocks first)
cp test/extra/fixtures/BATCH/NNN.tikz test/golden/fixtures/NN-<description>.tikz

# Generate the golden reference
npm run golden

# Run all tests to confirm
npm test
```

If it still fails visually or diff > 8%: commit the code fix alone (it still improves overall rendering), and note the remaining gap.

---

## Step 3 — If no fixable failing extra fixture exists: add a new fixture

### 3a. Scan extra fixtures for near-passes that reveal real gaps

Extra fixtures span the root batch (001–080) and numbered batches (0–4). Always check across all layers:

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
- [ ] **Double arrowheads**: stacked tips rendered correctly?
- [ ] **Label positions**: at correct positions (above/below/midway/near start)?
- [ ] **Colors and fill**: correct colors and opacity?
- [ ] **Line styles**: dashed/dotted patterns match?
- [ ] **Overall layout**: positions and spacing equivalent?

Decision:
- diff ≤ 5% AND all checklist items pass → promote it
- diff 5–8% AND only font rendering differs → promote it (font gap is acceptable)
- diff > 8% OR any checklist item fails → diagnose the root cause and fix it (don't just skip)
- Unsupported feature (clip, patterns, shadings, `yscale=-1`, `decoration={markings}`) → skip

### 3b. Fallback: write a focused fixture from scratch

Identify a gap in existing golden fixtures:

```bash
ls test/golden/fixtures/
```

Use `/tikz-ref <feature>` to look up correct syntax, then `/new-fixture <name>`.

---

## Step 4 — Commit

```bash
git add -A && git status
```

Only commit if there are meaningful changes:

```bash
git commit -m "fix: ..." # or "feat: ..."
```

---

## Guardrails

- Fix at most ONE failing test or feature per cycle (keep diffs reviewable).
- Add at most ONE new fixture per cycle.
- Do NOT refactor more than once every 5 cycles (check git log).
- Do NOT edit files in `/manuals/`.
- If `npm run golden` fails (no TeX Live), skip golden generation and note it.
- If a fix attempt fails after 3 tries, document why and move on.

---

## End of cycle

Report what was done:

- "Fixed fixture `X`: <root cause in 5 words>"
- "Fixed extra fixture `X`: implemented <feature>"
- "Added fixture `X`: <what it tests and why it was chosen>"
- "No fixable failures found, promoted easy fixture `X`"
- "No action: <reason>"
