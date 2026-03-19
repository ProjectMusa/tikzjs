/**
 * Knot environment preprocessor.
 *
 * Extracts \begin{knot}[opts]...\end{knot} environments, replacing each with a
 * \tikzjsKnot{id} placeholder. Strand bezier data is stored for the generator
 * to compute over/under crossing effects.
 *
 * Convention (matches the `knots` TikZ library):
 *   - The FIRST \strand listed is the OVER-strand by default.
 *   - `flip crossing = N` (1-based) makes the Nth crossing's later strand go over.
 */

// ── Public types ───────────────────────────────────────────────────────────────

/** One cubic bezier segment, coordinates in TeX points. */
export interface IRKnotBezier {
  x0: number; y0: number    // start
  cx1: number; cy1: number  // control point 1
  cx2: number; cy2: number  // control point 2
  x3: number; y3: number    // end
}

export interface KnotStrand {
  optStr: string              // raw option string e.g. "thick"
  segments: IRKnotBezier[]
}

export interface KnotEnvironment {
  clipWidth: number           // multiplier (default 5)
  flipCrossings: number[]     // 0-based crossing indices to flip
  strands: KnotStrand[]
}

// ── Dimension parsing ──────────────────────────────────────────────────────────

/** Convert a TikZ dimension string to TeX points. */
function dimToPt(s: string): number {
  s = s.trim()
  if (s.endsWith('cm')) return parseFloat(s) * 28.4528
  if (s.endsWith('pt')) return parseFloat(s)
  if (s.endsWith('mm')) return parseFloat(s) * 2.84528
  if (s.endsWith('in')) return parseFloat(s) * 72.27
  // Bare number → cm (TikZ default unit)
  return parseFloat(s) * 28.4528
}

/** Parse "(x,y)" coordinate string → [x_pt, y_pt]. */
function parseCoord(s: string): [number, number] {
  const m = s.match(/\(\s*([^,)]+?)\s*,\s*([^)]+?)\s*\)/)
  if (!m) throw new Error(`Cannot parse knot coordinate: "${s}"`)
  return [dimToPt(m[1]), dimToPt(m[2])]
}

// ── Option parsing ─────────────────────────────────────────────────────────────

function parseKnotOpts(optStr: string): { clipWidth: number; flipCrossings: number[] } {
  let clipWidth = 5
  const flipCrossings: number[] = []

  const cwMatch = optStr.match(/clip\s*width\s*=\s*([0-9.]+)/)
  if (cwMatch) clipWidth = parseFloat(cwMatch[1])

  // flip crossing = N  (1-based in TikZ → 0-based internally)
  const fcRe = /flip\s*crossing\s*=\s*([0-9]+)/g
  let m: RegExpExecArray | null
  while ((m = fcRe.exec(optStr)) !== null) {
    flipCrossings.push(parseInt(m[1]) - 1)
  }

  return { clipWidth, flipCrossings }
}

/** Parse strand option string → line width in pt. */
export function strandDrawWidth(optStr: string): number {
  if (/\bultra thick\b/.test(optStr)) return 1.6
  if (/\bvery thick\b/.test(optStr)) return 1.2
  if (/\bthick\b/.test(optStr)) return 0.8
  if (/\bthin\b/.test(optStr)) return 0.4
  if (/\bvery thin\b/.test(optStr)) return 0.2
  if (/\bultrathin\b/.test(optStr)) return 0.1
  const lw = optStr.match(/line\s*width\s*=\s*([0-9.]+)\s*(pt|mm|cm)?/)
  if (lw) return dimToPt(lw[1] + (lw[2] ?? 'pt'))
  return 0.4  // TikZ default
}

// ── Strand path parsing ────────────────────────────────────────────────────────

