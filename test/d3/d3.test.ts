/**
 * Edit-step tests: verify that IR mutations produce correct SVG output.
 *
 * Each fixture defines:
 * - TikZ source to parse
 * - A sequence of IR mutation steps (action + args)
 * - Expected SVG output (snapshot)
 *
 * The test pipeline is:
 *   parse(source) → apply mutations → generateSVG(ir) → compare snapshot
 *
 * No browser or DOM interactions — pure Node.js tests.
 */

import * as fs from 'fs'
import * as path from 'path'
import { preprocess } from '../../src/preprocessor/index'
import { parseExpanded } from '../../src/parser/index'
import { generateSVG } from '../../src/generators/svg/index'
import {
  moveNode,
  updateNodeLabel,
  updateCurveControl,
  moveSegmentEndpoint,
  removeElement,
  setStyleProp,
} from '../../src/generators/d3/irMutator'
import type { CpRole } from '../../src/generators/d3/irMutator'
import type { IRDiagram } from '../../src/ir/types'

// ── Mutation dispatch ────────────────────────────────────────────────────────

type MutationFn = (ir: IRDiagram, ...args: any[]) => boolean

const mutators: Record<string, MutationFn> = {
  moveNode: (ir, nodeId: string, x: number, y: number) => moveNode(ir, nodeId, x, y),
  updateNodeLabel: (ir, nodeId: string, label: string) => updateNodeLabel(ir, nodeId, label),
  updateCurveControl: (ir, pathId: string, segIdx: number, cpRole: CpRole, x: number, y: number) =>
    updateCurveControl(ir, pathId, segIdx, cpRole, x, y),
  moveSegmentEndpoint: (ir, pathId: string, segIdx: number, x: number, y: number) =>
    moveSegmentEndpoint(ir, pathId, segIdx, x, y),
  removeElement: (ir, elementId: string) => removeElement(ir, elementId),
  setStyleProp: (ir, elementId: string, key: string, value: any) =>
    setStyleProp(ir, elementId, key, value),
}

// ── Fixture loading ──────────────────────────────────────────────────────────

interface EditStep {
  action: string
  args: any[]
}

interface EditFixture {
  description: string
  source: string
  steps: EditStep[]
}

const FIXTURES_DIR = path.join(__dirname, 'fixtures')
const REFS_DIR = path.join(__dirname, 'refs')

const fixtureFiles = fs.existsSync(FIXTURES_DIR)
  ? fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json')).sort()
  : []

// ── Helper ───────────────────────────────────────────────────────────────────

function parseTikz(source: string): IRDiagram {
  const doc = preprocess(source)
  return parseExpanded(doc, { resetIds: true })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Edit-step tests', () => {
  for (const file of fixtureFiles) {
    const name = file.replace('.json', '')
    const fixturePath = path.join(FIXTURES_DIR, file)
    const refPath = path.join(REFS_DIR, `${name}.svg`)

    const fixture: EditFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

    test(`edit: ${name} — ${fixture.description}`, () => {
      // Parse
      const ir = parseTikz(fixture.source)

      // Apply mutations
      for (const step of fixture.steps) {
        const fn = mutators[step.action]
        expect(fn).toBeDefined()
        const result = fn(ir, ...step.args)
        expect(result).toBe(true)
      }

      // Generate SVG
      const svg = generateSVG(ir)
      expect(svg).toBeTruthy()
      expect(svg).toContain('<svg')

      // Compare against ref if it exists, otherwise write it
      if (fs.existsSync(refPath)) {
        const ref = fs.readFileSync(refPath, 'utf8')
        expect(svg).toBe(ref)
      } else {
        // First run: write the ref
        fs.mkdirSync(REFS_DIR, { recursive: true })
        fs.writeFileSync(refPath, svg, 'utf8')
        console.log(`  Wrote new ref: ${refPath}`)
      }
    })
  }

  if (fixtureFiles.length === 0) {
    test('no fixtures found', () => {
      console.log('No edit-step fixtures in', FIXTURES_DIR)
    })
  }
})
