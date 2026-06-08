"""Generate committed road geometry for the fleet (Vehicle Probe Model).

Each vehicle's full-day waypoint loop (fleet.py) is routed through OSRM in ONE
multi-waypoint request, then the returned polyline is resampled by **distance**
into a fixed-length path (PATH_POINTS points, equal spacing). routes.py maps
time-of-day → fraction along this path with a traffic-aware speed profile, so no
live OSRM call happens at runtime.

OSRM source: public demo server by default (rate-limited; one request per
vehicle, ~50 total). Override with --osrm http://localhost:5000 for a self-hosted
osrm-backend (OSM/ODbL — store/render freely, see STRUCTURE).

Usage:
    python -m scripts.gen_routes                 # public demo server
    python -m scripts.gen_routes --osrm http://localhost:5000
    python -m scripts.gen_routes --force         # rebuild even if file exists
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.fleet import FLEET  # noqa: E402

OUT_PATH = Path(__file__).parent.parent / "app" / "static_data" / "routes.json"
PATH_POINTS = 600               # equal-distance points per full-day loop
DEFAULT_OSRM = "https://router.project-osrm.org"
ROUTE_VERSION = 2


def _haversine_km(a: list[float], b: list[float]) -> float:
    """a, b = [lng, lat]."""
    r = 6371.0
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp = math.radians(b[1] - a[1])
    dl = math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _osrm_route(client: httpx.Client, base: str, wp) -> list[list[float]]:
    """Route all waypoints (lat,lng) in one request → full [[lng,lat],...] polyline."""
    coords = ";".join(f"{lng:.6f},{lat:.6f}" for lat, lng in wp)
    url = f"{base}/route/v1/driving/{coords}"
    resp = client.get(url, params={"overview": "full", "geometries": "geojson"})
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != "Ok" or not data.get("routes"):
        return _straight_polyline(wp)
    return data["routes"][0]["geometry"]["coordinates"]   # [[lng,lat],...]


def _straight_polyline(wp) -> list[list[float]]:
    """Fallback polyline: the waypoints themselves as [lng,lat]."""
    return [[lng, lat] for lat, lng in wp]


def _resample_by_distance(coords: list[list[float]], n: int) -> tuple[list[list[float]], float]:
    """Resample a [lng,lat] polyline to n points evenly spaced by distance.

    Returns (path, total_km).
    """
    if len(coords) < 2:
        p = [round(coords[0][0], 6), round(coords[0][1], 6)] if coords else [0.0, 0.0]
        return [p[:] for _ in range(n)], 0.0
    cum = [0.0]
    for i in range(len(coords) - 1):
        cum.append(cum[-1] + _haversine_km(coords[i], coords[i + 1]))
    total = cum[-1] or 1.0
    out: list[list[float]] = []
    seg = 0
    for k in range(n):
        target = (k / (n - 1)) * total
        while seg < len(cum) - 2 and cum[seg + 1] < target:
            seg += 1
        t0, t1 = cum[seg], cum[seg + 1]
        f = 0.0 if t1 <= t0 else (target - t0) / (t1 - t0)
        lng = coords[seg][0] + (coords[seg + 1][0] - coords[seg][0]) * f
        lat = coords[seg][1] + (coords[seg + 1][1] - coords[seg][1]) * f
        out.append([round(lng, 6), round(lat, 6)])
    return out, cum[-1]


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate fleet road geometry via OSRM")
    ap.add_argument("--osrm", default=DEFAULT_OSRM, help="OSRM base URL")
    ap.add_argument("--force", action="store_true", help="rebuild even if routes.json exists")
    ap.add_argument("--delay", type=float, default=0.3, help="seconds between OSRM calls (rate limit)")
    args = ap.parse_args()

    if OUT_PATH.exists() and not args.force:
        print(f"{OUT_PATH} exists — pass --force to rebuild.")
        return

    vehicles: dict[str, dict] = {}
    t0 = time.perf_counter()

    with httpx.Client(timeout=60) as client:
        for vi, v in enumerate(FLEET):
            coords = _osrm_route(client, args.osrm, v.waypoints)
            path, total_km = _resample_by_distance(coords, PATH_POINTS)
            vehicles[v.id] = {
                "type": v.type,
                "total_km": round(total_km, 1),
                "path": path,
            }
            print(f"  [{vi + 1}/{len(FLEET)}] {v.id} ({v.type})"
                  f"  {len(v.waypoints)} wp -> {total_km:.0f} km road")
            time.sleep(args.delay)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps({
        "version": ROUTE_VERSION,
        "path_points": PATH_POINTS,
        "vehicles": vehicles,
    }), encoding="utf-8")
    elapsed = time.perf_counter() - t0
    km = [vehicles[v.id]["total_km"] for v in FLEET]
    print(f"Wrote {OUT_PATH}  ({len(FLEET)} OSRM calls, {elapsed:.0f}s, "
          f"km {min(km):.0f}–{max(km):.0f} avg {sum(km)/len(km):.0f})")


if __name__ == "__main__":
    main()
