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
