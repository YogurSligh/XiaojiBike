from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.schemas.common import ApiResponse
from app.schemas.funds import (
    FundCandidateData,
    FundCodeSearchResult,
    FundFeeData,
    FundRefreshPayload,
    FundSearchResult,
)
from app.services.fund_data_service import FundDataService


router = APIRouter(prefix="/funds", tags=["funds"])


@router.get("/codes", response_model=ApiResponse[FundCodeSearchResult])
def get_fund_codes(
    query: str | None = Query(default=None, max_length=80),
    codes: list[str] | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
) -> ApiResponse[FundCodeSearchResult]:
    attempts: list[str] = []
    service = FundDataService()
    all_codes = service.resolve_fund_codes(
        codes=codes,
        query=query,
        limit=None,
        attempts=attempts,
    )
    page_codes = all_codes[offset : offset + limit]
    return ApiResponse(
        data=FundCodeSearchResult(
            codes=page_codes,
            total_count=len(all_codes),
            next_offset=offset + len(page_codes),
            has_more=len(all_codes) > offset + limit,
            provider_attempts=attempts,
        )
    )


@router.get("/candidates", response_model=ApiResponse[FundSearchResult])
def get_fund_candidates(
    query: str | None = Query(default=None, max_length=80),
    codes: list[str] | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    force_refresh: bool = Query(default=False),
) -> ApiResponse[FundSearchResult]:
    service = FundDataService()
    return ApiResponse(
        data=service.get_fund_data_list(
            codes=codes,
            query=query,
            limit=limit,
            force_refresh=force_refresh,
            fetch_profile="summary",
        )
    )


@router.get("/candidates/stream")
def stream_fund_candidates(
    query: str | None = Query(default=None, max_length=80),
    codes: list[str] | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    force_refresh: bool = Query(default=False),
) -> StreamingResponse:
    service = FundDataService()

    def event_stream() -> Iterator[str]:
        attempts: list[str] = []
        try:
            yield sse_event("attempt", {"message": "开始解析候选基金"})
            unique_codes = service.resolve_fund_codes(
                codes=codes,
                query=query,
                limit=limit,
                attempts=attempts,
            )
            for attempt in attempts:
                yield sse_event("attempt", {"message": attempt})
            yield sse_event("start", {"total": len(unique_codes)})
            if not unique_codes:
                yield sse_event("done", {"completed": 0, "total": 0})
                return
            completed = 0
            for payload in service.stream_fund_data(
                unique_codes,
                force_refresh=force_refresh,
                fetch_profile="summary",
            ):
                event_name = str(payload.get("event") or "message")
                if event_name == "item":
                    completed += 1
                    item = payload.get("item")
                    yield sse_event(
                        "item",
                        {
                            "index": payload.get("index"),
                            "completed": completed,
                            "total": len(unique_codes),
                            "item": item.model_dump(mode="json") if item is not None else None,
                        },
                    )
                elif event_name == "attempt":
                    yield sse_event("attempt", {"message": payload.get("message")})
            yield sse_event("done", {"completed": completed, "total": len(unique_codes)})
        except Exception as exc:
            yield sse_event("stream_error", {"message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{code}", response_model=ApiResponse[FundCandidateData])
def get_fund_candidate_detail(
    code: str,
    force_refresh: bool = Query(default=False),
) -> ApiResponse[FundCandidateData]:
    service = FundDataService()
    return ApiResponse(
        data=service.fetch_fund_data(
            code,
            force_refresh=force_refresh,
            fetch_profile="detail",
        )
    )


@router.get("/{code}/fees", response_model=ApiResponse[FundFeeData])
def get_fund_candidate_fees(
    code: str,
    force_refresh: bool = Query(default=False),
) -> ApiResponse[FundFeeData]:
    service = FundDataService()
    return ApiResponse(
        data=service.fetch_fund_fee_data(
            code,
            force_refresh=force_refresh,
        )
    )


@router.post("/refresh", response_model=ApiResponse[FundSearchResult])
def refresh_fund_candidates(payload: FundRefreshPayload) -> ApiResponse[FundSearchResult]:
    service = FundDataService()
    return ApiResponse(
        data=service.get_fund_data_list(
            codes=payload.codes,
            query=payload.query,
            limit=payload.limit,
            force_refresh=payload.force_refresh,
            fetch_profile="summary",
        )
    )


def sse_event(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"
