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

# Sync default images for Pages (root) and local frontend dev
if [[ -d "${REPO_ROOT}/images" ]]; then
  mkdir -p "${REPO_ROOT}/frontend/images"
  cp "${REPO_ROOT}/images/"*.png "${REPO_ROOT}/frontend/images/" 2>/dev/null || true
  cp "${REPO_ROOT}/images/"*.jpg "${REPO_ROOT}/frontend/images/" 2>/dev/null || true
  echo "synced images/: $(ls -1 ${REPO_ROOT}/images 2>/dev/null | tr '\n' ' ')"
fi

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
