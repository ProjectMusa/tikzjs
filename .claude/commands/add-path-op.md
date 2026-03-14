Add the TikZ path operation `$ARGUMENTS` to the pipeline end-to-end.

## The 5-step pattern (from CLAUDE.md)

1. **Grammar rule** in `src/parser/_tikzjs.pegjs`
   - Add `xxx_op` returning `{ kind: 'op-xxx', ... }`
   - Wire it into the `path_operation` choice list

2. **`buildSegments()`** in the grammar's global `{{ }}` initializer
   - Add `case 'op-xxx':` → push `{ _pendingXxx: ... }` onto `rawSegs`

3. **`resolvePending()`** in the same initializer
   - Add `_pendingXxx` case → consume next coord, emit final segment object

4. **IR type** in `src/ir/types.ts`
   - Add the new segment interface (discriminated by `kind: 'xxx'`) to the `PathSegment` union

5. **Emitter** in `src/generators/svg/pathEmitter.ts`
   - Add `case 'xxx':` to the segment switch → emit SVG path data string

## Key invariants
- Grammar rule names: `xxx_op` (snake_case, `_op` suffix)
- Pending objects: `{ _pendingXxx: <data> }` (camelCase, `_pending` prefix)
- Segment kinds: `'xxx'` matching the IR type discriminant
- Coordinate system: IR stores pt units; `ptToPx()` happens in the emitter via `coordResolver`
- `resolvePending` processes coords sequentially from `rawSegs` — consume exactly as many as the operation needs

## After editing the grammar
```
npm run gen   # REQUIRED — regenerates src/parser/_tikzjs.js
npm run build
npm test
```

## Reference operations already implemented
- `move` / `line` — simplest case, single coord
- `curve` — multi-coord with control points
- `arc` — angle + radius parameters, no coord consumed from rawSegs
- `node-on-path` — inline node, no coord

Now implement `$ARGUMENTS`.
