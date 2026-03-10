"""
Per-fixture comparison logic: renders our SVG, loads the ref, and runs all checks.
"""

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import cv2

from .config import (
    REFS_DIR, REPORT_DIR,
    DIFF_THRESHOLD, AREA_TOLERANCE, VERBOSE,
)
from .svg import render_tikzjs, svg_to_png
from .components import (
    extract_components, structural_diff_pct, raw_pixel_diff_pct,
)


@dataclass
class CompareResult:
    name: str
    passed: bool = True
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)

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
    1. Component count — both images should have the same number of connected
       foreground blobs (within a 10% tolerance for minor merge differences).
    2. Area distribution — sorted component areas should match within
       AREA_TOLERANCE, after scaling to a common canvas size.
    3. Structural diff — content-cropped, dilated XOR comparison should be
       below DIFF_THRESHOLD %.
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

    # ── Save debug PNGs ───────────────────────────────────────────────────────

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(REPORT_DIR / f'{name}_ours.png'), our_img)
    cv2.imwrite(str(REPORT_DIR / f'{name}_ref.png'),  ref_img)

    # ── Extract components ────────────────────────────────────────────────────

    our_cc = extract_components(our_img)
    ref_cc = extract_components(ref_img)

    n_ours = our_cc['n_components']
    n_ref  = ref_cc['n_components']

    result.stats['n_cc']  = f'{n_ours}/{n_ref}'
    result.stats['fg_px'] = f"{our_cc['total_fg_pixels']}/{ref_cc['total_fg_pixels']}"

    # Check 1: component count
    count_diff = abs(n_ours - n_ref)
    max_allowed = max(1, int(n_ref * 0.10))
    if count_diff > max_allowed:
        result.fail(
            f'component count mismatch: ours={n_ours}, ref={n_ref} '
            f'(diff={count_diff} > allowed={max_allowed})'
        )

    # Check 2: area distribution (scale to a common pixel density)
    h_ref, w_ref = ref_img.shape[:2]
    h_our, w_our = our_img.shape[:2]
    area_scale = (h_ref * w_ref) / (h_our * w_our) if (h_our * w_our) > 0 else 1.0

    n_compare = min(n_ours, n_ref)
    if n_compare > 0:
        our_areas_scaled = sorted(
            [a * area_scale for a in our_cc['areas'][:n_compare]], reverse=True
        )
        ref_areas = ref_cc['areas'][:n_compare]

        area_failures = []
        for i, (oa, ra) in enumerate(zip(our_areas_scaled, ref_areas)):
            if ra == 0:
                continue
            ratio = oa / ra
            if abs(ratio - 1.0) > AREA_TOLERANCE:
                area_failures.append(
                    f'  component {i + 1}: area ratio={ratio:.2f} '
                    f'(ours={oa:.0f}, ref={ra:.0f})'
                )

        if VERBOSE:
            for i, (oa, ra) in enumerate(zip(our_areas_scaled, ref_areas)):
                ratio = oa / ra if ra > 0 else float('inf')
                print(f'      cc[{i + 1}]: ours={oa:.0f} ref={ra:.0f} ratio={ratio:.2f}')

        if area_failures:
            n_bad = len(area_failures)
            if n_bad > max(1, int(n_compare * 0.20)):
                result.fail(
                    f'{n_bad}/{n_compare} components have area ratio outside '
                    f'±{int(AREA_TOLERANCE * 100)}% tolerance:\n'
                    + '\n'.join(area_failures[:5])
                )

    # Check 3: structural diff
    struct_diff = structural_diff_pct(our_img, ref_img)
    raw_diff    = raw_pixel_diff_pct(our_img, ref_img)
    result.stats['diff'] = f'{struct_diff:.2f}%'
    result.stats['raw']  = f'{raw_diff:.1f}%'

    # Save amplified diff image for visual inspection
    h, w = ref_img.shape[:2]
    our_resized    = cv2.resize(our_img, (w, h), interpolation=cv2.INTER_AREA)
    diff_amplified = cv2.convertScaleAbs(cv2.absdiff(our_resized, ref_img), alpha=5.0)
    cv2.imwrite(str(REPORT_DIR / f'{name}_diff.png'), diff_amplified)

    if struct_diff > DIFF_THRESHOLD:
        result.fail(
            f'structural diff {struct_diff:.2f}% exceeds threshold '
            f'{DIFF_THRESHOLD:.1f}% (raw: {raw_diff:.1f}%)'
        )

    return result
