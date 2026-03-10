{{
  // Top-level preamble: imported once, shared across all parses
  const ft = require('./factory');
  const op = require('./optionParser');
  const sr = require('./styleResolver');
}}
{
  // Per-parse preamble: options object available as 'options'
  // options.styleRegistry  — StyleRegistry instance from the preprocessor
  // options.tikzcdGrids    — Map<id, TikzcdGrid> from tikzcd preprocessor
  // options.nodeRegistry   — Record<string, string> accumulated during parse

  const registry = options && options.styleRegistry ? options.styleRegistry : { has: () => false, get: () => undefined };
  const tikzcdGrids = options && options.tikzcdGrids ? options.tikzcdGrids : new Map();

  // Node registry: name → id, populated as nodes are parsed
  const nodeRegistry = options && options.nodeRegistry ? options.nodeRegistry : {};

  function registerNode(node) {
    if (node && node.name) {
      nodeRegistry[node.name] = node.id;
    }
    return node;
  }

  function resolveOpts(rawOpts) {
    return op.resolveOptions(rawOpts, registry);
  }

  function parseRaw(optStr) {
    return op.parseRawOptions(optStr || '');
  }

  function anchorFor(rawOpts) {
    return sr.anchorFromPlacement(rawOpts);
  }
}

/////////////////////// Entry Point //////////////////////////

start
  = ws t:tikz ws        { return t; }
  / ws p:tikzpicture ws { return p; }

tikz
  = tikzhead opt:option_block cnt:tikzcontent
    {
      const rawOpts = parseRaw(opt);
      const style = resolveOpts(rawOpts);
      return ft.makeDiagram('tikz-inline', cnt, style, rawOpts, registry.toRecord ? registry.toRecord() : {}, nodeRegistry);
    }

tikzpicture
  = tikzpicturehead opt:option_block cnt:tikzcontent tikzpicturetail
    {
      const rawOpts = parseRaw(opt);
      const style = resolveOpts(rawOpts);
      return ft.makeDiagram('tikzpicture', cnt, style, rawOpts, registry.toRecord ? registry.toRecord() : {}, nodeRegistry);
    }

tikzhead
  = ws ('\\tikz' / '\\tikzjs') ws '{' ws

tikzpicturehead
  = ws '\\begin' ws '{' ws ('tikzpicture' / 'tikzjspicture') ws '}' ws

tikzpicturetail
  = ws '}' ws
  / ws '\\end' ws '{' ws ('tikzpicture' / 'tikzjspicture') ws '}' ws

/////////////////////// Option Blocks //////////////////////////

// Returns the raw option string (content inside [...])
option_block "option block"
  = ws '[' content:option_content ']' ws { return content; }
  / ws                                   { return ''; }

// Consume option content respecting nested brackets and braces
option_content
  = chars:option_char* { return chars.join(''); }

option_char
  = '{' inner:brace_content '}' { return '{' + inner + '}'; }
  / '[' inner:option_content ']' { return '[' + inner + ']'; }
  / c:[^\[\]{};] { return c; }

brace_content
  = chars:brace_char* { return chars.join(''); }

brace_char
  = '{' inner:brace_content '}' { return '{' + inner + '}'; }
  / c:[^{}] { return c; }

/////////////////////// Content (statement list) //////////////////////////

tikzcontent
  = ws list:statement_list ws { return list; }

statement_list
  = items:(ws s:statement ws { return s; })* { return items.filter(Boolean); }

statement
  = scope_statement
  / path_statement
  / standalone_node_statement
  / standalone_coordinate_statement
  / tikzcd_statement

/////////////////////// Scope //////////////////////////

scope_statement
  = '\\begin' ws '{' ws 'scope' ws '}' opt:option_block cnt:tikzcontent '\\end' ws '{' ws 'scope' ws '}'
    {
      const rawOpts = parseRaw(opt);
      const style = resolveOpts(rawOpts);
      return ft.makeScope(cnt, style, rawOpts, location());
    }

/////////////////////// tikzcd placeholder //////////////////////////

tikzcd_statement
  = '\\tikzjsTikzcd' ws '{' id:identifier '}'
    {
      const grid = tikzcdGrids.get(id);
      if (!grid) return null;
      return buildMatrixFromGrid(grid, id);
    }

/////////////////////// Path Statements //////////////////////////

path_statement
  = head:path_head opt:option_block ops:operation_list ';'
    {
      const impliedOpts = head.impliedOpts || '';
      const combinedOptStr = impliedOpts ? impliedOpts + (opt ? ',' + opt : '') : opt;
      const rawOpts = parseRaw(combinedOptStr);
      const style = resolveOpts(rawOpts);
      const { segments, inlineNodes } = buildSegments(ops);
      return ft.makePath(segments, style, rawOpts, inlineNodes, location());
    }

