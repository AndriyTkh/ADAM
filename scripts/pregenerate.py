"""BE-12: Pre-generate 3-day demo grid .bin files.

Usage:
    python -m scripts.pregenerate           # 3-day rolling window ending now
    python -m scripts.pregenerate --days 1  # shorter span (testing)
    python -m scripts.pregenerate --from 2024-01-01T00:00:00Z --to 2024-01-04T00:00:00Z

Writes to app/data/grid/{pollutant}/{stamp}.bin (header + Uint8 payload).
Skips files that already exist unless --force is passed.
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# allow running as: python -m scripts.pregenerate from repo root
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.binary import GridHeader, encode_grid
from app.core.buckets import buckets_in_range, snap, to_iso
from app.core.data_cache import DATA_DIR, grid_cached, grid_write
from app.core.grid_gen import generate_grid, scale_range
from app.config import settings

POLLUTANTS = ["aqi", "pm25", "no2", "co"]


def _make_header(pollutant: str) -> GridHeader:
    smin, smax = scale_range(pollutant)
    return GridHeader(
        dims_w=settings.grid_dim,
        dims_h=settings.grid_dim,
        bbox=settings.kyiv_bbox,
        scale_min=smin,
        scale_max=smax,
    )


def pregenerate(
    from_dt: datetime,
    to_dt: datetime,
    force: bool = False,
) -> None:
    buckets = buckets_in_range(from_dt, to_dt, 10)
    total = len(buckets) * len(POLLUTANTS)
    print(
        f"Generating {len(buckets)} buckets × {len(POLLUTANTS)} pollutants"
        f" = {total} files"
    )
    print(f"  from: {to_iso(from_dt)}")
    print(f"    to: {to_iso(to_dt)}")
    print(f"   dir: {DATA_DIR}")

    done = skipped = 0
    t0 = time.perf_counter()

    for pollutant in POLLUTANTS:
        hdr = _make_header(pollutant)
        for dt in buckets:
            if not force and grid_cached(pollutant, dt) is not None:
                skipped += 1
                continue
            payload = generate_grid(pollutant, dt, settings.grid_dim)
            body = encode_grid(hdr, payload)
            grid_write(pollutant, dt, body)
            done += 1

            if (done + skipped) % 100 == 0:
                elapsed = time.perf_counter() - t0
                rate = done / elapsed if elapsed > 0 else 0
                remaining = (total - done - skipped) / rate if rate > 0 else 0
                print(
                    f"  {done + skipped}/{total}"
                    f"  ({done} written, {skipped} skipped)"
                    f"  {rate:.1f} files/s  ETA {remaining:.0f}s"
                )

    elapsed = time.perf_counter() - t0
    print(
        f"Done. {done} written, {skipped} skipped in {elapsed:.1f}s"
        f" ({done / elapsed:.1f} files/s)"
    )


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Pre-generate ADAM demo grid files")
    p.add_argument("--days", type=int, default=3, help="rolling window size (default 3)")
    p.add_argument("--from", dest="from_", metavar="ISO", help="explicit start (overrides --days)")
    p.add_argument("--to", metavar="ISO", help="explicit end (default: now)")
    p.add_argument("--force", action="store_true", help="overwrite existing files")
    return p.parse_args()


def main() -> None:
    args = _parse_args()

    now = snap(datetime.now(timezone.utc))
    to_dt = datetime.fromisoformat(args.to.replace("Z", "+00:00")) if args.to else now
    if args.from_:
        from_dt = datetime.fromisoformat(args.from_.replace("Z", "+00:00"))
    else:
        from_dt = to_dt - timedelta(days=args.days)

    from_dt = snap(from_dt)
    to_dt = snap(to_dt)

    pregenerate(from_dt, to_dt, force=args.force)


if __name__ == "__main__":
    main()
