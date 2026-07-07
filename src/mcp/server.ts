#!/usr/bin/env node
/**
 * tikzjs MCP Server
 *
 * Exposes tikzjs as an MCP tool so Claude (Desktop, Code, or web) can
 * render TikZ diagrams to SVG without a TeX installation.
 *
 * Tools:
 *   render_tikz         — TikZ source → SVG string
 *   parse_tikz          — TikZ source → IR JSON (for inspection / round-trip)
 *   tikz_view_component — TikZ source → ready-to-paste MDX viewer component
 *                         (<TikZInteractive/> or <TikZ/>), validated by parsing
 *   view_tikz           — MCP App: renders the diagram in an interactive
 *                         viewer iframe on hosts supporting the Apps extension
 *                         (requires the bundle built by scripts/build-mcp-app.mjs)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { z } from 'zod'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

// ── tikz_view_component ──────────────────────────────────────────────────────

server.tool(
  'tikz_view_component',
  'Validate TikZ source and return a ready-to-paste MDX view component instead of raw SVG: ' +
    '<TikZInteractive/> (drag/pan/zoom viewer with edit mode) or <TikZ/> (static, prerendered to SVG at build time). ' +
    'Use this when authoring blog content; use render_tikz only when the SVG itself is needed.',
  {
    source: z.string().describe('TikZ source code (e.g. \\begin{tikzpicture}...\\end{tikzpicture})'),
    caption: z.string().optional().describe('Optional figure caption'),
    interactive: z
      .boolean()
      .optional()
      .describe('Emit <TikZInteractive/> (default: true). Pass false for the static <TikZ/> component.'),
    height: z.number().optional().describe('Viewport height in px for the interactive viewer (default: 400)'),
  },
  async ({ source, caption, interactive, height }) => {
    try {
      // Validate — parse errors surface here instead of at page load.
      parse(source)

      const code = source.trim()
      // The snippet embeds the source in a String.raw template literal,
      // which cannot represent backticks or ${.
      if (code.includes('`') || code.includes('${')) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: TikZ source contains ` or ${, which cannot be embedded in a String.raw template literal.',
            },
          ],
          isError: true,
        }
      }

      const tag = interactive === false ? 'TikZ' : 'TikZInteractive'
      const attrs: string[] = []
      if (caption) attrs.push(`caption="${caption.replace(/"/g, '&quot;')}"`)
      if (tag === 'TikZInteractive' && height) attrs.push(`height={${height}}`)
      const attrStr = attrs.length ? ` ${attrs.join(' ')}` : ''

      const snippet = `<${tag}${attrStr} code={String.raw\`\n${code}\n\`} />`
      return {
        content: [{ type: 'text' as const, text: snippet }],
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

// ── view_tikz (MCP App: interactive viewer iframe) ───────────────────────────

const VIEWER_URI = 'ui://tikzjs/viewer.html'
// server.ts compiles to dist/mcp/server.js; the bundle sits alongside it.
const VIEWER_HTML_PATH = join(__dirname, 'mcp-app.html')

registerAppTool(
  server,
  'view_tikz',
  {
    title: 'View TikZ diagram',
    description:
      'Render TikZ source in an interactive viewer displayed directly in the conversation ' +
      '(drag nodes, pan/zoom, reset, copy adjusted TikZ). Requires a host supporting MCP Apps; ' +
      'other hosts receive a text summary. Use render_tikz for a plain SVG instead.',
    inputSchema: {
      source: z.string().describe('TikZ source code (e.g. \\begin{tikzpicture}...\\end{tikzpicture})'),
    },
    // Declaring the output schema is what makes hosts forward structuredContent
    // to the app iframe; without it some hosts drop the structured payload.
    outputSchema: {
      source: z.string(),
      diagram: z.record(z.string(), z.unknown()).describe('tikzjs IR diagram (JSON)'),
    },
    _meta: { ui: { resourceUri: VIEWER_URI } },
  },
  async ({ source }: { source: string }) => {
    try {
      const diagram = parse(source)
      return {
        content: [
          {
            type: 'text' as const,
            text: `Rendered an interactive TikZ diagram (${diagram.elements.length} top-level element(s)).`,
          },
        ],
        structuredContent: { source, diagram: JSON.parse(serializeIR(diagram)) },
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

registerAppResource(
  server,
  'TikZ Interactive Viewer',
  VIEWER_URI,
  { description: 'Self-contained interactive TikZ diagram viewer (D3 editor + MathJax).' },
  async () => {
    if (!existsSync(VIEWER_HTML_PATH)) {
      throw new Error(
        `Viewer bundle not found at ${VIEWER_HTML_PATH} — run \`node scripts/build-mcp-app.mjs\` in tikzjs.`,
      )
    }
    return {
      contents: [
        {
          uri: VIEWER_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: readFileSync(VIEWER_HTML_PATH, 'utf8'),
        },
      ],
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
