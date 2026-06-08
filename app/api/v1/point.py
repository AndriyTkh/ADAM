"""BE-9: GET /v1/point — interpolated all-pollutant reading + nearestSensor."""
from __future__ import annotations

import math
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from app.core.buckets import from_iso, snap
from app.core.field import to_physical, true_field
from app.models.schemas import NearestSensor, PointReading
from app.api.v1.sensors import _SENSORS

router = APIRouter()

_POLLUTANTS = ["aqi", "pm25", "no2", "co"]


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6_371_000.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _physical(raw01: float, pollutant: str) -> float:
    return round(to_physical(raw01, pollutant), 2)


@router.get("/point", response_model=PointReading)
def get_point(
    lat: float = Query(...),
    lng: float = Query(...),
    t: str = Query("live"),
) -> PointReading:
    dt = from_iso(t) if t != "live" else snap(datetime.now(timezone.utc))

    readings: dict[str, float] = {}
    for p in _POLLUTANTS:
        raw = true_field(lat, lng, p, dt)
        readings[p] = _physical(raw, p)

    # nearest sensor by haversine
    nearest = min(_SENSORS, key=lambda s: _haversine_m(lat, lng, s.lat, s.lng))
    dist = _haversine_m(lat, lng, nearest.lat, nearest.lng)

    return PointReading(
        aqi=readings["aqi"],
        pm25=readings["pm25"],
        no2=readings["no2"],
        co=readings["co"],
        nearest_sensor=NearestSensor(id=nearest.id, distance_m=round(dist, 1)),
    )
