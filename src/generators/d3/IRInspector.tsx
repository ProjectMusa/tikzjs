
import { useState, useCallback } from 'react'
import type {
  IRDiagram,
  IRElement,
  IRNode,
  IRPath,
  IRScope,
  IRMatrix,
  IREdge,
  IRKnot,
  CoordRef,
  RawOption,
} from '../../ir/types.js'

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = {
  panel: {
    width: '100%',
    height: '100%',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'monospace',
    fontSize: 12,
    overflow: 'auto',
    padding: 0,
    display: 'flex',
    flexDirection: 'column' as const,
  } as React.CSSProperties,
  header: {
    padding: '6px 10px',
    borderBottom: '1px solid var(--color-border)',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--color-text)',
    background: 'var(--color-panel)',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } as React.CSSProperties,
  tabBar: {
    display: 'flex',
    gap: 2,
    padding: '4px 8px',
    borderBottom: '1px solid var(--color-border)',
    background: 'var(--color-panel)',
    flexShrink: 0,
  } as React.CSSProperties,
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '4px 0',
  } as React.CSSProperties,
}

type InspectorMode = 'elements' | 'tree'

// ── Coord formatting ────────────────────────────────────────────────────────

function formatCoord(ref: CoordRef): string {
  const c = ref.coord
  const prefix = ref.mode === 'relative' ? '++' : ref.mode === 'relative-pass' ? '+' : ''
  switch (c.cs) {
    case 'xy':
      return `${prefix}(${c.x.toFixed(1)}, ${c.y.toFixed(1)})pt`
    case 'polar':
      return `${prefix}(${c.angle}:${c.radius.toFixed(1)})pt`
    case 'node-anchor':
      return `${prefix}(${c.nodeName}.${c.anchor})`
    case 'node-placement':
      return `${c.direction}=of ${c.refName}`
    case 'calc':
      return `calc(...)`
  }
}

function formatOptions(opts: RawOption[]): string {
  if (!opts || opts.length === 0) return ''
  const parts = opts.map((o) => {
    if (!o.value) return o.key
    if (typeof o.value === 'string') return `${o.key}=${o.value}`
    return `${o.key}={...}`
  })
  return parts.join(', ')
}

// ── Kind colors ─────────────────────────────────────────────────────────────

