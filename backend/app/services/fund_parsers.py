from __future__ import annotations

import math
import re
from datetime import date, datetime
from typing import Any


_DATE_PATTERNS = (
    (re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日"), "%Y-%m-%d"),
    (re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})"), "%Y-%m-%d"),
)


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    text = str(value).replace("\xa0", " ").strip()
    text = re.sub(r"\s+", " ", text)
    if not text or text in {"--", "---", "nan", "NaT"}:
        return None
    return text


def parse_fee_pct(text: Any) -> float | None:
    value = clean_text(text)
    if value is None:
        return None
    match = re.search(r"(-?\d+(?:\.\d+)?)\s*%", value)
    if not match:
        return None
    return float(match.group(1))


def parse_cny_amount(text: Any) -> float | None:
    value = clean_text(text)
    if value is None:
        return None
    if any(word in value for word in ("无限额", "不限", "暂停", "封闭", "不支持")):
        return None
    normalized = value.replace(",", "")
    match = re.search(r"(-?\d+(?:\.\d+)?)", normalized)
    if not match:
        return None
    amount = float(match.group(1))
    if "亿元" in normalized:
        return amount * 100_000_000
    if "万元" in normalized or "万" in normalized:
        return amount * 10_000
    return amount


def parse_asset_size_yi(text: Any) -> float | None:
    value = clean_text(text)
    if value is None:
        return None
    normalized = value.replace(",", "")
    match = re.search(r"(-?\d+(?:\.\d+)?)", normalized)
    if not match:
        return None
    amount = float(match.group(1))
    if "万元" in normalized:
        return round(amount / 10_000, 6)
    if "元" in normalized and "亿元" not in normalized:
        return round(amount / 100_000_000, 6)
    return amount


def parse_share_size_yi(text: Any) -> float | None:
    value = clean_text(text)
    if value is None:
        return None
    normalized = value.replace(",", "")
    match = re.search(r"(-?\d+(?:\.\d+)?)", normalized)
    if not match:
        return None
    amount = float(match.group(1))
    if "万份" in normalized:
        return round(amount / 10_000, 6)
    if "份" in normalized and "亿份" not in normalized:
        return round(amount / 100_000_000, 6)
    return amount


def parse_daily_limit(text: Any) -> tuple[str | None, float | None]:
    value = clean_text(text)
    if value is None:
        return None, None
    return value, parse_cny_amount(value)


def parse_date_text(text: Any) -> str | None:
    value = clean_text(text)
    if value is None:
        return None
    for pattern, _format in _DATE_PATTERNS:
        match = pattern.search(value)
        if match:
            year, month, day = (int(part) for part in match.groups())
            try:
                return date(year, month, day).isoformat()
            except ValueError:
                return value
    return value


def extract_date_in_parentheses(text: Any) -> str | None:
    value = clean_text(text)
    if value is None:
        return None
    match = re.search(r"截止至[:：]\s*([^)）]+)", value)
    if match:
        return parse_date_text(match.group(1))
    return parse_date_text(value)


def parse_inception_date_and_share(text: Any) -> tuple[str | None, str | None]:
    value = clean_text(text)
    if value is None:
        return None, None
    parts = [part.strip() for part in value.split("/", 1)]
    return parse_date_text(parts[0]), clean_text(parts[1]) if len(parts) > 1 else None


def parse_share_class(code_text: Any, name: Any) -> str | None:
    text = " ".join(part for part in (clean_text(code_text), clean_text(name)) if part)
    if "（前端）" in text or "(前端)" in text:
        return "A类/前端"
    if "（后端）" in text or "(后端)" in text:
        return "后端"
    match = re.search(r"([A-H])(?:类)?(?:$|[\s（）()])", text)
    if match:
        return f"{match.group(1)}类"
    return None


def parse_years_since(date_text: str | None, today: date | None = None) -> float | None:
    if not date_text:
        return None
    try:
        start = datetime.strptime(date_text, "%Y-%m-%d").date()
    except ValueError:
        return None
    current = today or date.today()
    if start > current:
        return None
    return round((current - start).days / 365.25, 1)


def flatten_key_value_table(rows: list[list[Any]]) -> dict[str, str]:
    result: dict[str, str] = {}
    for row in rows:
        cells = [clean_text(cell) for cell in row]
        for index in range(0, len(cells), 2):
            key = cells[index]
            value = cells[index + 1] if index + 1 < len(cells) else None
            if key and value:
                result[key] = value
    return result