path_head "path command"
  = '\\path'     { return { cmd: '\\path',     impliedOpts: '' }; }
  / '\\draw'     { return { cmd: '\\draw',     impliedOpts: 'draw' }; }
  / '\\fill'     { return { cmd: '\\fill',     impliedOpts: 'fill' }; }
  / '\\filldraw' { return { cmd: '\\filldraw', impliedOpts: 'draw,fill' }; }
  / '\\clip'     { return { cmd: '\\clip',     impliedOpts: 'clip' }; }
  / '\\shade'    { return { cmd: '\\shade',    impliedOpts: 'shade' }; }

// Standalone \node command (shorthand)
standalone_node_statement
  = '\\node' opt:option_block al:node_alias? at_coord:node_at cnt:node_content ';'
    {
      const rawOpts = parseRaw(opt);
      const anchor = anchorFor(rawOpts);
      const style = resolveOpts(rawOpts);
      const position = at_coord || ft.coordRef(0, 0);
      const node = ft.makeNode(position, cnt || '', style, rawOpts, { name: al || undefined, anchor });
      registerNode(node);
      // Wrap in a single-node path for consistency
      return ft.makePath(
        [ft.moveSegment(position), ft.nodeOnPathSegment(node.id)],
        {}, [], [node], location()
      );
    }

// Standalone \coordinate command
standalone_coordinate_statement
  = '\\coordinate' opt:option_block al:node_alias? at_coord:node_at ';'
    {
      const position = at_coord || ft.coordRef(0, 0);
      const coord = ft.makeCoordinate(position, { name: al || undefined });
      if (al) nodeRegistry[al] = coord.id;
      return coord;
    }

/////////////////////// Operation List //////////////////////////

operation_list
  = ops:(ws op:path_operation ws { return op; })* { return ops; }

path_operation
  = c:path_coordinate { return { kind: 'op-coord', coord: c }; }
  / l:line_op         { return l; }
  / g:grid_op         { return g; }
  / b:curve_op        { return b; }
  / t:to_op           { return t; }
  / n:node_op         { return n; }
  / a:arc_op          { return a; }
  / cycle_op          { return { kind: 'op-close' }; }

cycle_op = ws 'cycle' ws

/////////////////////// Coordinate Spec //////////////////////////

path_coordinate "coordinate"
  = '++' c:raw_coordinate { return { kind: 'op-coord', coord: { ...c, mode: 'relative' } }; }
  / '+'  c:raw_coordinate { return { kind: 'op-coord', coord: { ...c, mode: 'relative-pass' } }; }
  / c:raw_coordinate      { return { kind: 'op-coord', coord: { ...c, mode: 'absolute' } }; }
  / a:node_alias_anchor   { return { kind: 'op-coord', coord: ft.nodeAnchorRef(a[0], a[1]) }; }
  / a:node_alias          { return { kind: 'op-coord', coord: ft.nodeAnchorRef(a, 'center') }; }

raw_coordinate "raw coordinate"
  = '(' ws x:number ws ',' ws y:number ws ')'
    { return ft.coordRef(x, y); }
  / '(' ws 'canvas' ws 'cs' ws ':' ws 'x' ws '=' ws x:number ws ',' ws 'y' ws '=' ws y:number ws ')'
    { return ft.coordRef(x, y); }
  / '(' ws angle:number ws ':' ws radius:number ws ')'
    { return ft.polarRef(angle, radius); }
  / '(' ws 'canvas' ws 'polar' ws 'cs' ws ':' ws 'angle' ws '=' ws a:number ws ',' ws 'radius' ws '=' ws r:number ws ')'
    { return ft.polarRef(a, r); }

node_alias "node alias"
  = '(' ws name:identifier ws ')'  { return name; }

node_alias_anchor "node alias with anchor"
  = '(' ws name:identifier ws '.' ws anchor:anchor_name ws ')' { return [name, anchor]; }

anchor_name
  = 'north east' / 'north west' / 'south east' / 'south west'
  / 'north' / 'south' / 'east' / 'west'
  / 'center' / 'mid' / 'base'
  / 'mid east' / 'mid west' / 'base east' / 'base west'
  / identifier

/////////////////////// Line Operations //////////////////////////

line_op "line operation"
  = ws '--' ws { return { kind: 'op-line', lineKind: '--' }; }
  / ws '-|' ws { return { kind: 'op-line', lineKind: '-|' }; }
  / ws '|-' ws { return { kind: 'op-line', lineKind: '|-' }; }

/////////////////////// Grid Operation //////////////////////////

