from __future__ import annotations

import json
import logging
import os
import queue
import re
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, as_completed, wait
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from io import StringIO
from pathlib import Path
from collections.abc import Iterator
from typing import Any, Callable

import pandas as pd
import requests

from app.core.config import get_settings
from app.schemas.funds import FundCandidateData, FundFeeData, FundFetchProfile, FundSearchResult
from app.services.fund_parsers import (
    clean_text,
    extract_date_in_parentheses,
    flatten_key_value_table,
    parse_asset_size_yi,
    parse_cny_amount,
    parse_daily_limit,
    parse_fee_pct,
    parse_inception_date_and_share,
    parse_share_class,
    parse_share_size_yi,
    parse_years_since,
)


EASTMONEY_F10_BASE = "https://fundf10.eastmoney.com"
AKSHARE_PURCHASE_TTL = timedelta(days=1)
FUND_DETAIL_TTL = timedelta(days=1)
FUND_DATA_CACHE_SCHEMA_VERSION = 4
REQUEST_SLEEP_SECONDS = 0.25
DEFAULT_CANDIDATE_CODES = ["006327", "006328", "040046", "040047", "270042"]
AKSHARE_CALL_LOCK = threading.RLock()
FUND_CACHE_FILE_LOCK = threading.RLock()
logger = logging.getLogger("uvicorn.error")
DETAIL_FETCH_STEPS = {
    "fee_confirm",
    "subscription_fee_raw",
    "redemption_fee_raw",
    "portfolio_holdings",
    "web_fallback",
}


class FundDataSourceError(RuntimeError):
    pass


def default_cache_data() -> dict[str, Any]:
    return {
        "cache_schema_version": FUND_DATA_CACHE_SCHEMA_VERSION,
        "funds": {},
        "purchase_rows": [],
        "purchase_updated_at": None,
    }


def is_fund_cache_entry_current(cached: Any) -> bool:
    return (
        isinstance(cached, dict)
        and cached.get("cache_schema_version") == FUND_DATA_CACHE_SCHEMA_VERSION
    )


def fund_cache_satisfies_profile(cached: dict[str, Any], fetch_profile: FundFetchProfile) -> bool:
    cached_profile = cached.get("fetch_profile") or "detail"
    if fetch_profile == "summary":
        return cached_profile in {"summary", "detail"} and fund_cache_has_summary_data(cached)
    return cached_profile == "detail"


def fund_cache_has_summary_data(cached: dict[str, Any]) -> bool:
    return any(
        clean_text(cached.get(key))
        for key in (
            "name",
            "full_name",
            "fund_type",
            "fund_company",
            "asset_size_raw",
            "purchase_status",
            "redeem_status",
        )
    )


def fund_fetch_worker_count(item_count: int) -> int:
    if item_count <= 1:
        return 1
    cpu_count = os.cpu_count() or 2
    return max(1, min(item_count, max(2, cpu_count * 2), 12))


def record_fetch_progress(
    message: str,
    *,
    attempts: list[str] | None = None,
    progress_callback: Callable[[str], None] | None = None,
) -> None:
    if attempts is not None:
        attempts.append(message)
    if progress_callback is not None:
        progress_callback(message)
    logger.info("基金详情抓取：%s", message)


@dataclass
class FundDataCache:
    path: Path

    def read(self) -> dict[str, Any]:
        with FUND_CACHE_FILE_LOCK:
            if not self.path.exists():
                return default_cache_data()
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                return default_cache_data()
        if not isinstance(data, dict):
            return default_cache_data()
        data.setdefault("cache_schema_version", 0)
        data.setdefault("funds", {})
        data.setdefault("purchase_rows", [])
        data.setdefault("purchase_updated_at", None)
        return data

    def write(self, data: dict[str, Any]) -> None:
        with FUND_CACHE_FILE_LOCK:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            data["cache_schema_version"] = FUND_DATA_CACHE_SCHEMA_VERSION
            payload = json.dumps(data, ensure_ascii=False, indent=2)
            tmp_path = self.path.with_name(f".{self.path.name}.{threading.get_ident()}.tmp")
            tmp_path.write_text(payload, encoding="utf-8")
            tmp_path.replace(self.path)


