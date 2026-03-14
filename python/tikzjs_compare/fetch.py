"""
Fetch TikZ fixture files from the Navidium/tikz_dataset HuggingFace dataset.

Extracts \\begin{tikzpicture}...\\end{tikzpicture} blocks from full LaTeX
documents and saves them as .tikz files suitable for use with tikzjs.

Usage:
    python -m tikzjs_compare.fetch [options]

Options:
    --count N           Number of fixtures to save (default: 50)
    --output DIR        Output directory (default: test/extra/fixtures)
    --seed N            Random seed for shuffling (default: 42)
    --include-generated Also include LLM-generated variations
    --url URL           Metadata URL override (for testing)
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

DATASET_URL = (
    'https://huggingface.co/datasets/Navidium/tikz_dataset'
    '/resolve/main/metadata.json'
)

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

def fetch_metadata(url: str) -> list[dict]:
    print(f'Fetching dataset metadata from:\n  {url}')
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
    print(f'  downloaded {len(raw) / 1024:.0f} KB')
    return json.loads(raw.decode('utf-8'))


# ── Main ───────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--count', type=int, default=50,
                        help='Number of fixtures to save (default: 50)')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT,
                        help='Output directory (default: test/extra/fixtures)')
    parser.add_argument('--seed', type=int, default=42,
                        help='Random seed for shuffling (default: 42)')
    parser.add_argument('--include-generated', action='store_true',
                        help='Also include LLM-generated variations')
    parser.add_argument('--url', default=DATASET_URL,
                        help='Metadata JSON URL override')
    args = parser.parse_args(argv)

    data = fetch_metadata(args.url)
    print(f'  {len(data)} entries in dataset')

    candidates: list[str] = []
    n_skipped = 0

    for entry in data:
        sources: list[str] = []
        orig = entry.get('tikz_code', '')
        if orig:
            sources.append(orig)
        if args.include_generated:
            sources.extend(entry.get('generated_samples', []))

        for src in sources:
            for block in extract_tikzpictures(src):
                block = block.strip()
                if not block:
                    continue
                if should_skip(block):
                    n_skipped += 1
                    continue
                candidates.append(block)

    print(f'  {len(candidates)} tikzpicture blocks extracted '
          f'({n_skipped} skipped by filter)')

    if not candidates:
        print('No candidates found — nothing to write.', file=sys.stderr)
        return 1

    # Deduplicate
    seen: set[str] = set()
    unique: list[str] = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    if len(unique) < len(candidates):
        print(f'  {len(candidates) - len(unique)} duplicates removed '
              f'→ {len(unique)} unique')
    candidates = unique

    random.seed(args.seed)
    random.shuffle(candidates)
    selected = candidates[:args.count]

    args.output.mkdir(parents=True, exist_ok=True)

    # Remove stale fixtures so re-runs with a different --count stay clean
    for old in sorted(args.output.glob('*.tikz')):
        old.unlink()

    for i, tikz in enumerate(selected, 1):
        (args.output / f'{i:03d}.tikz').write_text(tikz + '\n', encoding='utf-8')

    print(f'Wrote {len(selected)} fixtures to {args.output}/')
    return 0


if __name__ == '__main__':
    sys.exit(main())
