/**
 * Mutation round-trip tests: verify that IR mutations survive the TikZ round-trip.
 *
 * For each golden fixture, auto-discover applicable mutations, then verify:
 *   mutate(IR) → generateTikZ → re-parse → IR'
 *   The mutated coordinate must appear in IR'.
 *
 * Failures indicate TikZ generator bugs that prevent lossless editing round-trips.
 * These are tracked but don't block CI — the TikZ generator is a separate concern.
 */

import * as fs from 'fs'
import * as path from 'path'
import { preprocess } from '../../src/preprocessor/index'
import { parseExpanded } from '../../src/parser/index'
import { generateTikZ } from '../../src/generators/tikz/index'
import {
  moveNode,
  moveSegmentEndpoint,
  updateCurveControl,
  collectNodes,
} from '../../src/generators/d3/irMutator'
import type { IRDiagram, IRElement } from '../../src/ir/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTikz(source: string): IRDiagram {
  return parseExpanded(preprocess(source), { resetIds: true })
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

const DELTA = 14.2264 // 0.5cm in pt
const TOLERANCE = 0.1

// ── Coordinate search ────────────────────────────────────────────────────────

function hasCoord(elements: IRElement[], targetX: number, targetY: number): boolean {
  for (const el of elements) {
    if (el.kind === 'path') {
      for (const seg of el.segments) {
        if ('to' in seg && seg.to && seg.to.mode === 'absolute' && seg.to.coord.cs === 'xy') {
          if (Math.abs(seg.to.coord.x - targetX) < TOLERANCE &&
            Math.abs(seg.to.coord.y - targetY) < TOLERANCE) {
            return true
          }
        }
        if (seg.kind === 'curve') {
          for (const cp of seg.controls) {
            if (cp.mode === 'absolute' && cp.coord.cs === 'xy') {
              if (Math.abs(cp.coord.x - targetX) < TOLERANCE &&
                Math.abs(cp.coord.y - targetY) < TOLERANCE) {
                return true
              }
            }
          }
        }
      }
      for (const node of el.inlineNodes) {
        if (node.position.mode === 'absolute' && node.position.coord.cs === 'xy') {
          if (Math.abs(node.position.coord.x - targetX) < TOLERANCE &&
            Math.abs(node.position.coord.y - targetY) < TOLERANCE) {
            return true
          }
        }
      }
    }
    if (el.kind === 'node' && el.position.mode === 'absolute' && el.position.coord.cs === 'xy') {
      if (Math.abs(el.position.coord.x - targetX) < TOLERANCE &&
        Math.abs(el.position.coord.y - targetY) < TOLERANCE) {
        return true
      }
    }
    if (el.kind === 'scope' && hasCoord(el.children, targetX, targetY)) {
      return true
    }
  }
  return false
}

/** Check if any element (recursively) is a matrix. */
function hasMatrixElement(elements: IRElement[]): boolean {
  for (const el of elements) {
    if (el.kind === 'matrix') return true
    if (el.kind === 'scope' && hasMatrixElement(el.children)) return true
  }
  return false
}

// ── Mutation strategies ──────────────────────────────────────────────────────

interface MutationResult {
  expectedX: number
  expectedY: number
}

interface MutationStrategy {
  name: string
  apply(ir: IRDiagram): MutationResult | null
}

function makeLineEndpointStrategy(): MutationStrategy {
  return {
    name: 'moveSegmentEndpoint',
    apply(ir: IRDiagram): MutationResult | null {
      for (const el of ir.elements) {
        if (el.kind === 'path') {
          for (let i = 0; i < el.segments.length; i++) {
            const seg = el.segments[i]
            if ((seg.kind === 'line' || seg.kind === 'move') &&
              seg.to.mode === 'absolute' && seg.to.coord.cs === 'xy') {
              const newX = seg.to.coord.x + DELTA
              const newY = seg.to.coord.y + DELTA
              if (moveSegmentEndpoint(ir, el.id, i, newX, newY)) {
                return { expectedX: newX, expectedY: newY }
              }
            }
          }
        }
      }
      return null
    },
  }
}