class FundDataService:
    def __init__(self, cache_path: Path | None = None) -> None:
        settings = get_settings()
        self.cache = FundDataCache(cache_path or settings.data_dir / "fund_data_cache.json")
        self._cache_lock = threading.RLock()
        self._thread_local = threading.local()
        self._session_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
            )
        }
        self.session = requests.Session()
        self.session.headers.update(self._session_headers)
        self._fee_tables_cache: dict[str, dict[str, pd.DataFrame]] = {}
        self._fee_tables_lock = threading.RLock()

    def get_fund_data_list(
        self,
        *,
        codes: list[str] | None = None,
        query: str | None = None,
        limit: int = 20,
        force_refresh: bool = False,
        fetch_profile: FundFetchProfile = "summary",
    ) -> FundSearchResult:
        attempts: list[str] = []
        unique_codes = self.resolve_fund_codes(
            codes=codes,
            query=query,
            limit=limit,
            attempts=attempts,
        )
        workers = fund_fetch_worker_count(len(unique_codes))
        if workers > 1:
            attempts.append(f"并行抓取基金详情：{workers} 个线程")
        items = self.fetch_all_fund_data(
            unique_codes,
            force_refresh=force_refresh,
            attempts=attempts,
            max_workers=workers,
            fetch_profile=fetch_profile,
        )
        return FundSearchResult(items=items, provider_attempts=attempts)

    def resolve_fund_codes(
        self,
        *,
        codes: list[str] | None = None,
        query: str | None = None,
        limit: int | None = 20,
        attempts: list[str] | None = None,
    ) -> list[str]:
        normalized_codes = [normalize_fund_code(code) for code in (codes or []) if code.strip()]
        if query:
            matched_codes = self.search_codes(query, limit=limit, attempts=attempts)
            normalized_codes.extend(matched_codes)
        if not normalized_codes:
            normalized_codes = self._candidate_codes(limit or 20)
            if attempts is not None:
                attempts.append(f"使用默认候选基金 {len(normalized_codes)} 只")
        unique_codes = list(dict.fromkeys(normalized_codes))
        return unique_codes[:limit] if limit is not None else unique_codes

    def fetch_all_fund_data(
        self,
        codes: list[str],
        *,
        force_refresh: bool = False,
        attempts: list[str] | None = None,
        max_workers: int | None = None,
        fetch_profile: FundFetchProfile = "summary",
    ) -> list[FundCandidateData]:
        if not codes:
            return []
        workers = max_workers or fund_fetch_worker_count(len(codes))
        if workers <= 1:
            return [
                self.fetch_fund_data(
                    code,
                    force_refresh=force_refresh,
                    attempts=attempts,
                    fetch_profile=fetch_profile,
                )
                for code in codes
            ]

        results: list[FundCandidateData | None] = [None] * len(codes)
        attempts_by_index: list[list[str]] = [[] for _ in codes]
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="fund-fetch") as executor:
            future_to_index = {
                executor.submit(
                    self.fetch_fund_data,
                    code,
                    force_refresh=force_refresh,
                    attempts=attempts_by_index[index],
                    fetch_profile=fetch_profile,
                ): index
                for index, code in enumerate(codes)
            }
            for future in as_completed(future_to_index):
                index = future_to_index[future]
                results[index] = future.result()
        if attempts is not None:
            for item_attempts in attempts_by_index:
                attempts.extend(item_attempts)
        return [result for result in results if result is not None]

    def stream_fund_data(
        self,
        codes: list[str],
        *,
        force_refresh: bool = False,
        max_workers: int | None = None,
        heartbeat_seconds: float = 3,
        cancel_requested: Callable[[], bool] | None = None,
        fetch_profile: FundFetchProfile = "summary",
    ) -> Iterator[dict[str, Any]]:
        if not codes:
            return
        stream_cancelled = threading.Event()

        def is_cancelled() -> bool:
            return stream_cancelled.is_set() or (
                cancel_requested is not None and cancel_requested()
            )

        workers = max_workers or fund_fetch_worker_count(len(codes))
        if workers > 1:
            yield {"event": "attempt", "message": f"并行抓取基金详情：{workers} 个线程"}
        if workers <= 1:
            for index, code in enumerate(codes):
                if is_cancelled():
                    return
                item_attempts: list[str] = []
                item = self.fetch_fund_data(
                    code,
                    force_refresh=force_refresh,
                    attempts=item_attempts,
                    cancel_requested=is_cancelled,
                    fetch_profile=fetch_profile,
                )
                for attempt in item_attempts:
                    yield {"event": "attempt", "message": attempt}
                yield {"event": "item", "index": index, "item": item}
            return

        attempts_by_index: list[list[str]] = [[] for _ in codes]
        executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="fund-fetch")
        future_to_index = {}
        progress_queue: queue.Queue[str] = queue.Queue()
        code_iterator = iter(enumerate(codes))
        completed = 0

        def drain_progress() -> Iterator[dict[str, Any]]:
            while True:
                try:
                    message = progress_queue.get_nowait()
                except queue.Empty:
                    return
                yield {"event": "attempt", "message": message}

        def submit_next() -> bool:
            if is_cancelled():
                return False
            try:
                index, code = next(code_iterator)
            except StopIteration:
                return False
            future_to_index[
                executor.submit(
                    self.fetch_fund_data,
                    code,
                    force_refresh=force_refresh,
                    attempts=attempts_by_index[index],
                    cancel_requested=is_cancelled,
                    progress_callback=progress_queue.put,
                    fetch_profile=fetch_profile,
                )
            ] = index
            return True

        try:
            for _ in range(workers):
                if not submit_next():
                    break

            while future_to_index:
                if is_cancelled():
                    break
                yield from drain_progress()
                done, _ = wait(
                    set(future_to_index),
                    timeout=heartbeat_seconds,
                    return_when=FIRST_COMPLETED,
                )
                yield from drain_progress()
                if not done:
                    yield {
                        "event": "attempt",
                        "message": f"仍在抓取基金详情：已完成 {completed} / {len(codes)}",
                    }
                    continue
                for future in done:
                    index = future_to_index.pop(future)
                    item = future.result()
                    completed += 1
                    yield {"event": "item", "index": index, "item": item}
                    submit_next()
        finally:
            stream_cancelled.set()
            for future in future_to_index:
                future.cancel()
            executor.shutdown(wait=False, cancel_futures=True)

    def fetch_fund_data(
        self,
        code: str,
        *,
        force_refresh: bool = False,
        attempts: list[str] | None = None,
        cancel_requested: Callable[[], bool] | None = None,
        progress_callback: Callable[[str], None] | None = None,
        fetch_profile: FundFetchProfile = "summary",
    ) -> FundCandidateData:
        code = normalize_fund_code(code)
        with self._cache_lock:
            cache_data = self.cache.read()
            cached = cache_data.get("funds", {}).get(code)
        cached_is_current = is_fund_cache_entry_current(cached)
        cached_satisfies_profile = bool(
            cached_is_current
            and isinstance(cached, dict)
            and fund_cache_satisfies_profile(cached, fetch_profile)
        )
        if (
            cached
            and cached_is_current
            and cached_satisfies_profile
            and not force_refresh
            and not self._is_stale(cached.get("updated_at"), FUND_DETAIL_TTL)
        ):
            record_fetch_progress(
                f"{code}: 命中 1 天缓存",
                attempts=attempts,
                progress_callback=progress_callback,
            )
            return FundCandidateData.model_validate({**cached, "stale": False})
        if cached and not cached_is_current:
            record_fetch_progress(
                f"{code}: 缓存版本过旧，重新抓取",
                attempts=attempts,
                progress_callback=progress_callback,
            )

        try:
            if cancel_requested and cancel_requested():
                raise FundDataSourceError("请求已取消")
            data = self._fetch_fresh_fund_data(
                code,
                attempts=attempts,
                cancel_requested=cancel_requested,
                progress_callback=progress_callback,
                fetch_profile=fetch_profile,
            )
        except Exception as exc:
            message = short_error(exc)
            if cached and cached_satisfies_profile:
                fallback = FundCandidateData.model_validate(
                    {**cached, "stale": True, "fetch_status": "partial", "fetch_error": message}
                )
                record_fetch_progress(
                    f"{code}: 外部抓取失败，使用缓存",
                    attempts=attempts,
                    progress_callback=progress_callback,
                )
                return fallback
            return FundCandidateData(
                code=code,
                updated_at=utc_now(),
                fetch_status="failed",
                fetch_error=message,
                data_sources=[],
                source_urls=[],
                stale=False,
            )

        fund_cache_entry = data.model_dump(mode="json")
        fund_cache_entry["cache_schema_version"] = FUND_DATA_CACHE_SCHEMA_VERSION
        fund_cache_entry["fetch_profile"] = fetch_profile
        with self._cache_lock:
            cache_data = self.cache.read()
            cache_data.setdefault("funds", {})[code] = fund_cache_entry
            self.cache.write(cache_data)
        return data

    def fetch_fund_fee_data(
        self,
        code: str,
        *,
        force_refresh: bool = False,
        attempts: list[str] | None = None,
    ) -> FundFeeData:
        code = normalize_fund_code(code)
        with self._cache_lock:
            cache_data = self.cache.read()
            cached = cache_data.get("funds", {}).get(code)
        cached_is_current = is_fund_cache_entry_current(cached)
        cached_has_fees = bool(
            cached_is_current
            and (
                clean_text(cached.get("subscription_fee_raw"))
                or clean_text(cached.get("redemption_fee_raw"))
            )
        )
        if (
            cached
            and cached_is_current
            and cached_has_fees
            and not force_refresh
            and not self._is_stale(cached.get("updated_at"), FUND_DETAIL_TTL)
        ):
            record_fetch_progress(f"{code}: 命中费率缓存", attempts=attempts)
            return fund_fee_data_from_cache(cached)

        errors: list[str] = []
        subscription_fee_raw: str | None = None
        redemption_fee_raw: str | None = None
        try:
            record_fetch_progress(f"{code}: 开始 买入费率", attempts=attempts)
            started_at = time.monotonic()
            subscription_fee_raw = self._ak_fee_raw_any(
                code,
                ["申购费率（前端）", "申购费率", "认购费率（前端）", "认购费率"],
            )
            record_fetch_progress(
                f"{code}: 完成 买入费率 {time.monotonic() - started_at:.2f}s",
                attempts=attempts,
            )
        except Exception as exc:
            errors.append(f"subscription_fee_raw: {short_error(exc)}")
            record_fetch_progress(f"{code}: 失败 买入费率: {short_error(exc)}", attempts=attempts)

        try:
            record_fetch_progress(f"{code}: 开始 卖出费率", attempts=attempts)
            started_at = time.monotonic()
            redemption_fee_raw = self._ak_fee_raw(code, "赎回费率")
            record_fetch_progress(
                f"{code}: 完成 卖出费率 {time.monotonic() - started_at:.2f}s",
                attempts=attempts,
            )
        except Exception as exc:
            errors.append(f"redemption_fee_raw: {short_error(exc)}")
            record_fetch_progress(f"{code}: 失败 卖出费率: {short_error(exc)}", attempts=attempts)

        field_sources: dict[str, str] = {}
        if clean_text(subscription_fee_raw):
            field_sources["subscription_fee_raw"] = "akshare.fund_fee_em:申购费率"
        if clean_text(redemption_fee_raw):
            field_sources["redemption_fee_raw"] = "akshare.fund_fee_em:赎回费率"
        if field_sources and errors:
            status = "partial"
        elif field_sources:
            status = "success"
        else:
            status = "failed"
        data = FundFeeData(
            code=code,
            subscription_fee_raw=clean_text(subscription_fee_raw),
            redemption_fee_raw=clean_text(redemption_fee_raw),
            field_sources=field_sources,
            data_sources=["AKShare fund_fee_em"] if field_sources else [],
            source_urls=[f"{EASTMONEY_F10_BASE}/jjfl_{code}.html"],
            updated_at=utc_now(),
            fetch_status=status,
            fetch_error="; ".join(errors[:3]) if errors else None,
            stale=False,
        )
        if status in {"success", "partial"}:
            self._merge_fund_fee_cache(data)
            return data
        if cached and cached_is_current and cached_has_fees:
            fallback = fund_fee_data_from_cache(cached)
            fallback.fetch_status = "partial"
            fallback.fetch_error = "; ".join(errors[:3]) or "费率抓取失败"
            fallback.stale = True
            return fallback
        return data

    def _merge_fund_fee_cache(self, fee_data: FundFeeData) -> None:
        with self._cache_lock:
            cache_data = self.cache.read()
            funds = cache_data.setdefault("funds", {})
            cached = funds.get(fee_data.code)
            if not isinstance(cached, dict):
                cached = {
                    "code": fee_data.code,
                    "fetch_profile": "fees",
                    "data_sources": [],
                    "source_urls": [],
                    "field_sources": {},
                    "updated_at": fee_data.updated_at.isoformat(),
                    "fetch_status": fee_data.fetch_status,
                    "fetch_error": fee_data.fetch_error,
                    "stale": False,
                }
            cached["cache_schema_version"] = FUND_DATA_CACHE_SCHEMA_VERSION
            cached["subscription_fee_raw"] = fee_data.subscription_fee_raw
            cached["redemption_fee_raw"] = fee_data.redemption_fee_raw
            cached["updated_at"] = fee_data.updated_at.isoformat()
            cached["fetch_error"] = fee_data.fetch_error
            cached["stale"] = False
            cached.setdefault("fetch_profile", "fees")
            cached["field_sources"] = {
                **(cached.get("field_sources") or {}),
                **fee_data.field_sources,
            }
            cached["data_sources"] = sorted(
                set([*(cached.get("data_sources") or []), *fee_data.data_sources])
            )
            cached["source_urls"] = sorted(
                set([*(cached.get("source_urls") or []), *fee_data.source_urls])
            )
            funds[fee_data.code] = cached
            self.cache.write(cache_data)

    def normalize_fund_data(self, raw: dict[str, Any]) -> FundCandidateData:
        code = normalize_fund_code(raw["code"])
        fetch_profile: FundFetchProfile = raw.get("fetch_profile") or "detail"
        web_fallback = raw.get("web_fallback") or {}
        overview = {**(web_fallback.get("overview") or {}), **(raw.get("overview") or {})}
        fee_trade = raw.get("fee_trade") or {}
        fee_amount = raw.get("fee_amount") or {}
        fee_confirm = raw.get("fee_confirm") or {}
        operation_fee = raw.get("operation_fee") or {}
        purchase_row = raw.get("purchase_row") or {}
        return_curve_points = parse_return_curve_points(raw.get("return_curve") or [])
        return_metrics = trailing_return_metrics_from_points(return_curve_points)
        drawdown_metrics = max_drawdown_metrics(return_curve_points)
        return_curve_preview = sample_return_curve_preview(return_curve_points)
        top_holdings = top_portfolio_holdings(raw.get("portfolio_holdings") or [])
        field_sources: dict[str, str] = {}

        name = first_text(overview.get("基金简称"), purchase_row.get("基金简称"), web_fallback.get("name"))
        fund_code_raw = first_text(overview.get("基金代码"), code)
        inception_date, inception_share_raw = parse_inception_date_and_share(
            overview.get("成立日期/规模")
        )
        asset_size_raw = first_text(overview.get("净资产规模"), web_fallback.get("asset_size_raw"))
        share_size_raw = first_text(overview.get("份额规模"), inception_share_raw)
        daily_limit_raw = first_text(
            fee_amount.get("日累计申购限额"),
            purchase_row.get("日累计限定金额"),
            web_fallback.get("daily_purchase_limit_raw"),
        )
        daily_limit_raw, daily_limit_cny = parse_daily_limit(normalize_purchase_limit(daily_limit_raw))
        purchase_status = first_text(
            fee_trade.get("申购状态"),
            purchase_row.get("申购状态"),
            web_fallback.get("purchase_status"),
        )
        redeem_status = first_text(
            fee_trade.get("赎回状态"),
            purchase_row.get("赎回状态"),
            web_fallback.get("redeem_status"),
        )
        management_fee = parse_fee_pct(first_text(operation_fee.get("管理费率"), overview.get("管理费率")))
        custody_fee = parse_fee_pct(first_text(operation_fee.get("托管费率"), overview.get("托管费率")))
        sales_fee = parse_fee_pct(
            first_text(operation_fee.get("销售服务费率"), overview.get("销售服务费率"))
        )

        mark_sources(field_sources, "天天基金网页兜底", web_fallback.get("overview") or {}, OVERVIEW_FIELD_MAP)
        mark_sources(field_sources, "akshare.fund_overview_em", raw.get("overview") or {}, OVERVIEW_FIELD_MAP)
        mark_sources(field_sources, "akshare.fund_fee_em:交易状态", fee_trade, TRADE_FIELD_MAP)
        mark_sources(field_sources, "akshare.fund_fee_em:申购与赎回金额", fee_amount, AMOUNT_FIELD_MAP)
        mark_sources(field_sources, "akshare.fund_fee_em:运作费用", operation_fee, FEE_FIELD_MAP)
        mark_sources(field_sources, "akshare.fund_purchase_em", purchase_row, PURCHASE_FIELD_MAP)
        if clean_text(raw.get("subscription_fee_raw")):
            field_sources.setdefault("subscription_fee_raw", "akshare.fund_fee_em:申购费率")
        if clean_text(raw.get("redemption_fee_raw")):
            field_sources.setdefault("redemption_fee_raw", "akshare.fund_fee_em:赎回费率")
        if web_fallback:
            for key in web_fallback:
                if key == "overview":
                    continue
                field_sources.setdefault(key, "天天基金网页兜底")
        if return_metrics:
            for key in RETURN_FIELD_NAMES:
                if return_metrics.get(key) is not None:
                    field_sources.setdefault(key, "akshare.fund_open_fund_info_em:累计收益率走势")
        if drawdown_metrics:
            for key in DRAWDOWN_FIELD_NAMES:
                if drawdown_metrics.get(key) is not None:
                    field_sources.setdefault(key, "akshare.fund_open_fund_info_em:累计收益率走势")
        if top_holdings:
            field_sources.setdefault("top_holdings", "akshare.fund_portfolio_hold_em")

        source_urls = [
            f"{EASTMONEY_F10_BASE}/jbgk_{code}.html",
            f"{EASTMONEY_F10_BASE}/jjfl_{code}.html",
            f"{EASTMONEY_F10_BASE}/ccmx_{code}.html",
            "http://fund.eastmoney.com/Fund_sgzt_bzdm.html",
        ]
        data_sources = sorted(
            set(
                source
                for source in [
                    "AKShare fund_overview_em" if raw.get("overview") else None,
                    "AKShare fund_fee_em" if fee_trade or fee_amount or operation_fee else None,
                    "AKShare fund_purchase_em" if purchase_row else None,
                    "AKShare fund_open_fund_info_em" if return_metrics else None,
                    "AKShare fund_portfolio_hold_em" if top_holdings else None,
                    "天天基金 F10 网页" if web_fallback else None,
                ]
                if source
            )
        )

        status = "success" if overview and (fee_trade or purchase_row) else "partial"
        return FundCandidateData(
            code=code,
            fetch_profile=fetch_profile,
            name=name,
            full_name=clean_text(overview.get("基金全称")),
            fund_type=first_text(overview.get("基金类型"), purchase_row.get("基金类型")),
            share_class=parse_share_class(fund_code_raw, name),
            fund_company=clean_text(overview.get("基金管理人")),
            fund_manager_company=clean_text(overview.get("基金管理人")),
            custodian=clean_text(overview.get("基金托管人")),
            fund_managers=split_managers(overview.get("基金经理人")),
            tracking_index=clean_text(overview.get("跟踪标的")),
            benchmark=clean_text(overview.get("业绩比较基准")),
            purchase_status=purchase_status,
            redeem_status=redeem_status,
            regular_investment_status=clean_text(fee_trade.get("定投状态")),
            trade_status_raw=first_text(
                web_fallback.get("trade_status_raw"),
                join_status(purchase_status, redeem_status, fee_trade.get("定投状态")),
            ),
            daily_purchase_limit_raw=daily_limit_raw,
            daily_purchase_limit_cny=daily_limit_cny,
            purchase_start_amount_cny=parse_cny_amount(
                first_text(fee_amount.get("申购起点"), purchase_row.get("购买起点"))
            ),
            regular_investment_start_amount_cny=parse_cny_amount(fee_amount.get("定投起点")),
            buy_confirm_day=clean_text(fee_confirm.get("买入确认日")),
            sell_confirm_day=clean_text(fee_confirm.get("卖出确认日")),
            management_fee_pct=management_fee,
            custody_fee_pct=custody_fee,
            sales_service_fee_pct=sales_fee,
            total_annual_fee_pct=sum_nullable([management_fee, custody_fee, sales_fee]),
            max_subscription_fee_pct=parse_fee_pct(
                first_text(
                    raw.get("subscription_fee_raw"),
                    web_fallback.get("subscription_fee_raw"),
                    overview.get("最高申购费率"),
                    overview.get("最高认购费率"),
                )
            ),
            subscription_fee_raw=first_text(
                raw.get("subscription_fee_raw"), web_fallback.get("subscription_fee_raw")
            ),
            redemption_fee_raw=clean_text(raw.get("redemption_fee_raw")),
            asset_size_raw=asset_size_raw,
            asset_size_yi=parse_asset_size_yi(asset_size_raw),
            asset_size_date=extract_date_in_parentheses(asset_size_raw),
            share_size_raw=share_size_raw,
            share_size_yi=parse_share_size_yi(share_size_raw),
            share_size_date=extract_date_in_parentheses(share_size_raw),
            inception_date=inception_date,
            years_since_inception=parse_years_since(inception_date),
            return_1y_pct=return_metrics.get("return_1y_pct"),
            return_3y_pct=return_metrics.get("return_3y_pct"),
            return_5y_pct=return_metrics.get("return_5y_pct"),
            return_10y_pct=return_metrics.get("return_10y_pct"),
            return_since_inception_pct=return_metrics.get("return_since_inception_pct"),
            max_drawdown_3y_pct=drawdown_metrics.get("max_drawdown_3y_pct"),
            max_drawdown_5y_pct=drawdown_metrics.get("max_drawdown_5y_pct"),
            max_drawdown_10y_pct=drawdown_metrics.get("max_drawdown_10y_pct"),
            return_curve_preview=return_curve_preview,
            top_holdings=top_holdings,
            data_sources=data_sources,
            source_urls=source_urls,
            field_sources=field_sources,
            updated_at=utc_now(),
            fetch_status=status,
            fetch_error=None,
            stale=False,
        )

    def search_codes(
        self,
        query: str,
        *,
        limit: int | None,
        attempts: list[str] | None = None,
    ) -> list[str]:
        terms = parse_search_terms(query)
        if not terms:
            return []
        if attempts is not None and len(terms) > 1:
            attempts.append(f"解析多关键字 {len(terms)} 个")
        code_terms = {normalize_fund_code(term) for term in terms if is_fund_code_term(term)}
        text_terms = [term.lower() for term in terms if not is_fund_code_term(term)]
        rows = self._purchase_rows(attempts=attempts)
        matched: list[str] = []
        for row in rows:
            code = clean_text(row.get("基金代码"))
            if not code:
                continue
            normalized_code = normalize_fund_code(code)
            haystack = " ".join(str(value).lower() for value in row.values() if value is not None)
            code_matched = not code_terms or normalized_code in code_terms
            text_matched = all(term in haystack for term in text_terms)
            if code_matched and text_matched:
                matched.append(normalized_code)
            if limit is not None and len(matched) >= limit:
                break
        return matched

    def _fetch_fresh_fund_data(
        self,
        code: str,
        *,
        attempts: list[str] | None = None,
        cancel_requested: Callable[[], bool] | None = None,
        progress_callback: Callable[[str], None] | None = None,
        fetch_profile: FundFetchProfile = "summary",
    ) -> FundCandidateData:
        raw: dict[str, Any] = {"code": code}
        errors: list[str] = []
        fetch_steps: list[tuple[str, str, Callable[[], Any]]] = [
            ("overview", "基本概况", lambda: self._ak_overview(code)),
            ("fee_trade", "交易状态", lambda: self._ak_fee_table(code, "交易状态")),
            ("fee_amount", "申购赎回金额", lambda: self._ak_fee_table(code, "申购与赎回金额")),
            ("fee_confirm", "交易确认日", lambda: self._ak_fee_table(code, "交易确认日")),
            ("operation_fee", "运作费率", lambda: self._ak_fee_table(code, "运作费用")),
            (
                "subscription_fee_raw",
                "申购费率",
                lambda: self._ak_fee_raw_any(code, ["申购费率（前端）", "申购费率"]),
            ),
            ("redemption_fee_raw", "赎回费率", lambda: self._ak_fee_raw(code, "赎回费率")),
            ("purchase_row", "申购总表匹配", lambda: self._purchase_row(code, attempts=attempts)),
            ("return_curve", "收益曲线", lambda: self._ak_return_curve(code)),
            ("portfolio_holdings", "前十大持仓", lambda: self._ak_portfolio_holdings(code)),
        ]
        for key, label, getter in fetch_steps:
            if fetch_profile == "summary" and key in DETAIL_FETCH_STEPS:
                record_fetch_progress(
                    f"{code}: 跳过 {label}（详情页按需抓取）",
                    attempts=attempts,
                    progress_callback=progress_callback,
                )
                continue
            step_started_at: float | None = None
            try:
                if cancel_requested and cancel_requested():
                    raise FundDataSourceError("请求已取消")
                record_fetch_progress(
                    f"{code}: 开始 {label}",
                    attempts=attempts,
                    progress_callback=progress_callback,
                )
                step_started_at = time.monotonic()
                raw[key] = getter()
                elapsed = time.monotonic() - step_started_at
                record_fetch_progress(
                    f"{code}: 完成 {label} {elapsed:.2f}s",
                    attempts=attempts,
                    progress_callback=progress_callback,
                )
            except Exception as exc:
                elapsed = time.monotonic() - step_started_at if step_started_at is not None else 0
                error_message = short_error(exc)
                record_fetch_progress(
                    f"{code}: 失败 {label} {elapsed:.2f}s: {error_message}",
                    attempts=attempts,
                    progress_callback=progress_callback,
                )
                errors.append(f"{key}: {error_message}")
                if cancel_requested and cancel_requested():
                    break
        try:
            if (
                fetch_profile == "detail"
                and (not cancel_requested or not cancel_requested())
            ):
                record_fetch_progress(
                    f"{code}: 开始 天天基金网页兜底",
                    attempts=attempts,
                    progress_callback=progress_callback,
                )
                fallback_started_at = time.monotonic()
                raw["web_fallback"] = self._web_fallback(code)
                elapsed = time.monotonic() - fallback_started_at
                record_fetch_progress(
                    f"{code}: 完成 天天基金网页兜底 {elapsed:.2f}s",
                    attempts=attempts,
                    progress_callback=progress_callback,
                )
        except Exception as exc:
            elapsed = time.monotonic() - fallback_started_at if "fallback_started_at" in locals() else 0
            error_message = short_error(exc)
            record_fetch_progress(
                f"{code}: 失败 天天基金网页兜底 {elapsed:.2f}s: {error_message}",
                attempts=attempts,
                progress_callback=progress_callback,
            )
            errors.append(f"web_fallback: {error_message}")
        if not any(raw.get(key) for key in ("overview", "fee_trade", "purchase_row", "web_fallback")):
            raise FundDataSourceError("; ".join(errors) or "没有可用数据")
        data = self.normalize_fund_data({**raw, "fetch_profile": fetch_profile})
        unresolved_errors = [
            error for error in errors if not self._is_error_covered_by_fallback(error, data)
        ]
        if unresolved_errors:
            data.fetch_status = "partial"
            data.fetch_error = "; ".join(unresolved_errors[:3])
        record_fetch_progress(
            f"{code}: {data.fetch_status}",
            attempts=attempts,
            progress_callback=progress_callback,
        )
        time.sleep(REQUEST_SLEEP_SECONDS)
        return data

    def _ak_overview(self, code: str) -> dict[str, Any]:
        df = self._call_akshare(lambda ak: ak.fund_overview_em(symbol=code))
        if df.empty:
            raise FundDataSourceError("fund_overview_em 返回空表")
        return dataframe_first_row(df)

    def _ak_fee_table(self, code: str, indicator: str) -> dict[str, str]:
        df = self._fee_table_dataframe(code, indicator)
        if df.empty:
            return {}
        return flatten_key_value_table(df.astype(object).values.tolist())

    def _ak_fee_raw(self, code: str, indicator: str) -> str | None:
        df = self._fee_table_dataframe(code, indicator)
        if df.empty:
            return None
        return "；".join(
            " ".join(clean_text(cell) or "" for cell in row).strip()
            for row in df.astype(object).values.tolist()
            if any(clean_text(cell) for cell in row)
        )

    def _ak_fee_raw_any(self, code: str, indicators: list[str]) -> str | None:
        errors: list[str] = []
        for indicator in indicators:
            try:
                result = self._ak_fee_raw(code, indicator)
            except Exception as exc:
                errors.append(f"{indicator}: {short_error(exc)}")
                continue
            if result:
                return result
            errors.append(f"{indicator}: 空表")
        raise FundDataSourceError("; ".join(errors))

    def _ak_return_curve(self, code: str) -> list[dict[str, Any]]:
        response = self._session().get(
            "https://api.fund.eastmoney.com/pinzhong/LJSYLZS",
            params={"fundCode": code, "indexcode": "000300", "type": "se"},
            headers={"Referer": "https://fund.eastmoney.com/", **self._session_headers},
            timeout=6,
        )
        response.raise_for_status()
        payload = response.json()
        data_blocks = payload.get("Data") if isinstance(payload, dict) else None
        rows = data_blocks[0].get("data") if data_blocks else []
        df = pd.DataFrame(rows)
        if df.empty:
            return []
        df = df.iloc[:, :2]
        df.columns = ["日期", "累计收益率"]
        df["日期"] = pd.to_datetime(df["日期"], unit="ms", utc=True).dt.tz_convert(
            "Asia/Shanghai"
        )
        df["日期"] = pd.to_datetime(df["日期"], errors="coerce").dt.date
        df["累计收益率"] = pd.to_numeric(df["累计收益率"], errors="coerce")
        return [dataframe_row_to_json(row) for _, row in df.iterrows()]

    def _fee_table_dataframe(self, code: str, indicator: str) -> pd.DataFrame:
        return self._fee_tables(code).get(indicator, pd.DataFrame())

    def _fee_tables(self, code: str) -> dict[str, pd.DataFrame]:
        code = normalize_fund_code(code)
        with self._fee_tables_lock:
            cached = self._fee_tables_cache.get(code)
            if cached is not None:
                return cached
        tables = self._fetch_fee_tables(code)
        with self._fee_tables_lock:
            self._fee_tables_cache[code] = tables
        return tables

    def _fetch_fee_tables(self, code: str) -> dict[str, pd.DataFrame]:
        from bs4 import BeautifulSoup

        html = self._get_text(f"{EASTMONEY_F10_BASE}/jjfl_{code}.html")
        soup = BeautifulSoup(html, features="html.parser")
        tables: dict[str, pd.DataFrame] = {}
        for title_elem in soup.find_all(name="h4", class_="t"):
            title_text = clean_text(re.sub(r"\s+", " ", title_elem.get_text(" ", strip=True)))
            if not title_text:
                continue
            next_tables = title_elem.find_all_next("table")
            if not next_tables:
                continue
            try:
                if title_text == "申购与赎回金额" and len(next_tables) >= 2:
                    tables[title_text] = pd.concat(
                        [
                            pd.read_html(StringIO(str(next_tables[0])))[0],
                            pd.read_html(StringIO(str(next_tables[1])))[0],
                        ],
                        ignore_index=True,
                    )
                else:
                    tables[title_text] = pd.read_html(StringIO(str(next_tables[0])))[0]
            except Exception as exc:
                logger.warning("基金费率表解析失败：%s %s %s", code, title_text, short_error(exc))
        return tables

    def _ak_portfolio_holdings(self, code: str) -> list[dict[str, Any]]:
        errors: list[str] = []
        current_year = utc_now().year
        for year in range(current_year, current_year - 5, -1):
            try:
                df = self._call_akshare(
                    lambda ak, year=year: ak.fund_portfolio_hold_em(symbol=code, date=str(year))
                )
            except Exception as exc:
                errors.append(f"{year}: {short_error(exc)}")
                continue
            if not df.empty:
                return [dataframe_row_to_json(row) for _, row in df.iterrows()]
        if errors:
            raise FundDataSourceError("; ".join(errors[:3]))
        return []

    def _purchase_rows(self, *, attempts: list[str] | None = None) -> list[dict[str, Any]]:
        with self._cache_lock:
            cache_data = self.cache.read()
            if (
                cache_data.get("purchase_rows")
                and not self._is_stale(cache_data.get("purchase_updated_at"), AKSHARE_PURCHASE_TTL)
            ):
                return list(cache_data["purchase_rows"])
            try:
                df = self._call_akshare(lambda ak: ak.fund_purchase_em())
                rows = [dataframe_row_to_json(row) for _, row in df.iterrows()]
            except Exception as exc:
                if cache_data.get("purchase_rows"):
                    if attempts is not None:
                        attempts.append("fund_purchase_em 失败，使用缓存总表")
                    return list(cache_data["purchase_rows"])
                raise FundDataSourceError(short_error(exc)) from exc
            cache_data["purchase_rows"] = rows
            cache_data["purchase_updated_at"] = utc_now().isoformat()
            self.cache.write(cache_data)
            if attempts is not None:
                attempts.append(f"fund_purchase_em: {len(rows)} 行")
            return rows

    def _purchase_row(self, code: str, *, attempts: list[str] | None = None) -> dict[str, Any]:
        for row in self._purchase_rows(attempts=attempts):
            if normalize_fund_code(str(row.get("基金代码", ""))) == code:
                return row
        return {}

    def _web_fallback(self, code: str) -> dict[str, Any]:
        overview_html = self._get_text(f"{EASTMONEY_F10_BASE}/jbgk_{code}.html")
        fee_html = self._get_text(f"{EASTMONEY_F10_BASE}/jjfl_{code}.html")
        combined = normalize_html_text(f"{overview_html} {fee_html}")
        result: dict[str, Any] = {"overview": {}}
        overview: dict[str, str] = result["overview"]
        for raw_key, left, right in [
            ("基金全称", "基金全称", "基金简称"),
            ("基金简称", "基金简称", "基金代码"),
            ("基金代码", "基金代码", "基金类型"),
            ("基金类型", "基金类型", "发行日期"),
            ("发行日期", "发行日期", "成立日期/规模"),
            ("成立日期/规模", "成立日期/规模", "净资产规模"),
            ("净资产规模", "净资产规模", "份额规模"),
            ("份额规模", "份额规模", "基金管理人"),
            ("基金管理人", "基金管理人", "基金托管人"),
            ("基金托管人", "基金托管人", "基金经理人"),
            ("基金经理人", "基金经理人", "成立来分红"),
            ("管理费率", "管理费率", "托管费率"),
            ("托管费率", "托管费率", "销售服务费率"),
            ("销售服务费率", "销售服务费率", "最高认购费率"),
            ("最高认购费率", "最高认购费率", "业绩比较基准"),
            ("业绩比较基准", "业绩比较基准", "跟踪标的"),
            ("跟踪标的", "跟踪标的", "◆◆"),
        ]:
            value = pick_between(combined, left, right)
            if value:
                overview[raw_key] = value
        status_match = re.search(r"交易状态[:：]\s*([^#]+?)(?:购买手续费|成立日期|申购状态|赎回状态)", combined)
        if status_match:
            trade_status = clean_text(status_match.group(1))
            if trade_status:
                result["trade_status_raw"] = trade_status
                limit_match = re.search(r"单日累计购买上限\s*([0-9,.]+(?:万)?元)", trade_status)
                if limit_match:
                    result["daily_purchase_limit_raw"] = limit_match.group(1)
                result["purchase_status"] = "暂停申购" if "暂停申购" in trade_status else None
                result["redeem_status"] = "暂停赎回" if "暂停赎回" in trade_status else None
        subscription_fee_raw = first_text(
            pick_fee_rule_text(
                combined,
                ["申购费率（前端）", "申购费率", "购买手续费"],
                ["赎回费率", "运作费用", "基金运作费用", "管理费率", "托管费率"],
            ),
            pick_regex_group(combined, r"购买手续费[:：]\s*([0-9.]+%\s+[0-9.]+%)"),
        )
        if subscription_fee_raw:
            result["subscription_fee_raw"] = subscription_fee_raw
        redemption_fee_raw = pick_fee_rule_text(
            combined,
            ["赎回费率"],
            ["运作费用", "基金运作费用", "管理费率", "托管费率", "销售服务费率", "最高认购费率", "业绩比较基准"],
        )
        if redemption_fee_raw:
            result["redemption_fee_raw"] = redemption_fee_raw
        if not overview:
            result.pop("overview", None)
        return {key: value for key, value in result.items() if value}

    def _get_text(self, url: str) -> str:
        response = self._session().get(url, timeout=12)
        response.raise_for_status()
        response.encoding = response.apparent_encoding or response.encoding
        return response.text

    def _call_akshare(self, callback: Callable[[Any], Any]) -> Any:
        with AKSHARE_CALL_LOCK:
            return callback(import_akshare())

    def _session(self) -> requests.Session:
        session = getattr(self._thread_local, "session", None)
        if session is None:
            session = requests.Session()
            session.headers.update(self._session_headers)
            self._thread_local.session = session
        return session

    def _candidate_codes(self, limit: int) -> list[str]:
        path = get_settings().candidate_codes_path
        if path.exists():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                codes = payload.get("codes", []) if isinstance(payload, dict) else payload
                return [normalize_fund_code(str(code)) for code in codes][:limit]
            except json.JSONDecodeError:
                pass
        return DEFAULT_CANDIDATE_CODES[:limit]

    def _is_stale(self, updated_at: str | None, ttl: timedelta) -> bool:
        if not updated_at:
            return True
        try:
            parsed = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        except ValueError:
            return True
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return utc_now() - parsed > ttl

    def _is_error_covered_by_fallback(self, error: str, data: FundCandidateData) -> bool:
        if error.startswith("subscription_fee_raw") and data.subscription_fee_raw:
            return True
        if error.startswith("overview") and data.full_name and data.asset_size_raw:
            return True
        return False


