[![View Site](https://shields.io)](https://abhishekroushan.github.io/collage/)

# Tear2Fit: Torn Paper to Collage Mosaic

## Overview
Tear2Fit brings the tactile art of paper scrapbooking and collaging to your digital screen! Choose the source image to 'tear' and the target image to 'collage' and enjoy the fitting experience, twisting some 'knobs' along your way. Rip, fit, and create your collage in just a couple of clicks!

---
## How to Use — Play with the App

> **Entry points:** `https://abhishekroushan.github.io/collage/` (Pages, `index.html:1` synced from `frontend/collage-standalone.html:1`), double-click `frontend/collage-standalone.html` (offline `file://` works), or `python3 -m http.server 8000 --directory frontend` → `http://localhost:8000` (`frontend/index.html:1` needs `http://` for ES modules `frontend/js/main.js:1`).

### 0 · Quick Try (30 sec)

1. Open the app — defaults from `images/source.png` (left, color) + `images/target.png` (right, B&W) auto-load (`frontend/js/main.js:117` `loadDefaultImages()` tries `images/source.png` etc., fallback to embedded `data:image/webp` avoids tainted canvas on `file://`).
2. Keep defaults or replace (see §1) → **Tear Source** → **Compose Collage** → tweak any slider → **Export PNG**.

### 1 · Provide Images — Source (left) & Target (right)

Each card is at `frontend/index.html:25` / `frontend/collage-standalone.html:73` — identical UI:

| Way | How | When to use |
|---|---|---|
| **Default** | `images/source.png` + `images/target.png` (also `frontend/images/` synced by `scripts/sync-pages.sh:13`) load automatically on open. Status `Loaded default source & target from images/...` (`frontend/js/main.js:130`). | First play, no setup. Replace anytime. |
| **Drag & Drop** | Drag image file onto dashed `dropzone` (`frontend/style.css:10` `.dropzone`, `frontend/js/main.js:117` `wireDrop`). | Fastest local. |
| **Click to Browse** | Click the dashed box (hidden `.fileInputOverlay` `frontend/index.html:31` covers the zone). | Same as drop. |
| **Upload button** | **Upload** button right next to **Fetch URL** (`frontend/index.html:33` `urlRow` → `Fetch URL or Upload`, `frontend/style.css:21` `.uploadBtn`). Either/**OR** option — triggers the same file picker (`frontend/js/main.js:138` `sourceUploadBtn/targetUploadBtn`). | Explicit button alternative to clicking the zone. |
| **Fetch URL** | Paste `https://...` into `sourceUrl`/`targetUrl` (`frontend/index.html:34`) → **Fetch URL** (`frontend/js/main.js:55` `loadFromUrl`). App tries direct `crossOrigin='anonymous'`, then auto-retries `https://images.weserv.nl/?url=...` then `corsproxy.io` (see `DOCS.md` CORS notes). If all fail → `Try download & drop`. | Public links. Pinterest etc. often need proxy/fallback. |

**Target-specific toggles** under the target card (`frontend/index.html:51`):
- `auto-grayscale` (checked by default) — converts target to `L*` for the brightness map.
- `ignore white bg` (checked) — Composer later skips cells with `L>92` (leaves paper).

### 2 · Tweak Knobs Before Tearing/Composing

All sliders live in `frontend/index.html:58` `.controls` → four groups (`frontend/js/main.js:186` `controls`). Changes live-update the status but **Tear** and **Compose** are manual actions.

**Tear group** (`js/tear.js:22`, `js/quantize.js`):
| Slider | Range | What it does |
|---|---|---|
| `Palette (k)` | 3–24 (default 8) | LAB `k-means` shade quantization (`js/quantize.js`, samples 5–6k, `k-means++`). Low k = posterized, high k = subtle. |
| `Pieces` | 20–600 step 10 (default 120) | Total torn pieces, allocated per-palette proportional to area. |
| `Roughness` | 0–1 step 0.05 (0.55) | `fbm` border erode/dilate on Voronoi masks (`js/tear.js:22`). 0 = clean, 1 = very torn. |
| `Analysis size` | 140–420 step 20 (280) | Downscale longest side for speed. Larger = finer pieces but slower. |

**Target Map group** (`js/analyzeTarget.js:52`):
| Control | Options |
|---|---|
| `Mode` | `Direct (dense)` default — `brightnessMap = L*` per pixel. `Seeded Auto` — auto dark/light quantiles (12th/88th pct) → IDW `interpolateFromSeeds` `p=1.8`. `Seeded User` — click target preview to place anchors cycling `L=0/25/50/75/100`, right-click removes (`frontend/js/main.js:143`). |
| `Contrast` | -100..100 (0) — `applyContrast` before `L*`. |
| `Blur / diffuse` | 0–12 (0) — box-blur the map (`boxBlur` `radius/iters`). Smooths seeded gradients. |

**Composer group** (`js/composer.js:10`):
| Knob | Range / Options |
|---|---|
| `Grid` | `auto` or 0–60 cols (default `auto` → `sqrt(N*aspect)`). Rows derived. |
| `Luminance weight` | 0–1 (0.85) — match `|L_piece-L_target|*w + saturation*0.2*(1-w)`. High = strictly brightness, low = favors muted pieces. |
| `Scale` | 0.6–1.6 (1.0) — piece scale inside cell. |
| `Rotation` | `0° / ±15° / ±45° / ±180°` — random per piece. |
| `allow reuse` | unchecked — each piece once (greedy dark→light), checked = reuse best match. |
| `torn shadow/seam` | checked — drop shadow + paper edge. |

### 3 · Action Buttons (`frontend/index.html:89` `.actions`)

- **Tear Source** (`#btnTear`) → runs `tearImage(sourceCanvas, opts)` (`frontend/js/main.js:218`). Status `Tearing…` then `Torn into N pieces`. Auto `refreshMap()` + `doCompose(false)` if target exists.
- **Compose Collage** (`#btnCompose`) → `compose()` grid mosaic (`frontend/js/main.js:285`). Writes to `collageCanvas` (`720×720` max, 2× DPR for crisp). Status `Composed W×H`.
- **Export PNG** (`#btnExport`) → `2×` upscale of `_exportCanvas` → `collage.png` download.
- **Status** (`#status`) — live feedback (fetch/proxy, tear, compose).

All `change` on `Grid/L-weight/Scale/Rotation/allowReuse/showSeams/ignoreWhiteBg` and `Contrast/Blur/Mode` live-recompose if already torn (`frontend/js/main.js:325`).

### 4 · Inspect Outputs

- **Torn pieces — sorted by shade** (`#tray` `frontend/style.css:42` `.tray`, `frontend/js/main.js:238` `renderTray()`). `56×56` thumbs, sorted by `L*` then hue, tooltip `L/a`. `pieceCountLabel` shows `(N)`.
- **Palette bar** (`#paletteBar`) — `k` swatches `rgb(r,g,b)` tooltip `L`.
- **Collage** (`#collageCanvas` `frontend/style.css:47`, `frontend/js/main.js:285`). `collageInfo` shows `grid … · W×H · L weight`.
- **Brightness map (debug)** (`#mapCanvas`, `frontend/js/main.js:263` `renderMapToCanvas`). Grayscale `L` map actually used for matching (after contrast/blur/IDW). Useful to verify `Seeded` vs `Direct`.

### 5 · Iterate & Tips

- Start with defaults → `Tear` (120 pcs) → `Compose` → then sweep `Palette k` 8→16, `Roughness` 0.3→0.8, `L-weight` 0.6→0.95, `Grid` auto→20.
- Sparse line-art target → switch `Mode=Seeded User`, click 4–8 anchors (dark strokes `L=0`, paper `L=100`), `Blur 4–6`.
- White-background target → keep `ignore white bg` checked; uncheck to fill everything.
- **File vs HTTP:** `Fetch URL` needs `http://` (proxy built-in). `file://` double-click works for `collage-standalone.html` + defaults (embedded data URL) but URL fetch still needs `http://localhost:8000` or Pages.
- **Replace images anytime:** new `Upload`/`Drop` overwrites `sourceCanvas`/`targetCanvas`; `Tear` must be re-run (pieces are tied to source).

## Documentation

Want the full architecture, monorepo layout, and hybrid frontend/backend plan (OpenCV/Mojo migration) plus troubleshooting?

**→ Read [`DOCS.md`](DOCS.md)** — it contains the `## Organization` tree, `## General Plan` with the `Today → Hybrid` seam table, `Why this seam`, `Minimal separation` notes, and `### CORS notes` for `Fetch URL`. Keep `README.md` for usage; dive into `DOCS.md` for contributors.

Also see `frontend/README.md` for pipeline/knobs and `backend/README.md` for API + Mojo kernels.

## Quick Start

**Frontend only (today):**
```bash
# offline: double-click frontend/collage-standalone.html
python3 -m http.server 8000 --directory frontend  # http://localhost:8000
```

**With backend (when you need heavy ops):**
```bash
pip install -r backend/requirements.txt
uvicorn backend.app:app --reload --port 8000      # backend
python3 -m http.server 5173 --directory frontend  # frontend on different port
# frontend/js/main.js: set USE_BACKEND=true, BACKEND="http://localhost:8000"
docker build -t collage-backend backend && docker run -p 8000:8000 collage-backend
```

See `frontend/README.md` for full workflow/pipeline/knobs and `backend/README.md` for API + Mojo integration.

## GitHub Pages

GitHub Pages serves the standalone build from the repository root (`index.html:1`, copied verbatim from `frontend/collage-standalone.html:1` — fully self-contained, no external `style.css`/`js/` deps, works at `https://abhishekroushan.github.io/collage/`). `.nojekyll` disables Jekyll processing.

**Workflow after any edit to standalone:**

```bash
# 1. edit the source of truth
#    frontend/collage-standalone.html

# 2. sync to Pages root (verifies byte-identical copy)
./scripts/sync-pages.sh

# 3. commit both
git add frontend/collage-standalone.html index.html
git commit -m "update collage standalone + pages sync"
```

The sync script is `scripts/sync-pages.sh:1`. It does `cp frontend/collage-standalone.html index.html` and `touch .nojekyll`, then `diff -q` verification. Run it before every PR that touches the frontend; Pages deploys from `main` branch `/root` after merge.

Optional pre-commit hook to auto-sync:

```bash
cat > .git/hooks/pre-commit <<'HOOK'
#!/bin/sh
./scripts/sync-pages.sh
git add index.html
HOOK
chmod +x .git/hooks/pre-commit
```
