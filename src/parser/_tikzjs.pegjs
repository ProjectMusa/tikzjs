{{
  // Top-level preamble (one block only — runs once when parser module is loaded)
  const ft = require('./factory');
  const op = require('./optionParser');
  const sr = require('./styleResolver');

  // ── Helper: detect (nodeA) --/to (nodeB) node[midway/pos, above/below/left/right]{text} ──────
  // Returns an IREdge if the pattern matches, else null.
  const POSITION_KEYS = new Set(['midway', 'near start', 'near end', 'at start', 'at end', 'very near start', 'very near end']);
  const PLACEMENT_KEYS = new Set(['above', 'below', 'left', 'right']);

  function tryBuildEdgeFromOps(ops, style, rawOpts, nodeReg) {
    // Filter nulls
    const items = ops.filter(Boolean);
    // Pattern: coord(nodeRef A) [line|to] coord(nodeRef B) node(midway/pos)
    // Optional: any number of trailing node ops
    // Minimal: exactly 4 items: coord, line/to, coord, node
    if (items.length < 4) return null;

    const [first, conn, second, ...rest] = items;

    // First must be a named-node coord reference
    if (first.kind !== 'op-coord') return null;
    if (first.coord.coord.cs !== 'node-anchor') return null;

    // Connector must be line (--) or to
    if (conn.kind !== 'op-line' && conn.kind !== 'op-to') return null;

    // Second must also be a named-node coord
    if (second.kind !== 'op-coord') return null;
    if (second.coord.coord.cs !== 'node-anchor') return null;

    // Rest: all must be op-node with position/placement options
    if (rest.length === 0) return null;
    if (!rest.every(item => item.kind === 'op-node')) return null;

    // Check at least one node has a position key (midway etc.)
    const labels = [];
    for (const nodeItem of rest) {
      const nodeRawOpts = nodeItem.node.rawOptions || [];
      const keys = nodeRawOpts.map(o => o.key);
      const hasPosition = keys.some(k => POSITION_KEYS.has(k));
      if (!hasPosition) return null;  // not a midway label — don't convert

      const position = keys.find(k => POSITION_KEYS.has(k)) || 'midway';
      const placement = keys.find(k => PLACEMENT_KEYS.has(k)) || undefined;
      const swap = keys.includes('swap');
      const text = nodeItem.node.label || '';
      labels.push({ text, position, placement, swap });
    }

    // Determine routing
    let routing = { kind: 'straight' };
    if (conn.kind === 'op-to') {
      // Check for bend left/right in to options
      const toOpts = conn.rawOpts || [];
      const bendLeft  = toOpts.find(o => o.key === 'bend left');
      const bendRight = toOpts.find(o => o.key === 'bend right');
      if (bendLeft)  routing = { kind: 'bend', direction: 'left',  angle: parseFloat(bendLeft.value  || '30') };
      else if (bendRight) routing = { kind: 'bend', direction: 'right', angle: parseFloat(bendRight.value || '30') };
    }

    const fromNode = nodeReg[first.coord.coord.nodeName];
    const toNode   = nodeReg[second.coord.coord.nodeName];
    if (!fromNode || !toNode) return null;

    return ft.makeEdge(fromNode, toNode, routing, style, rawOpts, {
      fromAnchor: first.coord.coord.anchor !== 'center' ? first.coord.coord.anchor : undefined,
      toAnchor:   second.coord.coord.anchor !== 'center' ? second.coord.coord.anchor : undefined,
      labels,
    });
  }

  // ── Helper: build multiple IREdges from path ops that use the `edge` keyword ──
  // Pattern: (src) edge [opts] node* (dst)  — may repeat with different sources.
  // `edge` semantics: source is the last explicit coord BEFORE the edge op; the
  // destination coord does NOT update the "current source" (enabling same-source
  // chaining: `(A) edge (B) edge (C)` → A→B and A→C).
  function tryBuildMultiEdgesFromOps(ops, outerStyle, outerRawOpts, nodeReg, resolveOptsFn) {
    const items = ops.filter(Boolean);
    if (!items.some(function(i) { return i.kind === 'op-edge'; })) return null;

    var edges = [];
    var currentSourceItem = null;
    var inEdge = false;
    var edgeOpts = [];
    var edgeLabels = [];
    var edgeSourceItem = null;

    for (var idx = 0; idx < items.length; idx++) {
      var item = items[idx];
      if (item.kind === 'op-coord') {
        if (!inEdge) {
          currentSourceItem = item;
        } else {
          // This coord is the target of the pending edge
          var dst = item;
          var allEdgeOpts = outerRawOpts.concat(edgeOpts);
          // Detect loop option — self-loop edge regardless of destination
          var loopOpt = edgeOpts.find(function(o) { return o.key === 'loop' || o.key === 'loop above' || o.key === 'loop below' || o.key === 'loop left' || o.key === 'loop right'; })
                     || outerRawOpts.find(function(o) { return o.key === 'loop' || o.key === 'loop above' || o.key === 'loop below' || o.key === 'loop left' || o.key === 'loop right'; });
          // Merge outer style with edge-specific options for per-edge style
          var edgeStyle = (edgeOpts.length > 0 && resolveOptsFn)
            ? Object.assign({}, outerStyle, resolveOptsFn(edgeOpts))
            : outerStyle;
          if (loopOpt && edgeSourceItem && edgeSourceItem.coord.coord.cs === 'node-anchor') {
            var selfId = nodeReg[edgeSourceItem.coord.coord.nodeName];
            if (selfId) {
              var loopDir = loopOpt.key.replace('loop', '').trim() || 'right';
              edges.push(ft.makeEdge(selfId, selfId, { kind: 'loop', direction: loopDir }, edgeStyle, allEdgeOpts, { labels: edgeLabels }));
            }
          } else if (edgeSourceItem && edgeSourceItem.coord.coord.cs === 'node-anchor' &&
              dst.coord.coord.cs === 'node-anchor') {
            var fromId = nodeReg[edgeSourceItem.coord.coord.nodeName];
            var toId   = nodeReg[dst.coord.coord.nodeName];
            if (fromId && toId) {
              var bendLeft  = edgeOpts.find(function(o) { return o.key === 'bend left'; })
                           || outerRawOpts.find(function(o) { return o.key === 'bend left'; });
              var bendRight = edgeOpts.find(function(o) { return o.key === 'bend right'; })
                           || outerRawOpts.find(function(o) { return o.key === 'bend right'; });
              var inOpt  = edgeOpts.find(function(o) { return o.key === 'in'; });
              var outOpt = edgeOpts.find(function(o) { return o.key === 'out'; });
              var routing = { kind: 'straight' };
              if (bendLeft)       routing = { kind: 'bend', direction: 'left',  angle: parseFloat(bendLeft.value  || '30') };
              else if (bendRight) routing = { kind: 'bend', direction: 'right', angle: parseFloat(bendRight.value || '30') };
              else if (inOpt && outOpt) routing = { kind: 'in-out', inAngle: parseFloat(inOpt.value || '0'), outAngle: parseFloat(outOpt.value || '0') };
              edges.push(ft.makeEdge(fromId, toId, routing, edgeStyle, allEdgeOpts, { labels: edgeLabels }));
            }
          }
          inEdge = false;
          edgeOpts = [];
          edgeLabels = [];
          edgeSourceItem = null;
          // Do NOT update currentSourceItem — stays at pre-edge source for same-source chaining
        }
      } else if (item.kind === 'op-edge') {
        edgeSourceItem = currentSourceItem;
        edgeOpts = item.rawOpts || [];
        edgeLabels = [];
        inEdge = true;
      } else if (item.kind === 'op-node' && inEdge) {
        var keys = (item.node.rawOptions || []).map(function(o) { return o.key; });
        var placement = keys.find(function(k) { return PLACEMENT_KEYS.has(k); });
        var position  = keys.find(function(k) { return POSITION_KEYS.has(k); }) || 'midway';
        var text = item.node.label || '';
        if (text) edgeLabels.push({ text: text, position: position, placement: placement, swap: keys.includes('swap') });
      }
    }

    return edges.length > 0 ? edges : null;
  }

  // ── Helper: build segment list from raw grammar operation array ──────────────
  function buildSegments(ops, nodeRegistry) {
    const rawSegs = [];
    const inlineNodes = [];
    const inlineCoords = [];
    let lastCoord = ft.coordRef(0, 0);  // current path position for inline node placement
    let prevCoord = null;               // previous coordinate (for midway interpolation)
    // Last known absolute position (for resolving relative ++ offsets in inline node placement).
    let lastAbsCoord = ft.coordRef(0, 0);

    for (const item of ops) {
      if (!item) continue;
      switch (item.kind) {
        case 'op-coord':
          rawSegs.push(ft.moveSegment(item.coord));
          prevCoord = lastCoord;
          if (item.coord.mode === 'absolute') {
            lastCoord = item.coord;
            lastAbsCoord = item.coord;
          } else if (item.coord.mode === 'relative') {
            // ++ relative: synthesize calc add so inline nodes placed after this get the right absolute position
            lastCoord = { mode: 'absolute', coord: { cs: 'calc', expr: {
              kind: 'add',
              a: { kind: 'coord', ref: lastAbsCoord },
              b: { kind: 'coord', ref: { mode: 'absolute', coord: item.coord.coord } }
            }}};
            lastAbsCoord = lastCoord;
          } else {
            // relative-pass (+): current position advances but lastAbsCoord doesn't
            lastCoord = { mode: 'absolute', coord: { cs: 'calc', expr: {
              kind: 'add',
              a: { kind: 'coord', ref: lastAbsCoord },
              b: { kind: 'coord', ref: { mode: 'absolute', coord: item.coord.coord } }
            }}};
          }
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
        case 'op-edge':
          // Node-name edges are handled by tryBuildMultiEdgesFromOps before buildSegments is called.
          // When edge connects bare coordinates, treat as a 'to' line segment.
          rawSegs.push({ _pendingTo: item.rawOpts });
          break;
        case 'op-arc': {
          const arcSeg = buildArcSegment(item.rawOpts);
          if (arcSeg) rawSegs.push(arcSeg);
          break;
        }
        case 'op-arc-short':
          rawSegs.push(ft.arcSegment(item.startAngle, item.endAngle, item.xRadius, item.yRadius));
          break;
        case 'op-circle':
          rawSegs.push(ft.circleSegment(item.radius));
          break;
        case 'op-ellipse':
          rawSegs.push(ft.ellipseSegment(item.xRadius, item.yRadius));
          break;
        case 'op-parabola':
          rawSegs.push({ _pendingParabola: { rawOpts: item.rawOpts, bend: item.bend || null } });
          break;
        case 'op-sin':
          rawSegs.push({ _pendingSin: true });
          break;
        case 'op-cos':
          rawSegs.push({ _pendingCos: true });
          break;
        case 'op-node': {
          // Check if node has a position key (midway, near start, etc.)
          var nodeOpts = item.node.rawOptions || [];
          var nodeKeys = nodeOpts.map(function(o) { return o.key; });
          var posKey = nodeKeys.find(function(k) { return POSITION_KEYS.has(k); });
          var posVal = nodeKeys.find(function(k) { return k === 'pos'; });
          var t = null;
          if (posKey === 'midway')       t = 0.5;
          else if (posKey === 'near start' || posKey === 'very near start') t = 0.25;
          else if (posKey === 'near end'   || posKey === 'very near end')   t = 0.75;
          else if (posKey === 'at start')  t = 0;
          else if (posKey === 'at end')    t = 1;
          if (posVal) {
            var posOpt = nodeOpts.find(function(o) { return o.key === 'pos'; });
            if (posOpt && posOpt.value) t = parseFloat(posOpt.value);
          }
          if (t !== null && prevCoord) {
            // Interpolate between prevCoord and lastCoord
            item.node.position = { mode: 'absolute', coord: { cs: 'calc', expr: {
              kind: 'add',
              a: { kind: 'scale', factor: 1 - t, expr: { kind: 'coord', ref: prevCoord } },
              b: { kind: 'scale', factor: t,     expr: { kind: 'coord', ref: lastCoord } }
            }}};
          } else {
            item.node.position = lastCoord;  // inline node sits at current path position
          }
          inlineNodes.push(item.node);
          rawSegs.push(ft.nodeOnPathSegment(item.node.id));
          break;
        }
        case 'op-close':
          rawSegs.push(ft.closeSegment());
          break;
        case 'op-save-coord':
          // inline `coordinate (name)` — registers current position as a named coordinate
          if (item.name) {
            const coord = ft.makeCoordinate(lastCoord, { name: item.name });
            nodeRegistry[item.name] = coord.id;
            inlineCoords.push(coord);
          }
          break;
        case 'op-pic':
          // `pic [opts] {body}` — not yet rendered; skip silently
          break;
      }
    }

    // Helper: check if a node already has an explicit position key
    function hasPositionKey(node) {
      var opts = node.rawOptions || [];
      return opts.some(function(o) { return POSITION_KEYS.has(o.key) || o.key === 'pos'; });
    }

    return { segments: resolvePending(rawSegs, inlineNodes, hasPositionKey), inlineNodes, inlineCoords };
  }

  function resolvePending(rawSegs, inlineNodes, hasPositionKey) {
    const segments = [];
    var lastMoveCoord = null; // track current path position for midpoint computation
    for (let i = 0; i < rawSegs.length; i++) {
      const seg = rawSegs[i];
      if (seg && seg.kind === 'move') {
        lastMoveCoord = seg.to;
      }
      if (seg && seg._pendingLine !== undefined) {
        // Skip over inline node-on-path segments to find the target coordinate
        var lineTarget = null;
        var lineSkip = 0;
        var skippedNodes = [];
        for (var j = i + 1; j < rawSegs.length; j++) {
          if (rawSegs[j] && rawSegs[j].kind === 'node-on-path') {
            skippedNodes.push(rawSegs[j]);
            lineSkip++;
          } else if (rawSegs[j] && rawSegs[j].kind === 'move') {
            lineTarget = rawSegs[j];
            lineSkip++;
            break;
          } else {
            break;
          }
        }
        if (lineTarget) {
          // Update skipped inline nodes to midpoint between from and to
          if (lastMoveCoord && skippedNodes.length > 0) {
            for (var k = 0; k < skippedNodes.length; k++) {
              var nodeId = skippedNodes[k].nodeId;
              var inNode = inlineNodes.find(function(n) { return n.id === nodeId; });
              if (inNode && !hasPositionKey(inNode)) {
                var fromExpr = { kind: 'coord', ref: lastMoveCoord };
                var toExpr = { kind: 'coord', ref: lineTarget.to };
                if (seg._pendingLine === '-|') {
                  // Horizontal-first: corner at (target.x, from.y)
                  // perpendicular: a provides x, b provides y
                  inNode.position = { mode: 'absolute', coord: { cs: 'calc', expr: {
                    kind: 'perpendicular', a: toExpr, b: fromExpr, through: fromExpr
                  }}};
                } else if (seg._pendingLine === '|-') {
                  // Vertical-first: corner at (from.x, target.y)
                  inNode.position = { mode: 'absolute', coord: { cs: 'calc', expr: {
                    kind: 'perpendicular', a: fromExpr, b: toExpr, through: fromExpr
                  }}};
                } else {
                  // Straight line: midpoint
                  inNode.position = { mode: 'absolute', coord: { cs: 'calc', expr: {
                    kind: 'add',
                    a: { kind: 'scale', factor: 0.5, expr: fromExpr },
                    b: { kind: 'scale', factor: 0.5, expr: toExpr }
                  }}};
                }
              }
            }
          }
          for (var k = 0; k < skippedNodes.length; k++) segments.push(skippedNodes[k]);
          const to = lineTarget.to;
          if (seg._pendingLine === '--') segments.push(ft.lineSegment(to));
          else if (seg._pendingLine === '-|') segments.push(ft.hvLineSegment(to, true));
          else segments.push(ft.hvLineSegment(to, false));
          lastMoveCoord = to;
          i += lineSkip;
        }
      } else if (seg && seg._pendingCurve !== undefined) {
        // Skip over inline node-on-path segments to find the target coordinate
        var curveTarget = null;
        var curveSkip = 0;
        var skippedCurveNodes = [];
        for (var j = i + 1; j < rawSegs.length; j++) {
          if (rawSegs[j] && rawSegs[j].kind === 'node-on-path') {
            skippedCurveNodes.push(rawSegs[j]);
            curveSkip++;
          } else if (rawSegs[j] && rawSegs[j].kind === 'move') {
            curveTarget = rawSegs[j];
            curveSkip++;
            break;
          } else {
            break;
          }
        }
        if (curveTarget) {
          // Update skipped inline nodes to midpoint between from and to
          if (lastMoveCoord && skippedCurveNodes.length > 0) {
            for (var k = 0; k < skippedCurveNodes.length; k++) {
              var nodeId = skippedCurveNodes[k].nodeId;
              var inNode = inlineNodes.find(function(n) { return n.id === nodeId; });
              if (inNode && !hasPositionKey(inNode)) {
                inNode.position = { mode: 'absolute', coord: { cs: 'calc', expr: {
                  kind: 'add',
                  a: { kind: 'scale', factor: 0.5, expr: { kind: 'coord', ref: lastMoveCoord } },
                  b: { kind: 'scale', factor: 0.5, expr: { kind: 'coord', ref: curveTarget.to } }
                }}};
              }
            }
          }
          for (var k = 0; k < skippedCurveNodes.length; k++) segments.push(skippedCurveNodes[k]);
          segments.push(ft.curveSegment(seg._pendingCurve, curveTarget.to));
          lastMoveCoord = curveTarget.to;
          i += curveSkip;
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
      } else if (seg && seg._pendingParabola !== undefined) {
        const next = rawSegs[i + 1];
        if (next && next.kind === 'move') {
          const { rawOpts, bend } = seg._pendingParabola;
          const bendAtEnd = rawOpts && rawOpts.some(o => o.key === 'bend at end');
          segments.push(ft.parabolaSegment(next.to, bendAtEnd, bend || undefined));
          i++;
        }
      } else if (seg && seg._pendingSin) {
        const next = rawSegs[i + 1];
        if (next && next.kind === 'move') {
          segments.push(ft.sinSegment(next.to));
          i++;
        }
      } else if (seg && seg._pendingCos) {
        const next = rawSegs[i + 1];
        if (next && next.kind === 'move') {
          segments.push(ft.cosSegment(next.to));
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

  // ── tikzcd named sep presets (from tikzlibrarycd.code.tex, converted: 1em = 10pt) ──────────
  const TIKZCD_COL_SEP = { huge: 48, large: 36, normal: 24, scriptsize: 18, small: 12, tiny: 6 };
  const TIKZCD_ROW_SEP = { huge: 36, large: 27, normal: 18, scriptsize: 13.5, small: 9, tiny: 4.5 };

  function resolveTikzcdSep(rawOpts, key, presets, defaultPt) {
    const opt = rawOpts.find(o => o.key === key);
    if (!opt) return defaultPt;
    const v = (opt.value || '').trim();
    if (presets[v] !== undefined) return presets[v];
    const parsed = op.parseDimensionPt(v);
    return parsed > 0 ? parsed : defaultPt;
  }

  function buildMatrixFromGrid(grid, id, nodeReg, resolveOptsFn) {
    const position  = ft.coordRef(0, 0);
    const rawOpts   = grid.rawOptions || [];
    // Resolve column/row sep from diagram options; fall back to tikzcd `normal` defaults
    const sepFallback = resolveTikzcdSep(rawOpts, 'sep', TIKZCD_COL_SEP, null);
    const colSepPt  = resolveTikzcdSep(rawOpts, 'column sep', TIKZCD_COL_SEP, sepFallback ?? 24);
    const rowSepPt  = resolveTikzcdSep(rawOpts, 'row sep',    TIKZCD_ROW_SEP, sepFallback ?? 18);

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

        // Quoted string options like "f" or "g"' (swap) or "\phi" description are labels
        const labels = [];
        const styleRawOpts = [];
        for (const opt of (ar.rawOptions || [])) {
          const k = opt.key || '';
          if (k.startsWith('"')) {
            // Find the closing quote (may have trailing ' or style keywords after)
            const closeIdx = k.indexOf('"', 1);
            let text = closeIdx !== -1 ? k.slice(1, closeIdx) : k.slice(1);
            const rest = closeIdx !== -1 ? k.slice(closeIdx + 1) : '';
            const swap = rest.trimStart().startsWith("'");
            const styleWord = rest.replace(/^['\s]*/, '').trim(); // e.g. "description"
            const isDescription = styleWord === 'description';
            if (text) labels.push({ text, position: 'midway', swap, description: isDescription || undefined });
            if (styleWord && !isDescription) styleRawOpts.push({ key: styleWord });
          } else {
            styleRawOpts.push(opt);
          }
        }
        if (ar.label) labels.push({ text: ar.label, position: 'midway', swap: false });

        const style = resolveOptsFn(styleRawOpts);
        // tikzcd default: all arrows have a stealth arrowhead at the end (-> style)
        if (!style.arrowEnd) style.arrowEnd = { kind: '>' };
        arrows.push(ft.makeTikzcdArrow(fromId, toId, ar.rowDelta, ar.colDelta, style, styleRawOpts, { labels }));
      }
    }

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
  const knotEnvs     = (options && options.knotEnvs)      ? options.knotEnvs      : new Map();
  const nodeRegistry = (options && options.nodeRegistry)  ? options.nodeRegistry  : {};

  function resolveOpts(rawOpts) { return op.resolveOptions(rawOpts, registry); }
  // Resolve options for nodes: prepends 'every node' style if defined in registry
  function resolveNodeOpts(rawOpts) {
    var everyNodeDef = registry.get('every node');
    if (everyNodeDef && everyNodeDef.rawOptions) {
      return op.resolveOptions([...everyNodeDef.rawOptions, ...rawOpts], registry);
    }
    return op.resolveOptions(rawOpts, registry);
  }
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
  = tikzhead_open opt:option_block '{' cnt:tikzcontent '}'
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
  = ws first:('[' option_content ']') rest:(ws '[' option_content ']')* ws {
      const parts = [first[1], ...rest.map(r => r[2])].filter(s => s.length > 0);
      return parts.join(',');
    }
  / ws { return ''; }

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
  / knot_statement
  / ws ';' { return null; }
  / ws '{' cnt:tikzcontent '}' { return cnt.length === 1 ? cnt[0] : (cnt.length > 0 ? ft.makeScope(cnt, {}, []) : null); }

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

/////////////////////// Knot placeholder //////////////////////////

knot_statement
  = '\\tikzjsKnot' ws '{' id:identifier '}'
    {
      const env = knotEnvs.get(id);
      if (!env) return null;
      return ft.makeKnot(id, env);
    }

/////////////////////// Path Statements //////////////////////////

path_statement
  = head:path_head opt:option_block ops:operation_list ';'
    {
      const impliedOpts  = head.impliedOpts || '';
      const combinedStr  = impliedOpts ? (opt ? impliedOpts + ',' + opt : impliedOpts) : opt;
      const rawOpts      = parseRaw(combinedStr);
      const style        = resolveOpts(rawOpts);
      const edge = tryBuildEdgeFromOps(ops, style, rawOpts, nodeRegistry);
      if (edge) return edge;
      const multiEdges = tryBuildMultiEdgesFromOps(ops, style, rawOpts, nodeRegistry, resolveOpts);
      if (multiEdges) {
        if (multiEdges.length === 1) return multiEdges[0];
        return ft.makeScope(multiEdges, {}, []);
      }
      const { segments, inlineNodes, inlineCoords } = buildSegments(ops, nodeRegistry);
      // TikZ: `edge` in a path implies drawing (even with `\path` instead of `\draw`).
      const hasEdgeOp = ops.some(function(o) { return o && o.kind === 'op-edge'; });
      const effectiveStyle = (hasEdgeOp && !style.draw)
        ? Object.assign({}, style, { draw: 'currentColor' })
        : style;
      const path = ft.makePath(segments, effectiveStyle, rawOpts, inlineNodes);
      if (inlineCoords.length > 0) {
        return ft.makeScope([...inlineCoords, path], {}, []);
      }
      return path;
    }

path_head "path command"
  = '\\path'     { return { cmd: '\\path',     impliedOpts: '' }; }
  / '\\draw'     { return { cmd: '\\draw',     impliedOpts: 'draw' }; }
  / '\\filldraw' { return { cmd: '\\filldraw', impliedOpts: 'draw,fill' }; }
  / '\\fill'     { return { cmd: '\\fill',     impliedOpts: 'fill' }; }
  / '\\clip'     { return { cmd: '\\clip',     impliedOpts: '' }; }
  / '\\shade'    { return { cmd: '\\shade',    impliedOpts: '' }; }

standalone_node_statement
  = '\\node' opt:option_block al:node_alias? at_coord:node_at al2:(ws a:node_alias { return a; })? opts2:(ws '[' o:option_content ']' { return o; })* at_coord2:node_at al3:(ws a:node_alias { return a; })? cnt:node_content edges:standalone_node_edges ';'
    {
      const merged  = [opt, ...opts2].filter(s => s.length > 0).join(',');
      const rawOpts = parseRaw(merged);
      const pos     = at_coord || at_coord2 || ft.extractPlacementRef(rawOpts) || ft.coordRef(0, 0);
      const name    = al || al2 || al3 || undefined;
      const node    = ft.makeNode(pos, cnt || '', resolveNodeOpts(rawOpts), rawOpts,
        { name, anchor: anchorFor(rawOpts) });
      registerNode(node);
      var nodePath = ft.makePath([ft.moveSegment(pos), ft.nodeOnPathSegment(node.id)], {}, [], [node]);
      if (!edges || edges.length === 0) return nodePath;
      // Build edge paths from trailing edge ops
      var items = [nodePath];
      var srcId = node.id; // use node.id directly since registerNode just ran
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        var edgeStyle = resolveOpts(e.rawOpts);
        if (!edgeStyle.draw) edgeStyle = Object.assign({}, edgeStyle, { draw: 'currentColor' });
        // Resolve target node
        var tgtCoord = e.target;
        var tgtId = null;
        if (tgtCoord && tgtCoord.coord && tgtCoord.coord.cs === 'node-anchor') {
          tgtId = nodeRegistry[tgtCoord.coord.nodeName] || null;
        }
        if (srcId && tgtId) {
          // Determine routing from edge options
          var routing = { kind: 'straight' };
          var bendLeft  = e.rawOpts.find(function(o) { return o.key === 'bend left'; });
          var bendRight = e.rawOpts.find(function(o) { return o.key === 'bend right'; });
          if (bendLeft)  routing = { kind: 'bend', direction: 'left',  angle: parseFloat(bendLeft.value  || '30') };
          if (bendRight) routing = { kind: 'bend', direction: 'right', angle: parseFloat(bendRight.value || '30') };
          items.push(ft.makeEdge(srcId, tgtId, routing, edgeStyle, e.rawOpts, {}));
        }
      }
      return ft.makeScope(items, {}, []);
    }

standalone_node_edges
  = edges:(ws 'edge' eopt:option_block t:path_coordinate { return { rawOpts: parseRaw(eopt), target: t.coord }; })*
    { return edges; }

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
  = c:path_op_coord   { return c; }
  / l:line_op         { return l; }
  / r:rectangle_op    { return r; }
  / g:grid_op         { return g; }
  / b:curve_op        { return b; }
  / t:to_op           { return t; }
  / e:edge_op         { return e; }
  / n:node_op         { return n; }
  / n:bare_node_op    { return n; }
  / a:arc_op          { return a; }
  / ci:circle_op      { return ci; }
  / el:ellipse_op     { return el; }
  / pa:parabola_op    { return pa; }
  / s:sin_op          { return s; }
  / co:cos_op         { return co; }
  / coord:coordinate_op { return coord; }
  / p:pic_op          { return p; }
  / cycle_op          { return { kind: 'op-close' }; }
  / plot_op           { return null; }

cycle_op = ws 'cycle' ws ('{' ws '}' ws)?

coordinate_op "coordinate path op"
  = ws 'coordinate' opt:option_block al:node_alias? ws
    { return { kind: 'op-save-coord', name: al || null }; }

pic_op "pic"
  = ws 'pic' opt:option_block body:pic_body ws
    { return { kind: 'op-pic' }; }

pic_body "pic body"
  = ws '{' inner:brace_content '}' { return inner; }

/////////////////////// Coordinates //////////////////////////

// Used only inside path_operation — absorbs a trailing [opts] block (e.g. (coord)[out=...,in=...] to)
path_op_coord "coordinate"
  = c:path_coordinate option_block { return c; }

path_coordinate "coordinate"
  = '++' ws c:raw_coordinate { return { kind: 'op-coord', coord: { mode: 'relative',      coord: c.coord } }; }
  / '+'  ws c:raw_coordinate { return { kind: 'op-coord', coord: { mode: 'relative-pass', coord: c.coord } }; }
  / c:raw_coordinate         { return { kind: 'op-coord', coord: c }; }
  / a:node_alias_anchor      { return { kind: 'op-coord', coord: ft.nodeAnchorRef(a[0], a[1]) }; }
  / a:node_alias             { return { kind: 'op-coord', coord: ft.nodeAnchorRef(a, 'center') }; }
  / '(' ws ')'               { return { kind: 'op-coord', coord: ft.coordRef(0, 0) }; }

raw_coordinate "raw coordinate"
  = '(' ws x:coord_num u1:dim_unit ws ',' ws y:coord_num u2:dim_unit ws ',' ws z:coord_num u3:dim_unit ws ')'
    {
      // TikZ 3D: project using default z-vector (-3.85mm, -3.85mm) = (-10.913pt, -10.913pt)
      var zFactor = z * u3 / 28.4528; // normalize to cm-equivalent units
      return { mode: 'absolute', coord: { cs: 'xy', x: x * u1 + zFactor * (-10.913), y: y * u2 + zFactor * (-10.913) } };
    }
  / '(' ws x:coord_num u1:dim_unit ws ',' ws y:coord_num u2:dim_unit ws ')'
    { return { mode: 'absolute', coord: { cs: 'xy', x: x * u1, y: y * u2 } }; }
  / '(' ws 'canvas' ws 'cs' ws ':' ws 'x' ws '=' ws x:coord_num u1:dim_unit ws ',' ws 'y' ws '=' ws y:coord_num u2:dim_unit ws ')'
    { return { mode: 'absolute', coord: { cs: 'xy', x: x * u1, y: y * u2 } }; }
  / '(' ws angle:coord_num ws ':' ws radius:coord_num u:dim_unit ws ')'
    { return { mode: 'absolute', coord: { cs: 'polar', angle, radius: radius * u } }; }
  / '(' ws dir:direction_name ws ':' ws radius:coord_num u:dim_unit ws ')'
    { return { mode: 'absolute', coord: { cs: 'polar', angle: dir, radius: radius * u } }; }
  / '(' ws a:perp_operand ws '|-' ws b:perp_operand ws ')'
    { return { mode: 'absolute', coord: { cs: 'calc', expr: { kind: 'perpendicular', a: b.expr, b: a.expr, through: a.expr } } }; }
  / '(' ws a:perp_operand ws '-|' ws b:perp_operand ws ')'
    { return { mode: 'absolute', coord: { cs: 'calc', expr: { kind: 'perpendicular', a: a.expr, b: b.expr, through: a.expr } } }; }
  / '($' ws e:calc_expr ws '$)'
    { return { mode: 'absolute', coord: { cs: 'calc', expr: e } }; }
  / '(' ws '[' option_content ']' ws name:node_name ws '.' ws anchor:anchor_name ws ')'
    { return ft.nodeAnchorRef(name, anchor); }
  / '(' ws '[' option_content ']' ws name:node_name ws ')'
    { return ft.nodeAnchorRef(name, 'center'); }

// Operand for perpendicular intersection coordinates (A |- B) / (A -| B).
// Returns { expr: CalcExpr } wrapping the resolved coordinate/node reference.
perp_operand "perpendicular operand"
  = '$' ws e:calc_expr ws '$'
    { return { expr: e }; }
  / x:coord_num u1:dim_unit ws ',' ws y:coord_num u2:dim_unit
    { return { expr: { kind: 'coord', ref: { mode: 'absolute', coord: { cs: 'xy', x: x * u1, y: y * u2 } } } }; }
  / name:node_name ws '.' ws anchor:anchor_name
    { return { expr: { kind: 'coord', ref: ft.nodeAnchorRef(name, anchor) } }; }
  / name:node_name
    { return { expr: { kind: 'coord', ref: ft.nodeAnchorRef(name, 'center') } }; }

direction_name "direction"
  = 'north east' { return 45; }
  / 'north west' { return 135; }
  / 'south east' { return -45; }
  / 'south west' { return -135; }
  / 'north'      { return 90; }
  / 'south'      { return -90; }
  / 'east'       { return 0; }
  / 'west'       { return 180; }
  / 'up'         { return 90; }
  / 'down'       { return -90; }
  / 'right'      { return 0; }
  / 'left'       { return 180; }

// TikZ calc library expressions: $(A)!0.5!(B)$, $(A)+(B)$, etc.
calc_expr "calc expression"
  = a:calc_primary ws '!' ws t:number ws '!' ws b:calc_primary
    { return { kind: 'midpoint', t: t, a: { kind: 'coord', ref: a }, b: { kind: 'coord', ref: b } }; }
  / a:calc_primary ws '+' ws b:calc_primary
    { return { kind: 'add', a: { kind: 'coord', ref: a }, b: { kind: 'coord', ref: b } }; }
  / a:calc_primary ws '-' ws b:calc_primary
    { return { kind: 'sub', a: { kind: 'coord', ref: a }, b: { kind: 'coord', ref: b } }; }
  / f:number ws '*' ws a:calc_primary
    { return { kind: 'scale', factor: f, expr: { kind: 'coord', ref: a } }; }
  / a:calc_primary
    { return { kind: 'coord', ref: a }; }

calc_primary "calc primary"
  = c:raw_coordinate             { return c; }
  / a:node_alias_anchor          { return ft.nodeAnchorRef(a[0], a[1]); }
  / a:node_alias                 { return ft.nodeAnchorRef(a, 'center'); }

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
  = '(' ws name:node_name ws ')' { return name; }
  / '(' ws ')' { return ''; }

node_alias_anchor "node alias with anchor"
  = '(' ws name:node_name ws '.' ws anchor:anchor_name ws ')' { return [name, anchor]; }

anchor_name
  = $('north east' / 'north west' / 'south east' / 'south west'
     / 'north' / 'south' / 'east' / 'west'
     / 'center' / 'mid east' / 'mid west' / 'base east' / 'base west'
     / 'mid' / 'base')
  / $('-'? [0-9]+)
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

edge_op "edge"
  = ws 'edge' opt:option_block
    { return { kind: 'op-edge', rawOpts: parseRaw(opt) }; }

arc_op "arc"
  = ws 'arc' ws '(' ws sa:coord_num ws ':' ws ea:coord_num ws ':' ws xr:coord_num u1:dim_unit ws 'and' ws yr:coord_num u2:dim_unit ws ')'
    { return { kind: 'op-arc-short', startAngle: sa, endAngle: ea, xRadius: xr * u1, yRadius: yr * u2 }; }
  / ws 'arc' ws '(' ws sa:coord_num ws ':' ws ea:coord_num ws ':' ws r:coord_num u:dim_unit ws ')'
    { return { kind: 'op-arc-short', startAngle: sa, endAngle: ea, xRadius: r * u }; }
  / ws 'arc' opt:option_block
    { return { kind: 'op-arc', rawOpts: parseRaw(opt) }; }

circle_op "circle"
  = ws 'circle' ws '(' ws r:number u:dim_unit ws ')'
    { return { kind: 'op-circle', radius: r * u }; }
  / ws 'circle' ws '[' ws 'radius' ws '=' ws r:number u:dim_unit ws ']'
    { return { kind: 'op-circle', radius: r * u }; }
  / ws 'circle' ws '[' ws 'x' ws 'radius' ws '=' ws xr:number u1:dim_unit ws ',' ws 'y' ws 'radius' ws '=' ws yr:number u2:dim_unit ws ']'
    { return { kind: 'op-ellipse', xRadius: xr * u1, yRadius: yr * u2 }; }

ellipse_op "ellipse"
  = ws 'ellipse' ws '(' ws xr:number u1:dim_unit ws 'and' ws yr:number u2:dim_unit ws ')'
    { return { kind: 'op-ellipse', xRadius: xr * u1, yRadius: yr * u2 }; }

parabola_op "parabola"
  = ws 'parabola' opt:option_block ws 'bend' ws b:path_coordinate
    { return { kind: 'op-parabola', rawOpts: parseRaw(opt), bend: b.coord }; }
  / ws 'parabola' opt:option_block
    { return { kind: 'op-parabola', rawOpts: parseRaw(opt) }; }

sin_op "sin"
  = ws 'sin' ws { return { kind: 'op-sin' }; }

cos_op "cos"
  = ws 'cos' ws { return { kind: 'op-cos' }; }

// plot path operation — consumed as no-op (expression evaluation not supported)
plot_op "plot"
  = ws 'plot' opt:option_block body:plot_body ws { return null; }

plot_body "plot body"
  = '(' plot_inner ')' { return null; }
  / '{' brace_content '}' plot_body { return null; }
  / '' { return null; }

plot_inner "plot inner"
  = chars:plot_inner_char* { return null; }

plot_inner_char
  = '{' brace_content '}' { return null; }
  / '(' plot_inner ')' { return null; }
  / c:[^{}()] { return null; }

node_op "node"
  = ws 'node' opt:option_block al:node_alias? at_coord:node_at al2:(ws a:node_alias { return a; })? opt2:option_block cnt:node_content ws
    {
      const merged  = [opt, opt2].filter(s => s.length > 0).join(',');
      const rawOpts = parseRaw(merged);
      const name    = al || al2 || undefined;
      const node    = ft.makeNode(ft.coordRef(0, 0), cnt || '', resolveNodeOpts(rawOpts), rawOpts,
        { name, anchor: anchorFor(rawOpts) });
      if (at_coord) node.pos = at_coord;
      registerNode(node);
      return { kind: 'op-node', node };
    }

// Bare {text} on a path acts as an implicit inline node (equivalent to node {text})
bare_node_op
  = ws '{' content:node_body '}' ws
    {
      var node = ft.makeNode(ft.coordRef(0, 0), content || '', resolveNodeOpts([]), []);
      registerNode(node);
      return { kind: 'op-node', node: node };
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

// Node names allow a leading digit (e.g. \node (1) ... is valid TikZ), trailing primes (A', B'),
// and embedded arithmetic chars (ar+1, r-1).
node_name = $([a-zA-Z0-9_][a-zA-Z0-9_\-+']*)

number "number"
  = s:$[+\-]? ws i:$[0-9]+ '.' f:$[0-9]*
    { return parseFloat((s||'') + i + '.' + (f||'0')); }
  / s:$[+\-]? ws '.' f:$[0-9]+
    { return parseFloat((s||'') + '0.' + f); }
  / s:$[+\-]? ws i:$[0-9]+
    { return parseFloat((s||'') + i); }

// Unsigned number (no leading sign) — used in arithmetic tails.
pos_number "positive number"
  = i:$[0-9]+ '.' f:$[0-9]* { return parseFloat(i + '.' + (f||'0')); }
  / '.' f:$[0-9]+            { return parseFloat('0.' + f); }
  / i:$[0-9]+                { return parseFloat(i); }

// Full arithmetic expression supporting +, -, *, / for use in coordinate values
// after \foreach variable substitution (e.g. -1*360/12, 2*1.1, 360/48-2*360/12).
coord_num "coordinate number"
  = head:coord_term rest:(ws op:$[+\-] ws t:coord_term { return {op:op, t:t} })*
    { return rest.reduce(function(a, b) { return b.op === '+' ? a + b.t : a - b.t; }, head); }

coord_term
  = head:coord_factor rest:(ws op:$[*\/] ws f:coord_factor { return {op:op, f:f} })*
    { return rest.reduce(function(a, b) { return b.op === '*' ? a * b.f : a / b.f; }, head); }

coord_factor
  = '(' ws e:coord_num ws ')' { return e; }
  / '{' ws e:coord_num ws '}' { return e; }
  / 'sqrt' ws '(' ws e:coord_num ws ')' { return Math.sqrt(e); }
  / 'sin'  ws '(' ws e:coord_num ws ')' { return Math.sin(e * Math.PI / 180); }
  / 'cos'  ws '(' ws e:coord_num ws ')' { return Math.cos(e * Math.PI / 180); }
  / 'abs'  ws '(' ws e:coord_num ws ')' { return Math.abs(e); }
  / 'pi'   { return 3.14159265358979; }
  / '-' ws n:pos_number       { return -n; }
  / '+' ws n:pos_number       { return n; }
  / n:pos_number              { return n; }

ws "whitespace" = ([ \t\n\r]+ / ('%' [^\n]* '\n'?))*
