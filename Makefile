# tikzjs Makefile
#
# Targets:
#   make               — build (default)
#   make gen           — regenerate parser from grammar (run after editing _tikzjs.pegjs)
#   make build         — compile TypeScript → dist/
#   make test          — all jest tests (unit + golden structural)
#   make test-unit     — unit tests only
#   make test-golden   — golden structural tests only (jest, no pixel diff)
#   make golden        — generate golden SVG refs via pdflatex + dvisvgm (requires TeX Live)
#   make cdiff         — run Python/OpenCV connected-component comparison
#   make cdiff-v       — cdiff with verbose per-component output
#   make cdiff-one NAME=<fixture> — compare a single fixture
#   make venv          — create/update Python virtual environment
#   make serve         — start dev comparison server on :3737
#   make clean         — remove dist/
#   make install       — npm install (also runs gen + build via postinstall)
#
# Extra fixture targets (from HuggingFace dataset — fixtures not committed):
#   make extra-fetch            — download fixtures from Navidium/tikz_dataset
#   make extra-fetch COUNT=N    — download N fixtures (default: 50)
#   make cdiff-extra            — run visual diff on extra fixtures
#   make cdiff-extra-v          — cdiff-extra with verbose output
#   make cdiff-one-extra NAME=N — compare a single extra fixture
#   make serve-extra            — dev server for extra fixtures on :3738

NODE_MODULES := ./node_modules/.bin
PEGGY        := $(NODE_MODULES)/peggy
TSC          := $(NODE_MODULES)/tsc
JEST         := $(NODE_MODULES)/jest
GRAMMAR      := src/parser/_tikzjs.pegjs
PARSER       := src/parser/_tikzjs.js

VENV         := .venv
PYTHON       := $(VENV)/bin/python
PIP          := $(VENV)/bin/pip

EXTRA_FIXTURES := test/extra/fixtures
EXTRA_REFS     := test/extra/refs
EXTRA_REPORT   := /tmp/tikzjs-extra
EXTRA_COUNT    ?= 50

.PHONY: all gen build test test-unit test-golden golden \
        cdiff cdiff-v cdiff-one venv serve clean install watch \
        extra-fetch extra-golden cdiff-extra cdiff-extra-v cdiff-one-extra serve-extra

# Default target
all: build

# ── Parser generation ─────────────────────────────────────────────────────────

# Regenerate parser JS from PEG grammar.
# MUST be run after any edit to _tikzjs.pegjs.
gen: $(PARSER)

$(PARSER): $(GRAMMAR)
	@echo "→ Regenerating parser from grammar..."
	$(PEGGY) -o $(PARSER) --cache $(GRAMMAR)
	@echo "  done: $(PARSER)"

# ── TypeScript build ──────────────────────────────────────────────────────────

build: $(PARSER)
	@echo "→ Compiling TypeScript..."
	$(TSC)
	@echo "  done: dist/"

# ── Tests ─────────────────────────────────────────────────────────────────────

test:
	$(JEST) --silent=false

test-unit:
	$(JEST) --silent=false --testPathPattern='test/unit'

test-golden:
	$(JEST) --silent=false --testPathPattern='test/golden'

# ── Golden reference generation ───────────────────────────────────────────────

# Generate reference SVGs using TexLive (pdflatex + dvisvgm).
golden:
	@echo "→ Generating golden SVG references (requires TeX Live)..."
	bash scripts/generateGolden.sh

# ── Python venv ───────────────────────────────────────────────────────────────

# Create (or update) the Python virtual environment with tikzjs_compare installed.
venv: $(VENV)/bin/activate

$(VENV)/bin/activate: python/requirements.txt python/pyproject.toml
	@echo "→ Setting up Python virtual environment..."
	python3 -m venv $(VENV)
	$(PIP) install --quiet --upgrade pip
	$(PIP) install --quiet -e python/
	@echo "  done: $(VENV)/"

# ── Python/OpenCV connected-component comparison ──────────────────────────────

