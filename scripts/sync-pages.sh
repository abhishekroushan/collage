#!/usr/bin/env bash
# Sync GitHub Pages root index.html from frontend standalone build
# Usage: ./scripts/sync-pages.sh  (run from repo root or any subdir)
set -euo pipefail

# Resolve repo root (directory containing this script's parent)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SRC="${REPO_ROOT}/frontend/collage-standalone.html"
DST="${REPO_ROOT}/index.html"

if [[ ! -f "$SRC" ]]; then
  echo "error: source not found: $SRC" >&2
  exit 1
fi

# Copy verbatim - standalone is fully self-contained (no external deps)
cp "$SRC" "$DST"

# Ensure .nojekyll exists (disables Jekyll on Pages)
touch "${REPO_ROOT}/.nojekyll"

# Verify
if diff -q "$SRC" "$DST" >/dev/null; then
  echo "synced: $SRC -> $DST (identical, $(wc -c < "$DST") bytes)"
else
  echo "warning: files differ after copy" >&2
  exit 1
fi

# Show git status hint
if command -v git >/dev/null 2>&1; then
  echo "--- git status ---"
  git -C "$REPO_ROOT" status --short -- index.html .nojekyll || true
fi
