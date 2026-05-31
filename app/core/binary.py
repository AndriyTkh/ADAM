"""Binary header codec — single source of the wire format (SETUP-3).

Little-endian. Mirrored byte-for-byte by frontend/src/api/binaryHeader.ts.
Golden .bin fixtures (tests/fixtures) are asserted by BOTH py and ts suites
to catch cross-worktree drift. Spec locked in STRUCTURE -> "Binary header spec".

Single-grid header (34 bytes), then payload:
    magic   u32   0x4D414441  ('A','D','A','M' little-endian)
    ver     u16   = VER
    dims_w  u16
    dims_h  u16
    bbox    f32x4 west, south, east, north
    scaleMin f32
    scaleMax f32

Range blob header = single-grid header (with dims = frame dims) then:
    bucketCount u32
    tIndex[]    bucketCount x (isoLen u16 + utf8 bytes)   # actual present buckets
    frameType[] bucketCount x u8                          # 0=keyframe, 1=delta
then concatenated frame payloads.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass

MAGIC = 0x4D414441
VER = 1

_HEADER = struct.Struct("<IHHH4fff")  # magic,ver,w,h,bbox4,min,max
HEADER_SIZE = _HEADER.size  # 34


@dataclass
class GridHeader:
    dims_w: int
    dims_h: int
    bbox: tuple[float, float, float, float]
    scale_min: float
    scale_max: float
    ver: int = VER


def encode_header(h: GridHeader) -> bytes:
    return _HEADER.pack(
        MAGIC, h.ver, h.dims_w, h.dims_h,
        h.bbox[0], h.bbox[1], h.bbox[2], h.bbox[3],
        h.scale_min, h.scale_max,
    )


def decode_header(buf: bytes) -> GridHeader:
    magic, ver, w, hgt, bw, bs, be, bn, smin, smax = _HEADER.unpack_from(buf, 0)
    if magic != MAGIC:
        raise ValueError(f"bad magic 0x{magic:08X}")
    if ver != VER:
        raise ValueError(f"unsupported ver {ver}")
    return GridHeader(w, hgt, (bw, bs, be, bn), smin, smax, ver)


def encode_grid(h: GridHeader, payload: bytes) -> bytes:
    """Single-bucket .bin: header + Uint8 grid payload (BE-3)."""
    if len(payload) != h.dims_w * h.dims_h:
        raise ValueError("payload size != dims_w*dims_h")
    return encode_header(h) + payload


def encode_range_meta(
    h: GridHeader, t_index: list[str], frame_types: list[int]
) -> bytes:
    """Range-blob meta block (BE-4): header + bucketCount + tIndex[] + frameType[].

    Frame payloads are concatenated by the caller after this block.
    """
    if len(t_index) != len(frame_types):
        raise ValueError("t_index / frame_types length mismatch")
    out = bytearray(encode_header(h))
    out += struct.pack("<I", len(t_index))
    for iso in t_index:
        b = iso.encode("utf-8")
        out += struct.pack("<H", len(b)) + b
    out += bytes(frame_types)
    return bytes(out)