grid_op "grid operation"
  = ws 'grid' opt:option_block
    { return { kind: 'op-grid', rawOpts: parseRaw(opt) }; }

/////////////////////// Curve Operations //////////////////////////

curve_op "curve operation"
  = ws '..' ws 'controls' ws c0:path_coordinate ws 'and' ws c1:path_coordinate ws '..' ws
    { return { kind: 'op-curve', controls: [c0.coord, c1.coord] }; }
  / ws '..' ws 'controls' ws c0:path_coordinate ws '..' ws
    { return { kind: 'op-curve', controls: [c0.coord] }; }

/////////////////////// To-path Operation //////////////////////////

to_op "to operation"
  = ws 'to' opt:option_block
    { return { kind: 'op-to', rawOpts: parseRaw(opt) }; }

/////////////////////// Arc Operation //////////////////////////

arc_op "arc operation"
  = ws 'arc' opt:option_block
    { return { kind: 'op-arc', rawOpts: parseRaw(opt) }; }

/////////////////////// Node Operation //////////////////////////

node_op "node operation"
  = ws 'node' opt:option_block al:node_alias? cnt:node_content ws
    {
      const rawOpts = parseRaw(opt);
      const anchor = anchorFor(rawOpts);
      const style = resolveOpts(rawOpts);
      const node = ft.makeNode(ft.coordRef(0, 0), cnt || '', style, rawOpts, { name: al || undefined, anchor });
      registerNode(node);
      return { kind: 'op-node', node };
    }

node_at "at clause"
  = ws 'at' ws c:path_coordinate { return c.coord; }
  / ws                            { return null; }

node_content "node content"
  = ws '{' content:node_body '}' ws { return content; }
  / ws                               { return ''; }

node_body
  = chars:node_body_char* { return chars.join(''); }

node_body_char
  = '{' inner:node_body '}' { return '{' + inner + '}'; }
  / c:[^{}] { return c; }

/////////////////////// Identifier //////////////////////////

identifier
  = $[a-zA-Z_][a-zA-Z0-9_\-]*
  / $[a-zA-Z]+

/////////////////////// Numbers //////////////////////////

number "number"
  = s:[+\-]? ws i:$[0-9]+ '.' f:$[0-9]*
    { return parseFloat((s||'') + i + '.' + (f||'0')); }
  / s:[+\-]? ws '.' f:$[0-9]+
    { return parseFloat((s||'') + '0.' + f); }
  / s:[+\-]? ws i:$[0-9]+
    { return parseFloat((s||'') + i); }

ws "whitespace"
  = [ \t\n\r]*

/////////////////////// Helper functions (in action preamble) //////////////////////////

