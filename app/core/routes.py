"""Runtime road-geometry access (Vehicle Probe Model, layer 2).

Loads the committed routes.json (built offline by scripts.gen_routes via OSRM):
per vehicle a single full-day **path** — a polyline resampled to equal distance
spacing. At runtime we map the time-of-day to a fraction along that path using a
traffic-aware speed profile, so each vehicle traverses its whole loop once over
the active day (06:00–24:00 Kyiv) and crawls during the morning/evening peaks.

  position(t) = path[ progress(t) ]          progress: time → [0,1] along path
  progress(t) = ∫speed / ∫speed_full_day     speed dips at 08:00 & 18:00 peaks

Continuous: consecutive 10-min buckets sit far apart along a ~250–400 km loop,
so vehicle readings (sampled at the moving position) shift between every step.

Per-vehicle night freeze: each vehicle has its own active window, deterministic
from its id — it starts moving between 04:00–07:00 Kyiv and parks for the night
between 21:00–24:00. Outside that window it's parked at its depot (= path start),
position frozen but probes still emitted. ALL vehicles are parked 00:00–04:00.

If routes.json is missing, falls back to a straight-line path built from the
vehicle's waypoints so the app runs before route generation.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

from app.core.fleet import FLEET_MAP

_ROUTES_PATH = Path(__file__).parent.parent / "static_data" / "routes.json"
SUBPOINTS_PER_LEG = 40         # subpoints served per 10-min bucket (animation)
_BUCKET_SECONDS = 600

# ── Per-vehicle active window (Kyiv local, UTC+3) ────────────────────────────
# Each vehicle starts moving in [MOVE_START_MIN, MOVE_START_MIN+MOVE_SPAN] and
# parks for the night in [PARK_START_MIN, PARK_END_MIN]. Exact minute is hashed
# from the vehicle id (stable). The mandatory overlap 00:00–04:00 is guaranteed:
# move-start ≥ 04:00 and park-start ≥ 21:00 (< 24:00 ⇒ parked again by 00:00).
_MOVE_START_MIN = 240          # 04:00 — earliest a vehicle leaves depot
_MOVE_SPAN_MIN = 180           # … up to 07:00
_PARK_START_MIN = 1260         # 21:00 — earliest a vehicle parks for the night
_PARK_SPAN_MIN = 180           # … up to 24:00
_PEAK_DEPTH = 0.55             # peak-hour speed = (1 - depth) of free-flow
_PEAK_SIGMA = 1.2              # hours
_PEAKS = (8.0, 18.0)           # morning / evening rush centres (Kyiv local)


def _local_minutes(dt: datetime) -> float:
    """Minutes since Kyiv-local midnight (UTC+3), in [0, 1440)."""
    return ((dt.hour + 3) % 24) * 60 + dt.minute + dt.second / 60.0


@lru_cache(maxsize=len(FLEET_MAP))
def _window(vid: str) -> tuple[int, int]:
    """(move_start, park_start) Kyiv-local minutes, deterministic per vehicle."""
    h = int(hashlib.md5(vid.encode()).hexdigest(), 16)
    move_start = _MOVE_START_MIN + (h % (_MOVE_SPAN_MIN + 1))
    park_start = _PARK_START_MIN + ((h >> 16) % (_PARK_SPAN_MIN + 1))
    return move_start, park_start


def is_parked(vid: str, dt: datetime) -> bool:
    """True when this vehicle is parked at its depot (outside its active window)."""
    m = _local_minutes(dt)
    move_start, park_start = _window(vid)
    return m < move_start or m >= park_start


def _speed_weight(minute: float) -> float:
    """Relative driving speed at a Kyiv-local minute — dips at rush peaks."""
    h = minute / 60.0
    rush = max(math.exp(-0.5 * ((h - c) / _PEAK_SIGMA) ** 2) for c in _PEAKS)
    return 1.0 - _PEAK_DEPTH * rush


@lru_cache(maxsize=None)
def _progress_table(move_start: int, park_start: int) -> list[float]:
    """Cumulative normalised progress per active-window minute."""
    table = [0.0]
    acc = 0.0
    for m in range(move_start, park_start):
        acc += _speed_weight(m + 0.5)
        table.append(acc)
    total = table[-1] or 1.0
    return [v / total for v in table]


def progress(vid: str, dt: datetime) -> float | None:
    """Fraction [0,1] along the day's path, or None when parked (night)."""
    m = _local_minutes(dt)
    move_start, park_start = _window(vid)
    if m < move_start or m >= park_start:
        return None
    table = _progress_table(move_start, park_start)
    i = m - move_start
    lo = int(i)
    frac = i - lo
    a = table[lo]
    b = table[min(lo + 1, len(table) - 1)]
    return a + (b - a) * frac


