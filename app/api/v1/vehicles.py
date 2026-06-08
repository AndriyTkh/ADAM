"""BE-8: Mock vehicles — ~50 units on OSRM road loops (Vehicle Probe Model).

Positions come from committed road geometry (routes.py); readings are sampled
from the hidden true_field at the vehicle's position (field.py) — they spike
where the car drives through a high-emission zone, not by a vehicle-type
constant. Single-bucket response carries the 40 road-snapped sub-points so the
frontend can animate the marker along the road within the bucket.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from app.core.buckets import buckets_in_range, from_iso, snap, to_iso
from app.core.field import to_physical, true_field
from app.core.fleet import FLEET, FLEET_MAP
from app.core.routes import is_parked, subpoints, vehicle_pos
from app.models.schemas import Vehicle, VehiclePathVertex, VehicleReadings

router = APIRouter()

_PROBE_SECONDS = 15


def _readings_at(lat: float, lng: float, dt: datetime) -> VehicleReadings:
    """Sensor readings = hidden field at this position, in physical units."""
    return VehicleReadings(
        aqi=round(to_physical(true_field(lat, lng, "aqi", dt), "aqi"), 1),
        pm25=round(to_physical(true_field(lat, lng, "pm25", dt), "pm25"), 1),
        no2=round(to_physical(true_field(lat, lng, "no2", dt), "no2"), 1),
        co=round(to_physical(true_field(lat, lng, "co", dt), "co"), 2),
    )


def _status(vid: str, dt: datetime) -> str:
    if is_parked(vid, dt):
        return "parked"
    h = (dt.hour + 3) % 24
    return "idle" if h in (12, 13) else "active"


def _vehicle_at(vid: str, vtype: str, dt: datetime, with_subpoints: bool) -> Vehicle:
    lat, lng = vehicle_pos(vid, dt)
    sp = [[lng, lat] for lat, lng in subpoints(vid, dt)] if with_subpoints else None
    return Vehicle(
        id=vid, type=vtype, lat=lat, lng=lng,
        status=_status(vid, dt),
        readings=_readings_at(lat, lng, dt),
        subpoints=sp,
    )


@router.get("/vehicles")
def get_vehicles(
    t: str | None = Query(None),
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
) -> list:
    if from_ is not None and to is not None:
        from_dt = from_iso(from_)
        to_dt = from_iso(to)
        buckets = buckets_in_range(from_dt, to_dt, 10)
        result = []
        for dt in buckets:
            # range/playback frames: positions only (no sub-points → small payload)
            bucket_vehicles = [
                _vehicle_at(v.id, v.type, dt, with_subpoints=False).model_dump()
                for v in FLEET
            ]
            result.append({"t": to_iso(dt), "vehicles": bucket_vehicles})
        return result

    dt = from_iso(t) if t else snap(datetime.now(timezone.utc))
    # single bucket: include sub-points for in-bucket road animation
    return [_vehicle_at(v.id, v.type, dt, with_subpoints=True) for v in FLEET]


@router.get("/vehicles/{vid}/path")
def get_vehicle_path(
    vid: str,
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
) -> list[VehiclePathVertex]:
    if vid not in FLEET_MAP:
        raise HTTPException(404, f"vehicle {vid!r} not found")

    from_dt = from_iso(from_)
    to_dt = from_iso(to)
    buckets = buckets_in_range(from_dt, to_dt, 10)

    out: list[VehiclePathVertex] = []
    for dt in buckets:
        if is_parked(vid, dt):
            # parked → single depot vertex (avoid 40 duplicate points)
            lat, lng = vehicle_pos(vid, dt)
            out.append(VehiclePathVertex(
                lat=lat, lng=lng, t=to_iso(dt), readings=_readings_at(lat, lng, dt),
            ))
            continue
        # road-snapped sub-points: each its own 15 s timestamp + field reading
        for j, (lat, lng) in enumerate(subpoints(vid, dt)):
            sub_ts = datetime.fromtimestamp(
                dt.timestamp() + j * _PROBE_SECONDS, tz=timezone.utc
            )
            out.append(VehiclePathVertex(
                lat=lat, lng=lng,
                t=sub_ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                readings=_readings_at(lat, lng, sub_ts),
            ))
    return out
