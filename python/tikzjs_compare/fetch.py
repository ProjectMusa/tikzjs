"""
Fetch TikZ fixture files from HuggingFace datasets.

Supports two dataset sources:
  - nllg/DaTikZ-V4  (default) — via the HuggingFace datasets-server API
  - Navidium/tikz_dataset     — legacy, via a metadata.json file

Extracts \\begin{tikzpicture}...\\end{tikzpicture} blocks from full LaTeX
documents and saves them as .tikz files suitable for use with tikzjs.

Usage:
    python -m tikzjs_compare.fetch [options]

Sources:
    batch/0  — Navidium/tikz_dataset (metadata.json)
    batch/1+ — nllg/DaTikZ-V4 (datasets-server API, non-overlapping offsets)

Options:
    --batches N         Total number of batches: 1 = Navidium only (default: 1)
    --output DIR        Root output directory (default: test/extra/fixtures)
                        Each batch is written to {output}/0/, {output}/1/, …
    --seed N            Base random seed; each batch increments it (default: 42)
    --include-generated Also include LLM-generated variations (Navidium only)
    --url URL           Navidium metadata URL override (for testing)
"""

import argparse
import json
import random
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

from .config import PROJECT_ROOT

# ── Dataset sources ─────────────────────────────────────────────────────────────

DEFAULT_DATASET = 'nllg/DaTikZ-V4'

# HuggingFace datasets-server: returns up to 100 rows per page
_HF_ROWS_API = (
    'https://datasets-server.huggingface.co/rows'
    '?dataset={dataset}&config=default&split=train&offset={offset}&length={length}'
)

# Legacy Navidium dataset — single metadata.json file
_NAVIDIUM_URL = (
    'https://huggingface.co/datasets/Navidium/tikz_dataset'
    '/resolve/main/metadata.json'
)

BATCH_SIZE = 100
DEFAULT_OUTPUT = PROJECT_ROOT / 'test' / 'extra' / 'fixtures'

# ── Filters ────────────────────────────────────────────────────────────────────

_SKIP_PATTERNS = [
    re.compile(r'\\begin\s*\{axis\}'),         # pgfplots
    re.compile(r'\\begin\s*\{groupplot\}'),    # pgfplots groupplot
    re.compile(r'\\usepgfplotslibrary'),
    re.compile(r'\\pgfplotsset'),
]


def should_skip(tikz: str) -> bool:
    return any(r.search(tikz) for r in _SKIP_PATTERNS)


# ── Extraction ─────────────────────────────────────────────────────────────────

_TIKZPICTURE_RE = re.compile(
    r'(\\begin\s*\{tikzpicture\}.*?\\end\s*\{tikzpicture\})',
    re.DOTALL,
)

# Preamble lines that define reusable TikZ styles/commands — extract and
# prepend to the fixture so generateExtra.sh (and tikzjs) can see them.
_PREAMBLE_LINE_RE = re.compile(
    r'^[ \t]*'
    r'(?:'
    r'\\tikzstyle\b'           # \tikzstyle foo = [...]
    r'|\\tikzset\b'            # \tikzset{...}
    r'|\\pgfkeys\b'            # \pgfkeys{/tikz/...}
    r'|\\colorlet\b'           # \colorlet{mycolor}{...}
    r'|\\definecolor\b'        # \definecolor{...}
    r'|\\newcommand\b'         # custom macros used inside tikzpicture
    r'|\\renewcommand\b'
    r')',
    re.MULTILINE,
)

# Match a complete \tikzstyle or \tikzset statement (may span multiple lines
# with balanced braces — we grab up to the first ';' or end-of-statement).
_STYLE_DEF_RE = re.compile(
    r'(?:'
    r'\\tikzstyle\s+\w+\s*=\s*\[[^\]]*\]'          # \tikzstyle name = [...]
    r'|\\tikzset\s*\{[^}]*\}'                        # \tikzset{...} (simple)
    r'|\\colorlet\s*\{[^}]*\}\s*\{[^}]*\}'
    r'|\\definecolor\s*\{[^}]*\}\s*\{[^}]*\}\s*\{[^}]*\}'
    r')',
    re.DOTALL,
)


def extract_preamble_defs(latex_doc: str) -> str:
    """
    Extract \\tikzstyle, \\tikzset, \\colorlet, \\definecolor definitions
    from the document preamble (before \\begin{document}).

    Returns a string to prepend to the tikzpicture block, or '' if none found.
    """
    # Only scan before \begin{document}
    doc_start = latex_doc.find(r'\begin{document}')
    preamble = latex_doc[:doc_start] if doc_start != -1 else latex_doc

    defs = _STYLE_DEF_RE.findall(preamble)
    if not defs:
        return ''
    return '\n'.join(d.strip() for d in defs) + '\n'


def extract_tikzpictures(latex_doc: str) -> list[str]:
    """
    Extract all \\begin{tikzpicture}...\\end{tikzpicture} blocks.
    Prepends any \\tikzstyle/\\tikzset/color definitions from the preamble
    as comments so generateExtra.sh can include them in the LaTeX wrapper.
    """
    preamble_defs = extract_preamble_defs(latex_doc)
    blocks = _TIKZPICTURE_RE.findall(latex_doc)
    if preamble_defs:
        # Embed as a %!preamble block that generateExtra.sh can strip/include
        header = '%!preamble\n' + '\n'.join(
            '%  ' + line for line in preamble_defs.splitlines()
        ) + '\n%!end-preamble\n'
        return [header + b for b in blocks]
    return blocks


