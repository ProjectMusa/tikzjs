{{
  // Top-level preamble (one block only — runs once when parser module is loaded)
  const ft = require('./factory');
  const op = require('./optionParser');
  const sr = require('./styleResolver');

  // ── Helper: build segment list from raw grammar operation array ──────────────
  function buildSegments(ops) {
    const rawSegs = [];
    const inlineNodes = [];

    for (const item of ops) {
      if (!item) continue;
      switch (item.kind) {
        case 'op-coord':
          rawSegs.push(ft.moveSegment(item.coord));
          break;
        case 'op-line':
          rawSegs.push({ _pendingLine: item.lineKind });
          break;
        case 'op-grid':
          rawSegs.push({ _pendingGrid: item.rawOpts });
          break;
        case 'op-rectangle':
          rawSegs.push({ _pendingRectangle: true });
          break;
        case 'op-curve':
          rawSegs.push({ _pendingCurve: item.controls });
          break;
        case 'op-to':
          rawSegs.push({ _pendingTo: item.rawOpts });
          break;
        case 'op-arc': {
          const arcSeg = buildArcSegment(item.rawOpts);
          if (arcSeg) rawSegs.push(arcSeg);
          break;
        }
        case 'op-node':
          inlineNodes.push(item.node);
          rawSegs.push(ft.nodeOnPathSegment(item.node.id));
          break;
        case 'op-close':
          rawSegs.push(ft.closeSegment());
          break;
      }
    }

    return { segments: resolvePending(rawSegs), inlineNodes };
  }

  function resolvePending(rawSegs) {
    const segments = [];
    for (let i = 0; i < rawSegs.length; i++) {
      const seg = rawSegs[i];
      if (seg && seg._pendingLine !== undefined) {
        const next = rawSegs[i + 1];
        if (next && next.kind === 'move') {
          const to = next.to;
          if (seg._pendingLine === '--') segments.push(ft.lineSegment(to));
          else if (seg._pendingLine === '-|') segments.push(ft.hvLineSegment(to, true));
          else segments.push(ft.hvLineSegment(to, false));
          i++;
        }
      } else if (seg && seg._pendingCurve !== undefined) {
        const next = rawSegs[i + 1];
        if (next && next.kind === 'move') {
          segments.push(ft.curveSegment(seg._pendingCurve, next.to));
          i++;
        }
      } else if (seg && seg._pendingRectangle) {
        const next = rawSegs[i + 1];
        if (next && next.kind === 'move') {
          segments.push({ kind: 'rectangle', to: next.to });
          i++;
        }
      } else if (seg && seg._pendingGrid !== undefined) {
        const next = rawSegs[i + 1];
        if (next && next.kind === 'move') {
          segments.push({ kind: 'grid', to: next.to, rawOptions: seg._pendingGrid });
          i++;
        }
      } else if (seg && seg._pendingTo !== undefined) {
        const next = rawSegs[i + 1];
        if (next && next.kind === 'move') {
          segments.push(ft.toSegment(next.to, seg._pendingTo));
          i++;
        }
      } else if (seg) {
        segments.push(seg);
      }
    }
    return segments;
  }

  function buildArcSegment(rawOpts) {
    let startAngle, endAngle, xRadius, yRadius;
    for (const o of rawOpts) {
      if (o.key === 'start angle') startAngle = parseFloat(o.value);
      if (o.key === 'end angle')   endAngle   = parseFloat(o.value);
      if (o.key === 'radius')      xRadius    = op.parseDimensionPt(o.value);
      if (o.key === 'x radius')    xRadius    = op.parseDimensionPt(o.value);
      if (o.key === 'y radius')    yRadius    = op.parseDimensionPt(o.value);
    }
    if (startAngle !== undefined && endAngle !== undefined && xRadius !== undefined) {
      return ft.arcSegment(startAngle, endAngle, xRadius, yRadius);
    }
    return null;
  }

  function buildMatrixFromGrid(grid, id, nodeReg, resolveOptsFn) {
    const position  = ft.coordRef(0, 0);
    const rowSepPt  = 28.45; // 1cm
    const colSepPt  = 56.9;  // 2cm

    const rows        = [];
    const cellNodeMap = {};

    for (let r = 0; r < grid.rowCount; r++) {
      const row = [];
      for (let c = 0; c < grid.colCount; c++) {
        const cell = grid.cells.find(cell => cell.row === r && cell.col === c);
        if (cell) {
          const node = ft.makeNode(
            ft.coordRef(0, 0), cell.label, {}, [],
            { name: id + '_' + r + '_' + c }
          );
          if (node.name) nodeReg[node.name] = node.id;
          cellNodeMap[r + ',' + c] = node.id;
          row.push(node);
        } else {
          row.push(null);
        }
      }
      rows.push(row);
    }

    const arrows = [];
    for (const cell of grid.cells) {
      for (const ar of cell.arrows) {
        const fromId = cellNodeMap[cell.row + ',' + cell.col];
        const toRow  = cell.row + ar.rowDelta;
        const toCol  = cell.col + ar.colDelta;
        const toId   = cellNodeMap[toRow + ',' + toCol];
        if (!fromId || !toId) continue;

        // Quoted string options like "f" or "g"' (swap) are labels, not style opts
        const labels = [];
        const styleRawOpts = [];
        for (const opt of (ar.rawOptions || [])) {
          const k = opt.key || '';
          if (k.startsWith('"')) {
            let text = k;
            let swap = false;
            if (text.endsWith("'")) { swap = true; text = text.slice(0, -1); }
            if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
            if (text) labels.push({ text, position: 'midway', swap });
          } else {
            styleRawOpts.push(opt);
          }
        }
        if (ar.label) labels.push({ text: ar.label, position: 'midway', swap: false });

        const style = resolveOptsFn(styleRawOpts);
        arrows.push(ft.makeTikzcdArrow(fromId, toId, ar.rowDelta, ar.colDelta, style, styleRawOpts, { labels }));
      }
    }

    const rawOpts = grid.rawOptions || [];
    const style   = resolveOptsFn(rawOpts);
    const matrix  = ft.makeMatrix(position, rows, style, rawOpts, {
      name: id, columnSep: colSepPt, rowSep: rowSepPt,
    });
    return ft.makeScope([matrix, ...arrows], {}, []);
  }
}}

