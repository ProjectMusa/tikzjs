"""
SVG → PNG rasterization and tikzjs rendering helpers.
"""

import subprocess
from pathlib import Path

import numpy as np
import cv2
import cairosvg

from .config import DIST_INDEX, FIXTURES_DIR, SCALE


def svg_to_png(svg_str: str, scale: float = SCALE) -> np.ndarray:
    """
    Render an SVG string to a BGR numpy image array using cairosvg.

    The output is always on a white background.
    """
    png_bytes = cairosvg.svg2png(
        bytestring=svg_str.encode('utf-8'),
        scale=scale,
        background_color='white',
    )
    arr = np.frombuffer(png_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img  # BGR uint8


def render_tikzjs(fixture_name: str) -> str:
    """
    Invoke Node.js to render a fixture via the built dist/index.js.

    Returns the SVG string.
    Raises RuntimeError if the render fails.
    """
    tikz_path = FIXTURES_DIR / f'{fixture_name}.tikz'
    if not tikz_path.exists():
        raise FileNotFoundError(f'Fixture not found: {tikz_path}')
    if not DIST_INDEX.exists():
        raise FileNotFoundError(
            f'Built index.js not found: {DIST_INDEX}\n'
            f'Run `make build` first.'
        )

    script = f"""
const fs = require('fs');
const {{ generate }} = require('{DIST_INDEX}');
const src = fs.readFileSync('{tikz_path}', 'utf8');
try {{
  process.stdout.write(generate(src));
}} catch (e) {{
  process.stderr.write('ERROR: ' + e.message + '\\n');
  process.exit(1);
}}
"""
    result = subprocess.run(
        ['node', '-e', script],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        raise RuntimeError(f'tikzjs render failed:\n{result.stderr.strip()}')
    return result.stdout
