"""ADAM backend — FastAPI app entrypoint.

Backend owns all compute (interpolation, stats, ML, mocks). Frontend is a
pure render/query client talking to the versioned /v1 API. See PLAN.md.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api.v1 import router as v1_router

app = FastAPI(title="ADAM API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(v1_router, prefix="/v1")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
