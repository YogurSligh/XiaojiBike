from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_name: str = "选基宝"
    app_data_dir: Path = Path.home() / "Xuanjibao" / "data"
    candidate_codes_path: Path = PROJECT_ROOT / "data" / "fund_candidates.json"

    model_config = SettingsConfigDict(env_prefix="XUANJIBAO_", env_file=".env", extra="ignore")

    @property
    def data_dir(self) -> Path:
        return self.app_data_dir

    @property
    def fund_cache_path(self) -> Path:
        return self.data_dir / "fund_data_cache.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