/** Parse strand path string → bezier segments. */
function parseStrandPath(pathStr: string): IRKnotBezier[] {
  const segs: IRKnotBezier[] = []
  const s = pathStr.trim().replace(/;$/, '').trim()

  // Extract first coordinate
  const firstMatch = s.match(/^\s*(\([^)]+\))/)
  if (!firstMatch) return segs
  let prev = parseCoord(firstMatch[1])

  // Find cubic bezier segments: .. controls (cp1) and (cp2) .. (end)
  const cubicRe = /\.\.\s*controls\s*(\([^)]+\))\s*and\s*(\([^)]+\))\s*\.\.\s*(\([^)]+\))/g
  // Find line segments: -- (end)
  const lineRe = /--\s*(\([^)]+\))/g

  type SegInfo = { index: number; kind: 'cubic' | 'line'; match: RegExpExecArray }
  const found: SegInfo[] = []

  let m: RegExpExecArray | null
  while ((m = cubicRe.exec(s)) !== null) found.push({ index: m.index, kind: 'cubic', match: m })
  while ((m = lineRe.exec(s)) !== null) found.push({ index: m.index, kind: 'line', match: m })
  found.sort((a, b) => a.index - b.index)

  for (const seg of found) {
    if (seg.kind === 'cubic') {
      const cp1 = parseCoord(seg.match[1])
      const cp2 = parseCoord(seg.match[2])
      const end = parseCoord(seg.match[3])
      segs.push({ x0: prev[0], y0: prev[1], cx1: cp1[0], cy1: cp1[1], cx2: cp2[0], cy2: cp2[1], x3: end[0], y3: end[1] })
      prev = end
    } else {
      const end = parseCoord(seg.match[1])
      // Degenerate cubic (straight line)
      segs.push({ x0: prev[0], y0: prev[1], cx1: prev[0], cy1: prev[1], cx2: end[0], cy2: end[1], x3: end[0], y3: end[1] })
      prev = end
    }
  }

  return segs
}

// ── Main extraction ────────────────────────────────────────────────────────────

let _knotIdCounter = 0

export function extractKnotEnvironments(src: string): {
  expandedSource: string
  knots: Map<string, KnotEnvironment>
} {
  const knots = new Map<string, KnotEnvironment>()
  let result = ''
  let pos = 0

  const beginRe = /\\begin\s*\{\s*knot\s*\}/g
  let m: RegExpExecArray | null

  while ((m = beginRe.exec(src)) !== null) {
    result += src.slice(pos, m.index)
    let i = m.index + m[0].length

    // Read optional [opts]
    while (i < src.length && /\s/.test(src[i])) i++
    let optStr = ''
    if (src[i] === '[') {
      let depth = 0, j = i
      while (j < src.length) {
        if (src[j] === '[') depth++
        else if (src[j] === ']') { depth--; if (depth === 0) { j++; break } }
        j++
      }
      optStr = src.slice(i + 1, j - 1)
      i = j
    }

    // Find matching \end{knot}
    const endRe = /\\end\s*\{\s*knot\s*\}/g
    endRe.lastIndex = i
    const endMatch = endRe.exec(src)
    if (!endMatch) break
    const body = src.slice(i, endMatch.index)
    const afterEnd = endMatch.index + endMatch[0].length

    // Extract \strand[opts] path ; blocks from body
    const strands: KnotStrand[] = []
    let bi = 0
    while (bi < body.length) {
      // Skip whitespace and comments
      while (bi < body.length && /\s/.test(body[bi])) bi++
      if (bi >= body.length) break
      if (body[bi] === '%') { while (bi < body.length && body[bi] !== '\n') bi++; continue }

      if (body.slice(bi, bi + 7) === '\\strand') {
        bi += 7
        while (bi < body.length && /\s/.test(body[bi])) bi++

        let strandOpts = ''
        if (body[bi] === '[') {
          let depth = 0, j = bi
          while (j < body.length) {
            if (body[j] === '[') depth++
            else if (body[j] === ']') { depth--; if (depth === 0) { j++; break } }
            j++
          }
          strandOpts = body.slice(bi + 1, j - 1)
          bi = j
        }

        while (bi < body.length && /\s/.test(body[bi])) bi++
        let pathStr = ''
        let depth = 0
        while (bi < body.length) {
          const ch = body[bi]
          if (ch === '(') depth++
          else if (ch === ')') depth--
          else if (ch === ';' && depth === 0) { bi++; break }
          pathStr += ch
          bi++
        }

        const segments = parseStrandPath(pathStr)
        if (segments.length > 0) strands.push({ optStr: strandOpts, segments })
      } else {
        bi++
      }
    }

    const { clipWidth, flipCrossings } = parseKnotOpts(optStr)
    const id = `knot${_knotIdCounter++}`
    knots.set(id, { clipWidth, flipCrossings, strands })
    result += `\\tikzjsKnot{${id}}`
    pos = afterEnd
    beginRe.lastIndex = afterEnd
  }

  return { expandedSource: result + src.slice(pos), knots }
}
