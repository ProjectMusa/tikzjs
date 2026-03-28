/**
 * Playwright E2E tests for the D3 interactive editor.
 *
 * Verifies that UI interactions (drag, etc.) produce the same IR mutations
 * as calling irMutator functions directly.
 */

import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// PT_TO_PX = 52 / 28.4528 ≈ 1.8268
const PT_TO_PX = 52 / 28.4528

interface FixtureTarget {
  kind: 'node' | 'path' | 'edge'
  index: number
}

interface FixtureStep {
  mutation: {
    action: string
    target: FixtureTarget
    args: Record<string, any>
  }
  uiAction: {
    type: string
    target: FixtureTarget
    deltaXPt?: number
    deltaYPt?: number
    segIdx?: number
    cpRole?: string
    newLabel?: string
    labelIndex?: number
    key?: string
  }
}

interface E2EFixture {
  description: string
  goldenFixture: string
  steps: FixtureStep[]
}

const FIXTURES_DIR = path.join(__dirname, 'fixtures')
const COORD_TOLERANCE = 1.5 // pt — allow rounding from px↔pt conversion

function loadFixtures(): { name: string; fixture: E2EFixture }[] {
  const files = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'))
  return files.map(f => ({
    name: f.replace('.json', ''),
    fixture: JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf8')),
  }))
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Dispatch a full mousedown→mousemove(steps)→mouseup sequence on an element. */
async function dispatchDrag(
  page: Page,
  elementSelector: string,
  deltaXPt: number,
  deltaYPt: number,
): Promise<void> {
  await page.evaluate((params) => {
    const svg = document.querySelector('.editor-overlay svg') as SVGSVGElement
    if (!svg) throw new Error('No SVG')
    const el = svg.querySelector(params.selector) as SVGElement
      ?? document.querySelector(params.selector) as SVGElement
    if (!el) throw new Error(`Element not found: ${params.selector}`)

    const rect = el.getBoundingClientRect()
    const startClientX = rect.x + rect.width / 2
    const startClientY = rect.y + rect.height / 2

    const ctm = svg.getScreenCTM()!
    const dxScreen = params.deltaXPt * params.ptToPx * ctm.a
    const dyScreen = -params.deltaYPt * params.ptToPx * ctm.d

    const endClientX = startClientX + dxScreen
    const endClientY = startClientY + dyScreen

    el.dispatchEvent(new MouseEvent('mousedown', {
      clientX: startClientX, clientY: startClientY,
      screenX: startClientX, screenY: startClientY,
      bubbles: true, cancelable: true, button: 0, buttons: 1, view: window,
    }))

    const steps = 10
    for (let i = 1; i <= steps; i++) {
      window.dispatchEvent(new MouseEvent('mousemove', {
        clientX: startClientX + (dxScreen * i) / steps,
        clientY: startClientY + (dyScreen * i) / steps,
        screenX: startClientX + (dxScreen * i) / steps,
        screenY: startClientY + (dyScreen * i) / steps,
        bubbles: true, cancelable: true, button: 0, buttons: 1, view: window,
      }))
    }

    window.dispatchEvent(new MouseEvent('mouseup', {
      clientX: endClientX, clientY: endClientY,
      screenX: endClientX, screenY: endClientY,
      bubbles: true, cancelable: true, button: 0, buttons: 0, view: window,
    }))
  }, { selector: elementSelector, deltaXPt, deltaYPt, ptToPx: PT_TO_PX })
}

/** Click an SVG element to select it in the D3 editor. */
async function clickElement(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as SVGElement
    if (!el) throw new Error(`Click target not found: ${sel}`)
    const rect = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('click', {
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
      bubbles: true, cancelable: true, button: 0, view: window,
    }))
  }, selector)
}

// ── Test runner ──────────────────────────────────────────────────────────────

const fixtures = loadFixtures()

