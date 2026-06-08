"""v1 API router — mounts all sub-routers (BE-1 through BE-12)."""
from fastapi import APIRouter

from app.api.v1.pollutants import router as pollutants_router
from app.api.v1.grid       import router as grid_router
from app.api.v1.timerange  import router as timerange_router
from app.api.v1.sensors    import router as sensors_router
from app.api.v1.vehicles   import router as vehicles_router
from app.api.v1.point      import router as point_router
from app.api.v1.alerts     import router as alerts_router

router = APIRouter()

router.include_router(pollutants_router)
router.include_router(grid_router)
router.include_router(timerange_router)
router.include_router(sensors_router)
router.include_router(vehicles_router)
router.include_router(point_router)
router.include_router(alerts_router)
