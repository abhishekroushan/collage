# Backend — Python (+ Mojo)

HTTP seam between `frontend/` and heavy CV. Frontend can keep running fully client-side today; when you need OpenCV/SLIC/Mojo you switch `frontend/js/main.js` to call these endpoints instead.

## Endpoints (see `app.py`)

- `GET /api/health`
- `POST /api/tear` — multipart `file` + `palette_k, piece_count, roughness, ana_size` → `{palette, pieces: [{b64,pixelCount,bounds,r,g,b}]}`. Mirrors `frontend/js/tear.js`.
- `POST /api/brightness-map` — multipart `target` + `mode, contrast, blur, seeds_json` → `{b64,w,h}`. Mirrors `frontend/js/analyzeTarget.js`.
- `POST /api/compose` — multipart `target` + `pieces_json, gridCols, lWeight, scale, rotation, allowReuse, showSeams, ignoreWhiteBg` → `{b64,w,h}`. Mirrors `frontend/js/composer.js`.

Contract is **image in = PNG b64 / multipart out** — no shared memory, no tight coupling. Swapping a Mojo kernel under `/api/tear` does not change the frontend.

## Run

```bash
pip install -r requirements.txt
uvicorn app:app --reload --port 8000  # backend on 8000
# serve frontend separately:
python3 -m http.server 5173 --directory ../frontend  # or Vite
```

Set `frontend/js/main.js` to use backend:

```js
const USE_BACKEND = true;
const BACKEND = "http://localhost:8000";
if(USE_BACKEND){
  const fd = new FormData();
  fd.append("file", sourceFile);
  fd.append("palette_k", paletteK);
  const res = await fetch(`${BACKEND}/api/tear`, {method:"POST", body: fd});
  const {palette, pieces} = await res.json(); // pieces[].b64 -> Image
} else {
  torn = await tearImage(sourceCanvas, opts); // local js/tear.js
}
```

## Where complexity moves

| Today (JS) | Later (Python/Mojo) | Why |
|---|---|---|
| `js/quantize.js` k-means LAB | `cv2.kmeans` LAB + `sklearn` | faster, better init |
| `js/tear.js` Voronoi + fbm | `skimage.segmentation.slic` + watershed + Mojo morphology | true superpixels, better torn fibers |
| `js/analyzeTarget.js` IDW | Poisson solve / distance transform (`cv2.distanceTransform`) + Mojo diffusion | smoother seeding for sparse targets |
| `js/composer.js` grid | `cv2` packing + graph-cut / Hungarian assignment + Mojo kernels | optimal placement, no gaps |

Keep the frontend Canvas preview path even after backend exists — instant feedback without round-trip.

## Docker

```bash
docker build -t collage-backend .
docker run -p 8000:8000 collage-backend
```
