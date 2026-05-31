"""v1 API router. Sub-routers added per task (BE-1..BE-12)."""
from fastapi import APIRouter

router = APIRouter()


@router.get("/ping")
def ping() -> dict[str, str]:
    """Placeholder until BE-1+ land. Confirms v1 mount works."""
    return {"v1": "ok"}
