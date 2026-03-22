/**
 * Emit IR elements as TikZ source strings.
 */

import type {
  IRNode, IRNamedCoordinate, IRPath, IREdge, IRTikzcdArrow,
  IRScope, IRMatrix, IRKnot, IRElement, PathSegment, RawOption,
  EdgeLabel, IRDiagram,
} from '../../ir/types.js'
import { TIKZ_CONSTANTS } from '../svg/constants.js'
import { emitCoord } from './coordEmitter.js'
import { emitOptions } from './optionEmitter.js'

const PT_PER_CM = TIKZ_CONSTANTS.PT_PER_CM

function fmt(n: number): string {
  const rounded = Math.round(n * 10000) / 10000
  return String(rounded)
}

function ptToCm(pt: number): string {
  return fmt(pt / PT_PER_CM)
}

// ── Node ─────────────────────────────────────────────────────────────────────

export function emitNode(node: IRNode): string {
  const opts = emitOptions(node.rawOptions)
  const name = node.name ? ` (${node.name})` : ''
  const at = ` at ${emitCoord(node.position)}`
  const label = ` {${node.label}}`
  return `\\node${opts}${name}${at}${label};`
}

export function emitCoordinate(coord: IRNamedCoordinate): string {
  const name = coord.name ? ` (${coord.name})` : ''
  const at = ` at ${emitCoord(coord.position)}`
  return `\\coordinate${name}${at};`
}

// ── Path Segments ────────────────────────────────────────────────────────────

function emitSegment(seg: PathSegment, inlineNodes: Map<string, IRNode>): string {
  switch (seg.kind) {
    case 'move':
      return emitCoord(seg.to)
    case 'line':
      return `-- ${emitCoord(seg.to)}`
    case 'hv-line':
      return seg.hvFirst ? `-| ${emitCoord(seg.to)}` : `|- ${emitCoord(seg.to)}`
    case 'curve': {
      if (seg.controls.length === 2) {
        return `.. controls ${emitCoord(seg.controls[0])} and ${emitCoord(seg.controls[1])} .. ${emitCoord(seg.to)}`
      }
      return `.. controls ${emitCoord(seg.controls[0])} .. ${emitCoord(seg.to)}`
    }
    case 'arc': {
      const startAngle = fmt(seg.startAngle)
      const endAngle = fmt(seg.endAngle)
      const xr = ptToCm(seg.xRadius)
      if (seg.yRadius !== undefined && seg.yRadius !== seg.xRadius) {
        return `arc (${startAngle}:${endAngle}:${xr} and ${ptToCm(seg.yRadius)})`
      }
      return `arc (${startAngle}:${endAngle}:${xr})`
    }
    case 'to': {
      const opts = emitOptions(seg.rawOptions)
      return `to${opts} ${emitCoord(seg.to)}`
    }
    case 'node-on-path': {
      const node = inlineNodes.get(seg.nodeId)
      if (!node) return ''
      const opts = emitOptions(node.rawOptions)
      return `node${opts} {${node.label}}`
    }
    case 'close':
      return '-- cycle'
    case 'circle':
      return `circle (${ptToCm(seg.radius)})`
    case 'ellipse':
      return `ellipse (${ptToCm(seg.xRadius)} and ${ptToCm(seg.yRadius)})`
    case 'parabola': {
      if (seg.bend) {
        return `parabola bend ${emitCoord(seg.bend)} ${emitCoord(seg.to)}`
      }
      return `parabola ${emitCoord(seg.to)}`
    }
    case 'sin':
      return `sin ${emitCoord(seg.to)}`
    case 'cos':
      return `cos ${emitCoord(seg.to)}`
  }
}

// ── Path ─────────────────────────────────────────────────────────────────────

/**
 * Determine the path command from rawOptions.
 * Looks for 'draw', 'fill' keys to pick \draw, \fill, \filldraw, or \path.
 */
function inferPathCommand(rawOptions: RawOption[]): string {
  let hasDraw = false
  let hasFill = false
  for (const opt of rawOptions) {
    if (opt.key === 'draw') hasDraw = true
    if (opt.key === 'fill') hasFill = true
    // Shorthand: -> implies draw
    if (opt.key === '->' || opt.key === '<-' || opt.key === '<->') hasDraw = true
  }
  if (hasDraw && hasFill) return '\\filldraw'
  if (hasFill) return '\\fill'
  if (hasDraw) return '\\draw'
  return '\\path'
}

export function emitPath(path: IRPath): string {
  const cmd = inferPathCommand(path.rawOptions)
  const opts = emitOptions(path.rawOptions)

  // Build inline node lookup
  const inlineNodes = new Map<string, IRNode>()
  for (const node of path.inlineNodes) {
    inlineNodes.set(node.id, node)
  }

  const parts = path.segments.map(s => emitSegment(s, inlineNodes))
  return `${cmd}${opts} ${parts.join(' ')};`
}

