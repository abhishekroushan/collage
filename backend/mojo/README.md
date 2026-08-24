# Mojo kernels (future)

Mojo is for the hot inner loops that Python+OpenCV still bottlenecks on:

- `tear.mojo` — SLIC superpixels + fbm ragged edge morphology (replaces `tear.js` / `app.py:/api/tear` inner loop)
- `compose.mojo` — packing / distance-transform seeding (`analyzeTarget.js` / `app.py:/api/brightness-map`)
- `match.mojo` — LAB distance + assignment (replaces `composer.js` matching)

Contract: HTTP stays the same (`POST /api/tear` etc. in `app.py`). Python calls Mojo via `python interop` or as a subprocess/extension:

```
# app.py
# from mojo_kernels import tear_kernel  # Mojo compiled as Python extension
# pieces = tear_kernel(arr, palette_k, piece_count, roughness)
```

Build (when Mojo toolchain installed):
```bash
mojo build mojo/tear.mojo -o mojo/tear.so
```

Keep the API shape JSON+multipart so swapping the kernel is transparent to `frontend/js/main.js`.
