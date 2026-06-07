from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_name: str = Field(
        default="小基比可",
        validation_alias=AliasChoices("XIAOJIBIKE_APP_NAME", "XUANJIBAO_APP_NAME"),
    )
    app_data_dir: Path = Field(
        default=Path.home() / "XiaojiBike" / "data",
        validation_alias=AliasChoices("XIAOJIBIKE_APP_DATA_DIR", "XUANJIBAO_APP_DATA_DIR"),
    )
    candidate_codes_path: Path = Field(
        default=PROJECT_ROOT / "data" / "fund_candidates.json",
        validation_alias=AliasChoices(
            "XIAOJIBIKE_CANDIDATE_CODES_PATH",
            "XUANJIBAO_CANDIDATE_CODES_PATH",
        ),
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
    )

    @property
    def data_dir(self) -> Path:
        return self.app_data_dir

    @property
    def fund_cache_path(self) -> Path:
        return self.data_dir / "fund_data_cache.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
