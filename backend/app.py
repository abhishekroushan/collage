"""
Backend for Collage — Torn Paper
Python FastAPI service that can take over math-heavy ops from frontend/js.

Frontend (frontend/index.html + js/*.js) stays as static UI.
Heavy ops (quantize / SLIC / ragged edge / composition) move here when JS is insufficient.

Run:
  pip install -r requirements.txt
  uvicorn app:app --reload --port 8000
Frontend then calls /api/* instead of local js/tear.js etc.

Mojo path: keep this same HTTP contract and swap the kernels under
backend/mojo/* (see README). HTTP is the stable seam.
"""
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import cv2
import numpy as np
from PIL import Image
import io
import base64

app = FastAPI(title="Collage Backend", version="0.1.0")

# Allow frontend on different origin (localhost:8000 vs :5173, file:// via CORS proxy, etc.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def pil_from_bytes(b: bytes) -> Image.Image:
    return Image.open(io.BytesIO(b)).convert("RGB")

def b64_png(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

@app.get("/api/health")
def health():
    return {"ok": True}

# --- Tear: palette-constrained Voronoi + ragged edge (Python/OpenCV version) ---
@app.post("/api/tear")
async def tear(
    file: UploadFile = File(...),
    palette_k: int = Form(8),
    piece_count: int = Form(120),
    roughness: float = Form(0.55),
    ana_size: int = Form(280),
):
    """
    Replaces frontend/js/tear.js.
    Input: multipart image + params.
    Output: { palette: [{r,g,b}], pieces: [{id, colorIdx, r,g,b, avgLab, b64, bounds, pixelCount}] }
    Pieces are returned as PNG data URLs (cropped). Frontend renders them into tray
    and passes their LAB to /api/compose. This keeps frontend/backend decoupled —
    no binary mask streaming, no tight coupling to pixel coordinates.
    """
    raw = await file.read()
    pil = pil_from_bytes(raw)
    w, h = pil.size
    scale = min(1.0, ana_size / max(w, h))
    aw, ah = max(1, int(w*scale)), max(1, int(h*scale))
    small = pil.resize((aw, ah), Image.BILINEAR)
    arr = np.array(small)  # (ah,aw,3) uint8 RGB

    # --- quantize in LAB via OpenCV kmeans ---
    lab = cv2.cvtColor(arr, cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
    compact, labels, centers = cv2.kmeans(lab, K=palette_k, bestLabels=None, criteria=criteria, attempts=3, flags=cv2.KMEANS_PP_CENTERS)
    labels = labels.flatten()  # N
    centers_lab = centers.astype(np.uint8)
    # palette RGB for display: convert centers back to RGB
    centers_rgb = cv2.cvtColor(centers_lab[None, :, :], cv2.COLOR_LAB2RGB)[0]  # (k,3)
    palette = [{"r": int(c[0]), "g": int(c[1]), "b": int(c[2])} for c in centers_rgb]

    # --- per-color pixel indices ---
    counts = np.bincount(labels, minlength=palette_k)
    # allocate pieces proportionally (same logic as js/tear.js:22)
    total = int(piece_count)
    raw_alloc = np.maximum(1, np.round(counts / counts.sum() * total)).astype(int)
    # fix overshoot/undershoot to sum==total (simple)
    while raw_alloc.sum() > total:
        idx = int(np.argmin(raw_alloc.astype(float) / np.maximum(1, counts)))
        if raw_alloc[idx] > 1:
            raw_alloc[idx] -= 1
        else:
            break
    while raw_alloc.sum() < total:
        idx = int(np.argmax(counts.astype(float) / np.maximum(1, raw_alloc)))
        raw_alloc[idx] += 1

    pieces = []
    gid = 0
    # lab array for distance in piece mean (use original arr for avg RGB)
    flat_rgb = arr.reshape(-1, 3)
    ys, xs = np.divmod(np.arange(aw*ah), aw)

    for ci in range(palette_k):
        idxs = np.where(labels == ci)[0]
        if len(idxs) == 0:
            continue
        nPieces = int(raw_alloc[ci])
        # farthest-point sampling on (x,y) for spread seeds
        rng = np.random.default_rng(0)
        seeds = [int(rng.choice(idxs))]
        for _ in range(1, nPieces):
            # sample 32 candidates, pick farthest from existing seeds
            cands = rng.choice(idxs, size=min(32, len(idxs)), replace=False)
            best, best_d = int(cands[0]), -1
            for c in cands:
                cx, cy = int(c % aw), int(c // aw)
                dmin = min((cx - int(s % aw))**2 + (cy - int(s // aw))**2 for s in seeds)
                if dmin > best_d:
                    best_d, best = dmin, int(c)
            seeds.append(best)
        seed_xy = np.array([(s % aw, s // aw) for s in seeds], dtype=np.float32)

        # Voronoi assignment constrained to this color
        pts = np.stack([idxs % aw, idxs // aw], axis=1).astype(np.float32)  # (M,2)
        # brute force nearest seed (M up to ~20k, K up to ~60 -> fine)
        dists = np.linalg.norm(pts[:, None, :] - seed_xy[None, :, :], axis=2)  # (M,K)
        assign = np.argmin(dists, axis=1)

        for li in range(nPieces):
            pix = idxs[assign == li]
            if len(pix) == 0:
                continue
            pxs, pys = pix % aw, pix // aw
            x0, x1 = int(pxs.min()), int(pxs.max())
            y0, y1 = int(pys.min()), int(pys.max())
            bw, bh = x1 - x0 + 1, y1 - y0 + 1
            pad = 2
            # build piece PNG (ana scale)
            piece = Image.new("RGBA", (bw + 2*pad, bh + 2*pad), (0,0,0,0))
            # naive: paste pixels
            for p in pix:
                x, y = int(p % aw), int(p // aw)
                r, g, b = map(int, flat_rgb[p])
                piece.putpixel((x - x0 + pad, y - y0 + pad), (r, g, b, 255))
            # ragged edge: erode border where fbm-like noise > thresh
            if roughness > 0.01:
                # simple cheap noise via hash of (x,y) seeded by ci
                for p in pix:
                    x, y = int(p % aw), int(p // aw)
                    # border?
                    is_border = False
                    for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                        nx, ny = x+dx, y+dy
                        if not (0 <= nx < aw and 0 <= ny < ah):
                            is_border = True
                            break
                        if labels[ny*aw+nx] != ci or assign[np.where(idxs==p)[0][0]] != li:
                            # outer check simplified: just treat any neighbor outside pix as border
                            pass
                    # use deterministic pseudo-noise in [0,1)
                    h = (x*73856093 ^ y*19349663 ^ ci*83492791) % 1000 / 1000.0
                    if is_border and h > (0.35 + roughness*0.3):
                        piece.putpixel((x - x0 + pad, y - y0 + pad), (0,0,0,0))
            # average color for matching
            avg = flat_rgb[pix].mean(axis=0).astype(int)
            pieces.append({
                "id": gid,
                "colorIdx": ci,
                "r": int(avg[0]), "g": int(avg[1]), "b": int(avg[2]),
                "pixelCount": int(len(pix)),
                "bounds": {"x0": x0, "y0": y0, "x1": x1, "y1": y1, "w": bw, "h": bh, "pad": pad},
                "b64": b64_png(piece),
            })
            gid += 1

    # sort by luminance proxy (0.2126R + 0.7152G + 0.0722B)
    pieces.sort(key=lambda p: 0.2126*p["r"] + 0.7152*p["g"] + 0.0722*p["b"])
    return JSONResponse({"palette": palette, "pieces": pieces, "aw": aw, "ah": ah, "w": w, "h": h})

# --- Brightness map (replaces js/analyzeTarget.js) ---
@app.post("/api/brightness-map")
async def brightness_map(
    file: UploadFile = File(...),
    mode: str = Form("direct"),  # direct | seededAuto | seededUser
    contrast: int = Form(0),
    blur: int = Form(0),
    seeds_json: str = Form("[]"),  # JSON [{x,y,L}]
):
    import json
    raw = await file.read()
    pil = pil_from_bytes(raw)
    # optional contrast (PIL)
    # For brevity keep direct L via grayscale; seeded modes would interpolate here.
    # Frontend currently does seeded interpolation locally; backend can swap to Poisson/solve.
    w, h = pil.size
    g = pil.convert("L")
    arr = np.array(g, dtype=np.float32)
    if contrast != 0:
        f = (259*(contrast+255))/(255*(259-contr))
        # ... clamp
        pass
    # return as PNG preview + raw map would be large; frontend only needs PNG for debug and will use map server-side for compose
    # For now return b64 grayscale map; compose will recompute map server-side if needed.
    b64 = b64_png(Image.fromarray(arr.astype(np.uint8), mode="L").convert("RGB"))
    return {"w": w, "h": h, "b64": b64}

# --- Compose (replaces js/composer.js) ---
@app.post("/api/compose")
async def compose_endpoint(
    target: UploadFile = File(...),
    pieces_json: str = Form(...),  # JSON array from /api/tear
    gridCols: int = Form(0),
    lWeight: float = Form(0.85),
    scale: float = Form(1.0),
    rotation: int = Form(15),
    allowReuse: bool = Form(False),
    showSeams: bool = Form(True),
    ignoreWhiteBg: bool = Form(True),
    mode: str = Form("direct"),
):
    """
    Server-side compose: receives target image + pieces (as b64 from /api/tear
    or client-side pieces). Returns composed PNG b64.
    This is where Mojo kernels (torn edge, SLIC, packing) would plug in
    without changing the HTTP contract.
    """
    import json, math, random
    pieces = json.loads(pieces_json)
    t_raw = await target.read()
    t_pil = pil_from_bytes(t_raw).convert("RGB")
    tw, th = t_pil.size
    # reuse the JS logic: build grid, match by L, paste pieces (decoded from b64)
    # Simplified server version — frontend can keep using its Canvas impl until this is hardened.
    out = Image.new("RGB", (tw, th), (11,14,19))
    # ... actual paste logic mirrors js/composer.js; omitted for skeleton
    return {"b64": b64_png(out), "w": tw, "h": th}
