"""Disk cache for pre-generated grid .bin files (BE-12)."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data" / "grid"


def _grid_path(pollutant: str, dt: datetime) -> Path:
    # ISO with colons swapped (Windows-safe filenames): 20240115T0830Z
    stamp = dt.strftime("%Y%m%dT%H%MZ")
    return DATA_DIR / pollutant / f"{stamp}.bin"


def grid_cached(pollutant: str, dt: datetime) -> bytes | None:
    p = _grid_path(pollutant, dt)
    if p.exists():
        return p.read_bytes()
    return None


def grid_write(pollutant: str, dt: datetime, data: bytes) -> None:
    p = _grid_path(pollutant, dt)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
