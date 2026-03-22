#!/usr/bin/env bash
# Generate golden SVG reference files from TikZ fixtures using TexLive.
# Requires: pdflatex, dvisvgm (or pdf2svg)
#
# Usage: bash scripts/generateGolden.sh
#
# Set TIKZJS_ROOT to the project root (default: parent of this script's dir)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${TIKZJS_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

FIXTURES_DIR="$PROJECT_ROOT/test/golden/fixtures"
REFS_DIR="$PROJECT_ROOT/test/golden/refs"
TMPDIR_BASE="$(mktemp -d)"

echo "Generating golden SVGs..."
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

  # Determine required packages from fixture filename
  PACKAGES="tikz"
  if [[ "$base" == *"tikzcd"* ]]; then
    PACKAGES="tikz,tikz-cd"
  fi

  # Create a minimal LaTeX document wrapping the fixture
  FIXTURE_CONTENT="$(cat "$tikz_file")"

  # Detect environment type and required libraries
  TIKZ_LIBRARIES=""
  if echo "$FIXTURE_CONTENT" | grep -q '\\begin{knot}'; then
    TIKZ_LIBRARIES="knots"
  fi
  if echo "$FIXTURE_CONTENT" | grep -qE 'arrows=\{|Stealth\[|Latex\[|-Stealth|-Latex'; then
    TIKZ_LIBRARIES="${TIKZ_LIBRARIES:+$TIKZ_LIBRARIES,}arrows.meta"
  fi
  if echo "$FIXTURE_CONTENT" | grep -qE 'ellipse|regular polygon|star|trapezium|semicircle|cylinder|diamond'; then
    TIKZ_LIBRARIES="${TIKZ_LIBRARIES:+$TIKZ_LIBRARIES,}shapes.geometric"
  fi

  if echo "$FIXTURE_CONTENT" | grep -q '\\begin{tikzcd}'; then
    USE_PACKAGES="\\usepackage{tikz}\\usepackage{tikz-cd}"
  else
    USE_PACKAGES="\\usepackage{tikz}"
  fi

  if [[ -n "$TIKZ_LIBRARIES" ]]; then
    USE_PACKAGES="${USE_PACKAGES}\\usetikzlibrary{${TIKZ_LIBRARIES}}"
  fi

  cat > "$tmpdir/doc.tex" << LATEX_EOF
\\documentclass[border=2pt]{standalone}
$USE_PACKAGES
\\begin{document}
$FIXTURE_CONTENT
\\end{document}
LATEX_EOF

  # Run pdflatex
  if ! pdflatex -interaction=nonstopmode -output-directory="$tmpdir" "$tmpdir/doc.tex" \
      > "$tmpdir/pdflatex.log" 2>&1; then
    echo "    WARNING: pdflatex failed for $base (see $tmpdir/pdflatex.log)"
    continue
  fi

  # Convert to SVG
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

  echo "    OK -> $REFS_DIR/$base.svg"
done

rm -rf "$TMPDIR_BASE"
echo "Done. References saved to $REFS_DIR/"