{
  // Per-parse initializer
  const registry     = (options && options.styleRegistry) ? options.styleRegistry : { has: () => false, get: () => undefined, toRecord: () => ({}) };
  const tikzcdGrids  = (options && options.tikzcdGrids)   ? options.tikzcdGrids   : new Map();
  const nodeRegistry = (options && options.nodeRegistry)  ? options.nodeRegistry  : {};

  function resolveOpts(rawOpts) { return op.resolveOptions(rawOpts, registry); }
  function parseRaw(optStr)     { return op.parseRawOptions(optStr || ''); }
  function anchorFor(rawOpts)   { return sr.anchorFromPlacement(rawOpts); }
  function registerNode(node)   { if (node && node.name) nodeRegistry[node.name] = node.id; return node; }
}

/////////////////////// Entry Point //////////////////////////

start
  = ws t:tikz        ws { return t; }
  / ws p:tikzpicture ws { return p; }
  / ws cd:tikzcd_root ws { return cd; }

tikzcd_root
  = scope:tikzcd_statement
    {
      return ft.makeDiagram('tikzpicture', [scope], {}, [],
        registry.toRecord ? registry.toRecord() : {}, nodeRegistry);
    }

tikz
  = tikzhead_open opt:option_block cnt:tikzcontent '}'
    {
      const rawOpts = parseRaw(opt);
      return ft.makeDiagram('tikz-inline', cnt, resolveOpts(rawOpts), rawOpts,
        registry.toRecord ? registry.toRecord() : {}, nodeRegistry);
    }

tikzpicture
  = tikzpicturehead opt:option_block cnt:tikzcontent tikzpicturetail
    {
      const rawOpts = parseRaw(opt);
      return ft.makeDiagram('tikzpicture', cnt, resolveOpts(rawOpts), rawOpts,
        registry.toRecord ? registry.toRecord() : {}, nodeRegistry);
    }

tikzhead_open
  = ws '\\tikzjs' ws
  / ws '\\tikz'   ws

tikzpicturehead
  = ws '\\begin' ws '{' ws ('tikzpicture' / 'tikzjspicture') ws '}' ws

tikzpicturetail
  = ws '\\end' ws '{' ws ('tikzpicture' / 'tikzjspicture') ws '}' ws

/////////////////////// Option Blocks //////////////////////////

option_block "option block"
  = ws '[' content:option_content ']' ws { return content; }
  / ws                                    { return ''; }

