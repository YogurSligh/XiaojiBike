from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


FundFetchStatus = Literal["success", "partial", "failed"]
FundFetchProfile = Literal["summary", "detail"]


class FundReturnCurvePoint(BaseModel):
    date: str
    return_pct: float


class FundPortfolioHolding(BaseModel):
    rank: int | None = None
    code: str | None = None
    name: str
    value_pct: float | None = None
    shares: str | None = None
    market_value: str | None = None
    report_period: str | None = None


class FundCandidateData(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    fetch_profile: FundFetchProfile = "detail"
    name: str | None = None
    full_name: str | None = None
    fund_type: str | None = None
    share_class: str | None = None
    fund_company: str | None = None
    fund_manager_company: str | None = None
    custodian: str | None = None
    fund_managers: list[str] | None = None
    tracking_index: str | None = None
    benchmark: str | None = None
    purchase_status: str | None = None
    redeem_status: str | None = None
    regular_investment_status: str | None = None
    trade_status_raw: str | None = None
    daily_purchase_limit_raw: str | None = None
    daily_purchase_limit_cny: float | None = None
    purchase_start_amount_cny: float | None = None
    regular_investment_start_amount_cny: float | None = None
    buy_confirm_day: str | None = None
    sell_confirm_day: str | None = None
    management_fee_pct: float | None = None
    custody_fee_pct: float | None = None
    sales_service_fee_pct: float | None = None
    total_annual_fee_pct: float | None = None
    max_subscription_fee_pct: float | None = None
    subscription_fee_raw: str | None = None
    redemption_fee_raw: str | None = None
    asset_size_raw: str | None = None
    asset_size_yi: float | None = None
    asset_size_date: str | None = None
    share_size_raw: str | None = None
    share_size_yi: float | None = None
    share_size_date: str | None = None
    inception_date: str | None = None
    years_since_inception: float | None = None
    return_1y_pct: float | None = None
    return_3y_pct: float | None = None
    return_5y_pct: float | None = None
    return_10y_pct: float | None = None
    return_since_inception_pct: float | None = None
    max_drawdown_3y_pct: float | None = None
    max_drawdown_5y_pct: float | None = None
    max_drawdown_10y_pct: float | None = None
    return_curve_preview: list[FundReturnCurvePoint] = Field(default_factory=list)
    top_holdings: list[FundPortfolioHolding] = Field(default_factory=list)
    data_sources: list[str] = Field(default_factory=list)
    source_urls: list[str] = Field(default_factory=list)
    field_sources: dict[str, str] = Field(default_factory=dict)
    updated_at: datetime
    fetch_status: FundFetchStatus
    fetch_error: str | None = None
    stale: bool = False


class FundFeeData(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    subscription_fee_raw: str | None = None
    redemption_fee_raw: str | None = None
    field_sources: dict[str, str] = Field(default_factory=dict)
    data_sources: list[str] = Field(default_factory=list)
    source_urls: list[str] = Field(default_factory=list)
    updated_at: datetime
    fetch_status: FundFetchStatus
    fetch_error: str | None = None
    stale: bool = False


class FundSearchResult(BaseModel):
    items: list[FundCandidateData]
    provider_attempts: list[str] = Field(default_factory=list)


class FundCodeSearchResult(BaseModel):
    codes: list[str]
    total_count: int = 0
    next_offset: int = 0
    has_more: bool = False
    provider_attempts: list[str] = Field(default_factory=list)


class FundRefreshPayload(BaseModel):
    codes: list[str] = Field(default_factory=list, max_length=100)
    query: str | None = Field(default=None, max_length=80)
    limit: int = Field(default=20, ge=1, le=100)
    force_refresh: bool = False