// ── Edge ─────────────────────────────────────────────────────────────────────

function emitEdgeLabels(labels: EdgeLabel[]): string {
  if (!labels || labels.length === 0) return ''
  return labels.map(l => {
    const parts: string[] = []
    if (l.placement) parts.push(l.placement)
    if (l.position === 'midway') parts.push('midway')
    else if (l.position === 'near start') parts.push('near start')
    else if (l.position === 'near end') parts.push('near end')
    else if (l.position === 'at start') parts.push('at start')
    else if (l.position === 'at end') parts.push('at end')
    else if (typeof l.position === 'number' && l.position !== 0.5) parts.push(`pos=${fmt(l.position)}`)
    if (l.swap) parts.push('swap')
    if (l.description) parts.push('description')
    const opts = parts.length > 0 ? `[${parts.join(', ')}]` : ''
    return ` node${opts} {${l.text}}`
  }).join('')
}

export function emitEdge(edge: IREdge, idToName: Map<string, string>): string {
  const from = idToName.get(edge.from) || edge.from
  const to = idToName.get(edge.to) || edge.to
  const fromAnchor = edge.fromAnchor ? `.${edge.fromAnchor}` : ''
  const toAnchor = edge.toAnchor ? `.${edge.toAnchor}` : ''
  const opts = emitOptions(edge.rawOptions)
  const labels = emitEdgeLabels(edge.labels)
  return `\\draw${opts} (${from}${fromAnchor}) edge${labels} (${to}${toAnchor});`
}

// ── tikzcd ───────────────────────────────────────────────────────────────────

/**
 * Convert rowDelta/colDelta to tikzcd direction string.
 * e.g. rowDelta=1,colDelta=0 → "d", rowDelta=-1,colDelta=1 → "ur"
 */
function tikzcdDirection(rowDelta: number, colDelta: number): string {
  let dir = ''
  if (rowDelta < 0) dir += 'u'.repeat(Math.abs(rowDelta))
  if (rowDelta > 0) dir += 'd'.repeat(rowDelta)
  if (colDelta < 0) dir += 'l'.repeat(Math.abs(colDelta))
  if (colDelta > 0) dir += 'r'.repeat(colDelta)
  return dir || 'r' // fallback
}

function emitTikzcdArrow(arrow: IRTikzcdArrow): string {
  const dir = tikzcdDirection(arrow.rowDelta, arrow.colDelta)

  // Build options: direction first, then rawOptions (excluding direction-related)
  const optParts: string[] = [dir]
  for (const opt of arrow.rawOptions) {
    // Skip direction-like keys that are already captured in dir
    if (['r', 'l', 'u', 'd', 'rr', 'll', 'uu', 'dd'].includes(opt.key)) continue
    if (opt.value !== undefined && opt.value !== '') {
      optParts.push(`${opt.key}=${typeof opt.value === 'string' ? opt.value : '{...}'}`)
    } else {
      optParts.push(opt.key)
    }
  }

  const labels = arrow.labels.map(l => {
    if (l.swap) return `'${l.text}'`
    if (l.description) return `"${l.text}"`
    return `{${l.text}}`
  }).join(' ')

  return `\\ar[${optParts.join(', ')}]${labels ? ' ' + labels : ''}`
}

export function emitMatrix(
  matrix: IRMatrix,
  arrows: IRTikzcdArrow[],
  indent: string,
): string {
  const isTikzcd = arrows.length > 0
  const lines: string[] = []

  if (isTikzcd) {
    // Group arrows by source cell (by from node id)
    const arrowsByFrom = new Map<string, IRTikzcdArrow[]>()
    for (const a of arrows) {
      const list = arrowsByFrom.get(a.from) || []
      list.push(a)
      arrowsByFrom.set(a.from, list)
    }

    const opts = emitOptions(matrix.rawOptions)
    lines.push(`\\begin{tikzcd}${opts}`)

    for (let r = 0; r < matrix.rows.length; r++) {
      const row = matrix.rows[r]
      const cells: string[] = []
      for (let c = 0; c < row.length; c++) {
        const node = row[c]
        let cell = node ? node.label : ''
        // Append arrows originating from this cell
        if (node) {
          const nodeArrows = arrowsByFrom.get(node.id) || []
          for (const a of nodeArrows) {
            cell += ' ' + emitTikzcdArrow(a)
          }
        }
        cells.push(cell)
      }
      const rowEnd = r < matrix.rows.length - 1 ? ' \\\\' : ''
      lines.push(`${indent}${cells.join(' & ')}${rowEnd}`)
    }

    lines.push('\\end{tikzcd}')
  } else {
    // Regular \matrix
    const opts = emitOptions(matrix.rawOptions)
    const name = matrix.name ? ` (${matrix.name})` : ''
    lines.push(`\\matrix${opts}${name} {`)

    for (const row of matrix.rows) {
      const cells = row.map(node => {
        if (!node) return ''
        const nodeOpts = emitOptions(node.rawOptions)
        return `\\node${nodeOpts} {${node.label}};`
      })
      lines.push(`${indent}${cells.join(' & ')} \\\\`)
    }

    lines.push('};')
  }

  return lines.join('\n')
}

