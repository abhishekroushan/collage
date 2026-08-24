# Collage — Torn Paper Mosaic

Client-side collage tool. Feed a color **source** image → it is torn into shade-sorted pieces → those pieces fill a black-and-white **target** image by luminance match. All processing in the browser (Canvas + JS), no upload.

Live: open `collage-standalone.html` directly (double-click, works on `file://`) or serve the folder and open `index.html` via `http://`.

## Quick Start

### Offline (for end users)
Just double-click **`collage-standalone.html`** — single file, no server, no install. This is the file to ship.

### Dev / HTTP (required for `index.html`)
`index.html` uses ES modules (`js/main.js`), which browsers block on `file://`.

```bash
# from this folder (frontend/):
python3 -m http.server 8000
# or from repo root:
# python3 -m http.server 8000 --directory frontend
# open http://localhost:8000
```

> If you open `index.html` via `file://` you will see a red banner and `Drop / Click to browse` does nothing — that's the browser's CORS policy for modules. Use the standalone file or a local server.

## Workflow

1. **Drop Source (color)** — drag-drop, click the dashed box to browse, or paste a URL and `Fetch URL`.
2. **Drop Target (B&W)** — same. It is auto-grayscaled; enable `auto-grayscale` / `ignore white bg` as needed.
3. **Tear Source** — quantizes + Voronoi-tears the source (see Pipeline).
4. **Compose Collage** — fills the target grid with best-matching pieces. Tweak knobs and re-compose.
5. **Export PNG** — 2× high-res export of the collage canvas.

URL fetch needs `crossOrigin=anonymous`; if the host blocks CORS the status bar says `URL fetch failed — download & drop` (canvas taint). Drag-drop bypasses this.

## How It Works

```
[Source RGB] --quantize (k-means LAB)--> palette (k shades)
     |                 \
     |            per-color Voronoi (far-point seeds) + fbm ragged edge
     v                 v
  [Bag of Pieces sorted by L*]  ─┐
                                 │
[Target RGB] -> grayscale L* -> brightnessMap[w*h] (0-100) --┘
                                 │
                         Composer (grid mosaic, LAB distance)
                                 v
                            Collage Canvas -> PNG
```

**Tear (`js/tear.js`)**
- Downscale source to `Analysis size` (140–420px) for speed.
- `k`-means in LAB space (`js/quantize.js`, `js/color.js`) → palette. Samples 5–6k pixels, k-means++ init, 10–12 iters.
- Allocate pieces per palette proportional to area (ensures dominant shades get more pieces).
- Within each palette's pixel set, run constrained Voronoi via `nPieces` farthest-point seeds, then build pixel-perfect masks + 1–2px `fbm` border erode/dilate per `Roughness`. Each piece gets its own offscreen canvas and avg `LAB`.
- Tray sorted by `L*` (luminance) then hue.

**Target Map (`js/analyzeTarget.js`)** — two modes, default `Direct`:

- **Direct (dense, default)** — `brightnessMap = L*` per pixel (sRGB → linear → XYZ → LAB L*). Optional `Contrast` and `Blur/diffuse` (box blur). No seeds.
- **Seeded Auto** (sparse/line-art) — auto picks dark/light quantiles (12th/88th pct) as anchors, interpolates full map via inverse-distance weighting (`interpolateFromSeeds`, `p=1.8`) blended 65/35 with original grays.
- **Seeded User** — click target preview to place anchors cycling `L=0/25/50/75/100`, right-click to remove. Same IDW interpolation. Good for silhouettes where direct map would waste pieces on white paper.

**Composer (`js/composer.js`)**
- Builds `cols × rows` grid (`Grid=auto` → `sqrt(N*aspect)`). Each cell's avg `L` is the lookup key.
- Matches `distance = wL*|L_piece - L_target| + 0.2*(1-wL)*saturation(piece)`; `Luminance weight` knob controls this. `allowReuse=false` uses each piece once (greedy dark→light).
- Places piece scaled to cell (`Scale` 0.6–1.6×), random rotation (`±0/15/45/180°`), jitter, optional shadow/seam, skips `L>92` cells if `ignore white bg`.

## Controls

| Group | Knob | What it does |
|---|---|---|
| Tear | `Palette (k)` 3–24 | Shade quantization granularity |
|  | `Pieces` 20–600 | Total torn pieces |
|  | `Roughness` 0–1 | fbm amplitude on torn edge |
|  | `Analysis size` | Downscale size; larger = finer but slower |
| Target Map | `Mode` | Direct / Seeded Auto / Seeded User |
|  | `Contrast` -100..100 | Pre-contrast on target |
|  | `Blur / diffuse` 0–12 | Post-blur on brightness map (seeded gradients) |
| Composer | `Grid` auto/0–60 | Columns; rows derived |
|  | `Luminance weight` 0–1 | Match on brightness vs. desaturation |
|  | `Scale` | Piece scale within cell |
|  | `Rotation` | Random rotation range |
|  | `allow reuse` | Reuse same piece if best match |
|  | `torn shadow/seam` | Drop shadow + paper thickness |
| Target | `ignore white bg` | Skip bright cells (leave paper) |

`Brightness map (debug)` canvas shows the post-processed `L` map actually used for matching.

## Project Structure

```
index.html                 # dev entry (ES modules, needs http://)
collage-standalone.html    # offline single-file (double-click)
style.css                  # layout + dropzone overlay (.fileInputOverlay)
js/
  main.js                  # UI wiring, drop+URL, seeded clicks, tear/compose flow
  color.js                 # sRGB→LAB, distance, contrast
  quantize.js              # k-means in LAB
  tear.js                  # palette-constrained Voronoi + ragged edge
  analyzeTarget.js         # Direct / Seeded map + box blur + preview
  composer.js              # grid mosaic matching + placement
```

## Hosting / Distribution

- **GitHub Pages (recommended):** push the `frontend/` folder (or set Pages source to `frontend/`), enable Pages — share the `https://` link. No CORS issues, no download.
- **Zip:** ship `collage-standalone.html` alone — it's self-contained (`grep -c 'src="js/'` → 0). No `file://` module issue. For the monorepo, zip `frontend/collage-standalone.html`.
- **Electron/Tauri/PWA:** wrap the same static assets if a desktop app is needed later.

## Troubleshooting

- **Browse button does nothing / `Failed to load resource: net::ERR_FAILED` in console:** you opened `index.html` via `file://`. Use `collage-standalone.html` or `python3 -m http.server 8000` → `http://localhost:8000`.
- **URL fetch failed (CORS):** host blocks `crossOrigin=anonymous`. Download the image and drop it instead, or host via CORS proxy.
- **Slow tear:** lower `Analysis size` or `Pieces`, or reduce target canvas `maxMapSide` (720px cap in `js/main.js:228` — path is `frontend/js/main.js:228` from repo root).

License: MIT (add as needed).
