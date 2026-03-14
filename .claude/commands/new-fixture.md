Create a new golden test fixture for `$ARGUMENTS`.

## Steps

1. **Choose the next fixture number** — check `test/golden/fixtures/` for the highest `NN-` prefix, use `NN+1`.

2. **Write the fixture** — create `test/golden/fixtures/NN-$ARGUMENTS.tikz`:
   - Content: bare `\begin{tikzpicture}...\end{tikzpicture}` (no `\documentclass`)
   - Keep it focused: one feature per fixture
   - Follow existing naming: `NN-kebab-case-description.tikz`

3. **Generate the golden reference** (requires TeX Live):
   ```bash
   npm run golden
   ```
   This runs `scripts/generateGolden.sh` → pdflatex + dvisvgm → writes `test/golden/refs/NN-$ARGUMENTS.svg`.

4. **Verify tikzjs renders it** — the golden test is structural only (element count), so also do a visual check:
   ```bash
   make cdiff-one NAME=NN-$ARGUMENTS
   ```

5. **Run the full test suite**:
   ```bash
   npm test
   ```

## Fixture format

```latex
\begin{tikzpicture}
  % your content here
\end{tikzpicture}
```

## What makes a good fixture
- Exercises one specific feature (one shape, one option, one path op)
- Has a clear visual assertion (something that would look obviously wrong if broken)
- Uses `draw` or `fill` so the output has visible content
- Fits in <10 lines

Now create the fixture for `$ARGUMENTS`.
