Debug the golden fixture `$ARGUMENTS`.

## What to do

Run the single-fixture comparison and capture output:

```bash
make cdiff-one NAME=$ARGUMENTS
```

This renders `test/golden/fixtures/$ARGUMENTS.tikz` via tikzjs, compares it against `test/golden/refs/$ARGUMENTS.svg` (TeX reference), and writes debug images to `/tmp/tikzjs-golden/`:
- `$ARGUMENTS_ours.png` — tikzjs rasterized output
- `$ARGUMENTS_ref.png`  — TeX reference rasterized
- `$ARGUMENTS_struct.png` — structural diff (red=extra in ours, blue=missing)
- `$ARGUMENTS_diff.png`  — amplified raw pixel diff
- `$ARGUMENTS_cc_ours.png` / `_cc_ref.png` — connected-component overlays

## Diagnosis guide

| Symptom | Likely cause |
|---|---|
| Missing elements (blue in struct) | Path op not emitted / wrong segment kind |
| Extra elements (red in struct) | Emitting too much, or spurious default shapes |
| Size mismatch (large diff %) | Wrong pt→px conversion, wrong `em` resolution, wrong `minimum height` |
| Position shift | Anchor offset wrong, `yshift`/`xshift` not applied, SVG y-inversion bug |
| Text size difference | Font rendering gap (MathJax vs TeX CM glyphs) — WARN not FAIL |
| Component count mismatch | Element missing entirely or extra group wrapper |

## Pipeline stages to check

```
TikZ source → Preprocessor → Parser (IR) → SVG Generator
```

- **IR wrong?** `parse(src)` and `JSON.stringify(ir.elements, null, 2)` to inspect
- **SVG wrong?** `generate(src)` and eyeball the SVG XML
- **Emitter wrong?** Check `src/generators/svg/pathEmitter.ts`, `nodeEmitter.ts`, `styleEmitter.ts`
- **Coord wrong?** Check `src/generators/svg/coordResolver.ts`

Now diagnose `$ARGUMENTS`.
