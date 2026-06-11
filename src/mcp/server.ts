#!/usr/bin/env node
/**
 * tikzjs MCP Server
 *
 * Exposes tikzjs as an MCP tool so Claude (Desktop, Code, or web) can
 * render TikZ diagrams to SVG without a TeX installation.
 *
 * Tools:
 *   render_tikz  — TikZ source → SVG string
 *   parse_tikz   — TikZ source → IR JSON (for inspection / round-trip)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { parse, generate, serializeIR } from '../core.js'

// ── Server setup ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'tikzjs',
  version: '0.1.0',
})

// ── render_tikz ──────────────────────────────────────────────────────────────

server.tool(
  'render_tikz',
  'Render TikZ source code to an SVG string. Returns self-contained SVG with MathJax-rendered math.',
  {
    source: z.string().describe('TikZ source code (e.g. \\begin{tikzpicture}...\\end{tikzpicture})'),
    padding: z.number().optional().describe('SVG padding in pt (default: 5)'),
  },
  async ({ source, padding }) => {
    try {
      const svg = generate(source, { padding })
      return {
        content: [{ type: 'text' as const, text: svg }],
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text' as const, text: `Error rendering TikZ: ${message}` }],
        isError: true,
      }
    }
  },
)

// ── parse_tikz ───────────────────────────────────────────────────────────────

server.tool(
  'parse_tikz',
  'Parse TikZ source code to the tikzjs intermediate representation (IR) as JSON. Useful for inspecting diagram structure or round-tripping.',
  {
    source: z.string().describe('TikZ source code'),
  },
  async ({ source }) => {
    try {
      const diagram = parse(source)
      return {
        content: [{ type: 'text' as const, text: serializeIR(diagram) }],
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text' as const, text: `Error parsing TikZ: ${message}` }],
        isError: true,
      }
    }
  },
)

// ── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // Server is now listening on stdio — Claude will send JSON-RPC messages.
  // Log to stderr so we don't interfere with the JSON-RPC protocol on stdout.
  console.error('tikzjs MCP server running on stdio')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
