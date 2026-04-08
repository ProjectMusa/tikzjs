Look up TikZ/PGF documentation for `$ARGUMENTS` from the local manuals.

## Manual source files

All files are in `/home/lind/gits/tikzjs/manuals/`. **Do not edit them.**

### Topic → file mapping

| Topic | Primary files |
|---|---|
| path operations (draw, fill, clip) | `pgfmanual-en-tikz-paths.tex`, `pgfmanual-en-base-paths.tex` |
| nodes, shapes, anchors | `pgfmanual-en-tikz-shapes.tex`, `pgfmanual-en-base-nodes.tex`, `pgfmanual-en-library-shapes.tex` |
| arrows, tips, markers | `pgfmanual-en-tikz-arrows.tex`, `pgfmanual-en-base-arrows.tex`, `pgfmanual-en-library-arrows.tex` |
| coordinates, calc | `pgfmanual-en-tikz-coordinates.tex`, `pgfmanual-en-library-calc.tex` |
| matrices | `pgfmanual-en-tikz-matrices.tex`, `pgfmanual-en-base-matrices.tex`, `pgfmanual-en-library-matrices.tex` |
| trees | `pgfmanual-en-tikz-trees.tex`, `pgfmanual-en-library-trees.tex` |
| graphs | `pgfmanual-en-tikz-graphs.tex` |
| scopes, styles, tikzset | `pgfmanual-en-tikz-scopes.tex` |
| transformations, rotate, scale | `pgfmanual-en-tikz-transformations.tex`, `pgfmanual-en-base-transformations.tex` |
| decorations | `pgfmanual-en-tikz-decorations.tex`, `pgfmanual-en-base-decorations.tex`, `pgfmanual-en-library-decorations.tex` |
| transparency, opacity, fill opacity | `pgfmanual-en-tikz-transparency.tex`, `pgfmanual-en-base-transparency.tex` |
| colors, fill, draw color | `pgfmanual-en-tikz-actions.tex`, `pgfmanual-en-base-actions.tex` |
| patterns | `pgfmanual-en-base-patterns.tex`, `pgfmanual-en-library-patterns.tex` |
| shadows, fadings | `pgfmanual-en-library-shadows.tex`, `pgfmanual-en-library-fadings.tex` |
| plots | `pgfmanual-en-tikz-plots.tex`, `pgfmanual-en-base-plots.tex` |
| foreach, loops | `pgfmanual-en-pgffor.tex` |
| math, expressions | `pgfmanual-en-math-commands.tex`, `pgfmanual-en-math-parsing.tex` |
| keys, pgfkeys | `pgfmanual-en-pgfkeys.tex` |
| tikzcd, commutative diagrams | `tikz-cd.sty`, `tikzlibrarycd.code.tex` |
| TeX macro source | `tikz.code.tex`, `tikzlibrarymatrix.code.tex` |

## Search strategy

1. **Identify the topic** from `$ARGUMENTS`. Split into: concept (e.g. "rounded corners"), feature area (e.g. "path options").

2. **Select 1–3 most relevant files** from the table above.

3. **Grep for the key term** — search for `\pgfkey`, `\tikzset`, `\def`, option names, or section headings:
   ```bash
   grep -n "rounded corners\|round corner" /home/lind/gits/tikzjs/manuals/pgfmanual-en-tikz-paths.tex | head -40
   ```

4. **Read the surrounding context** — use `Read` with `offset`/`limit` to get the full option description (typically 20–60 lines around the match).

5. **Also check TeX source** when behavior is ambiguous — `tikz.code.tex` has the actual macro implementations:
   ```bash
   grep -n "rounded corners" /home/lind/gits/tikzjs/manuals/tikz.code.tex | head -20
   ```

6. **Return a structured answer** with:
   - The exact option/command syntax (from `\pgfkeys` or `\begin{key}{...}` blocks)
   - Default value and accepted values
   - Which IR field or SVG generator code is responsible for implementing it
   - A minimal TikZ example that exercises it

## Usage context

This command is used by the continuous improvement loop to:
- Understand a TikZ feature before writing a new fixture
- Verify correct behavior when fixing a failing fixture
- Confirm option names and semantics before editing parser/generator code

Now look up `$ARGUMENTS` in the manuals.
