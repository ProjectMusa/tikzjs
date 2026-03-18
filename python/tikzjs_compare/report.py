"""
HTML report with summary table + expandable per-fixture detail panels.
"""

import base64
from pathlib import Path

from .compare import CompareResult
from .config import REPORT_DIR, DIFF_THRESHOLD


# ── CSS ───────────────────────────────────────────────────────────────────────

_CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       font-size: 13px; background: #f0f0f0; color: #222; }
h1 { background: #1a1a2e; color: #fff; padding: 14px 24px; font-size: 15px; font-weight: 600; }

/* ── summary bar ── */
.summary { background: #fff; border-bottom: 1px solid #ddd;
           padding: 10px 24px; display: flex; gap: 20px; align-items: center; }
.pass-count { color: #1a7a1a; font-weight: 700; }
.fail-count { color: #cc0000; font-weight: 700; }
.meta { color: #666; font-size: 12px; }

/* ── legend ── */
.legend { background: #fff; border-bottom: 1px solid #ddd; padding: 6px 24px;
          display: flex; gap: 16px; font-size: 11px; }
.leg { display: flex; align-items: center; gap: 5px; }
.swatch { width: 12px; height: 12px; border-radius: 2px; border: 1px solid #aaa; }

/* ── main table ── */
table.main { width: 100%; border-collapse: collapse; }
table.main th { background: #2a2a3e; color: #ddd; padding: 7px 12px;
                text-align: left; font-size: 11px; font-weight: 600; }
table.main td { padding: 7px 12px; vertical-align: middle; border-bottom: 1px solid #e8e8e8; }
tr.pass-row { background: #f5fff5; }
tr.fail-row { background: #fff5f5; }
tr.pass-row:hover, tr.fail-row:hover { filter: brightness(0.97); cursor: pointer; }

.status { font-weight: 700; font-size: 12px; width: 52px; }
.pass-row .status { color: #1a7a1a; }
.fail-row .status { color: #cc0000; }

.fname { font-family: monospace; font-size: 12px; }
.stats { font-size: 11px; color: #555; font-family: monospace; }

/* diff bar */
.diff-bar-wrap { width: 120px; }
.diff-bar-bg { background: #e8e8e8; border-radius: 3px; height: 10px; overflow: hidden; }
.diff-bar-fill { height: 100%; border-radius: 3px; }
.diff-label { font-size: 11px; font-family: monospace; margin-top: 2px; }

.issues { font-size: 11px; color: #cc0000; font-family: monospace;
          white-space: pre-wrap; max-width: 320px; }

/* ── detail panel ── */
tr.detail-row td { padding: 0; background: #1e1e2e; }
.detail-panel { padding: 16px 20px; display: none; }
tr.detail-row.open .detail-panel { display: block; }

.detail-grid { display: grid; gap: 12px; }

.section-title { color: #aac; font-size: 11px; font-weight: 600; letter-spacing: .05em;
                 text-transform: uppercase; margin-bottom: 6px; }

/* image strips */
.img-strip { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-start; }
.img-card { background: #2a2a3e; border-radius: 5px; padding: 6px; }
.img-card .img-label { color: #88a; font-size: 10px; margin-bottom: 4px;
                       font-family: monospace; }
.img-card img { display: block; max-height: 160px; max-width: 320px;
                border: 1px solid #444; border-radius: 3px; }

"""

# ── JS ────────────────────────────────────────────────────────────────────────

_JS = """
document.querySelectorAll('tr.data-row').forEach(row => {
  row.addEventListener('click', () => {
    const detail = row.nextElementSibling;
    if (!detail || !detail.classList.contains('detail-row')) return;
    const isOpen = detail.classList.contains('open');
    // close all
    document.querySelectorAll('tr.detail-row.open').forEach(d => d.classList.remove('open'));
    if (!isOpen) detail.classList.add('open');
  });
});
"""


# ── helpers ───────────────────────────────────────────────────────────────────

def _b64(name: str, suffix: str) -> str | None:
    p = REPORT_DIR / f'{name}_{suffix}.png'
    if not p.exists():
        return None
    return base64.b64encode(p.read_bytes()).decode()


def _img_card(label: str, b64: str | None) -> str:
    if not b64:
        return ''
    return f'''<div class="img-card">
      <div class="img-label">{label}</div>
      <img src="data:image/png;base64,{b64}">
    </div>'''


def _diff_bar(pct: float) -> str:
    """Color-coded horizontal bar: green→yellow→red based on diff %."""
    clamped = min(pct, DIFF_THRESHOLD * 2)
    width   = int(clamped / (DIFF_THRESHOLD * 2) * 100)
    if pct <= DIFF_THRESHOLD:
        color = '#2a9a2a'
    elif pct <= DIFF_THRESHOLD * 1.5:
        color = '#c8a020'
    else:
        color = '#cc2020'
    return f'''<div class="diff-bar-wrap">
      <div class="diff-bar-bg">
        <div class="diff-bar-fill" style="width:{width}%;background:{color}"></div>
      </div>
      <div class="diff-label" style="color:{color}">{pct:.2f}%</div>
    </div>'''


def _detail_panel(result: CompareResult) -> str:
    b_ours   = _b64(result.name, 'ours')
    b_ref    = _b64(result.name, 'ref')
    b_diff   = _b64(result.name, 'diff')
    b_struct = _b64(result.name, 'struct')

    return f'''<div class="detail-panel">
  <div class="detail-grid">

    <div>
      <div class="section-title">Rasterized output</div>
      <div class="img-strip">
        {_img_card('ours', b_ours)}
        {_img_card('reference', b_ref)}
        {_img_card('pixel diff ×5', b_diff)}
      </div>
    </div>

    <div>
      <div class="section-title">
        Structural diff
        &nbsp;<span style="font-size:10px;color:#88a;font-weight:normal">
          (content-cropped · dilated XOR ·
          <span style="color:#aaa">■</span> both
          <span style="color:#88f">■</span> extra in ours
          <span style="color:#f88">■</span> missing from ours)
        </span>
      </div>
      <div class="img-strip">
        {_img_card(f'struct diff {result.struct_diff:.2f}%', b_struct)}
      </div>
    </div>

  </div>
</div>'''


# ── main entry ────────────────────────────────────────────────────────────────

def write_html_report(results: list[CompareResult]) -> Path:
    """Write REPORT_DIR/report.html and return the path."""
    n_pass = sum(1 for r in results if r.passed)
    n_fail = len(results) - n_pass

    rows_html = []
    for r in results:
        row_cls    = 'pass-row' if r.passed else 'fail-row'
        status_txt = 'PASS' if r.passed else 'FAIL'
        stats_str  = '&nbsp; '.join(
            f'<b>{k}</b>={v}' for k, v in r.stats.items()
        )
        issues = ('<br>'.join(r.failures + r.warnings)
                  if r.failures or r.warnings else '')

        rows_html.append(f'''
          <tr class="data-row {row_cls}" title="Click to expand">
            <td class="status">{status_txt}</td>
            <td class="fname">{r.name}</td>
            <td class="stats">{stats_str}</td>
            <td>{_diff_bar(r.struct_diff)}</td>
            <td class="issues">{issues}</td>
          </tr>
          <tr class="detail-row">
            <td colspan="5">{_detail_panel(r)}</td>
          </tr>''')

    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>tikzjs golden comparison</title>
  <style>{_CSS}</style>
</head>
<body>
  <h1>tikzjs golden comparison report</h1>

  <div class="summary">
    <span class="pass-count">{n_pass} passed</span>
    <span class="fail-count">{n_fail} failed</span>
    <span class="meta">of {len(results)} fixtures</span>
    <span class="meta">struct diff threshold: {DIFF_THRESHOLD}%</span>
  </div>

  <div class="legend">
    <span class="leg"><span class="swatch" style="background:#3d3"></span> pass</span>
    <span class="leg"><span class="swatch" style="background:#d33"></span> fail</span>
    <span class="leg"><span class="swatch" style="background:#aaa"></span> both</span>
    <span class="leg"><span class="swatch" style="background:#44f"></span> extra in ours</span>
    <span class="leg"><span class="swatch" style="background:#f44"></span> missing from ours</span>
    <span style="color:#888">— click any row to expand detail</span>
  </div>

  <table class="main">
    <tr>
      <th>Status</th>
      <th>Fixture</th>
      <th>Stats</th>
      <th>Struct diff</th>
      <th>Issues</th>
    </tr>
    {''.join(rows_html)}
  </table>

  <script>{_JS}</script>
</body>
</html>"""

    report_path = REPORT_DIR / 'report.html'
    report_path.write_text(html, encoding='utf-8')
    return report_path