option_content = chars:option_char* { return chars.join(''); }

option_char
  = '{' inner:brace_content '}' { return '{' + inner + '}'; }
  / '[' inner:option_content ']' { return '[' + inner + ']'; }
  / c:[^\[\]{};] { return c; }

brace_content = chars:brace_char* { return chars.join(''); }

brace_char
  = '{' inner:brace_content '}' { return '{' + inner + '}'; }
  / c:[^{}] { return c; }

/////////////////////// Content //////////////////////////

tikzcontent = ws list:statement_list ws { return list; }

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
      return ft.makeScope(cnt, resolveOpts(rawOpts), rawOpts);
    }

/////////////////////// tikzcd placeholder //////////////////////////

tikzcd_statement
  = '\\tikzjsTikzcd' ws '{' id:identifier '}'
    {
      const grid = tikzcdGrids.get(id);
      if (!grid) return null;
      return buildMatrixFromGrid(grid, id, nodeRegistry, resolveOpts);
    }

/////////////////////// Path Statements //////////////////////////

path_statement
  = head:path_head opt:option_block ops:operation_list ';'
    {
      const impliedOpts  = head.impliedOpts || '';
      const combinedStr  = impliedOpts ? (opt ? impliedOpts + ',' + opt : impliedOpts) : opt;
      const rawOpts      = parseRaw(combinedStr);
      const style        = resolveOpts(rawOpts);
      const { segments, inlineNodes } = buildSegments(ops);
      return ft.makePath(segments, style, rawOpts, inlineNodes);
    }

path_head "path command"
  = '\\path'     { return { cmd: '\\path',     impliedOpts: '' }; }
  / '\\draw'     { return { cmd: '\\draw',     impliedOpts: 'draw' }; }
  / '\\fill'     { return { cmd: '\\fill',     impliedOpts: 'fill' }; }
  / '\\filldraw' { return { cmd: '\\filldraw', impliedOpts: 'draw,fill' }; }
  / '\\clip'     { return { cmd: '\\clip',     impliedOpts: '' }; }
  / '\\shade'    { return { cmd: '\\shade',    impliedOpts: '' }; }

standalone_node_statement
  = '\\node' opt:option_block al:node_alias? at_coord:node_at cnt:node_content ';'
    {
      const rawOpts = parseRaw(opt);
      const pos     = at_coord || ft.coordRef(0, 0);
      const node    = ft.makeNode(pos, cnt || '', resolveOpts(rawOpts), rawOpts,
        { name: al || undefined, anchor: anchorFor(rawOpts) });
      registerNode(node);
      return ft.makePath([ft.moveSegment(pos), ft.nodeOnPathSegment(node.id)], {}, [], [node]);
    }

standalone_coordinate_statement
  = '\\coordinate' opt:option_block al:node_alias? at_coord:node_at ';'
    {
      const pos   = at_coord || ft.coordRef(0, 0);
      const coord = ft.makeCoordinate(pos, { name: al || undefined });
      if (al) nodeRegistry[al] = coord.id;
      return coord;
    }

/////////////////////// Operation List //////////////////////////

operation_list
  = ops:(ws o:path_operation ws { return o; })* { return ops; }

path_operation
  = c:path_coordinate { return c; }
  / l:line_op         { return l; }
  / r:rectangle_op    { return r; }
  / g:grid_op         { return g; }
  / b:curve_op        { return b; }
  / t:to_op           { return t; }
  / n:node_op         { return n; }
  / a:arc_op          { return a; }
  / cycle_op          { return { kind: 'op-close' }; }

cycle_op = ws 'cycle' ws

/////////////////////// Coordinates //////////////////////////

path_coordinate "coordinate"
  = '++' c:raw_coordinate { return { kind: 'op-coord', coord: { mode: 'relative',      coord: c.coord } }; }
  / '+'  c:raw_coordinate { return { kind: 'op-coord', coord: { mode: 'relative-pass', coord: c.coord } }; }
  / c:raw_coordinate      { return { kind: 'op-coord', coord: c }; }
  / a:node_alias_anchor   { return { kind: 'op-coord', coord: ft.nodeAnchorRef(a[0], a[1]) }; }
  / a:node_alias          { return { kind: 'op-coord', coord: ft.nodeAnchorRef(a, 'center') }; }