for (const { name, fixture } of fixtures) {
  const supported = fixture.steps.some(s => ['drag', 'drag-cp', 'edit-label', 'edit-edge-label', 'delete', 'nudge'].includes(s.uiAction.type))
  if (!supported) continue

  test(`e2e: ${name} — ${fixture.description}`, async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__tikzjs !== undefined, { timeout: 10000 })

    await page.evaluate(async (fixtureName: string) => {
      await (window as any).__tikzjs.loadFixture(fixtureName)
    }, fixture.goldenFixture)

    await page.waitForSelector('.editor-overlay svg', { timeout: 5000 })
    await page.waitForTimeout(500)

    for (const step of fixture.steps) {
      // ════════════════════════════════════════════════════════════════════
      // Node drag
      // ════════════════════════════════════════════════════════════════════
      if (step.uiAction.type === 'drag') {
        const setup = await page.evaluate((params) => {
          function collectAllNodes(elements: any[]): any[] {
            const nodes: any[] = []
            for (const el of elements) {
              if (el.kind === 'node') nodes.push(el)
              if (el.kind === 'scope') nodes.push(...collectAllNodes(el.children))
              if (el.kind === 'path') nodes.push(...el.inlineNodes)
              if (el.kind === 'matrix') {
                for (const row of el.rows) for (const cell of row) if (cell) nodes.push(cell)
              }
            }
            return nodes
          }
          function findNodeById(elements: any[], id: string): any {
            for (const el of elements) {
              if (el.kind === 'node' && el.id === id) return el
              if (el.kind === 'scope') { const f = findNodeById(el.children, id); if (f) return f }
              if (el.kind === 'path') { for (const n of el.inlineNodes) { if (n.id === id) return n } }
            }
            return null
          }

          const tikzjs = (window as any).__tikzjs
          const ir = tikzjs.getIR()
          if (!ir) throw new Error('No IR available')

          const allNodes = collectAllNodes(ir.elements)
          if (params.targetIndex >= allNodes.length) {
            throw new Error(`Node index ${params.targetIndex} out of range (${allNodes.length} found)`)
          }
          const targetNode = allNodes[params.targetIndex]
          if (targetNode.position.coord.cs !== 'xy') throw new Error(`Node ${targetNode.id} not draggable`)

          const newX = targetNode.position.coord.x + params.deltaXPt
          const newY = targetNode.position.coord.y + params.deltaYPt

          const irCopy = JSON.parse(JSON.stringify(ir))
          tikzjs.applyMutation(irCopy, params.action, { nodeId: targetNode.id, x: newX, y: newY })
          const mutatedNode = findNodeById(irCopy.elements, targetNode.id)

          return {
            elementId: targetNode.id,
            expectedX: mutatedNode.position.coord.x,
            expectedY: mutatedNode.position.coord.y,
          }
        }, {
          targetIndex: step.mutation.target.index,
          action: step.mutation.action,
          deltaXPt: step.uiAction.deltaXPt,
          deltaYPt: step.uiAction.deltaYPt,
        })

        const svgEl = page.locator(`.editor-overlay svg [data-ir-id="${setup.elementId}"]`).first()
        await expect(svgEl).toBeVisible({ timeout: 3000 })
        expect(await svgEl.evaluate(el => el.classList.contains('d3-draggable'))).toBe(true)

        await dispatchDrag(page, `[data-ir-id="${setup.elementId}"]`, step.uiAction.deltaXPt, step.uiAction.deltaYPt)
        await page.waitForTimeout(1000)

        const actual = await page.evaluate((params) => {
          function findNodeById(elements: any[], id: string): any {
            for (const el of elements) {
              if (el.kind === 'node' && el.id === id) return el
              if (el.kind === 'scope') { const f = findNodeById(el.children, id); if (f) return f }
              if (el.kind === 'path') { for (const n of el.inlineNodes) { if (n.id === id) return n } }
            }
            return null
          }
          const ir = (window as any).__tikzjs.getIR()
          const node = findNodeById(ir.elements, params.elementId)
          if (!node) throw new Error(`Node ${params.elementId} not found after drag`)
          return { x: node.position.coord.x, y: node.position.coord.y }
        }, { elementId: setup.elementId })

        expect(Math.abs(actual.x - setup.expectedX)).toBeLessThan(COORD_TOLERANCE)
        expect(Math.abs(actual.y - setup.expectedY)).toBeLessThan(COORD_TOLERANCE)
      }

      // ════════════════════════════════════════════════════════════════════
      // Control point drag
      // ════════════════════════════════════════════════════════════════════
      if (step.uiAction.type === 'drag-cp') {
        const segIdx = step.uiAction.segIdx!
        const cpRole = step.uiAction.cpRole!

        // Resolve the path element ID and compute expected result
        const setup = await page.evaluate((params) => {
          function findElement(elements: any[], id: string): any {
            for (const el of elements) {
              if (el.id === id) return el
              if (el.kind === 'scope') { const f = findElement(el.children, id); if (f) return f }
            }
            return null
          }
          function collectPaths(elements: any[]): any[] {
            const paths: any[] = []
            for (const el of elements) {
              if (el.kind === 'path') paths.push(el)
              if (el.kind === 'scope') paths.push(...collectPaths(el.children))
            }
            return paths
          }

          const tikzjs = (window as any).__tikzjs
          const ir = tikzjs.getIR()
          if (!ir) throw new Error('No IR available')

          const paths = collectPaths(ir.elements)
          if (params.targetIndex >= paths.length) {
            throw new Error(`Path index ${params.targetIndex} out of range (${paths.length} found)`)
          }
          const targetPath = paths[params.targetIndex]
          const pathId = targetPath.id
          const seg = targetPath.segments[params.segIdx]
          if (!seg) throw new Error(`Segment ${params.segIdx} not found in path ${pathId}`)

          // Read the original control point position
          let origX: number, origY: number
          if (params.cpRole === 'to' || params.cpRole === 'move') {
            if (seg.to.coord.cs !== 'xy') throw new Error('Segment endpoint not xy')
            origX = seg.to.coord.x
            origY = seg.to.coord.y
          } else {
            const cpIdx = params.cpRole === 'cp1' ? 0 : 1
            const cp = seg.controls?.[cpIdx]
            if (!cp || cp.coord.cs !== 'xy') throw new Error(`Control point ${params.cpRole} not xy`)
            origX = cp.coord.x
            origY = cp.coord.y
          }

          const newX = origX + params.deltaXPt
          const newY = origY + params.deltaYPt

          // Apply programmatic mutation on a deep clone
          const irCopy = JSON.parse(JSON.stringify(ir))
          tikzjs.applyMutation(irCopy, params.action, {
            pathId, segIdx: params.segIdx, cpRole: params.cpRole, x: newX, y: newY,
          })

          // Read expected from mutated copy
          const mutatedPath = findElement(irCopy.elements, pathId)
          const mutatedSeg = mutatedPath.segments[params.segIdx]
          let expectedX: number, expectedY: number
          if (params.cpRole === 'to' || params.cpRole === 'move') {
            expectedX = mutatedSeg.to.coord.x
            expectedY = mutatedSeg.to.coord.y
          } else {
            const cpIdx = params.cpRole === 'cp1' ? 0 : 1
            expectedX = mutatedSeg.controls[cpIdx].coord.x
            expectedY = mutatedSeg.controls[cpIdx].coord.y
          }

          return { pathId, expectedX, expectedY }
        }, {
          targetIndex: step.mutation.target.index,
          action: step.mutation.action,
          segIdx,
          cpRole,
          deltaXPt: step.uiAction.deltaXPt,
          deltaYPt: step.uiAction.deltaYPt,
        })

        // Click the path to select it → triggers highlight with control point handles
        const pathSelector = `.editor-overlay svg [data-ir-id="${setup.pathId}"]`
        await expect(page.locator(pathSelector).first()).toBeVisible({ timeout: 3000 })
        await clickElement(page, pathSelector)
        await page.waitForTimeout(500)

        // Find the control point handle
        const handleSelector =
          `[data-d3-role="cp-handle"][data-ir-path-id="${setup.pathId}"][data-seg-idx="${segIdx}"][data-cp-role="${cpRole}"]`
        await expect(page.locator(handleSelector).first()).toBeVisible({ timeout: 3000 })

        // Drag the control point handle
        await dispatchDrag(page, handleSelector, step.uiAction.deltaXPt, step.uiAction.deltaYPt)
        await page.waitForTimeout(1000)

        // Read resulting IR
        const actual = await page.evaluate((params) => {
          function findElement(elements: any[], id: string): any {
            for (const el of elements) {
              if (el.id === id) return el
              if (el.kind === 'scope') { const f = findElement(el.children, id); if (f) return f }
            }
            return null
          }
          const ir = (window as any).__tikzjs.getIR()
          const p = findElement(ir.elements, params.pathId)
          if (!p) throw new Error(`Path ${params.pathId} not found after drag`)
          const seg = p.segments[params.segIdx]
          if (params.cpRole === 'to' || params.cpRole === 'move') {
            return { x: seg.to.coord.x, y: seg.to.coord.y }
          }
          const cpIdx = params.cpRole === 'cp1' ? 0 : 1
          return { x: seg.controls[cpIdx].coord.x, y: seg.controls[cpIdx].coord.y }
        }, { pathId: setup.pathId, segIdx, cpRole })

        expect(Math.abs(actual.x - setup.expectedX)).toBeLessThan(COORD_TOLERANCE)
        expect(Math.abs(actual.y - setup.expectedY)).toBeLessThan(COORD_TOLERANCE)
      }

      // ════════════════════════════════════════════════════════════════════
      // Label edit
      // ════════════════════════════════════════════════════════════════════
      if (step.uiAction.type === 'edit-label') {
        const newLabel = step.uiAction.newLabel!

        // Resolve the node element and compute expected label via programmatic mutation
        const setup = await page.evaluate((params) => {
          function collectAllNodes(elements: any[]): any[] {
            const nodes: any[] = []
            for (const el of elements) {
              if (el.kind === 'node') nodes.push(el)
              if (el.kind === 'scope') nodes.push(...collectAllNodes(el.children))
              if (el.kind === 'path') nodes.push(...el.inlineNodes)
              if (el.kind === 'matrix') {
                for (const row of el.rows) for (const cell of row) if (cell) nodes.push(cell)
              }
            }
            return nodes
          }

          const tikzjs = (window as any).__tikzjs
          const ir = tikzjs.getIR()
          if (!ir) throw new Error('No IR available')

          const allNodes = collectAllNodes(ir.elements)
          if (params.targetIndex >= allNodes.length) {
            throw new Error(`Node index ${params.targetIndex} out of range (${allNodes.length} found)`)
          }
          const targetNode = allNodes[params.targetIndex]

          // Apply programmatic mutation on a deep clone
          const irCopy = JSON.parse(JSON.stringify(ir))
          tikzjs.applyMutation(irCopy, params.action, { nodeId: targetNode.id, label: params.newLabel })

          function findNodeById(elements: any[], id: string): any {
            for (const el of elements) {
              if (el.kind === 'node' && el.id === id) return el
              if (el.kind === 'scope') { const f = findNodeById(el.children, id); if (f) return f }
              if (el.kind === 'path') { for (const n of el.inlineNodes) { if (n.id === id) return n } }
            }
            return null
          }
          const mutatedNode = findNodeById(irCopy.elements, targetNode.id)

          return {
            elementId: targetNode.id,
            expectedLabel: mutatedNode.label,
          }
        }, {
          targetIndex: step.mutation.target.index,
          action: step.mutation.action,
          newLabel,
        })

        // Find the node element and double-click it via two rapid mousedown events
        // (the editor uses mousedown-timing detection to bypass d3-drag's click suppression)
        const svgEl = page.locator(`.editor-overlay svg [data-ir-id="${setup.elementId}"]`).first()
        await expect(svgEl).toBeVisible({ timeout: 3000 })
        await page.evaluate((sel) => {
          const el = document.querySelector(sel) as SVGElement
          if (!el) throw new Error(`Click target not found: ${sel}`)
          const rect = el.getBoundingClientRect()
          const opts = {
            clientX: rect.x + rect.width / 2,
            clientY: rect.y + rect.height / 2,
            bubbles: true, cancelable: true, button: 0, view: window,
          }
          el.dispatchEvent(new MouseEvent('mousedown', opts))
          el.dispatchEvent(new MouseEvent('mouseup', opts))
          el.dispatchEvent(new MouseEvent('mousedown', opts))
          el.dispatchEvent(new MouseEvent('mouseup', opts))
        }, `.editor-overlay svg [data-ir-id="${setup.elementId}"]`)

        // Wait for the inline input to appear
        const input = page.locator('.d3-label-input')
        await expect(input).toBeVisible({ timeout: 3000 })

        // Clear and type the new label
        await input.fill(newLabel)
        await input.press('Enter')

        // Wait for re-render
        await page.waitForTimeout(1000)

        // Read resulting IR and compare
        const actual = await page.evaluate((params) => {
          function findNodeById(elements: any[], id: string): any {
            for (const el of elements) {
              if (el.kind === 'node' && el.id === id) return el
              if (el.kind === 'scope') { const f = findNodeById(el.children, id); if (f) return f }
              if (el.kind === 'path') { for (const n of el.inlineNodes) { if (n.id === id) return n } }
            }
            return null
          }
          const ir = (window as any).__tikzjs.getIR()
          const node = findNodeById(ir.elements, params.elementId)
          if (!node) throw new Error(`Node ${params.elementId} not found after edit`)
          return { label: node.label }
        }, { elementId: setup.elementId })

        expect(actual.label).toBe(setup.expectedLabel)
      }

      // ════════════════════════════════════════════════════════════════════
      // Edge label edit
      // ════════════════════════════════════════════════════════════════════
      if (step.uiAction.type === 'edit-edge-label') {
        const newLabel = step.uiAction.newLabel!
        const labelIndex = step.uiAction.labelIndex ?? 0

        const setup = await page.evaluate((params) => {
          function collectEdges(elements: any[]): any[] {
            const edges: any[] = []
            for (const el of elements) {
              if (el.kind === 'edge') edges.push(el)
              if (el.kind === 'scope') edges.push(...collectEdges(el.children))
            }
            return edges
          }

          const tikzjs = (window as any).__tikzjs
          const ir = tikzjs.getIR()
          if (!ir) throw new Error('No IR available')

          const edges = collectEdges(ir.elements)
          if (params.targetIndex >= edges.length) {
            throw new Error(`Edge index ${params.targetIndex} out of range (${edges.length} found)`)
          }
          const targetEdge = edges[params.targetIndex]
          if (params.labelIndex >= targetEdge.labels.length) {
            throw new Error(`Label index ${params.labelIndex} out of range (${targetEdge.labels.length} found)`)
          }

          // Apply programmatic mutation on a deep clone
          const irCopy = JSON.parse(JSON.stringify(ir))
          tikzjs.applyMutation(irCopy, params.action, {
            edgeId: targetEdge.id, labelIndex: params.labelIndex, label: params.newLabel,
          })

          function findEdgeById(elements: any[], id: string): any {
            for (const el of elements) {
              if (el.kind === 'edge' && el.id === id) return el
              if (el.kind === 'scope') { const f = findEdgeById(el.children, id); if (f) return f }
            }
            return null
          }
          const mutatedEdge = findEdgeById(irCopy.elements, targetEdge.id)

          return {
            edgeId: targetEdge.id,
            labelId: `${targetEdge.id}:label:${params.labelIndex}`,
            expectedLabel: mutatedEdge.labels[params.labelIndex].text,
          }
        }, {
          targetIndex: step.mutation.target.index,
          action: step.mutation.action,
          labelIndex,
          newLabel,
        })

        // Find the edge label element and double-click it
        const labelSelector = `.editor-overlay svg [data-ir-id="${setup.labelId}"]`
        await expect(page.locator(labelSelector).first()).toBeVisible({ timeout: 3000 })
        await page.evaluate((sel) => {
          const el = document.querySelector(sel) as SVGElement
          if (!el) throw new Error(`Edge label not found: ${sel}`)
          const rect = el.getBoundingClientRect()
          const opts = {
            clientX: rect.x + rect.width / 2,
            clientY: rect.y + rect.height / 2,
            bubbles: true, cancelable: true, button: 0, view: window,
          }
          el.dispatchEvent(new MouseEvent('mousedown', opts))
          el.dispatchEvent(new MouseEvent('mouseup', opts))
          el.dispatchEvent(new MouseEvent('mousedown', opts))
          el.dispatchEvent(new MouseEvent('mouseup', opts))
        }, labelSelector)

        // Wait for the inline input to appear
        const input = page.locator('.d3-label-input')
        await expect(input).toBeVisible({ timeout: 3000 })

        // Clear and type the new label
        await input.fill(newLabel)
        await input.press('Enter')

        // Wait for re-render
        await page.waitForTimeout(1000)

        // Read resulting IR and compare
        const actual = await page.evaluate((params) => {
          function findEdgeById(elements: any[], id: string): any {
            for (const el of elements) {
              if (el.kind === 'edge' && el.id === id) return el
              if (el.kind === 'scope') { const f = findEdgeById(el.children, id); if (f) return f }
            }
            return null
          }
          const ir = (window as any).__tikzjs.getIR()
          const edge = findEdgeById(ir.elements, params.edgeId)
          if (!edge) throw new Error(`Edge ${params.edgeId} not found after edit`)
          return { label: edge.labels[params.labelIndex].text }
        }, { edgeId: setup.edgeId, labelIndex })

        expect(actual.label).toBe(setup.expectedLabel)
      }

      // ════════════════════════════════════════════════════════════════════
      // Delete element
      // ════════════════════════════════════════════════════════════════════
      if (step.uiAction.type === 'delete') {
        const setup = await page.evaluate((params) => {
          function collectAllNodes(elements: any[]): any[] {
            const nodes: any[] = []
            for (const el of elements) {
              if (el.kind === 'node') nodes.push(el)
              if (el.kind === 'scope') nodes.push(...collectAllNodes(el.children))
              if (el.kind === 'path') nodes.push(...el.inlineNodes)
              if (el.kind === 'matrix') {
                for (const row of el.rows) for (const cell of row) if (cell) nodes.push(cell)
              }
            }
            return nodes
          }
          function collectByKind(elements: any[], kind: string): any[] {
            const result: any[] = []
            for (const el of elements) {
              if (el.kind === kind) result.push(el)
              if (el.kind === 'scope') result.push(...collectByKind(el.children, kind))
            }
            return result
          }

          const tikzjs = (window as any).__tikzjs
          const ir = tikzjs.getIR()
          if (!ir) throw new Error('No IR available')

          let targetId: string
          if (params.targetKind === 'node') {
            const allNodes = collectAllNodes(ir.elements)
            if (params.targetIndex >= allNodes.length) {
              throw new Error(`Node index ${params.targetIndex} out of range`)
            }
            targetId = allNodes[params.targetIndex].id
          } else {
            const items = collectByKind(ir.elements, params.targetKind)
            if (params.targetIndex >= items.length) {
              throw new Error(`${params.targetKind} index ${params.targetIndex} out of range`)
            }
            targetId = items[params.targetIndex].id
          }

          // Apply programmatic mutation on a deep clone to get expected element count
          const irCopy = JSON.parse(JSON.stringify(ir))
          tikzjs.applyMutation(irCopy, params.action, { elementId: targetId })

          return {
            elementId: targetId,
            expectedElementCount: irCopy.elements.length,
          }
        }, {
          targetKind: step.mutation.target.kind,
          targetIndex: step.mutation.target.index,
          action: step.mutation.action,
        })

        // Click the element to select it
        const selector = `.editor-overlay svg [data-ir-id="${setup.elementId}"]`
        await expect(page.locator(selector).first()).toBeVisible({ timeout: 3000 })
        await clickElement(page, selector)
        await page.waitForTimeout(300)

        // Press Delete key
        await page.keyboard.press('Delete')
        await page.waitForTimeout(1000)

        // Verify the element was removed
        const actual = await page.evaluate((params) => {
          const ir = (window as any).__tikzjs.getIR()
          function findById(elements: any[], id: string): any {
            for (const el of elements) {
              if ('id' in el && el.id === id) return el
              if (el.kind === 'scope') { const f = findById(el.children, id); if (f) return f }
              if (el.kind === 'path') {
                for (const n of el.inlineNodes) { if (n.id === id) return n }
              }
            }
            return null
          }
          return {
            elementCount: ir.elements.length,
            elementStillExists: findById(ir.elements, params.elementId) !== null,
          }
        }, { elementId: setup.elementId })

        expect(actual.elementStillExists).toBe(false)
        expect(actual.elementCount).toBe(setup.expectedElementCount)
      }

      // ════════════════════════════════════════════════════════════════════
      // Nudge node (arrow keys)
      // ════════════════════════════════════════════════════════════════════
      if (step.uiAction.type === 'nudge') {
        const arrowKey = step.uiAction.key!

        const setup = await page.evaluate((params) => {
          function collectAllNodes(elements: any[]): any[] {
            const nodes: any[] = []
            for (const el of elements) {
              if (el.kind === 'node') nodes.push(el)
              if (el.kind === 'scope') nodes.push(...collectAllNodes(el.children))
              if (el.kind === 'path') nodes.push(...el.inlineNodes)
              if (el.kind === 'matrix') {
                for (const row of el.rows) for (const cell of row) if (cell) nodes.push(cell)
              }
            }
            return nodes
          }
          function findNodeById(elements: any[], id: string): any {
            for (const el of elements) {
              if (el.kind === 'node' && el.id === id) return el
              if (el.kind === 'scope') { const f = findNodeById(el.children, id); if (f) return f }
              if (el.kind === 'path') { for (const n of el.inlineNodes) { if (n.id === id) return n } }
            }
            return null
          }

          const tikzjs = (window as any).__tikzjs
          const ir = tikzjs.getIR()
          if (!ir) throw new Error('No IR available')

          const allNodes = collectAllNodes(ir.elements)
          if (params.targetIndex >= allNodes.length) {
            throw new Error(`Node index ${params.targetIndex} out of range`)
          }
          const targetNode = allNodes[params.targetIndex]
          if (targetNode.position.coord.cs !== 'xy') throw new Error('Not draggable')

          const newX = targetNode.position.coord.x + params.deltaXPt
          const newY = targetNode.position.coord.y + params.deltaYPt

          const irCopy = JSON.parse(JSON.stringify(ir))
          tikzjs.applyMutation(irCopy, params.action, { nodeId: targetNode.id, x: newX, y: newY })
          const mutatedNode = findNodeById(irCopy.elements, targetNode.id)

          return {
            elementId: targetNode.id,
            expectedX: mutatedNode.position.coord.x,
            expectedY: mutatedNode.position.coord.y,
          }
        }, {
          targetIndex: step.mutation.target.index,
          action: step.mutation.action,
          deltaXPt: step.mutation.args.deltaXPt,
          deltaYPt: step.mutation.args.deltaYPt,
        })

        // Click the node to select it
        const selector = `.editor-overlay svg [data-ir-id="${setup.elementId}"]`
        await expect(page.locator(selector).first()).toBeVisible({ timeout: 3000 })
        await clickElement(page, selector)
        await page.waitForTimeout(300)

        // Press the arrow key
        await page.keyboard.press(arrowKey)
        await page.waitForTimeout(1000)

        // Read resulting IR and compare
        const actual = await page.evaluate((params) => {
          function findNodeById(elements: any[], id: string): any {
            for (const el of elements) {
              if (el.kind === 'node' && el.id === id) return el
              if (el.kind === 'scope') { const f = findNodeById(el.children, id); if (f) return f }
              if (el.kind === 'path') { for (const n of el.inlineNodes) { if (n.id === id) return n } }
            }
            return null
          }
          const ir = (window as any).__tikzjs.getIR()
          const node = findNodeById(ir.elements, params.elementId)
          if (!node) throw new Error(`Node ${params.elementId} not found after nudge`)
          return { x: node.position.coord.x, y: node.position.coord.y }
        }, { elementId: setup.elementId })

        expect(Math.abs(actual.x - setup.expectedX)).toBeLessThan(COORD_TOLERANCE)
        expect(Math.abs(actual.y - setup.expectedY)).toBeLessThan(COORD_TOLERANCE)
      }
    }
  })
}
