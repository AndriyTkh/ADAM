"""10-min bucket helpers."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta


ALLOWED_STEPS = [10, 30, 60, 360, 1440]  # minutes


def snap(dt: datetime) -> datetime:
    """Snap to 10-min boundary (floor), UTC."""
    dt = dt.astimezone(timezone.utc).replace(second=0, microsecond=0)
    return dt - timedelta(minutes=dt.minute % 10)


def from_iso(iso: str) -> datetime:
    if iso == "live":
        return snap(datetime.now(timezone.utc))
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(timezone.utc)


def to_iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:00Z")


def buckets_in_range(
    from_dt: datetime, to_dt: datetime, stride_minutes: int
) -> list[datetime]:
    """All bucket datetimes in [from_dt, to_dt] spaced stride_minutes apart."""
    result = []
    cur = snap(from_dt)
    end = snap(to_dt)
    step = timedelta(minutes=stride_minutes)
    while cur <= end:
        result.append(cur)
        cur += step
    return result


def min_step_for_range(range_minutes: int) -> int:
    """Return min allowed step per the clamp table (STRUCTURE)."""
    if range_minutes <= 14 * 1440:
        frames_at_10m = range_minutes // 10
        if frames_at_10m <= 1500:
            return 10
        # find smallest allowed step keeping frames ≤ 1500
        for s in ALLOWED_STEPS:
            if range_minutes // s <= 1500:
                return s
    return ALLOWED_STEPS[-1]


def validate_step(from_dt: datetime, to_dt: datetime, step: int) -> None:
    """Raise ValueError if step is below min for this range (422 upstream)."""
    range_minutes = int((to_dt - from_dt).total_seconds() // 60)
    min_step = min_step_for_range(range_minutes)
    if step < min_step:
        raise ValueError(
            f"step {step}m below minimum {min_step}m for {range_minutes}m range"
        )
    if step not in ALLOWED_STEPS:
        raise ValueError(f"step {step} not in {ALLOWED_STEPS}")
