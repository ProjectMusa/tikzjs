"""
CLI entry point: python -m tikzjs_compare [--save-baseline FILE] [--check-baseline FILE] [fixture ...]

With no arguments, runs all fixtures found in test/golden/fixtures/.

  --save-baseline FILE   Save structural diff values to a JSON baseline file
  --check-baseline FILE  Compare against a saved baseline; fail if any fixture regresses
                         by more than BASELINE_TOLERANCE (default 0.5%)
"""

import json
import re
import sys
from pathlib import Path

from .config import FIXTURES_DIR, REPORT_DIR, DIFF_THRESHOLD, SCALE
from .compare import compare_fixture
from .report import write_html_report

# Maximum allowed increase in structural diff % vs baseline before flagging a regression
BASELINE_TOLERANCE = float(__import__('os').environ.get('GOLDEN_BASELINE_TOLERANCE', '0.5'))


def main(argv: list[str] | None = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])

    save_baseline: str | None = None
    check_baseline: str | None = None

    # Simple arg parsing for flags (keeps positional fixture args)
    positional: list[str] = []
    i = 0
    while i < len(args):
        if args[i] == '--save-baseline' and i + 1 < len(args):
            save_baseline = args[i + 1]
            i += 2
        elif args[i] == '--check-baseline' and i + 1 < len(args):
            check_baseline = args[i + 1]
            i += 2
        else:
            positional.append(args[i])
            i += 1

    if positional:
        names = [a.replace('.tikz', '') for a in positional]
    else:
        def _natural_key(s: str) -> list:
            return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', s)]
        names = sorted((p.stem for p in FIXTURES_DIR.glob('*.tikz')), key=_natural_key)

    if not names:
        print('No fixtures found.', file=sys.stderr)
        return 1

    print(f'Running golden comparison on {len(names)} fixture(s)...')
    print(f'  diff threshold : {DIFF_THRESHOLD}%')
    print(f'  render scale   : {SCALE}x')
    print(f'  report dir     : {REPORT_DIR}')
    print()

    results = [compare_fixture(name) for name in names]

    for r in results:
        print(r.summary_line())

    report_path = write_html_report(results)

    n_fail = sum(1 for r in results if not r.passed)
    n_warn = sum(1 for r in results if r.warnings and r.passed)
    n_pass = len(results) - n_fail

    print(f'\nResults: {n_pass} passed, {n_fail} failed, {n_warn} warnings')
    print(f'HTML report: {report_path}')

    # ── Save baseline ─────────────────────────────────────────────────────────
    if save_baseline:
        baseline = {r.name: {'struct': round(r.struct_diff, 2), 'raw': round(r.raw_diff, 1)}
                    for r in results}
        Path(save_baseline).write_text(json.dumps(baseline, indent=2) + '\n', encoding='utf-8')
        print(f'\nBaseline saved: {save_baseline} ({len(baseline)} fixtures)')

    # ── Check baseline ────────────────────────────────────────────────────────
    if check_baseline:
        bp = Path(check_baseline)
        if not bp.exists():
            print(f'\nBaseline file not found: {check_baseline}', file=sys.stderr)
            return 1
        baseline = json.loads(bp.read_text(encoding='utf-8'))
        regressions: list[str] = []
        for r in results:
            if r.name not in baseline:
                continue  # new fixture, no baseline to compare
            old_struct = baseline[r.name]['struct']
            delta = r.struct_diff - old_struct
            if delta > BASELINE_TOLERANCE:
                regressions.append(
                    f'  {r.name}: {old_struct:.2f}% → {r.struct_diff:.2f}% '
                    f'(+{delta:.2f}%, tolerance {BASELINE_TOLERANCE}%)'
                )
        if regressions:
            print(f'\n✗ Baseline regressions ({len(regressions)}):')
            for line in regressions:
                print(line)
            return 1
        else:
            print(f'\n✓ No baseline regressions (tolerance ±{BASELINE_TOLERANCE}%)')

    return 0 if n_fail == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