const KIND_COLORS: Record<string, string> = {
  node: '#a6e3a1',
  coordinate: '#94e2d5',
  path: '#89b4fa',
  scope: '#cba6f7',
  matrix: '#fab387',
  edge: '#f9e2af',
  knot: '#f38ba8',
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span
      className="kind-badge"
      style={{
        background: KIND_COLORS[kind] ?? 'var(--color-muted)',
        color: 'var(--color-bg)',
        borderRadius: 3,
        padding: '0 4px',
        fontSize: 10,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {kind}
    </span>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MODE 1: Elements — flat list of nodes and paths, clickable for selection
// ══════════════════════════════════════════════════════════════════════════════

function collectFlatElements(elements: IRElement[]): IRElement[] {
  const result: IRElement[] = []
  for (const el of elements) {
    if (el.kind === 'scope') {
      result.push(...collectFlatElements((el as IRScope).children))
    } else if (el.kind === 'matrix') {
      result.push(el)
      for (const row of (el as IRMatrix).rows) {
        for (const cell of row) {
          if (cell) result.push(cell)
        }
      }
    } else if (el.kind === 'path') {
      result.push(el)
      for (const n of (el as IRPath).inlineNodes) {
        result.push(n)
      }
    } else {
      result.push(el)
    }
  }
  return result
}

function elementSummary(el: IRElement): string {
  switch (el.kind) {
    case 'node': {
      const n = el as IRNode
      const name = n.name ? `(${n.name}) ` : ''
      const label = n.label
        ? `"${n.label.length > 24 ? n.label.slice(0, 24) + '...' : n.label}"`
        : ''
      return `${name}${label} at ${formatCoord(n.position)}`
    }
    case 'coordinate': {
      const name = el.name ? `(${el.name}) ` : ''
      return `${name}at ${formatCoord(el.position)}`
    }
    case 'path': {
      const p = el as IRPath
      const cmd =
        p.rawOptions.some((o) => o.key === 'fill') && p.rawOptions.some((o) => o.key === 'draw')
          ? '\\filldraw'
          : p.rawOptions.some((o) => o.key === 'fill')
            ? '\\fill'
            : '\\draw'
      return `${cmd} ${p.segments.length} segments`
    }
    case 'matrix': {
      const m = el as IRMatrix
      return `${m.rows.length}x${m.rows[0]?.length ?? 0}${m.name ? ' (' + m.name + ')' : ''}`
    }
    case 'edge': {
      const e = el as IREdge
      return `${e.from} -> ${e.to} (${e.routing.kind})`
    }
    case 'knot': {
      const k = el as IRKnot
      return `${k.strands.length} strands`
    }
    default:
      return ''
  }
}

interface ElementListProps {
  diagram: IRDiagram
  selectedId: string | null
  onSelect: (id: string | null) => void
}

function ElementList({ diagram, selectedId, onSelect }: ElementListProps) {
  const flatElements = collectFlatElements(diagram.elements)

  return (
    <div>
      {flatElements.map((el) => {
        const isSelected = el.id === selectedId
        return (
          <div
            key={el.id}
            className={`inspector-row${isSelected ? ' selected' : ''}`}
            onClick={() => onSelect(isSelected ? null : el.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              cursor: 'pointer',
              borderLeft: isSelected ? '3px solid #f59e0b' : '3px solid transparent',
            }}
          >
            <KindBadge kind={el.kind} />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
            >
              {elementSummary(el)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MODE 2: Tree — JSON-serializable tree view (existing behavior)
// ══════════════════════════════════════════════════════════════════════════════

interface TreeRowProps {
  depth: number
  kind: string
  summary: string
  children?: React.ReactNode
  id?: string
  selectedId?: string | null
  onSelect?: (id: string | null) => void
}

function TreeRow({ depth, kind, summary, children, id, selectedId, onSelect }: TreeRowProps) {
  const [open, setOpen] = useState(true)
  const hasChildren = !!children
  const isSelected = id != null && id === selectedId

  return (
    <div>
      <div
        className={`inspector-row${isSelected ? ' selected' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'baseline',
          padding: '2px 8px 2px ' + (8 + depth * 14) + 'px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          borderLeft: isSelected ? '3px solid #f59e0b' : '3px solid transparent',
        }}
        onClick={(e) => {
          if (hasChildren && !id) {
            setOpen((o) => !o)
          } else if (id && onSelect) {
            onSelect(isSelected ? null : id)
          }
          if (hasChildren) setOpen((o) => !o)
        }}
      >
        {hasChildren ? (
          <span style={{ width: 14, flexShrink: 0, color: 'var(--color-muted)', fontSize: 10 }}>
            {open ? '\u25BC' : '\u25B6'}
          </span>
        ) : (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}
        <KindBadge kind={kind} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', marginLeft: 6 }}>
          {summary}
        </span>
      </div>
      {hasChildren && open && <div>{children}</div>}
    </div>
  )
}

function NodeTreeRow({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: IRNode
  depth: number
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const name = node.name ? `(${node.name})` : ''
  const label = node.label
    ? ` "${node.label.length > 30 ? node.label.slice(0, 30) + '...' : node.label}"`
    : ''
  const pos = formatCoord(node.position)

  return (
    <TreeRow
      depth={depth}
      kind="node"
      summary={`${name} at ${pos}${label}`}
      id={node.id}
      selectedId={selectedId}
      onSelect={onSelect}
    >
      {node.rawOptions.length > 0 && (
        <div
          style={{
            padding: '1px 8px 1px ' + (8 + (depth + 1) * 14 + 14) + 'px',
            color: 'var(--color-muted)',
            fontSize: 11,
          }}
        >
          [{formatOptions(node.rawOptions)}]
        </div>
      )}
    </TreeRow>
  )
}

function ElementTreeRow({
  el,
  depth,
  diagram,
  selectedId,
  onSelect,
}: {
  el: IRElement
  depth: number
  diagram: IRDiagram
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  switch (el.kind) {
    case 'node':
      return <NodeTreeRow node={el} depth={depth} selectedId={selectedId} onSelect={onSelect} />

    case 'coordinate': {
      const name = el.name ? `(${el.name})` : ''
      const pos = formatCoord(el.position)
      return (
        <TreeRow
          depth={depth}
          kind="coord"
          summary={`${name} at ${pos}`}
          id={el.id}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )
    }

    case 'path': {
      const segs = el.segments.length
      const opts = formatOptions(el.rawOptions)
      const cmd =
        el.rawOptions.some((o) => o.key === 'fill') && el.rawOptions.some((o) => o.key === 'draw')
          ? 'filldraw'
          : el.rawOptions.some((o) => o.key === 'fill')
            ? 'fill'
            : 'draw'
      return (
        <TreeRow
          depth={depth}
          kind="path"
          summary={`\\${cmd} ${segs} segs${opts ? ' [' + opts + ']' : ''}`}
          id={el.id}
          selectedId={selectedId}
          onSelect={onSelect}
        >
          {el.segments.map((seg, i) => {
            let desc: string
            switch (seg.kind) {
              case 'move':
                desc = `moveto ${formatCoord(seg.to)}`
                break
              case 'line':
                desc = `lineto ${formatCoord(seg.to)}`
                break
              case 'hv-line':
                desc = `${seg.hvFirst ? '-|' : '|-'} ${formatCoord(seg.to)}`
                break
              case 'curve':
                desc = `curveto ${formatCoord(seg.to)}`
                break
              case 'arc':
                desc = `arc ${seg.startAngle}:${seg.endAngle}:${seg.xRadius.toFixed(1)}pt`
                break
              case 'to':
                desc = `to ${formatCoord(seg.to)}`
                break
              case 'circle':
                desc = `circle r=${seg.radius.toFixed(1)}pt`
                break
              case 'ellipse':
                desc = `ellipse ${seg.xRadius.toFixed(1)}x${seg.yRadius.toFixed(1)}pt`
                break
              case 'close':
                desc = 'cycle'
                break
              case 'node-on-path':
                desc = `node ${seg.nodeId}`
                break
              default:
                desc = seg.kind
            }
            return (
              <div
                key={i}
                style={{
                  padding: '1px 8px 1px ' + (8 + (depth + 1) * 14 + 14) + 'px',
                  color: 'var(--color-muted)',
                  fontSize: 11,
                }}
              >
                {desc}
              </div>
            )
          })}
          {(el as IRPath).inlineNodes.length > 0 && (
            <>
              <div
                style={{
                  padding: '1px 8px 1px ' + (8 + (depth + 1) * 14 + 14) + 'px',
                  color: 'var(--color-muted)',
                  fontSize: 10,
                  fontStyle: 'italic',
                }}
              >
                inline nodes:
              </div>
              {(el as IRPath).inlineNodes.map((n) => (
                <NodeTreeRow key={n.id} node={n} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
              ))}
            </>
          )}
        </TreeRow>
      )
    }

    case 'scope':
      return (
        <TreeRow depth={depth} kind="scope" summary={`${el.children.length} children`} id={el.id} selectedId={selectedId} onSelect={onSelect}>
          {el.children.map((child) => (
            <ElementTreeRow
              key={child.id}
              el={child}
              depth={depth + 1}
              diagram={diagram}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </TreeRow>
      )

    case 'matrix': {
      const rows = el.rows.length
      const cols = el.rows[0]?.length ?? 0
      return (
        <TreeRow
          depth={depth}
          kind="matrix"
          summary={`${rows}x${cols}${el.name ? ' (' + el.name + ')' : ''}`}
          id={el.id}
          selectedId={selectedId}
          onSelect={onSelect}
        >
          {el.rows.map((row, r) =>
            row.map((cell, c) =>
              cell ? (
                <div key={`${r}-${c}`}>
                  <div
                    style={{
                      padding: '1px 8px 1px ' + (8 + (depth + 1) * 14 + 14) + 'px',
                      color: 'var(--color-muted)',
                      fontSize: 10,
                    }}
                  >
                    [{r},{c}]
                  </div>
                  <NodeTreeRow node={cell} depth={depth + 2} selectedId={selectedId} onSelect={onSelect} />
                </div>
              ) : null,
            ),
          )}
        </TreeRow>
      )
    }

    case 'edge': {
      const from = el.from
      const to = el.to
      const routing = el.routing.kind
      const labels = el.labels.length
      return (
        <TreeRow
          depth={depth}
          kind={'tikzcdKind' in el ? 'arrow' : 'edge'}
          summary={`${from} -> ${to} (${routing})${labels ? ' ' + labels + ' labels' : ''}`}
          id={el.id}
          selectedId={selectedId}
          onSelect={onSelect}
        >
          {el.labels.map((l, i) => (
            <div
              key={i}
              style={{
                padding: '1px 8px 1px ' + (8 + (depth + 1) * 14 + 14) + 'px',
                color: 'var(--color-muted)',
                fontSize: 11,
              }}
            >
              label: "{l.text.length > 30 ? l.text.slice(0, 30) + '...' : l.text}"
              {l.swap ? ' (swap)' : ''}
              {l.description ? ' (desc)' : ''}
            </div>
          ))}
        </TreeRow>
      )
    }

    case 'knot': {
      const strands = (el as IRKnot).strands.length
      const flips = (el as IRKnot).flipCrossings.length
      return (
        <TreeRow
          depth={depth}
          kind="knot"
          summary={`${strands} strands, ${flips} flips`}
          id={el.id}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )
    }

    default:
      return null
  }
}

function TreeView({
  diagram,
  selectedId,
  onSelect,
}: {
  diagram: IRDiagram
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const elemCount = diagram.elements.length
  const nodeCount = Object.keys(diagram.nodeRegistry).length

  return (
    <div>
      <div style={{ padding: '4px 8px', color: 'var(--color-muted)', fontSize: 11, borderBottom: '1px solid var(--color-border)' }}>
        {elemCount} elements, {nodeCount} named nodes
        {Object.keys(diagram.styleRegistry).length > 0 && (
          <>, {Object.keys(diagram.styleRegistry).length} styles</>
        )}
      </div>
      {diagram.elements.map((el) => (
        <ElementTreeRow key={el.id} el={el} depth={0} diagram={diagram} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Main component
// ══════════════════════════════════════════════════════════════════════════════

export interface IRInspectorProps {
  diagram: IRDiagram | null
  /** Called when user clicks an element. Pass the id to D3EditorPanel.highlightElementId. */
  onSelectElement?: (elementId: string | null) => void
  /** Currently selected element id (controlled). */
  selectedElementId?: string | null
}

export function IRInspector({ diagram, onSelectElement, selectedElementId }: IRInspectorProps) {
  const [mode, setMode] = useState<InspectorMode>('elements')
  const selectedId = selectedElementId ?? null

  const handleSelect = useCallback(
    (id: string | null) => {
      if (onSelectElement) onSelectElement(id)
    },
    [onSelectElement],
  )

  const tabStyle = (active: boolean) =>
    ({
      background: active ? 'var(--color-activebtn)' : 'transparent',
      color: active ? 'var(--color-text)' : 'var(--color-muted)',
      border: 'none',
      borderRadius: 4,
      padding: '2px 10px',
      fontSize: 11,
      cursor: 'pointer',
    }) as React.CSSProperties

  if (!diagram) {
    return (
      <div style={styles.panel}>
        <div style={styles.header}>IR Inspector</div>
        <div style={{ padding: '12px 10px', color: 'var(--color-muted)' }}>No diagram loaded</div>
      </div>
    )
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>IR Inspector</div>
      <div style={styles.tabBar}>
        <button style={tabStyle(mode === 'elements')} onClick={() => setMode('elements')}>
          Elements
        </button>
        <button style={tabStyle(mode === 'tree')} onClick={() => setMode('tree')}>
          Tree
        </button>
      </div>
      <div style={styles.content}>
        {mode === 'elements' ? (
          <ElementList diagram={diagram} selectedId={selectedId} onSelect={handleSelect} />
        ) : (
          <TreeView diagram={diagram} selectedId={selectedId} onSelect={handleSelect} />
        )}
      </div>
    </div>
  )
}