// ── Scope ────────────────────────────────────────────────────────────────────

export function emitScope(
  scope: IRScope,
  diagram: IRDiagram,
  indent: string,
  depth: number,
): string {
  const opts = emitOptions(scope.rawOptions)
  const lines: string[] = []
  lines.push(`\\begin{scope}${opts}`)
  for (const child of scope.children) {
    const emitted = emitElement(child, diagram, indent, depth + 1)
    if (emitted) lines.push(indent + emitted)
  }
  lines.push('\\end{scope}')
  return lines.join('\n')
}

// ── Knot ─────────────────────────────────────────────────────────────────────

export function emitKnot(knot: IRKnot, indent: string): string {
  const lines: string[] = []
  lines.push('\\begin{knot}')
  for (const strand of knot.strands) {
    // Emit each strand as a \strand command with bezier segments
    const segs = strand.segments
    if (segs.length === 0) continue
    const parts: string[] = [`(${ptToCm(segs[0].x0)}, ${ptToCm(segs[0].y0)})`]
    for (const s of segs) {
      parts.push(
        `.. controls (${ptToCm(s.cx1)}, ${ptToCm(s.cy1)}) and (${ptToCm(s.cx2)}, ${ptToCm(s.cy2)}) .. (${ptToCm(s.x3)}, ${ptToCm(s.y3)})`,
      )
    }
    lines.push(`${indent}\\strand[line width=${fmt(strand.drawWidth)}pt] ${parts.join(' ')};`)
  }
  if (knot.flipCrossings.length > 0) {
    for (const idx of knot.flipCrossings) {
      lines.push(`${indent}\\flipcrossings{${idx + 1}}`)
    }
  }
  lines.push('\\end{knot}')
  return lines.join('\n')
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Build a node-id → node-name map from the diagram's nodeRegistry.
 * nodeRegistry is name→id; we need id→name for edge emission.
 */
export function buildIdToNameMap(diagram: IRDiagram): Map<string, string> {
  const map = new Map<string, string>()
  for (const [name, id] of Object.entries(diagram.nodeRegistry)) {
    map.set(id, name)
  }
  return map
}

/**
 * Collect all tikzcd arrows from the element list, grouped by the matrix
 * that contains their source node.
 */
export function collectTikzcdArrows(elements: IRElement[]): IRTikzcdArrow[] {
  const arrows: IRTikzcdArrow[] = []
  for (const el of elements) {
    if ('tikzcdKind' in el && el.tikzcdKind) {
      arrows.push(el as IRTikzcdArrow)
    }
    if (el.kind === 'scope') {
      arrows.push(...collectTikzcdArrows(el.children))
    }
  }
  return arrows
}

/**
 * Find which matrix contains a given node id (by scanning matrix rows).
 */
function findMatrixForNode(elements: IRElement[], nodeId: string): IRMatrix | undefined {
  for (const el of elements) {
    if (el.kind === 'matrix') {
      for (const row of el.rows) {
        for (const cell of row) {
          if (cell && cell.id === nodeId) return el
        }
      }
    }
    if (el.kind === 'scope') {
      const found = findMatrixForNode(el.children, nodeId)
      if (found) return found
    }
  }
  return undefined
}

export function emitElement(
  el: IRElement,
  diagram: IRDiagram,
  indent: string,
  depth: number,
): string | null {
  switch (el.kind) {
    case 'node':
      return emitNode(el)
    case 'coordinate':
      return emitCoordinate(el)
    case 'path':
      return emitPath(el)
    case 'edge':
      return emitEdge(el, buildIdToNameMap(diagram))
    case 'scope':
      return emitScope(el, diagram, indent, depth)
    case 'matrix': {
      // Collect tikzcd arrows that belong to this matrix
      const allArrows = collectTikzcdArrows(diagram.elements)
      const matrixArrows = allArrows.filter(a => {
        const m = findMatrixForNode(diagram.elements, a.from)
        return m && m.id === el.id
      })
      return emitMatrix(el, matrixArrows, indent)
    }
    case 'knot':
      return emitKnot(el, indent)
    default:
      // tikzcd-arrow: handled within matrix emission, skip standalone
      if ('tikzcdKind' in el) return null
      return null
  }
}