# ── Path access ──────────────────────────────────────────────────────────────

_ROUTE_VERSION = 2


@lru_cache(maxsize=1)
def _routes() -> dict | None:
    if not _ROUTES_PATH.exists():
        return None
    data = json.loads(_ROUTES_PATH.read_text(encoding="utf-8"))
    if data.get("version") != _ROUTE_VERSION:
        return None   # stale (pre-redesign) file → straight-line fallback
    return data


def has_routes() -> bool:
    return _routes() is not None


@lru_cache(maxsize=len(FLEET_MAP))
def _path(vid: str) -> list[list[float]]:
    """Equal-distance [lng,lat] polyline for a vehicle's full-day loop."""
    r = _routes()
    if r is not None:
        veh = r["vehicles"].get(vid)
        if veh is not None:
            return veh["path"]
    return _straight_path(vid)


def _straight_path(vid: str, n: int = 600) -> list[list[float]]:
    """Fallback: straight segments between waypoints, resampled by distance."""
    wp = FLEET_MAP[vid].waypoints                      # (lat, lng)
    pts = [[p[1], p[0]] for p in wp]                   # [lng, lat]
    seg = [0.0]
    for i in range(len(pts) - 1):
        d = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        seg.append(seg[-1] + d)
    total = seg[-1] or 1.0
    out: list[list[float]] = []
    j = 0
    for k in range(n):
        target = (k / (n - 1)) * total
        while j < len(seg) - 2 and seg[j + 1] < target:
            j += 1
        t0, t1 = seg[j], seg[j + 1]
        f = 0.0 if t1 <= t0 else (target - t0) / (t1 - t0)
        out.append([
            pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f,
            pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f,
        ])
    return out


def _interp(path: list[list[float]], p: float) -> tuple[float, float]:
    """(lat, lng) at fraction p∈[0,1] along an equal-distance [lng,lat] path."""
    n = len(path)
    x = max(0.0, min(1.0, p)) * (n - 1)
    i = int(x)
    if i >= n - 1:
        lng, lat = path[-1]
        return lat, lng
    f = x - i
    lng = path[i][0] + (path[i + 1][0] - path[i][0]) * f
    lat = path[i][1] + (path[i + 1][1] - path[i][1]) * f
    return lat, lng


def vehicle_pos(vid: str, dt: datetime) -> tuple[float, float]:
    """Deterministic (lat, lng) at dt — interpolated along the day's path."""
    p = progress(vid, dt)
    if p is None:
        return FLEET_MAP[vid].depot
    return _interp(_path(vid), p)


def subpoints(vid: str, dt: datetime) -> list[tuple[float, float]]:
    """40 (lat, lng) points covering the bucket [dt, dt+10min) along the path.

    Spans progress(dt)→progress(dt+10min): a short slice during rush peaks
    (vehicle crawls), longer off-peak. Night → all points = depot (parked).
    """
    p0 = progress(vid, dt)
    if p0 is None:
        return [FLEET_MAP[vid].depot] * SUBPOINTS_PER_LEG
    p1 = progress(vid, dt + timedelta(seconds=_BUCKET_SECONDS))
    if p1 is None or p1 < p0:
        p1 = 1.0
    path = _path(vid)
    return [
        _interp(path, p0 + (p1 - p0) * (j / SUBPOINTS_PER_LEG))
        for j in range(SUBPOINTS_PER_LEG)
    ]