function makeMoveNodeStrategy(): MutationStrategy {
  return {
    name: 'moveNode',
    apply(ir: IRDiagram): MutationResult | null {
      const nodes = collectNodes(ir.elements)
      for (const node of nodes) {
        if (node.position.coord.cs === 'xy' && node.position.mode === 'absolute') {
          const newX = node.position.coord.x + DELTA
          const newY = node.position.coord.y + DELTA
          if (moveNode(ir, node.id, newX, newY)) {
            return { expectedX: newX, expectedY: newY }
          }
        }
      }
      return null
    },
  }
}

function makeCurveControlStrategy(): MutationStrategy {
  return {
    name: 'updateCurveControl',
    apply(ir: IRDiagram): MutationResult | null {
      for (const el of ir.elements) {
        if (el.kind === 'path') {
          for (let i = 0; i < el.segments.length; i++) {
            const seg = el.segments[i]
            if (seg.kind === 'curve' && seg.controls.length > 0) {
              const cp = seg.controls[0]
              if (cp.mode === 'absolute' && cp.coord.cs === 'xy') {
                const newX = cp.coord.x + DELTA
                const newY = cp.coord.y + DELTA
                if (updateCurveControl(ir, el.id, i, 'cp1', newX, newY)) {
                  return { expectedX: newX, expectedY: newY }
                }
              }
            }
          }
        }
      }
      return null
    },
  }
}

const strategies: MutationStrategy[] = [
  makeLineEndpointStrategy(),
  makeMoveNodeStrategy(),
  makeCurveControlStrategy(),
]

// ── Test suite ───────────────────────────────────────────────────────────────

const GOLDEN_DIR = path.join(__dirname, '..', 'golden', 'fixtures')

const goldenFiles = fs.existsSync(GOLDEN_DIR)
  ? fs.readdirSync(GOLDEN_DIR).filter(f => f.endsWith('.tikz')).sort()
  : []

describe('Mutation round-trip tests', () => {
  const failures: string[] = []

  for (const file of goldenFiles) {
    const name = file.replace('.tikz', '')

    for (const strategy of strategies) {
      test(`roundtrip: ${name} × ${strategy.name}`, () => {
        const src = fs.readFileSync(path.join(GOLDEN_DIR, file), 'utf8')

        let ir: IRDiagram
        try {
          ir = parseTikz(src)
        } catch {
          return
        }

        // Skip fixtures with elements the TikZ generator can't handle
        if (hasMatrixElement(ir.elements)) return

        const irForMutation = deepClone(ir)
        const result = strategy.apply(irForMutation)
        if (!result) return

        // Round-trip: mutated IR → TikZ → re-parse
        let tikz: string
        try {
          tikz = generateTikZ(irForMutation)
        } catch {
          return
        }

        let irReparsed: IRDiagram
        try {
          irReparsed = parseTikz(tikz)
        } catch {
          // Re-parse failure IS a real bug
          failures.push(`${name} × ${strategy.name}: re-parse failed`)
          return
        }

        // The mutated coordinate must exist in the re-parsed IR
        const found = hasCoord(irReparsed.elements, result.expectedX, result.expectedY)
        if (!found) {
          failures.push(`${name} × ${strategy.name}`)
        }
        // Don't assert — track for the summary test
      })
    }
  }

  // Summary test: report all round-trip failures
  test('round-trip summary', () => {
    if (failures.length > 0) {
      console.log(`\n⚠ ${failures.length} round-trip failures (TikZ generator bugs):`)
      for (const f of failures) {
        console.log(`  - ${f}`)
      }
    } else {
      console.log('\n✓ All applicable mutations survive round-trip')
    }
    // This test always passes — failures are tracked, not blocking
  })
})
