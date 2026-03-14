Add the TikZ style option `$ARGUMENTS` to the pipeline end-to-end.

## Context — do not re-read these files, use what's here

**Pipeline:** raw option string → `parseRawOptions()` → `RawOption[]` → `resolveOptions()` → `applyOption()` → `ResolvedStyle` → SVG emitter.

**Files to edit (in order):**

1. `src/ir/types.ts` — `ResolvedStyle` interface (lines ~95–152). Add the new field under the right section comment. Use `number` for pt values, `string` for colors/keywords, `boolean` for flags.

2. `src/parser/optionParser.ts` — `applyOption()` switch (line ~84). Add a `case` under the matching section. Dimension values use `parseDimension(value as string, emSizePt)`. Colors use `resolveColor(value as string)`. Unknown values go in `setExtra(style, key, value as string)`.

3. `src/generators/svg/nodeEmitter.ts` or `src/generators/svg/styleEmitter.ts` — consume the new field to emit the SVG attribute or geometry change.

## Style section map in optionParser.ts
- Stroke/fill: `draw`, `fill`, `color`
- Line width: `line width`, named widths (`thin`, `thick`, …)
- Node geometry: `inner sep`, `outer sep`, `minimum width`, `minimum height`, `minimum size`
- Text: `text`, `align`, `node font` → sets `fontSize`
- Transform: `rotate`, `xshift`, `yshift`, `scale`
- Opacity: `opacity`, `fill opacity`, `draw opacity`
- Rounded corners: `rounded corners`, `sharp corners`
- Edge routing: `bend left/right`, `in`, `out`, `looseness`, `loop`
- Label placement: `midway`, `near start`, `near end`, `pos`, `sloped`, `swap`

## em-aware dimensions
If the value can use `em` units (e.g. `minimum height=3em`), pass `emSizePt` to `parseDimension`. The pre-scan in `resolveOptions` already provides `emSizePt` from `node font`.

## After editing
Run `npm run build && npm test` — no grammar regeneration needed unless you touched `_tikzjs.pegjs`.

Now add the option `$ARGUMENTS`. Start with `src/ir/types.ts`, then `optionParser.ts`, then the emitter.
