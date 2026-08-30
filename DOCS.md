# Documentation — Tear2Fit Architecture & Plans

> For quick play, see `README.md:9` **How to Use**. This file is for contributors wanting architecture, monorepo layout, and hybrid frontend/backend plans.

## Organization

Monorepo: `frontend/` (JS + Canvas, ships today) + `backend/` (Python/FastAPI + future Mojo kernels). Heavy CV moves to the backend without rewriting the UI — HTTP is the stable seam.

```
collage/
  frontend/               # static app — see frontend/README.md for full pipeline/knobs
    index.html            # dev (ES modules, needs http://)
    collage-standalone.html # offline single-file (file://)
    style.css
    js/main.js            # drop/URL, wire-up, seeded clicks
    js/tear.js | quantize.js | color.js | analyzeTarget.js | composer.js
  backend/
    app.py                # FastAPI: /api/tear, /api/brightness-map, /api/compose
    requirements.txt
    Dockerfile
    mojo/README.md        # where Mojo kernels plug in
  README.md               # this file
```

## General Plan — Hybrid Frontend + Backend

**Yes, JS frontend + Python/Mojo backend is the right split for complex later ops.** Keep UI in JS, offload math-heavy kernels to Python (OpenCV/skimage) then Mojo for inner loops.

### What changes vs today (all-client)

| Concern | Today | Hybrid | Seam |
|---|---|---|---|
| Quantize | `js/quantize.js` k-means LAB (5k samples) | `cv2.kmeans` LAB + sklearn, or `skimage` | `POST /api/tear` |
| Tear | per-color Voronoi + fbm (`js/tear.js:22`) | `skimage.segmentation.slic` + watershed + OpenCV morphology + `mojo/tear.mojo` | same |
| Target map | IDW `interpolateFromSeeds` (`js/analyzeTarget.js:52`) | `cv2.distanceTransform` / Poisson solve + `mojo/compose.mojo` diffusion | `POST /api/brightness-map` |
| Compose matching | LAB distance greedy (`js/composer.js:10`) | Hungarian/graph-cut + `mojo/match.mojo` | `POST /api/compose` |
| Transport | none | `multipart/form-data` images + JSON params, `CORS *` (see `backend/app.py:18`) |  |
| Preview | Canvas direct | Backend returns `b64` PNG data URLs; frontend draws to same canvases |  |

Frontend already has the toggle point (`frontend/js/main.js:1` wiring): add `USE_BACKEND` flag and `fetch(BACKEND+"/api/tear", {method:"POST", body: FormData})` — no HTML/CSS rewrite.

### Why this seam

- **Contract isimages + params in, JSON+b64 out** (`backend/app.py:45` `b64_png`). No shared memory, no binary mask streaming. Swapping a Mojo kernel (`backend/mojo/README.md`) doesn't change the frontend.
- **Progressive:** ship `frontend/collage-standalone.html` offline today; add backend when you need it, feature-flagged.
- **No CORS pain for users:** dev serves `frontend/` on `http://localhost:5173` and `backend` on `:8000` (`CORSMiddleware` in `app.py:18`); prod puts both behind one origin or reverse proxy.

### Minimal separation done

`frontend/` and `backend/` folders are already split (see tree above). Root `frontend/README.md` keeps the current pipeline/knobs/distribution docs; `backend/README.md` documents endpoints + Mojo plug-in.

### CORS notes (Fetch URL)

Direct `Fetch URL` uses `crossOrigin="anonymous"` and requires the host to send `Access-Control-Allow-Origin:*` (needed to draw to `<canvas>` without tainting). `i.pinimg.com` and `img.magnific.com` currently do **not** send that header (verified `curl -I` → no `ACA O`, only `vary: Origin`), so the browser blocks `origin 'null'` / `ERR_FAILED` — even though the image loads visually.

- **Fix 1 — never use `file://` for URL fetch:** open via `http://localhost:8000` (`python3 -m http.server 8000 --directory frontend` or root) or `https://abhishekroushan.github.io/collage/`. `file://` gives opaque `origin null` which many CDNs reject (`Unsafe attempt to load URL file://...`).
- **Fix 2 — proxy retry (now built-in):** `frontend/js/main.js:55` and `frontend/collage-standalone.html:880` (`loadFromUrl`) now automatically retry via `https://images.weserv.nl/?url=...&output=jpg` (returns `ACA O:*`) then `https://corsproxy.io/?...`. If both fail, the status shows `URL fetch failed (CORS). Try download & drop.`
- **Fallback — download & drop:** the most reliable for Pinterest etc. Save the image locally and drop onto the canvas; no CORS check needed.
