import type { Currency } from "../types";

const currencySymbols: Record<Currency, string> = {
  CNY: "¥",
};

export function formatCurrency(value: number, currency: Currency) {
  return `${currencySymbols[currency]}${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
