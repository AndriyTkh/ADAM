"""ADAM backend — FastAPI app entrypoint.

Backend owns all compute (interpolation, stats, ML, mocks). Frontend is a
pure render/query client talking to the versioned /v1 API. See PLAN.md.
"""
from pathlib import Path

import logging
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.api.v1 import router as v1_router

app = FastAPI(title="ADAM API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_client_logger = logging.getLogger("adam.client")
if not _client_logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
    _client_logger.addHandler(_h)
    _client_logger.setLevel(logging.DEBUG)
    _client_logger.propagate = False


@app.post("/client-log")
async def client_log(request: Request) -> dict[str, str]:
    body = await request.json()
    ts = datetime.now(timezone.utc).isoformat()
    level = body.get("level", "ERROR").upper()
    message = body.get("message", "")
    source = body.get("source", "")
    lineno = body.get("lineno", "")
    _client_logger.error("[BROWSER %s] %s  @ %s:%s  (%s)", level, message, source, lineno, ts)
    return {"ok": "1"}

app.include_router(v1_router, prefix="/v1")

# Serve pre-generated .bin files directly (BE-12).
# Mount after /v1 so API routes take priority.
_data_dir = Path(__file__).parent / "data"
_data_dir.mkdir(exist_ok=True)
app.mount("/data", StaticFiles(directory=str(_data_dir)), name="data")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
