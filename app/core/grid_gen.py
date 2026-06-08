"""Grid generator — IDW reconstruction from vehicle probes (Vehicle Probe Model, layer 3).

The served grid is **not** the hidden field: for bucket [T, T+10min) we gather
that bucket's ~2000 vehicle probe points (see probes.py) and IDW them onto the
256² grid, blended toward a weak background prior in poorly-covered cells, then
Gaussian-blurred to tame moving-point streaks. This *is* the real pipeline —
swapping mock probes for real hardware probes changes nothing downstream.

Algorithm (locked):
  - probe points → cKDTree; per grid cell, IDW over k=12 nearest, power 1.5.
  - coverage = exp(-(d_nearest / COVER_SCALE)²); cell = cov·idw + (1-cov)·background.
    background = hidden true_field (weak prior so zero-coverage areas aren't blank).
  - Gaussian blur (σ≈1.2) post-pass.
  - Output Uint8 (value·255); header scaleMin/scaleMax come from field.scale_range.
"""
from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache

import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

from app.core.field import (  # noqa: F401  (scale_range re-exported for callers)
    BBOX_E,
    BBOX_N,
    BBOX_S,
    BBOX_W,
    scale_range,
    true_field_points,
)
from app.core.probes import bucket_probe_positions, probe_values

GRID_DIM = 256

_IDW_POWER = 1.5
_K = 12              # nearest probes per cell
_COVER_SCALE = 0.012  # deg (~1.3 km) — IDW trusted within this radius
_BLUR_SIGMA = 1.2
_EPS = 1e-9


@lru_cache(maxsize=8)
def _bucket_tree(epoch_bucket: int, grid_dim: int):
    """Per-bucket probe KDTree + grid coords + background, reused across pollutants."""
    dt = datetime.fromtimestamp(epoch_bucket * 600, tz=timezone.utc)
    plat, plng = bucket_probe_positions(dt)
    tree = cKDTree(np.column_stack([plat, plng]))

    lats = np.linspace(BBOX_N, BBOX_S, grid_dim)   # row 0 = north
    lngs = np.linspace(BBOX_W, BBOX_E, grid_dim)
    lng_grid, lat_grid = np.meshgrid(lngs, lats)   # (H, W)
    cells = np.column_stack([lat_grid.ravel(), lng_grid.ravel()])

    k = min(_K, len(plat))
    dist, idx = tree.query(cells, k=k)
    if k == 1:
        dist = dist[:, None]
        idx = idx[:, None]
    return dt, plat, plng, dist, idx, lat_grid, lng_grid


def generate_grid(pollutant: str, dt: datetime, grid_dim: int = GRID_DIM) -> bytes:
    """Return Uint8 bytes (grid_dim²) reconstructed from this bucket's probes."""
    epoch_bucket = int(dt.timestamp()) // 600
    bdt, plat, plng, dist, idx, lat_grid, lng_grid = _bucket_tree(epoch_bucket, grid_dim)

    values = probe_values(plat, plng, pollutant, bdt)   # 0..1 per probe

    # IDW over k nearest probes, power 1.5
    w = 1.0 / (dist ** _IDW_POWER + _EPS)
    idw = np.sum(w * values[idx], axis=1) / np.sum(w, axis=1)

    # blend toward weak background where coverage is thin
    d_near = dist[:, 0]
    cover = np.exp(-(d_near / _COVER_SCALE) ** 2)
    background = true_field_points(lat_grid.ravel(), lng_grid.ravel(), pollutant, bdt)
    field = cover * idw + (1.0 - cover) * background

    field = field.reshape(grid_dim, grid_dim)
    field = gaussian_filter(field, sigma=_BLUR_SIGMA, mode="nearest")

    uint8 = np.clip(field * 255.0, 0, 255).astype(np.uint8)
    return uint8.tobytes()
