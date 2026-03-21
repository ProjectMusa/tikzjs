Run one cycle of the continuous tikzjs improvement loop.

## Cycle logic

### Step 1 — Check current test status

```bash
npm test 2>&1 | tail -40
```

### Step 2 — Branch on result

#### If there are FAILING golden tests → fix one

1. Identify the first failing fixture name (e.g. `14-rounded-corners`).
2. Run `/fix-fixture <name>` to diagnose and fix it.
3. Verify with `npm test` before moving on.

#### If ALL tests pass → choose between: add fixture OR refactor

Use this heuristic:
- Count fixtures: `ls test/golden/fixtures/ | wc -l`
- Count cycles since last refactor: check recent git log for "refactor" commits
  ```bash
  git log --oneline -20
  ```
- **If fewer than 3 refactor commits in the last 20 commits AND there is structural debt** → run `/refactor`
- **Otherwise** → add a new fixture (see below)

### Step 3 — Adding a new fixture

#### 3a. First: check `test/extra` for a promotable fixture

`test/extra/fixtures/` contains 85 real-world TikZ examples. Prefer promoting one of these
over writing from scratch — they give more realistic coverage.

1. Scan a few extra fixtures and pick one that exercises a feature NOT already in `test/golden/fixtures/`:
   ```bash
   ls test/extra/fixtures/ | head -20
   cat test/extra/fixtures/NNN.tikz
   ```
   Skip fixtures that use `\includegraphics`, unsupported libraries, or are >30 lines (too complex).
   Good candidates: ones using `path` options, node shapes, arrows, coordinates, transforms, loops.

2. Run the visual diff on the candidate to see how well tikzjs handles it:
   ```bash
   make cdiff-one-extra NAME=NNN
   ```
   - If diff ≤ 5%: promote it — copy to `test/golden/fixtures/NN-<description>.tikz` and run `npm run golden`
   - If diff > 5% but the feature is important: note the gap and fall back to 3b (write from scratch)
   - If it uses unsupported features (clip, patterns, shadings): skip and try the next one

3. When promoting, strip any `%!preamble`/`%!end-preamble` block — golden fixtures must be bare `\begin{tikzpicture}...\end{tikzpicture}`.

#### 3b. Fallback: write a focused fixture from scratch

If no `test/extra` fixture is suitable:

1. **Identify a gap** — look at existing fixtures to find uncovered TikZ features:
   ```bash
   ls test/golden/fixtures/
   ```
   Common areas to expand: path options (`dashed`, `dotted`, `line cap`, `line join`),
   node shapes (`rectangle`, `circle`, `ellipse`, named anchors), coordinate systems
   (`polar`, `barycentric`, `intersection`), transformations (`rotate`, `scale`, `shift`),
   arrows (tip styles, `stealth`, `latex`, `to`), colors and opacity,
   `foreach` loops, matrix layouts.

2. **Look up the feature** using `/tikz-ref <feature>` before writing the fixture.
   This ensures the fixture uses correct TikZ syntax and exercises the right behavior.

3. **Write and register the fixture** using `/new-fixture <kebab-case-name>`.

### Step 4 — Commit if changes were made

```bash
git add -A
git status
```

Only commit if there are meaningful changes (new fixture + ref, or a code fix):
```bash
git commit -m "feat: <short description of what was added/fixed>"
```

## Guardrails

- Fix at most ONE failing test per cycle (to keep diffs reviewable).
- Add at most ONE new fixture per cycle.
- Do NOT refactor more than once every 5 cycles (check git log to enforce this).
- Do NOT edit files in `/manuals/`.
- If `npm run golden` fails (no TeX Live), skip the golden generation step and note it.
- If a fix attempt fails after 3 tries, skip that fixture and move to the next one.

## End of cycle

Report what was done in one sentence:
- "Fixed fixture `X`: <root cause in 5 words>"
- "Added fixture `X`: <what it tests>"
- "Ran refactor: <what changed>"
- "No action: all tests pass, refactor not needed yet"
