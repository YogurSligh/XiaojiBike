from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import get_settings
from app.schemas.common import HealthResponse


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"


def create_app() -> FastAPI:
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    application = FastAPI(title=settings.app_name)
    application.include_router(api_router)

    @application.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok")

    _mount_frontend(application)
    return application


def _mount_frontend(application: FastAPI) -> None:
    index_path = FRONTEND_DIST / "index.html"
    assets_path = FRONTEND_DIST / "assets"
    if not index_path.exists():
        return

    if assets_path.exists():
        application.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @application.get("/", include_in_schema=False)
    def frontend_index() -> FileResponse:
        return FileResponse(index_path)

    @application.get("/{full_path:path}", include_in_schema=False)
    def frontend_fallback(full_path: str) -> FileResponse:
        if full_path.startswith("api/") or full_path == "health":
            return FileResponse(index_path, status_code=404)
        return FileResponse(index_path)


app = create_app()
