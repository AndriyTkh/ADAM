"""BE-1: GET /v1/pollutants — catalog driving FE tabs and shader scales."""
from fastapi import APIRouter
from app.models.schemas import Pollutant

router = APIRouter()

_CATALOG: list[Pollutant] = [
    Pollutant(
        key="aqi",
        label="AQI",
        unit="EAQI",
        group="composite",
        scale="eaqi",
        available=True,
    ),
    Pollutant(
        key="pm25",
        label="PM2.5",
        unit="µg/m³",
        group="PM",
        scale="pm25",
        available=True,
    ),
    Pollutant(
        key="no2",
        label="NO₂",
        unit="µg/m³",
        group="NOx",
        scale="no2",
        available=True,
    ),
    Pollutant(
        key="co",
        label="CO",
        unit="mg/m³",
        group="carbon",
        scale="co",
        available=True,
    ),
]


@router.get("/pollutants", response_model=list[Pollutant])
def get_pollutants() -> list[Pollutant]:
    return _CATALOG
