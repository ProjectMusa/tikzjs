"""
Runtime configuration for tikzjs_compare.
All values can be overridden with environment variables.
"""

import os
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────────

PACKAGE_DIR  = Path(__file__).resolve().parent
PYTHON_DIR   = PACKAGE_DIR.parent
PROJECT_ROOT = PYTHON_DIR.parent

FIXTURES_DIR = PROJECT_ROOT / 'test' / 'golden' / 'fixtures'
REFS_DIR     = PROJECT_ROOT / 'test' / 'golden' / 'refs'
DIST_INDEX   = PROJECT_ROOT / 'dist' / 'index.js'

# ── Comparison thresholds ──────────────────────────────────────────────────────

# Maximum structural diff % (after content-crop + dilation) to PASS
DIFF_THRESHOLD = float(os.environ.get('GOLDEN_DIFF_THRESHOLD', '2.0'))

# Fractional tolerance for per-component area comparison
AREA_TOLERANCE = float(os.environ.get('GOLDEN_AREA_TOLERANCE', '0.20'))

# PNG render scale factor (higher = better anti-aliasing, slower)
SCALE = float(os.environ.get('GOLDEN_SCALE', '2.0'))

# Dilation kernel radius in px for XOR structural comparison.
# Absorbs 1–3px positional shifts from anti-aliasing / margin differences.
DILATION_RADIUS = int(os.environ.get('GOLDEN_DILATION_RADIUS', '6'))

# Output directory for PNG debug images and HTML report
REPORT_DIR = Path(os.environ.get('GOLDEN_REPORT_DIR', '/tmp/tikzjs-golden'))

# Set to True for verbose per-component output
VERBOSE = os.environ.get('GOLDEN_VERBOSE', '0') == '1'
