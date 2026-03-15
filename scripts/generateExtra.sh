#!/usr/bin/env bash
# Generate extra SVG reference files from TikZ fixtures using TexLive.
# Requires: pdflatex, dvisvgm (or pdf2svg)
#
# Usage: bash scripts/generateextra.sh
#
# Set TIKZJS_ROOT to the project root (default: parent of this script's dir)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${TIKZJS_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

FIXTURES_DIR="$PROJECT_ROOT/test/extra/fixtures"
REFS_DIR="$PROJECT_ROOT/test/extra/refs"
TMPDIR_BASE="$(mktemp -d)"

echo "Generating extra SVGs..."
echo "  Fixtures: $FIXTURES_DIR"
echo "  Refs:     $REFS_DIR"

mkdir -p "$REFS_DIR"

# Check for required tools
if ! command -v pdflatex &>/dev/null; then
  echo "ERROR: pdflatex not found. Install TeX Live."
  exit 1
fi

if command -v dvisvgm &>/dev/null; then
  SVG_TOOL="dvisvgm"
elif command -v pdf2svg &>/dev/null; then
  SVG_TOOL="pdf2svg"
else
  echo "ERROR: Neither dvisvgm nor pdf2svg found."
  exit 1
fi

for tikz_file in "$FIXTURES_DIR"/*.tikz; do
  base="$(basename "$tikz_file" .tikz)"
  tmpdir="$TMPDIR_BASE/$base"
  mkdir -p "$tmpdir"

  echo "  Processing: $base"

  FIXTURE_CONTENT="$(cat "$tikz_file")"

  # Extract %!preamble...%!end-preamble block (added by fetch.py for \tikzstyle/\tikzset defs)
  PREAMBLE_DEFS=""
  if echo "$FIXTURE_CONTENT" | grep -q '^%!preamble'; then
    PREAMBLE_DEFS="$(echo "$FIXTURE_CONTENT" | sed -n '/^%!preamble$/,/^%!end-preamble$/p' \
      | grep -v '^%!preamble$' | grep -v '^%!end-preamble$' | sed 's/^%  //')"
    # Strip the preamble block from the fixture content passed to LaTeX
    FIXTURE_CONTENT="$(echo "$FIXTURE_CONTENT" | sed '/^%!preamble$/,/^%!end-preamble$/d')"
    # Balance any unmatched braces in the extracted defs (fetch.py sometimes drops closing braces)
    if [[ -n "$PREAMBLE_DEFS" ]]; then
      open_count=$(echo "$PREAMBLE_DEFS" | tr -cd '{' | wc -c)
      close_count=$(echo "$PREAMBLE_DEFS" | tr -cd '}' | wc -c)
      if (( open_count > close_count )); then
        for (( i=0; i < open_count - close_count; i++ )); do
          PREAMBLE_DEFS+="}"
        done
      fi
    fi
  fi

  # Conditionally add tikz-cd if the fixture uses it
  TIKZCD_PKG=""
  if echo "$FIXTURE_CONTENT" | grep -q '\\begin{tikzcd}'; then
    TIKZCD_PKG="\\usepackage{tikz-cd}"
  fi

  # Conditionally add mwe if the fixture uses \includegraphics (provides example-image etc.)
  MWE_PKG=""
  if echo "$FIXTURE_CONTENT" | grep -q '\\includegraphics'; then
    MWE_PKG="\\usepackage{mwe}"
  fi

  # Wrap fixture in a standalone LaTeX document with a broad library set.
  # Real-world fixtures from the HuggingFace dataset commonly use:
  #   positioning, arrows.meta, shapes, calc, decorations, patterns, matrix, fit, backgrounds
  # Loading all of these costs nothing and prevents hard compilation failures
  # from missing library features (unlike missing \tikzstyle defs, which are just warnings).
  cat > "$tmpdir/doc.tex" << LATEX_EOF
\\documentclass[border=2pt]{standalone}
\\usepackage{amsmath,amssymb}
\\usepackage{tikz}
$TIKZCD_PKG
$MWE_PKG
\\usetikzlibrary{
  arrows, arrows.meta,
  shapes, shapes.geometric, shapes.symbols, shapes.arrows, shapes.multipart,
  positioning,
  calc,
  decorations, decorations.pathreplacing, decorations.markings, decorations.text,
  patterns,
  matrix,
  fit,
  backgrounds,
  shadows,
  through,
  intersections,
  automata,
  angles,
  quotes,
}
$PREAMBLE_DEFS
\\begin{document}
$FIXTURE_CONTENT
\\end{document}
LATEX_EOF

  # Detect if fixture uses TikZ fill patterns — pdflatex/dvisvgm --pdf strips these to fill='none'.
  # Use the DVI path (latex + dvisvgm) for pattern fixtures to preserve hatch/dot fills.
  USE_DVI=0
  if echo "$FIXTURE_CONTENT" | grep -qE 'pattern\s*=\s*(north|south|horizontal|vertical|grid|crosshatch|dots)'; then
    USE_DVI=1
  fi

  if [[ "$USE_DVI" == "1" ]]; then
    # DVI path: preserves pattern fills
    latex -interaction=nonstopmode -output-directory="$tmpdir" "$tmpdir/doc.tex" \
        > "$tmpdir/latex.log" 2>&1 || true
    if [[ ! -f "$tmpdir/doc.dvi" ]]; then
      echo "    WARNING: latex failed to produce DVI for $base (see $tmpdir/latex.log)"
      continue
    fi
    if [[ "$SVG_TOOL" == "dvisvgm" ]]; then
      if ! dvisvgm "$tmpdir/doc.dvi" -o "$REFS_DIR/$base.svg" \
          > "$tmpdir/dvisvgm.log" 2>&1; then
        echo "    WARNING: dvisvgm failed for $base"
        continue
      fi
    else
      echo "    WARNING: pdf2svg cannot process DVI — skipping pattern fixture $base"
      continue
    fi
  else
    # PDF path: better text rendering for non-pattern fixtures
    pdflatex -interaction=nonstopmode -output-directory="$tmpdir" "$tmpdir/doc.tex" \
        > "$tmpdir/pdflatex.log" 2>&1 || true
    if [[ ! -f "$tmpdir/doc.pdf" ]]; then
      echo "    WARNING: pdflatex failed to produce PDF for $base (see $tmpdir/pdflatex.log)"
      continue
    fi

    if [[ "$SVG_TOOL" == "dvisvgm" ]]; then
      if ! dvisvgm --pdf "$tmpdir/doc.pdf" -o "$REFS_DIR/$base.svg" \
          > "$tmpdir/dvisvgm.log" 2>&1; then
        echo "    WARNING: dvisvgm failed for $base"
        continue
      fi
    else
      if ! pdf2svg "$tmpdir/doc.pdf" "$REFS_DIR/$base.svg"; then
        echo "    WARNING: pdf2svg failed for $base"
        continue
      fi
    fi
  fi

  echo "    OK -> $REFS_DIR/$base.svg"
done

rm -rf "$TMPDIR_BASE"
echo "Done. References saved to $REFS_DIR/"
