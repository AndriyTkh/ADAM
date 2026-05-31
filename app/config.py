"""App settings (env-driven). See PLAN SETUP-2 for dev wiring."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="ADAM_")

    # CORS origins allowed to hit the API (Vite dev server + prod FE).
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # OpenAQ (BE-7) — key hidden server-side, never shipped to FE.
    openaq_api_key: str = ""

    # Pre-generated demo bucket span (BE-12). ISO bounds, filled later.
    demo_from: str = ""
    demo_to: str = ""

    # Kyiv heatmap bounds [west, south, east, north] (mercator quad).
    kyiv_bbox: tuple[float, float, float, float] = (30.24, 50.21, 30.82, 50.59)
    grid_dim: int = 256


settings = Settings()
