"""
HTML report generation for golden comparison results.
"""

import base64
from pathlib import Path

from .compare import CompareResult
from .config import REPORT_DIR, DIFF_THRESHOLD, AREA_TOLERANCE


_CSS = """
  body { font-family: -apple-system, sans-serif; font-size: 13px; margin: 0; background: #f5f5f5; }
  h1 { background: #1a1a2e; color: white; margin: 0; padding: 16px 24px; font-size: 16px; }
  .summary { padding: 12px 24px; background: white; border-bottom: 1px solid #ddd; }
  .pass-count { color: #2a7a2a; font-weight: 600; }
  .fail-count { color: #cc0000; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #222; color: white; padding: 8px 12px; text-align: left; font-size: 12px; }
  td { padding: 8px 12px; border-bottom: 1px solid #eee; vertical-align: middle; }
  tr.pass { background: #f8fff8; }
  tr.fail { background: #fff8f8; }
  .status { font-weight: 700; width: 50px; }
  tr.pass .status { color: #2a7a2a; }
  tr.fail .status { color: #cc0000; }
  .name { font-family: monospace; font-size: 12px; }
  .images img { max-height: 80px; border: 1px solid #ccc; margin-right: 4px; }
  .issues { font-size: 11px; color: #cc0000; font-family: monospace; white-space: pre-wrap; }
"""


def _thumb(name: str, suffix: str) -> str:
    p = REPORT_DIR / f'{name}_{suffix}.png'
    if p.exists():
        b64 = base64.b64encode(p.read_bytes()).decode()
        return f'<img src="data:image/png;base64,{b64}" title="{suffix}">'
    return ''


def write_html_report(results: list[CompareResult]) -> Path:
    """
    Write an HTML report to REPORT_DIR/report.html and return the path.
    Embeds thumbnail PNGs (ours / ref / diff) inline as base64.
    """
    rows = []
    for r in results:
        status_class = 'pass' if r.passed else 'fail'
        status_text  = 'PASS' if r.passed else 'FAIL'
        issues       = '<br>'.join(r.failures + r.warnings)
        stats_str    = ', '.join(f'{k}={v}' for k, v in r.stats.items())
        thumbs       = _thumb(r.name, 'ours') + _thumb(r.name, 'ref') + _thumb(r.name, 'diff')
        rows.append(f'''
          <tr class="{status_class}">
            <td class="status">{status_text}</td>
            <td class="name">{r.name}</td>
            <td>{stats_str}</td>
            <td class="images">{thumbs}</td>
            <td class="issues">{issues}</td>
          </tr>
        ''')

    n_pass = sum(1 for r in results if r.passed)
    n_fail = len(results) - n_pass

    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>tikzjs golden comparison report</title>
  <style>{_CSS}</style>
</head>
<body>
  <h1>tikzjs golden comparison report</h1>
  <div class="summary">
    <span class="pass-count">{n_pass} passed</span> &nbsp;
    <span class="fail-count">{n_fail} failed</span>
    out of {len(results)} fixtures &nbsp;|&nbsp;
    diff threshold: {DIFF_THRESHOLD}% &nbsp;|&nbsp;
    area tolerance: ±{int(AREA_TOLERANCE * 100)}%
  </div>
  <table>
    <tr>
      <th>Status</th><th>Fixture</th><th>Stats</th>
      <th>ours / ref / diff</th><th>Issues</th>
    </tr>
    {''.join(rows)}
  </table>
</body>
</html>"""

    report_path = REPORT_DIR / 'report.html'
    report_path.write_text(html, encoding='utf-8')
    return report_path
