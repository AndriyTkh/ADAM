"""BE-3/4/5/11: Grid endpoints.

BE-3  GET /v1/grid/{pollutant}/{t}.bin        single-bucket binary
BE-4  GET /v1/grid/{pollutant}/range          delta+brotli range blob
BE-5  step→stride clamp + 422 on min-step violation
BE-11 GET /v1/heatmap/{pollutant}/{t}.png     bounds-PNG fallback (built, unwired)
"""
from __future__ import annotations

import io
from datetime import datetime

import brotli
import numpy as np
from fastapi import APIRouter, HTTPException, Query, Response

from app.config import settings
from app.core.binary import GridHeader, encode_grid, encode_range_meta
from app.core.buckets import (
    ALLOWED_STEPS,
    buckets_in_range,
    from_iso,
    to_iso,
    validate_step,
)
from app.core.data_cache import grid_cached
from app.core.grid_gen import generate_grid, scale_range

router = APIRouter()

KEYFRAME_INTERVAL = 60

_VALID_POLLUTANTS = {"aqi", "pm25", "no2", "co"}


def _check_pollutant(p: str) -> None:
    if p not in _VALID_POLLUTANTS:
        raise HTTPException(422, f"unknown pollutant '{p}'")


def _make_header(pollutant: str) -> GridHeader:
    smin, smax = scale_range(pollutant)
    return GridHeader(
        dims_w=settings.grid_dim,
        dims_h=settings.grid_dim,
        bbox=settings.kyiv_bbox,
        scale_min=smin,
        scale_max=smax,
    )


# ── BE-3: single bucket ──────────────────────────────────────────────────────

def _get_grid_payload(pollutant: str, dt: datetime) -> bytes:
    """Return raw Uint8 grid bytes, from disk cache if available."""
    cached = grid_cached(pollutant, dt)
    if cached is not None:
        # cached file is full .bin (header+payload); strip 34-byte header
        from app.core.binary import HEADER_SIZE
        return cached[HEADER_SIZE:]
    return generate_grid(pollutant, dt, settings.grid_dim)


@router.get("/grid/{pollutant}/{t}.bin")
def get_grid_bucket(pollutant: str, t: str) -> Response:
    _check_pollutant(pollutant)
    dt = from_iso(t)
    is_live = (t == "live")

    if not is_live:
        cached = grid_cached(pollutant, dt)
        if cached is not None:
            return Response(
                content=cached,
                media_type="application/octet-stream",
                headers={"Cache-Control": "public, max-age=31536000, immutable"},
            )

    payload = generate_grid(pollutant, dt, settings.grid_dim)
    body = encode_grid(_make_header(pollutant), payload)

    cache = "no-cache" if is_live else "public, max-age=31536000, immutable"
    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={"Cache-Control": cache},
    )


# ── BE-4 + BE-5: range blob ──────────────────────────────────────────────────

@router.get("/grid/{pollutant}/range")
def get_grid_range(
    pollutant: str,
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    step: int = Query(10, description="stride minutes"),
) -> Response:
    _check_pollutant(pollutant)

    # BE-5: clamp enforcement
    if step not in ALLOWED_STEPS:
        raise HTTPException(422, f"step {step} not in {ALLOWED_STEPS}")

    from_dt = from_iso(from_)
    to_dt   = from_iso(to)
    if to_dt <= from_dt:
        raise HTTPException(422, "to must be after from")

    try:
        validate_step(from_dt, to_dt, step)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e

    bucket_dts = buckets_in_range(from_dt, to_dt, step)
    if not bucket_dts:
        raise HTTPException(204, "no buckets in range")

    t_index: list[str] = []
    frame_types: list[int] = []
    frame_payloads: list[bytes] = []
    prev_grid: bytes | None = None
    frames_since_keyframe = 0

    for i, dt in enumerate(bucket_dts):
        grid = _get_grid_payload(pollutant, dt)
        is_keyframe = (
            i == 0
            or prev_grid is None
            or frames_since_keyframe >= KEYFRAME_INTERVAL
        )
        if is_keyframe:
            frame_payloads.append(grid)
            frame_types.append(0)
            frames_since_keyframe = 0
        else:
            delta = bytes(b ^ p for b, p in zip(grid, prev_grid))  # type: ignore[arg-type]
            frame_payloads.append(delta)
            frame_types.append(1)
            frames_since_keyframe += 1

        t_index.append(to_iso(dt))
        prev_grid = grid

    meta = encode_range_meta(_make_header(pollutant), t_index, frame_types)
    raw = meta + b"".join(frame_payloads)
    compressed = brotli.compress(raw, quality=6)

    return Response(
        content=compressed,
        media_type="application/octet-stream",
        headers={
            "Content-Encoding": "br",
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Frame-Count": str(len(t_index)),
        },
    )


# ── BE-11: bounds-PNG fallback (built, unwired in frontend) ─────────────────

@router.get("/heatmap/{pollutant}/{t}.png")
def get_heatmap_png(pollutant: str, t: str) -> Response:
    """Fallback PNG: same grid rendered as RGBA image (insurance path)."""
    _check_pollutant(pollutant)
    try:
        from PIL import Image  # type: ignore[import]
    except ImportError:
        raise HTTPException(501, "Pillow not installed; PNG fallback unavailable")

    dt = from_iso(t)
    grid_bytes = generate_grid(pollutant, dt, settings.grid_dim)
    arr = np.frombuffer(grid_bytes, dtype=np.uint8).reshape(
        settings.grid_dim, settings.grid_dim
    )
    # Simple hot colormap: value 0→transparent, 255→opaque red
    rgba = np.zeros((settings.grid_dim, settings.grid_dim, 4), dtype=np.uint8)
    rgba[..., 0] = arr                      # R
    rgba[..., 3] = (arr // 2).astype(np.uint8)  # A (semi-transparent)

    img = Image.fromarray(rgba, "RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    is_live = (t == "live")
    cache = "no-cache" if is_live else "public, max-age=31536000, immutable"
    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={"Cache-Control": cache},
    )
