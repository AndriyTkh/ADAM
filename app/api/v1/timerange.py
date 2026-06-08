"""BE-6: GET /v1/timerange — axis bounds, steps, available buckets."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

from fastapi import APIRouter

from app.core.buckets import ALLOWED_STEPS, buckets_in_range, snap, to_iso
from app.models.schemas import TimeRange

router = APIRouter()

# Demo span: 3 days back from now (open item 3 — picking 3d as default).
_DEMO_DAYS = 3


@router.get("/timerange", response_model=TimeRange)
def get_timerange() -> TimeRange:
    now = snap(datetime.now(timezone.utc))
    from_dt = now - timedelta(days=_DEMO_DAYS)
    bucket_list = buckets_in_range(from_dt, now, stride_minutes=10)
    return TimeRange(
        from_=to_iso(from_dt),
        to=to_iso(now),
        min_step_minutes=10,
        steps=ALLOWED_STEPS,
        buckets=[to_iso(b) for b in bucket_list],
    )
