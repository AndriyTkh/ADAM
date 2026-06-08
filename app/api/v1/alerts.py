"""BE-10: GET /v1/alerts — threshold-based mock alerts (WS demoted/optional)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Query

from app.core.buckets import from_iso, snap, to_iso
from app.models.schemas import Alert

router = APIRouter()

# Mock alert zones keyed to high-emission hotspots
_ALERT_ZONES = [
    {"lat": 50.42, "lng": 30.65, "name": "Darnytsia Industrial",    "threshold": 0.75},
    {"lat": 50.35, "lng": 30.62, "name": "Boryspil Hwy Corridor", "threshold": 0.70},
]


@router.get("/alerts", response_model=list[Alert])
def get_alerts(t: str = Query("live")) -> list[Alert]:
    from app.core.field import traffic_factor
    dt = from_iso(t) if t != "live" else snap(datetime.now(timezone.utc))
    tf = traffic_factor(dt)

    alerts = []
    for zone in _ALERT_ZONES:
        intensity = tf * zone["threshold"]
        if intensity > 0.65:
            severity = "high" if intensity > 0.80 else "medium"
            alerts.append(Alert(
                severity=severity,
                message=f"Elevated AQI near {zone['name']}",
                time=to_iso(dt),
                zone=zone["name"],
            ))
    return alerts
