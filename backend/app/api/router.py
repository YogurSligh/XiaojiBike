from fastapi import APIRouter

from app.api.funds import router as funds_router


api_router = APIRouter(prefix="/api")
api_router.include_router(funds_router)