# ── Download ───────────────────────────────────────────────────────────────────

def _get_json(url: str) -> object:
    req = urllib.request.Request(url, headers={'User-Agent': 'tikzjs-fetch/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            raw = response.read()
    except urllib.error.HTTPError as e:
        print(f'HTTP error {e.code}: {e.reason}', file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f'URL error: {e.reason}', file=sys.stderr)
        sys.exit(1)
    return json.loads(raw.decode('utf-8'))


def fetch_datikz(dataset: str, want: int, dataset_offset: int = 0) -> list[str]:
    """Fetch tikz_code strings from nllg/DaTikZ-V4 via datasets-server API.

    Reads starting at *dataset_offset* in the dataset and fetches enough rows
    to yield at least *want* entries after extraction filtering.
    """
    PAGE = 100
    # Over-fetch to account for filtering losses
    fetch_target = min(want * 4, 2000)
    codes: list[str] = []
    offset = dataset_offset
    while len(codes) < fetch_target:
        length = min(PAGE, fetch_target - len(codes))
        url = _HF_ROWS_API.format(dataset=dataset, offset=offset, length=length)
        print(f'  fetching rows {offset}–{offset + length - 1} …')
        data = _get_json(url)
        rows = data.get('rows', [])
        if not rows:
            break
        for item in rows:
            code = item.get('row', {}).get('tikz_code', '')
            if code:
                codes.append(code)
        offset += len(rows)
        if len(rows) < length:
            break  # no more data
    return codes


def fetch_navidium(url: str) -> list[dict]:
    """Fetch entries from Navidium/tikz_dataset metadata.json."""
    print(f'Fetching dataset metadata from:\n  {url}')
    data = _get_json(url)
    print(f'  downloaded — {len(data)} entries')
    return data


# ── Main ───────────────────────────────────────────────────────────────────────

def _extract_candidates(sources: list[str]) -> tuple[list[str], int]:
    """Filter and extract tikzpicture blocks from a list of LaTeX source strings."""
    candidates: list[str] = []
    n_skipped = 0
    for src in sources:
        for block in extract_tikzpictures(src):
            block = block.strip()
            if not block:
                continue
            if should_skip(block):
                n_skipped += 1
                continue
            candidates.append(block)
    return candidates, n_skipped


def _write_batch(candidates: list[str], out_dir: Path, seed: int) -> int:
    """Deduplicate, shuffle, pick BATCH_SIZE, write to out_dir. Returns count written."""
    seen: set[str] = set()
    unique: list[str] = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    if len(unique) < len(candidates):
        print(f'  {len(candidates) - len(unique)} duplicates removed → {len(unique)} unique')

    random.seed(seed)
    random.shuffle(unique)
    selected = unique[:BATCH_SIZE]

    out_dir.mkdir(parents=True, exist_ok=True)
    for old in sorted(out_dir.glob('*.tikz')):
        old.unlink()
    for i, tikz in enumerate(selected, 1):
        (out_dir / f'{i:03d}.tikz').write_text(tikz + '\n', encoding='utf-8')
    return len(selected)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--batches', type=int, default=1,
                        help='Number of groups of 100 to fetch (default: 1)')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT,
                        help='Root output directory (default: test/extra/fixtures)')
    parser.add_argument('--seed', type=int, default=42,
                        help='Base random seed; each batch increments it (default: 42)')
    parser.add_argument('--include-generated', action='store_true',
                        help='Also include LLM-generated variations (Navidium only)')
    parser.add_argument('--url', default=None,
                        help='Navidium metadata URL override (for testing)')
    args = parser.parse_args(argv)

    total_written = 0

    # ── Batch 0: Navidium/tikz_dataset ─────────────────────────────────────────
    print('Batch 0 (Navidium/tikz_dataset):')
    url = args.url or _NAVIDIUM_URL
    data = fetch_navidium(url)
    all_sources: list[str] = []
    for entry in data:
        orig = entry.get('tikz_code', '')
        if orig:
            all_sources.append(orig)
        if args.include_generated:
            all_sources.extend(entry.get('generated_samples', []))
    candidates, n_skipped = _extract_candidates(all_sources)
    print(f'  {len(candidates)} blocks extracted ({n_skipped} skipped)')
    n = _write_batch(candidates, args.output / '0', args.seed)
    print(f'  wrote {n} fixtures → {args.output / "0"}/')
    total_written += n

    # ── Batches 1-N: nllg/DaTikZ-V4 ────────────────────────────────────────────
    if args.batches > 1:
        print(f'\nDataset: {DEFAULT_DATASET}')
        stride = BATCH_SIZE * 4
        for batch_idx in range(1, args.batches):
            dataset_offset = (batch_idx - 1) * stride
            print(f'\nBatch {batch_idx} (dataset offset {dataset_offset}):')
            raw_codes = fetch_datikz(DEFAULT_DATASET, BATCH_SIZE, dataset_offset)
            print(f'  {len(raw_codes)} tikz_code entries fetched')
            candidates, n_skipped = _extract_candidates(raw_codes)
            print(f'  {len(candidates)} blocks extracted ({n_skipped} skipped)')
            if not candidates:
                print('  no candidates — stopping early', file=sys.stderr)
                break
            out_dir = args.output / str(batch_idx)
            n = _write_batch(candidates, out_dir, args.seed + batch_idx)
            print(f'  wrote {n} fixtures → {out_dir}/')
            total_written += n

    print(f'\nTotal: {total_written} fixtures across {args.batches} batch(es)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