def import_akshare() -> Any:
    try:
        import akshare as ak  # type: ignore[import-untyped]
    except ImportError as exc:
        raise FundDataSourceError("AKShare 未安装，请安装 backend[market] 依赖") from exc
    return ak


def dataframe_first_row(df: pd.DataFrame) -> dict[str, Any]:
    return dataframe_row_to_json(df.iloc[0])


def dataframe_row_to_json(row: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in row.items():
        if pd.isna(value):
            result[str(key)] = None
        elif hasattr(value, "isoformat"):
            result[str(key)] = value.isoformat()
        else:
            result[str(key)] = value
    return result


def fund_fee_data_from_cache(cached: dict[str, Any]) -> FundFeeData:
    return FundFeeData(
        code=normalize_fund_code(str(cached.get("code", ""))),
        subscription_fee_raw=clean_text(cached.get("subscription_fee_raw")),
        redemption_fee_raw=clean_text(cached.get("redemption_fee_raw")),
        field_sources={
            key: value
            for key, value in (cached.get("field_sources") or {}).items()
            if key in {"subscription_fee_raw", "redemption_fee_raw"}
        },
        data_sources=list(cached.get("data_sources") or []),
        source_urls=list(cached.get("source_urls") or []),
        updated_at=datetime.fromisoformat(str(cached["updated_at"]).replace("Z", "+00:00")),
        fetch_status=cached.get("fetch_status") or "success",
        fetch_error=clean_text(cached.get("fetch_error")),
        stale=bool(cached.get("stale")),
    )


def normalize_fund_code(code: str) -> str:
    digits = re.search(r"\d{1,6}", code)
    if not digits:
        return code.strip()
    return digits.group(0).zfill(6)


def parse_search_terms(query: str) -> list[str]:
    return [term.strip() for term in re.split(r"[,，]+", query) if term.strip()]


def is_fund_code_term(term: str) -> bool:
    return re.fullmatch(r"\d{1,6}", term.strip()) is not None


def normalize_purchase_limit(value: Any) -> str | None:
    text = clean_text(value)
    if text is None:
        return None
    try:
        amount = float(text)
    except ValueError:
        return text
    if amount >= 10_000_000_000:
        return "无限额"
    return f"{amount:g}元"


def split_managers(value: Any) -> list[str] | None:
    text = clean_text(value)
    if text is None:
        return None
    parts = [part.strip() for part in re.split(r"[,，、/ ]+", text) if part.strip()]
    return parts or None


def first_text(*values: Any) -> str | None:
    for value in values:
        text = clean_text(value)
        if text is not None:
            return text
    return None


def sum_nullable(values: list[float | None]) -> float | None:
    valid = [value for value in values if value is not None]
    if not valid:
        return None
    return round(sum(valid), 4)


RETURN_FIELD_NAMES = [
    "return_1y_pct",
    "return_3y_pct",
    "return_5y_pct",
    "return_10y_pct",
    "return_since_inception_pct",
]
DRAWDOWN_FIELD_NAMES = [
    "max_drawdown_3y_pct",
    "max_drawdown_5y_pct",
    "max_drawdown_10y_pct",
]


def trailing_return_metrics(rows: list[dict[str, Any]]) -> dict[str, float | None]:
    return trailing_return_metrics_from_points(parse_return_curve_points(rows))


def parse_return_curve_points(rows: list[dict[str, Any]]) -> list[tuple[date, float]]:
    return sorted(
        (
            point
            for point in (return_curve_point(row) for row in rows)
            if point is not None
        ),
        key=lambda item: item[0],
    )


def trailing_return_metrics_from_points(points: list[tuple[date, float]]) -> dict[str, float | None]:
    if not points:
        return {}
    latest_date, latest_return = points[-1]
    result: dict[str, float | None] = {
        "return_since_inception_pct": round_percentage(latest_return),
    }
    for years, key in [
        (1, "return_1y_pct"),
        (3, "return_3y_pct"),
        (5, "return_5y_pct"),
        (10, "return_10y_pct"),
    ]:
        cutoff = latest_date - timedelta(days=round(365.25 * years))
        base = latest_point_on_or_before(points, cutoff)
        result[key] = interval_return_from_cumulative(base[1], latest_return) if base else None
    return result


def max_drawdown_metrics(points: list[tuple[date, float]]) -> dict[str, float | None]:
    if not points:
        return {}
    result: dict[str, float | None] = {}
    for years, key in [
        (3, "max_drawdown_3y_pct"),
        (5, "max_drawdown_5y_pct"),
        (10, "max_drawdown_10y_pct"),
    ]:
        result[key] = max_drawdown_for_years(points, years)
    return result


def max_drawdown_for_years(points: list[tuple[date, float]], years: int) -> float | None:
    if len(points) < 2:
        return None
    latest_date = points[-1][0]
    cutoff = latest_date - timedelta(days=round(365.25 * years))
    window_points = [point for point in points if point[0] >= cutoff]
    if len(window_points) < 2:
        window_points = points
    peak_index: float | None = None
    max_drawdown = 0.0
    for _, return_pct in window_points:
        value_index = 1 + return_pct / 100
        if value_index <= 0:
            continue
        if peak_index is None or value_index > peak_index:
            peak_index = value_index
            continue
        drawdown = (value_index / peak_index - 1) * 100
        max_drawdown = min(max_drawdown, drawdown)
    return round_percentage(max_drawdown) if peak_index is not None else None


def sample_return_curve_preview(
    points: list[tuple[date, float]],
    *,
    max_points: int = 96,
) -> list[dict[str, Any]]:
    if not points:
        return []
    if len(points) <= max_points:
        sampled = points
    else:
        last_index = len(points) - 1
        indexes = sorted({round(index * last_index / (max_points - 1)) for index in range(max_points)})
        sampled = [points[index] for index in indexes]
    return [
        {"date": point_date.isoformat(), "return_pct": round_percentage(return_pct)}
        for point_date, return_pct in sampled
    ]


def top_portfolio_holdings(rows: list[dict[str, Any]], *, limit: int = 10) -> list[dict[str, Any]]:
    holdings: list[dict[str, Any]] = []
    for index, row in enumerate(rows, start=1):
        name = first_text(row.get("股票名称"), row.get("持仓名称"), row.get("名称"), row.get("name"))
        if not name:
            continue
        holdings.append(
            {
                "rank": parse_int(first_text(row.get("序号"), row.get("排名"))) or index,
                "code": first_text(row.get("股票代码"), row.get("代码"), row.get("code")),
                "name": name,
                "value_pct": parse_return_pct(
                    first_text(row.get("占净值比例"), row.get("占净值比例(%)"), row.get("持仓占比"), row.get("比例"))
                ),
                "shares": first_text(row.get("持股数"), row.get("持仓数量"), row.get("持股数量")),
                "market_value": first_text(row.get("持仓市值"), row.get("持股市值"), row.get("市值")),
                "report_period": first_text(row.get("季度"), row.get("报告期"), row.get("持仓截止日期"), row.get("截止日期")),
            }
        )
        if len(holdings) >= limit:
            break
    return holdings


def return_curve_point(row: dict[str, Any]) -> tuple[date, float] | None:
    point_date = parse_curve_date(
        first_text(row.get("净值日期"), row.get("日期"), row.get("x"), row.get("date"))
    )
    value = parse_return_pct(
        first_text(
            row.get("累计收益率"),
            row.get("累计收益率走势"),
            row.get("收益率"),
            row.get("y"),
            row.get("value"),
        )
    )
    if point_date is None or value is None:
        return None
    return point_date, value


def latest_point_on_or_before(points: list[tuple[date, float]], cutoff: date) -> tuple[date, float] | None:
    match: tuple[date, float] | None = None
    for point in points:
        if point[0] <= cutoff:
            match = point
        else:
            break
    return match


def interval_return_from_cumulative(base_return: float, latest_return: float) -> float | None:
    base_index = 1 + base_return / 100
    latest_index = 1 + latest_return / 100
    if base_index <= 0:
        return None
    return round_percentage((latest_index / base_index - 1) * 100)


def parse_curve_date(value: str | None) -> date | None:
    if not value:
        return None
    text = value.strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except ValueError:
            continue
    return None


def parse_return_pct(value: str | None) -> float | None:
    if not value:
        return None
    text = value.replace("%", "").replace(",", "").strip()
    try:
        result = float(text)
    except ValueError:
        return None
    return result if pd.notna(result) else None


def parse_int(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"\d+", value.replace(",", ""))
    return int(match.group(0)) if match else None


def round_percentage(value: float) -> float:
    return round(value, 4)


def join_status(*values: Any) -> str | None:
    parts = [clean_text(value) for value in values]
    parts = [value for value in parts if value]
    return " / ".join(parts) if parts else None


def normalize_html_text(html: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text.replace("&nbsp;", " ")).strip()


def pick_between(text: str, left: str, right: str) -> str | None:
    pattern = re.compile(rf"{re.escape(left)}\s*(.*?)\s*{re.escape(right)}")
    match = pattern.search(text)
    if not match:
        return None
    return clean_text(match.group(1))


def pick_regex_group(text: str, pattern: str) -> str | None:
    match = re.search(pattern, text)
    if not match:
        return None
    return clean_text(match.group(1))


def pick_fee_rule_text(text: str, labels: list[str], stop_labels: list[str]) -> str | None:
    label_pattern = "|".join(re.escape(label) for label in labels)
    stop_pattern = "|".join(re.escape(label) for label in stop_labels)
    match = re.search(rf"(?:{label_pattern})\s*(.*?)(?={stop_pattern}|$)", text)
    if not match:
        return None
    value = clean_text(match.group(1))
    if value is None:
        return None
    return value[:600]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def short_error(exc: Exception) -> str:
    return str(exc).replace("\n", " ")[:300] or exc.__class__.__name__


def mark_sources(
    field_sources: dict[str, str],
    source: str,
    data: dict[str, Any],
    mapping: dict[str, str],
) -> None:
    if not data:
        return
    for raw_key, field_name in mapping.items():
        if clean_text(data.get(raw_key)) is not None:
            field_sources.setdefault(field_name, source)


OVERVIEW_FIELD_MAP = {
    "基金全称": "full_name",
    "基金简称": "name",
    "基金类型": "fund_type",
    "基金管理人": "fund_company",
    "基金托管人": "custodian",
    "基金经理人": "fund_managers",
    "跟踪标的": "tracking_index",
    "业绩比较基准": "benchmark",
    "净资产规模": "asset_size_raw",
    "份额规模": "share_size_raw",
    "管理费率": "management_fee_pct",
    "托管费率": "custody_fee_pct",
    "销售服务费率": "sales_service_fee_pct",
    "最高申购费率": "max_subscription_fee_pct",
    "最高认购费率": "max_subscription_fee_pct",
}
TRADE_FIELD_MAP = {
    "申购状态": "purchase_status",
    "赎回状态": "redeem_status",
    "定投状态": "regular_investment_status",
}
AMOUNT_FIELD_MAP = {
    "申购起点": "purchase_start_amount_cny",
    "定投起点": "regular_investment_start_amount_cny",
    "日累计申购限额": "daily_purchase_limit_raw",
}
FEE_FIELD_MAP = {
    "管理费率": "management_fee_pct",
    "托管费率": "custody_fee_pct",
    "销售服务费率": "sales_service_fee_pct",
}
PURCHASE_FIELD_MAP = {
    "基金简称": "name",
    "基金类型": "fund_type",
    "申购状态": "purchase_status",
    "赎回状态": "redeem_status",
    "购买起点": "purchase_start_amount_cny",
    "日累计限定金额": "daily_purchase_limit_raw",
    "手续费": "max_subscription_fee_pct",
}
