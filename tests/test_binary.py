"""Header codec parity + round-trip (SETUP-3 / QA-2).

Asserts encode/decode round-trips AND that the committed golden .bin (shared
with the frontend suite) still matches byte-for-byte — catches wire drift.
"""
from pathlib import Path

import pytest

from app.core.binary import (
    HEADER_SIZE,
    GridHeader,
    decode_header,
    encode_grid,
    encode_header,
    encode_range_meta,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _header() -> GridHeader:
    return GridHeader(4, 4, (30.24, 50.21, 30.82, 50.59), 0.0, 500.0)


def test_header_size_locked():
    assert HEADER_SIZE == 34


def test_header_round_trip():
    h = _header()
    got = decode_header(encode_header(h))
    assert got.dims_w == 4 and got.dims_h == 4
    assert got.ver == 1
    assert got.scale_max == 500.0
    assert got.bbox[0] == pytest.approx(30.24)


def test_bad_magic_rejected():
    with pytest.raises(ValueError, match="bad magic"):
        decode_header(b"\x00\x00\x00\x00" + bytes(HEADER_SIZE - 4))


def test_grid_golden_matches():
    blob = encode_grid(_header(), bytes(range(16)))
    assert blob == (FIXTURES / "grid_golden.bin").read_bytes()


def test_range_meta_golden_matches():
    meta = encode_range_meta(
        _header(), ["2026-05-31T12:00", "2026-05-31T12:10"], [0, 1]
    )
    assert meta == (FIXTURES / "range_meta_golden.bin").read_bytes()
