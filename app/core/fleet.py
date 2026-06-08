"""Fleet definitions — 50 mock vehicles on full-day Kyiv loops (Vehicle Probe Model).

Redesign (2026-05-31): each vehicle drives **one long closed loop per day**
(~250–400 km) instead of a short repeating named-stop loop. Two movement styles:

  - random  (taxi-like: car/van/truck) — chained random waypoints from a scattered
    ~100-point pool, then closed back to start. Trucks/vans get shorter daily km
    (more dwell-like averaging) than cars.
  - shuttle  (bus)                      — two far endpoints crossed back-and-forth
    over the day, coursing through the city.

Deterministic: a fixed seed builds the pool + every itinerary. `gen_routes.py`
routes each vehicle's waypoints through OSRM in ONE multi-waypoint request and
resamples the full polyline by distance into a fixed-length path (routes.json v2).
`routes.py` maps time-of-day → progress along that path with a traffic-aware speed
profile, so the loop is traversed once per active day (06:00–24:00 Kyiv).

Per vehicle:
  - waypoints: closed loop of (lat, lng) — first == last conceptually (start = depot)
  - depot:     waypoints[0] — night-freeze parking spot (00:00–06:00 Kyiv)
  - target_km: intended road distance for the day (drives loop length per type)
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass

# ── Kyiv city-core bbox for the scattered waypoint pool ──────────────────────
# Inset from the full grid bbox so points land in the built-up city (OSRM snaps
# each to the nearest road).
_POOL_W, _POOL_S, _POOL_E, _POOL_N = 30.36, 50.33, 30.72, 50.56
POOL_SIZE = 100

FLEET_SIZE = 50

# Type bands: (type, count, movement_style, target_road_km).
# Cars = the many fast random movers; vans/trucks fewer + shorter daily km;
# buses cross the city on fixed shuttle routes.
_TYPE_BANDS: list[tuple[str, int, str, float]] = [
    ("car",   18, "random",  400.0),
    ("van",   16, "random",  320.0),
    ("truck",  8, "random",  260.0),
    ("bus",    8, "shuttle", 360.0),
]

# Straight-line waypoint sum under-shoots road distance (roads detour ~1.35×).
_ROAD_DETOUR = 1.35
_BUS_FAR_KM = 16.0   # min straight separation for a bus's two endpoints


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1 = a
    lat2, lng2 = b
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _build_pool(rng: random.Random) -> list[tuple[float, float]]:
    """~100 scattered (lat, lng) points across the Kyiv city core."""
    return [
        (round(rng.uniform(_POOL_S, _POOL_N), 5),
         round(rng.uniform(_POOL_W, _POOL_E), 5))
        for _ in range(POOL_SIZE)
    ]


def _random_loop(
    rng: random.Random, pool: list[tuple[float, float]], target_straight: float
) -> list[tuple[float, float]]:
    """Chain random pool points until ~target km, then close back to start."""
    wp = [rng.choice(pool)]
    cum = 0.0
    while cum < target_straight:
        nxt = rng.choice(pool)
        if nxt == wp[-1]:
            continue
        cum += _haversine_km(wp[-1], nxt)
        wp.append(nxt)
    wp.append(wp[0])   # close loop → depot = start = end
    return wp


def _shuttle_loop(
    rng: random.Random, pool: list[tuple[float, float]], target_straight: float
) -> list[tuple[float, float]]:
    """Two far endpoints crossed back-and-forth until ~target km, closed at start."""
    a = rng.choice(pool)
    far = [p for p in pool if _haversine_km(a, p) >= _BUS_FAR_KM]
    b = rng.choice(far) if far else max(pool, key=lambda p: _haversine_km(a, p))
    leg = _haversine_km(a, b)
    wp = [a]
    cum = 0.0
    nxt, after = b, a
    while cum < target_straight:
        wp.append(nxt)
        cum += leg
        nxt, after = after, nxt
    if wp[-1] != a:
        wp.append(a)   # close back to depot
    return wp


@dataclass(frozen=True)
class VehicleDef:
    id: str
    type: str
    waypoints: tuple[tuple[float, float], ...]   # closed loop; [0] == start
    target_km: float

    @property
    def depot(self) -> tuple[float, float]:
        return self.waypoints[0]


def _build_fleet() -> list[VehicleDef]:
    rng = random.Random(0xADA_2026)   # fixed seed → stable pool + itineraries
    pool = _build_pool(rng)
    defs: list[VehicleDef] = []
    i = 0
    for vtype, count, style, target_km in _TYPE_BANDS:
        target_straight = target_km / _ROAD_DETOUR
        for _ in range(count):
            i += 1
            wp = (
                _shuttle_loop(rng, pool, target_straight) if style == "shuttle"
                else _random_loop(rng, pool, target_straight)
            )
            defs.append(VehicleDef(
                id=f"v{i}",
                type=vtype,
                waypoints=tuple(wp),
                target_km=target_km,
            ))
    return defs


FLEET: list[VehicleDef] = _build_fleet()
FLEET_MAP: dict[str, VehicleDef] = {v.id: v for v in FLEET}