raw_coordinate "raw coordinate"
  = '(' ws x:number u1:dim_unit ws ',' ws y:number u2:dim_unit ws ')'
    { return { mode: 'absolute', coord: { cs: 'xy', x: x * u1, y: y * u2 } }; }
  / '(' ws 'canvas' ws 'cs' ws ':' ws 'x' ws '=' ws x:number u1:dim_unit ws ',' ws 'y' ws '=' ws y:number u2:dim_unit ws ')'
    { return { mode: 'absolute', coord: { cs: 'xy', x: x * u1, y: y * u2 } }; }
  / '(' ws angle:number ws ':' ws radius:number u:dim_unit ws ')'
    { return { mode: 'absolute', coord: { cs: 'polar', angle, radius: radius * u } }; }

// Unit suffix → pt multiplier. No unit = TikZ default (1cm = 28.4528pt).
dim_unit
  = ws 'cm' { return 28.4528; }
  / ws 'mm' { return 2.84528; }
  / ws 'pt' { return 1.0; }
  / ws 'bp' { return 1.00375; }
  / ws 'in' { return 72.27; }
  / ws 'ex' { return 4.5; }
  / ws 'em' { return 10.0; }
  / ws     { return 28.4528; }  // default TikZ unit = 1cm

node_alias "node alias"
  = '(' ws name:identifier ws ')' { return name; }

node_alias_anchor "node alias with anchor"
  = '(' ws name:identifier ws '.' ws anchor:anchor_name ws ')' { return [name, anchor]; }

anchor_name
  = $('north east' / 'north west' / 'south east' / 'south west'
     / 'north' / 'south' / 'east' / 'west'
     / 'center' / 'mid east' / 'mid west' / 'base east' / 'base west'
     / 'mid' / 'base')
  / identifier

/////////////////////// Path Operations //////////////////////////

line_op "line"
  = ws '--' ws { return { kind: 'op-line', lineKind: '--' }; }
  / ws '-|' ws { return { kind: 'op-line', lineKind: '-|' }; }
  / ws '|-' ws { return { kind: 'op-line', lineKind: '|-' }; }

rectangle_op "rectangle"
  = ws 'rectangle' ws { return { kind: 'op-rectangle' }; }

grid_op "grid"
  = ws 'grid' opt:option_block
    { return { kind: 'op-grid', rawOpts: parseRaw(opt) }; }

curve_op "curve"
  = ws '..' ws 'controls' ws c0:path_coordinate ws 'and' ws c1:path_coordinate ws '..' ws
    { return { kind: 'op-curve', controls: [c0.coord, c1.coord] }; }
  / ws '..' ws 'controls' ws c0:path_coordinate ws '..' ws
    { return { kind: 'op-curve', controls: [c0.coord] }; }

to_op "to"
  = ws 'to' opt:option_block
    { return { kind: 'op-to', rawOpts: parseRaw(opt) }; }

arc_op "arc"
  = ws 'arc' opt:option_block
    { return { kind: 'op-arc', rawOpts: parseRaw(opt) }; }

node_op "node"
  = ws 'node' opt:option_block al:node_alias? cnt:node_content ws
    {
      const rawOpts = parseRaw(opt);
      const node    = ft.makeNode(ft.coordRef(0, 0), cnt || '', resolveOpts(rawOpts), rawOpts,
        { name: al || undefined, anchor: anchorFor(rawOpts) });
      registerNode(node);
      return { kind: 'op-node', node };
    }

node_at "at clause"
  = ws 'at' ws c:path_coordinate { return c.coord; }
  / ws                            { return null; }

node_content "node content"
  = ws '{' content:node_body '}' ws { return content; }
  / ws                               { return ''; }

node_body = chars:node_body_char* { return chars.join(''); }

node_body_char
  = '{' inner:node_body '}' { return '{' + inner + '}'; }
  / c:[^{}] { return c; }

/////////////////////// Primitives //////////////////////////

identifier = $([a-zA-Z_][a-zA-Z0-9_\-]*)

number "number"
  = s:$[+\-]? ws i:$[0-9]+ '.' f:$[0-9]*
    { return parseFloat((s||'') + i + '.' + (f||'0')); }
  / s:$[+\-]? ws '.' f:$[0-9]+
    { return parseFloat((s||'') + '0.' + f); }
  / s:$[+\-]? ws i:$[0-9]+
    { return parseFloat((s||'') + i); }

ws "whitespace" = [ \t\n\r]*
