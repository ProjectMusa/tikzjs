"""
Per-fixture comparison logic.
"""

from dataclasses import dataclass, field
from pathlib import Path

import cv2

from .config import REFS_DIR, REPORT_DIR, DIFF_THRESHOLD, RAW_FONT_THRESHOLD, STRUCT_HARD_THRESHOLD
from .svg import render_tikzjs, svg_to_png
from .components import structural_diff, raw_pixel_diff_pct


@dataclass
class CompareResult:
    name: str
    passed: bool = True
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    stats: dict         = field(default_factory=dict)
    struct_diff: float  = 0.0
    raw_diff:    float  = 0.0

    def fail(self, msg: str) -> None:
        self.passed = False
        self.failures.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def summary_line(self) -> str:
        status = '✓ PASS' if self.passed else '✗ FAIL'
        stats_str = ', '.join(f'{k}={v}' for k, v in self.stats.items())
        line = f'  {status}  {self.name:<35}  {stats_str}'
        if self.failures:
            indent = '\n         '
            line += indent + indent.join(self.failures)
        return line


def compare_fixture(name: str) -> CompareResult:
    """
    Compare tikzjs output for `name` against its golden reference SVG.

    Checks:
      1. Structural diff — content-cropped dilated XOR below DIFF_THRESHOLD %

    Saves to REPORT_DIR:
      {name}_ours.png   — rasterized our SVG
      {name}_ref.png    — rasterized reference SVG
      {name}_struct.png — structural diff visualization
      {name}_diff.png   — raw amplified pixel diff
    """
    result = CompareResult(name=name)

    ref_path = REFS_DIR / f'{name}.svg'
    if not ref_path.exists():
        result.warn('no reference SVG — skipping pixel comparison')
        result.stats['ref'] = 'missing'
        return result

    # ── Render ────────────────────────────────────────────────────────────────

    try:
        our_svg = render_tikzjs(name)
    except (RuntimeError, FileNotFoundError) as e:
        result.fail(f'render error: {e}')
        return result

    ref_svg = ref_path.read_text(encoding='utf-8')

    try:
        our_img = svg_to_png(our_svg)
        ref_img = svg_to_png(ref_svg)
    except Exception as e:
        result.fail(f'rasterization error: {e}')
        return result

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(REPORT_DIR / f'{name}_ours.png'), our_img)
    cv2.imwrite(str(REPORT_DIR / f'{name}_ref.png'),  ref_img)

    # ── Structural diff ───────────────────────────────────────────────────────

    struct_pct, struct_img = structural_diff(our_img, ref_img)
    raw_pct = raw_pixel_diff_pct(our_img, ref_img)

    result.struct_diff   = struct_pct
    result.raw_diff      = raw_pct
    result.stats['diff'] = f'{struct_pct:.2f}%'
    result.stats['raw']  = f'{raw_pct:.1f}%'

    cv2.imwrite(str(REPORT_DIR / f'{name}_struct.png'), struct_img)

    h_ref, w_ref = ref_img.shape[:2]
    our_resized    = cv2.resize(our_img, (w_ref, h_ref), interpolation=cv2.INTER_AREA)
    diff_amplified = cv2.convertScaleAbs(cv2.absdiff(our_resized, ref_img), alpha=5.0)
    cv2.imwrite(str(REPORT_DIR / f'{name}_diff.png'), diff_amplified)

    if struct_pct > DIFF_THRESHOLD:
        if struct_pct > STRUCT_HARD_THRESHOLD:
            result.fail(
                f'structural diff {struct_pct:.2f}% > hard threshold {STRUCT_HARD_THRESHOLD:.1f}% '
                f'(raw: {raw_pct:.1f}%)'
            )
        elif raw_pct < RAW_FONT_THRESHOLD:
            result.warn(
                f'font rendering diff: struct {struct_pct:.2f}% > {DIFF_THRESHOLD:.1f}% '
                f'(raw {raw_pct:.1f}% < {RAW_FONT_THRESHOLD:.1f}% — likely font difference)'
            )
        else:
            result.fail(
                f'structural diff {struct_pct:.2f}% > threshold {DIFF_THRESHOLD:.1f}% '
                f'(raw: {raw_pct:.1f}%)'
            )

    return result
