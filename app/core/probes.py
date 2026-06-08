"""Vehicle probe stream (Vehicle Probe Model, layer 2 — the hardware feed).

For a 10-min bucket: gather every vehicle's 40 road-snapped sub-points
(50 × 40 ≈ 2000 probe points) and sample the hidden true_field at each, plus
deterministic sensor noise. Readings spike naturally where a car drives through
a high-emission zone — not by a vehicle-type constant.

This is the raw feed grid_gen.py reconstructs the served grid from.
"""
from __future__ import annotations

from datetime import datetime

import numpy as np

from app.core.field import true_field_points
from app.core.fleet import FLEET

_NOISE_SD = 0.03   # sensor noise on the 0..1 field


def bucket_probe_positions(dt: datetime) -> tuple[np.ndarray, np.ndarray]:
    """All probe (lats, lngs) for the bucket — pollutant-independent positions."""
    from app.core.routes import subpoints  # local import avoids cycle

    lats: list[float] = []
    lngs: list[float] = []
    for v in FLEET:
        for lat, lng in subpoints(v.id, dt):
            lats.append(lat)
            lngs.append(lng)
    return np.asarray(lats), np.asarray(lngs)


def _noise(dt: datetime, pollutant: str, n: int) -> np.ndarray:
    seed = (int(dt.timestamp()) // 600) ^ (hash(pollutant) & 0xFFFFFFFF)
    rng = np.random.default_rng(seed)
    return rng.normal(0.0, _NOISE_SD, n)


def probe_values(
    lats: np.ndarray, lngs: np.ndarray, pollutant: str, dt: datetime
) -> np.ndarray:
    """Measured 0..1 values at probe points = true_field + sensor noise (clamped)."""
    field = true_field_points(lats, lngs, pollutant, dt)
    noisy = field + _noise(dt, pollutant, len(lats))
    return np.clip(noisy, 0.0, 1.0)


def bucket_probes(
    pollutant: str, dt: datetime
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(lats, lngs, values01) for all probes in the bucket — grid_gen input."""
    lats, lngs = bucket_probe_positions(dt)
    return lats, lngs, probe_values(lats, lngs, pollutant, dt)