# Run full pixel + connected-component comparison against reference SVGs.
# Output: /tmp/tikzjs-golden/report.html  (open in browser or `make serve`)
cdiff: build venv
	@echo "→ Running golden comparison (Python/OpenCV)..."
	$(PYTHON) -m tikzjs_compare

# Verbose mode: prints per-component area ratios
cdiff-v: build venv
	@echo "→ Running golden comparison (verbose)..."
	GOLDEN_VERBOSE=1 $(PYTHON) -m tikzjs_compare

# Compare a single fixture:
#   make cdiff-one NAME=08-tikzcd-basic
cdiff-one: build venv
	@echo "→ Comparing fixture: $(NAME)"
	GOLDEN_VERBOSE=1 $(PYTHON) -m tikzjs_compare $(NAME)

# ── Dev server ────────────────────────────────────────────────────────────────

serve:
	@echo "→ Starting dev server at http://localhost:3737 ..."
	node scripts/server.js

serve-%:
	@echo "→ Starting dev server at http://localhost:$* ..."
	node scripts/server.js $*

# ── Extra fixtures (HuggingFace dataset) ──────────────────────────────────────

# Generate TeX reference SVGs for extra fixtures (requires TeX Live).
# Run after extra-fetch, or after re-fetching with updated fetch.py.
extra-golden:
	@echo "→ Generating extra SVG references (requires TeX Live)..."
	bash scripts/generateExtra.sh

# Fetch extra fixtures from Navidium/tikz_dataset.
# Override count with: make extra-fetch COUNT=100
extra-fetch: venv
	@echo "→ Fetching $(EXTRA_COUNT) extra fixtures from HuggingFace..."
	$(PYTHON) -m tikzjs_compare.fetch --count $(EXTRA_COUNT) --output $(EXTRA_FIXTURES)

# Visual diff on extra fixtures (no golden refs — renders only, checks for errors).
# Output: $(EXTRA_REPORT)/report.html
cdiff-extra: build venv
	@echo "→ Running extra fixture comparison..."
	TIKZJS_FIXTURES_DIR=$(EXTRA_FIXTURES) TIKZJS_REFS_DIR=$(EXTRA_REFS) \
	  TIKZJS_REPORT_DIR=$(EXTRA_REPORT) \
	  $(PYTHON) -m tikzjs_compare

cdiff-extra-v: build venv
	@echo "→ Running extra fixture comparison (verbose)..."
	TIKZJS_FIXTURES_DIR=$(EXTRA_FIXTURES) TIKZJS_REFS_DIR=$(EXTRA_REFS) \
	  TIKZJS_REPORT_DIR=$(EXTRA_REPORT) GOLDEN_VERBOSE=1 \
	  $(PYTHON) -m tikzjs_compare

# Compare a single extra fixture: make cdiff-one-extra NAME=007
cdiff-one-extra: build venv
	@echo "→ Comparing extra fixture: $(NAME)"
	TIKZJS_FIXTURES_DIR=$(EXTRA_FIXTURES) TIKZJS_REFS_DIR=$(EXTRA_REFS) \
	  TIKZJS_REPORT_DIR=$(EXTRA_REPORT) GOLDEN_VERBOSE=1 \
	  $(PYTHON) -m tikzjs_compare $(NAME)

# Dev server for extra fixtures on :3738 (visual diff report served at /diff)
serve-extra:
	@echo "→ Starting extra dev server at http://localhost:3738 ..."
	TIKZJS_FIXTURES_DIR=$(EXTRA_FIXTURES) TIKZJS_REFS_DIR=$(EXTRA_REFS) \
	  TIKZJS_DIFF_DIR=$(EXTRA_REPORT) \
	  node scripts/server.js 3738

# ── Utilities ─────────────────────────────────────────────────────────────────

clean:
	rm -rf dist/
	@echo "  dist/ removed"

clean-all: clean
	rm -rf $(VENV)
	@echo "  .venv/ removed"

install:
	npm install

# Watch mode: rebuild on grammar/TS changes (requires entr)
watch:
	@which entr >/dev/null 2>&1 || (echo "Install entr: sudo apt install entr" && exit 1)
	find src/ -name '*.ts' -o -name '*.pegjs' | entr -r make build
