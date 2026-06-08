"""Hidden 'true field' — the reality vehicle sensors sample (Vehicle Probe Model).

This is layer 1 of the probe model (STRUCTURE → "Vehicle Probe Model &
Grid-from-Probes"). It is **never served raw**: the served grid is an IDW
reconstruction from vehicle probes (see grid_gen.py), and vehicle/point readings
are this field + sensor noise. Repurposes the old fixed hotspots as the
underlying pollution field `true_field(lat, lng, dt)`.

  true_field = IDW(hotspots) × traffic_factor + slow drift     (0..1, per pollutant)

Physical scale ranges live here too (header scaleMin/scaleMax come from these).
"""
from __future__ import annotations

import math
from datetime import datetime

import numpy as np

# ── Kyiv bbox (matches config default) ─────────────────────────────────────
BBOX_W, BBOX_S, BBOX_E, BBOX_N = 30.24, 50.21, 30.82, 50.59

# ── Hotspot definitions (the hidden field's sources) ────────────────────────
# (lat, lng, {pollutant: base_strength_0..1})
_HOTSPOTS: list[tuple[float, float, dict[str, float]]] = [
    # Darnytsia industrial east
    (50.42, 30.65, {"aqi": 0.8, "pm25": 0.9, "no2": 0.6, "co": 0.5}),
    # Boryspil highway SE traffic
    (50.35, 30.62, {"aqi": 0.6, "pm25": 0.5, "no2": 0.8, "co": 0.9}),
    # City centre traffic
    (50.45, 30.52, {"aqi": 0.55, "pm25": 0.4, "no2": 0.75, "co": 0.7}),
    # Industrial north-west (Kurenivka)
    (50.52, 30.47, {"aqi": 0.7, "pm25": 0.75, "no2": 0.5, "co": 0.4}),
    # Obolon residential (low background)
    (50.50, 30.50, {"aqi": 0.25, "pm25": 0.2, "no2": 0.3, "co": 0.25}),
]

# Physical scale ranges per pollutant (units in STRUCTURE/schemas)
SCALE_RANGES: dict[str, tuple[float, float]] = {
    "aqi":  (0.0, 100.0),    # EAQI 0–100
    "pm25": (0.0, 75.0),     # µg/m³
    "no2":  (0.0, 200.0),    # µg/m³
    "co":   (0.0, 10.0),     # mg/m³
}

POLLUTANTS = ["aqi", "pm25", "no2", "co"]

_P = 2.0       # IDW power for the field
_EPS = 1e-6


def traffic_factor(dt: datetime) -> float:
    """0.6..1.0 — peaks at 08:00 and 18:00 Kyiv local (UTC+3)."""
    hour = (dt.hour + 3) % 24 + dt.minute / 60.0
    morning = math.exp(-0.5 * ((hour - 8.0) / 1.2) ** 2)
    evening = math.exp(-0.5 * ((hour - 18.0) / 1.2) ** 2)
    return 0.6 + 0.4 * max(morning, evening)


def drift_offset(dt: datetime, hotspot_idx: int) -> float:
    """Slow spatial intensity drift, period ~4h, unique per hotspot."""
    epoch = dt.timestamp()
    phase = hotspot_idx * 2.1
    return 0.08 * math.sin(epoch / 14400.0 + phase)


def true_field(lat: float, lng: float, pollutant: str, dt: datetime) -> float:
    """Hidden field value (0..1) at a single point — what a sensor would read."""
    tf = traffic_factor(dt)
    weights_sum = 0.0
    values_sum = 0.0
    for idx, (hlat, hlng, strengths) in enumerate(_HOTSPOTS):
        base = strengths.get(pollutant, 0.0)
        strength = max(0.0, min(1.0, base * tf + drift_offset(dt, idx)))
        d2 = (lat - hlat) ** 2 + (lng - hlng) ** 2
        w = 1.0 / (d2 + _EPS) ** (_P / 2.0)
        weights_sum += w
        values_sum += w * strength
    return values_sum / (weights_sum + _EPS)


def true_field_points(
    lats: np.ndarray, lngs: np.ndarray, pollutant: str, dt: datetime
) -> np.ndarray:
    """Vectorised true_field over arrays of points (0..1). lats/lngs same shape."""
    tf = traffic_factor(dt)
    weights_sum = np.zeros_like(lats, dtype=np.float64)
    values_sum = np.zeros_like(lats, dtype=np.float64)
    for idx, (hlat, hlng, strengths) in enumerate(_HOTSPOTS):
        base = strengths.get(pollutant, 0.0)
        strength = max(0.0, min(1.0, base * tf + drift_offset(dt, idx)))
        d2 = (lats - hlat) ** 2 + (lngs - hlng) ** 2
        w = 1.0 / (d2 + _EPS) ** (_P / 2.0)
        weights_sum += w
        values_sum += w * strength
    return values_sum / (weights_sum + _EPS)


def scale_range(pollutant: str) -> tuple[float, float]:
    return SCALE_RANGES.get(pollutant, (0.0, 1.0))


def to_physical(raw01: float, pollutant: str) -> float:
    smin, smax = scale_range(pollutant)
    return smin + raw01 * (smax - smin)
