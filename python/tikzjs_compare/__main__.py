"""
CLI entry point: python -m tikzjs_compare [fixture ...]

With no arguments, runs all fixtures found in test/golden/fixtures/.
"""

import sys
from pathlib import Path

from .config import FIXTURES_DIR, REPORT_DIR, DIFF_THRESHOLD, AREA_TOLERANCE, SCALE
from .compare import compare_fixture
from .report import write_html_report


def main(argv: list[str] | None = None) -> int:
    args = (argv if argv is not None else sys.argv[1:])

    if args:
        names = [a.replace('.tikz', '') for a in args]
    else:
        names = sorted(p.stem for p in FIXTURES_DIR.glob('*.tikz'))

    if not names:
        print('No fixtures found.', file=sys.stderr)
        return 1

    print(f'Running golden comparison on {len(names)} fixture(s)...')
    print(f'  diff threshold : {DIFF_THRESHOLD}%')
    print(f'  area tolerance : ±{int(AREA_TOLERANCE * 100)}%')
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

    return 0 if n_fail == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
