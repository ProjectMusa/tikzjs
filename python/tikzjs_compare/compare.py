"""
Per-fixture comparison logic.
"""

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import cv2

from .config import REFS_DIR, REPORT_DIR, DIFF_THRESHOLD, RAW_FONT_THRESHOLD, STRUCT_HARD_THRESHOLD, AREA_TOLERANCE, VERBOSE
from .svg import render_tikzjs, svg_to_png
from .components import (
    extract_components,
    render_component_overlay,
    structural_diff,
    raw_pixel_diff_pct,
)


@dataclass
class ComponentRow:
    """Per-component comparison entry for the detail table."""
    rank: int           # 1-based, sorted by area descending
    our_area: float     # scaled to ref pixel density
    ref_area: float
    ratio: float        # our_area / ref_area
    ok: bool            # within AREA_TOLERANCE


@dataclass
class CompareResult:
    name: str
    passed: bool = True
    failures: list[str]      = field(default_factory=list)
    warnings: list[str]      = field(default_factory=list)
    stats: dict              = field(default_factory=dict)
    component_rows: list[ComponentRow] = field(default_factory=list)
    struct_diff: float = 0.0
    raw_diff:    float = 0.0

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
      1. Component count  — within 10% tolerance
      2. Area distribution — sorted areas scaled to common density, within AREA_TOLERANCE
      3. Structural diff   — content-cropped dilated XOR below DIFF_THRESHOLD %

    Saves to REPORT_DIR:
      {name}_ours.png      — rasterized our SVG
      {name}_ref.png       — rasterized reference SVG
      {name}_cc_ours.png   — component overlay (colored blobs)
      {name}_cc_ref.png    — component overlay (colored blobs)
      {name}_struct.png    — structural diff visualization
      {name}_diff.png      — raw amplified pixel diff
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

    # ── Connected components ──────────────────────────────────────────────────

    our_cc = extract_components(our_img)
    ref_cc = extract_components(ref_img)

    n_ours = our_cc['n_components']
    n_ref  = ref_cc['n_components']

    result.stats['n_cc']  = f'{n_ours}/{n_ref}'
    result.stats['fg_px'] = f"{our_cc['total_fg_pixels']}/{ref_cc['total_fg_pixels']}"

    # Save component overlay images
    cv2.imwrite(str(REPORT_DIR / f'{name}_cc_ours.png'),
                render_component_overlay(our_img, our_cc))
    cv2.imwrite(str(REPORT_DIR / f'{name}_cc_ref.png'),
                render_component_overlay(ref_img, ref_cc))

    # ── Compute pixel diffs early (needed for font-threshold in area check) ───

    struct_pct, struct_img = structural_diff(our_img, ref_img)
    raw_pct = raw_pixel_diff_pct(our_img, ref_img)

    result.struct_diff = struct_pct
    result.raw_diff    = raw_pct
    result.stats['diff'] = f'{struct_pct:.2f}%'
    result.stats['raw']  = f'{raw_pct:.1f}%'

    cv2.imwrite(str(REPORT_DIR / f'{name}_struct.png'), struct_img)

    # Also save a raw amplified diff for reference
    h_ref, w_ref = ref_img.shape[:2]
    our_resized    = cv2.resize(our_img, (w_ref, h_ref), interpolation=cv2.INTER_AREA)
    diff_amplified = cv2.convertScaleAbs(cv2.absdiff(our_resized, ref_img), alpha=5.0)
    cv2.imwrite(str(REPORT_DIR / f'{name}_diff.png'), diff_amplified)

    # ── Check 1: component count ──────────────────────────────────────────────

    count_diff  = abs(n_ours - n_ref)
    max_allowed = max(1, int(n_ref * 0.10))
    if count_diff > max_allowed:
        result.fail(
            f'component count mismatch: ours={n_ours}, ref={n_ref} '
            f'(diff={count_diff} > allowed={max_allowed})'
        )

    # ── Check 2: area distribution ────────────────────────────────────────────

    h_our, w_our = our_img.shape[:2]
    area_scale = (h_ref * w_ref) / (h_our * w_our) if (h_our * w_our) > 0 else 1.0

    n_compare = min(n_ours, n_ref)
    area_failures = []

    for i in range(n_compare):
        oa = our_cc['areas'][i] * area_scale
        ra = ref_cc['areas'][i]
        ratio = oa / ra if ra > 0 else float('inf')
        ok = abs(ratio - 1.0) <= AREA_TOLERANCE
        result.component_rows.append(ComponentRow(
            rank=i + 1, our_area=oa, ref_area=ra, ratio=ratio, ok=ok
        ))
        if not ok:
            area_failures.append(
                f'  cc[{i+1}]: ratio={ratio:.2f} (ours={oa:.0f}, ref={ra:.0f})'
            )
        if VERBOSE:
            tag = '✓' if ok else '✗'
            print(f'      {tag} cc[{i+1}]: ours={oa:.0f} ref={ra:.0f} ratio={ratio:.2f}')

    if area_failures:
        n_bad = len(area_failures)
        if n_bad > max(1, int(n_compare * 0.20)):
            msg = (
                f'{n_bad}/{n_compare} components outside ±{int(AREA_TOLERANCE*100)}%:\n'
                + '\n'.join(area_failures[:5])
            )
            # When raw pixel diff is low, area mismatch is attributed to font differences
            # (MathJax vs TeX CM glyphs render at different glyph sizes) — warn, don't fail.
            if raw_pct < RAW_FONT_THRESHOLD:
                result.warn(f'font rendering (area): {msg}')
            else:
                result.fail(msg)

    # ── Check 3: structural diff ──────────────────────────────────────────────

    if struct_pct > DIFF_THRESHOLD:
        if struct_pct > STRUCT_HARD_THRESHOLD:
            # Far above threshold — always a real rendering error, not font rendering.
            result.fail(
                f'structural diff {struct_pct:.2f}% > hard threshold {STRUCT_HARD_THRESHOLD:.1f}% '
                f'(raw: {raw_pct:.1f}%)'
            )
        elif raw_pct < RAW_FONT_THRESHOLD:
            # Moderately above threshold with low raw diff — likely font rendering difference.
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
