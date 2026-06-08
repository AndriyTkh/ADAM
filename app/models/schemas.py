"""Pydantic response schemas — mirrors frontend/src/api/types.ts."""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel


# ── Pollutants ──────────────────────────────────────────────────────────────

class Pollutant(BaseModel):
    key: str
    label: str
    unit: str
    group: Literal["PM", "NOx", "SOx", "carbon", "composite"]
    scale: str          # ramp id consumed by shader / legend
    available: bool


# ── Sensors ─────────────────────────────────────────────────────────────────

class Sensor(BaseModel):
    id: str
    lat: float
    lng: float
    name: str
    tier: Literal["reference", "low-cost"]
    provider: str


class SensorReading(BaseModel):
    aqi: float | None = None
    pm25: float | None = None
    no2: float | None = None
    co: float | None = None
    datetime_last: str   # ISO of the actual measurement bucket


# ── Vehicles ─────────────────────────────────────────────────────────────────

class VehicleReadings(BaseModel):
    aqi: float | None = None
    pm25: float | None = None
    no2: float | None = None
    co: float | None = None


class Vehicle(BaseModel):
    id: str
    type: Literal["truck", "van", "car", "bus"]
    lat: float
    lng: float
    status: Literal["active", "idle", "parked"]
    readings: VehicleReadings
    # 40 road-snapped [lng, lat] sub-points for in-bucket animation (single-t only)
    subpoints: list[list[float]] | None = None


class VehiclePathVertex(BaseModel):
    lat: float
    lng: float
    t: str           # ISO bucket
    readings: VehicleReadings


# ── Point query ──────────────────────────────────────────────────────────────

class NearestSensor(BaseModel):
    id: str
    distance_m: float


class PointReading(BaseModel):
    aqi: float | None = None
    pm25: float | None = None
    no2: float | None = None
    co: float | None = None
    nearest_sensor: NearestSensor
    interpolated: bool = True


# ── Time range ───────────────────────────────────────────────────────────────

class TimeRange(BaseModel):
    from_: str
    to: str
    min_step_minutes: int = 10
    steps: list[int]
    buckets: list[str]

    model_config = {"populate_by_name": True}


# ── Alerts ───────────────────────────────────────────────────────────────────

class Alert(BaseModel):
    severity: Literal["low", "medium", "high"]
    message: str
    time: str
    zone: str | None = None