{{
  // Build segments and inline-node list from the raw operation list
  function buildSegments(ops) {
    const segments = [];
    const inlineNodes = [];
    let lastCoord = null;

    for (const op of ops) {
      if (!op) continue;

      switch (op.kind) {
        case 'op-coord': {
          const coord = op.coord;
          if (lastCoord === null) {
            segments.push(ft.moveSegment(coord));
          } else {
            // A coordinate after another coordinate is an implicit move
            segments.push(ft.moveSegment(coord));
          }
          lastCoord = coord;
          break;
        }
        case 'op-line': {
          // The line op is followed by a coordinate (next op-coord)
          // We record the line type; the next coord will complete it
          segments.push({ _pendingLine: op.lineKind });
          break;
        }
        case 'op-grid': {
          segments.push({ _pendingGrid: op.rawOpts });
          break;
        }
        case 'op-curve': {
          segments.push({ _pendingCurve: op.controls });
          break;
        }
        case 'op-to': {
          segments.push({ _pendingTo: op.rawOpts });
          break;
        }
        case 'op-arc': {
          const arcSeg = buildArcSegment(op.rawOpts);
          if (arcSeg) segments.push(arcSeg);
          break;
        }
        case 'op-node': {
          inlineNodes.push(op.node);
          segments.push(ft.nodeOnPathSegment(op.node.id));
          break;
        }
        case 'op-close': {
          segments.push(ft.closeSegment());
          break;
        }
      }
    }

    // Second pass: resolve pending operations by looking ahead for their target coord
    return resolvePending(segments, inlineNodes);
  }

  function resolvePending(rawSegments, inlineNodes) {
    const segments = [];
    for (let i = 0; i < rawSegments.length; i++) {
      const seg = rawSegments[i];
      if (seg && seg._pendingLine !== undefined) {
        // Find next move segment
        const nextMove = rawSegments[i + 1];
        if (nextMove && nextMove.kind === 'move') {
          const to = nextMove.to;
          segments.push(
            seg._pendingLine === '--' ? ft.lineSegment(to) :
            seg._pendingLine === '-|' ? ft.hvLineSegment(to, true) :
            ft.hvLineSegment(to, false)
          );
          i++; // consume the move
        }
      } else if (seg && seg._pendingCurve !== undefined) {
        const nextMove = rawSegments[i + 1];
        if (nextMove && nextMove.kind === 'move') {
          segments.push(ft.curveSegment(seg._pendingCurve, nextMove.to));
          i++;
        }
      } else if (seg && seg._pendingGrid !== undefined) {
        const nextMove = rawSegments[i + 1];
        if (nextMove && nextMove.kind === 'move') {
          // Grid: encode as a special 'arc' kind re-purposing the structure,
          // or use a dedicated segment type. We encode as a 'line' with
          // rawOptions containing 'grid' marker for the generator to handle.
          segments.push({ kind: 'grid', to: nextMove.to, rawOptions: seg._pendingGrid });
          i++;
        }
      } else if (seg && seg._pendingTo !== undefined) {
        const nextMove = rawSegments[i + 1];
        if (nextMove && nextMove.kind === 'move') {
          segments.push(ft.toSegment(nextMove.to, seg._pendingTo));
          i++;
        }
      } else if (seg) {
        segments.push(seg);
      }
    }
    return { segments, inlineNodes };
  }

  function buildArcSegment(rawOpts) {
    let startAngle, endAngle, xRadius, yRadius;
    for (const opt of rawOpts) {
      if (opt.key === 'start angle') startAngle = parseFloat(opt.value);
      if (opt.key === 'end angle') endAngle = parseFloat(opt.value);
      if (opt.key === 'radius') xRadius = ft.parseDimension ? ft.parseDimension(opt.value) : parseFloat(opt.value);
      if (opt.key === 'x radius') xRadius = ft.parseDimension ? ft.parseDimension(opt.value) : parseFloat(opt.value);
      if (opt.key === 'y radius') yRadius = ft.parseDimension ? ft.parseDimension(opt.value) : parseFloat(opt.value);
    }
    if (startAngle !== undefined && endAngle !== undefined && xRadius !== undefined) {
      return ft.arcSegment(startAngle, endAngle, xRadius, yRadius);
    }
    return null;
  }

  function buildMatrixFromGrid(grid, id) {
    // Convert TikzcdGrid → IRMatrix + IRTikzcdArrow[]
    // Returns an IRMatrix element with arrows embedded
    // The arrows will be resolved by the SVG generator using nodeRegistry
    const position = ft.coordRef(0, 0);
    const rowSep = 28.45; // 1cm in pt ≈ default tikzcd row sep
    const colSep = 56.9;  // 2cm in pt ≈ default tikzcd col sep

    // Build rows of IRNode
    const rows = [];
    const cellNodeMap = {}; // "r,c" → node id

    for (let r = 0; r < grid.rowCount; r++) {
      const row = [];
      for (let c = 0; c < grid.colCount; c++) {
        const cell = grid.cells.find(cell => cell.row === r && cell.col === c);
        if (cell && cell.label) {
          const node = ft.makeNode(
            ft.coordRef(0, 0), // position set by matrixEmitter
            cell.label,
            {},
            [],
            { name: `${id}_${r}_${c}` }
          );
          registerNode(node);
          cellNodeMap[`${r},${c}`] = node.id;
          row.push(node);
        } else {
          row.push(null);
        }
      }
      rows.push(row);
    }

    // Build IRTikzcdArrow for each \ar command
    const arrows = [];
    for (const cell of grid.cells) {
      for (const ar of cell.arrows) {
        const fromId = cellNodeMap[`${cell.row},${cell.col}`];
        const toRow = cell.row + ar.rowDelta;
        const toCol = cell.col + ar.colDelta;
        const toId = cellNodeMap[`${toRow},${toCol}`];
        if (!fromId || !toId) continue;

        const labels = ar.label ? [{ text: ar.label, position: 'midway' }] : [];
        const rawOpts = ar.rawOptions || [];
        const style = resolveOpts(rawOpts);

        const arrow = ft.makeTikzcdArrow(fromId, toId, ar.rowDelta, ar.colDelta, style, rawOpts, { labels });
        arrows.push(arrow);
      }
    }

    const rawOpts = grid.rawOptions || [];
    const style = resolveOpts(rawOpts);
    const matrix = ft.makeMatrix(position, rows, style, rawOpts, {
      name: id,
      columnSep: colSep,
      rowSep: rowSep,
    });

    // Return a scope containing matrix + arrows
    return ft.makeScope([matrix, ...arrows], {}, [], location());
  }
}}
