import type {
  FundCandidateData,
  FundCodeSearchResult,
  FundFeeData,
  FundSearchResult,
} from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

type ApiEnvelope<T> = {
  data: T;
  message?: string;
};

type FundCandidateStreamHandlers = {
  signal?: AbortSignal;
  onStart?: (payload: { total: number }) => void;
  onAttempt?: (message: string) => void;
  onItem?: (fund: FundCandidateData, payload: { index?: number; completed: number; total: number }) => void;
  onDone?: (payload: { completed: number; total: number }) => void;
};

type RawFundCandidateData = {
  code: string;
  fetch_profile?: "summary" | "detail";
  name?: string | null;
  full_name?: string | null;
  fund_type?: string | null;
  share_class?: string | null;
  fund_company?: string | null;
  fund_manager_company?: string | null;
  custodian?: string | null;
  fund_managers?: string[] | null;
  tracking_index?: string | null;
  benchmark?: string | null;
  purchase_status?: string | null;
  redeem_status?: string | null;
  regular_investment_status?: string | null;
  trade_status_raw?: string | null;
  daily_purchase_limit_raw?: string | null;
  daily_purchase_limit_cny?: number | string | null;
  purchase_start_amount_cny?: number | string | null;
  regular_investment_start_amount_cny?: number | string | null;
  buy_confirm_day?: string | null;
  sell_confirm_day?: string | null;
  management_fee_pct?: number | string | null;
  custody_fee_pct?: number | string | null;
  sales_service_fee_pct?: number | string | null;
  total_annual_fee_pct?: number | string | null;
  max_subscription_fee_pct?: number | string | null;
  subscription_fee_raw?: string | null;
  redemption_fee_raw?: string | null;
  asset_size_raw?: string | null;
  asset_size_yi?: number | string | null;
  asset_size_date?: string | null;
  share_size_raw?: string | null;
  share_size_yi?: number | string | null;
  share_size_date?: string | null;
  inception_date?: string | null;
  years_since_inception?: number | string | null;
  return_1y_pct?: number | string | null;
  return_3y_pct?: number | string | null;
  return_5y_pct?: number | string | null;
  return_10y_pct?: number | string | null;
  return_since_inception_pct?: number | string | null;
  max_drawdown_3y_pct?: number | string | null;
  max_drawdown_5y_pct?: number | string | null;
  max_drawdown_10y_pct?: number | string | null;
  return_curve_preview?: Array<{
    date?: string | null;
    return_pct?: number | string | null;
  }> | null;
  top_holdings?: Array<{
    rank?: number | string | null;
    code?: string | null;
    name?: string | null;
    value_pct?: number | string | null;
    shares?: string | null;
    market_value?: string | null;
    report_period?: string | null;
  }> | null;
  data_sources?: string[];
  source_urls?: string[];
  field_sources?: Record<string, string>;
  updated_at: string;
  fetch_status: FundCandidateData["fetchStatus"];
  fetch_error?: string | null;
  stale?: boolean;
};

type RawFundSearchResult = {
  items: RawFundCandidateData[];
  provider_attempts?: string[];
};

type RawFundFeeData = {
  code: string;
  subscription_fee_raw?: string | null;
  redemption_fee_raw?: string | null;
  field_sources?: Record<string, string>;
  data_sources?: string[];
  source_urls?: string[];
  updated_at: string;
  fetch_status: FundFeeData["fetchStatus"];
  fetch_error?: string | null;
  stale?: boolean;
};

type RawFundCodeSearchResult = {
  codes: string[];
  total_count?: number;
  next_offset?: number;
  has_more?: boolean;
  provider_attempts?: string[];
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const body: BodyInit | undefined =
    options.body === undefined ? undefined : JSON.stringify(options.body);

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    body,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `请求失败：${response.status}`);
  }

  return unwrapApiData((await response.json()) as T | ApiEnvelope<T>);
}

function unwrapApiData<T>(response: T | ApiEnvelope<T>): T {
  if (
    response &&
    typeof response === "object" &&
    "data" in response &&
    Object.keys(response).every((key) => key === "data" || key === "message")
  ) {
    return (response as ApiEnvelope<T>).data;
  }

  return response as T;
}

function streamFundCandidates(
  payload: {
    query?: string;
    codes?: string[];
    limit?: number;
    forceRefresh?: boolean;
  },
  handlers: FundCandidateStreamHandlers,
): Promise<void> {
  const params = new URLSearchParams({
    limit: String(payload.limit ?? 20),
  });
  if (payload.query) params.set("query", payload.query);
  if (payload.forceRefresh) params.set("force_refresh", "true");
  for (const code of payload.codes ?? []) {
    params.append("codes", code);
  }

  return new Promise((resolve, reject) => {
    if (handlers.signal?.aborted) {
      resolve();
      return;
    }

    const source = new EventSource(`${API_BASE_URL}/funds/candidates/stream?${params.toString()}`);
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      source.close();
      handlers.signal?.removeEventListener("abort", abort);
      resolve();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      source.close();
      handlers.signal?.removeEventListener("abort", abort);
      reject(error);
    };
    const abort = () => finish();

    handlers.signal?.addEventListener("abort", abort, { once: true });
    source.addEventListener("start", (event) => {
      const data = parseSseData<{ total?: number }>(event);
      handlers.onStart?.({ total: data.total ?? 0 });
    });
    source.addEventListener("attempt", (event) => {
      const data = parseSseData<{ message?: string }>(event);
      if (data.message) handlers.onAttempt?.(data.message);
    });
    source.addEventListener("item", (event) => {
      const data = parseSseData<{
        index?: number;
        completed?: number;
        total?: number;
        item?: RawFundCandidateData | null;
      }>(event);
      if (!data.item) return;
      handlers.onItem?.(normalizeFundCandidate(data.item), {
        index: data.index,
        completed: data.completed ?? 0,
        total: data.total ?? 0,
      });
    });
    source.addEventListener("done", (event) => {
      const data = parseSseData<{ completed?: number; total?: number }>(event);
      handlers.onDone?.({ completed: data.completed ?? 0, total: data.total ?? 0 });
      finish();
    });
    source.addEventListener("stream_error", (event) => {
      const data = parseSseData<{ message?: string }>(event);
      fail(new Error(data.message || "基金流式加载失败"));
    });
    source.onerror = () => {
      if (!handlers.signal?.aborted) {
        fail(new Error("基金流式连接中断"));
      }
    };
  });
}

function parseSseData<T>(event: Event): T {
  const message = event as MessageEvent<string>;
  return JSON.parse(message.data) as T;
}

function optionalText(value: string | null | undefined): string | undefined {
  return value === null || value === undefined || value === "" ? undefined : value;
}

function optionalNumber(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function normalizeFundCandidate(result: RawFundCandidateData): FundCandidateData {
  return {
    code: result.code,
    fetchProfile: result.fetch_profile ?? "detail",
    name: optionalText(result.name),
    fullName: optionalText(result.full_name),
    fundType: optionalText(result.fund_type),
    shareClass: optionalText(result.share_class),
    fundCompany: optionalText(result.fund_company),
    fundManagerCompany: optionalText(result.fund_manager_company),
    custodian: optionalText(result.custodian),
    fundManagers: result.fund_managers ?? undefined,
    trackingIndex: optionalText(result.tracking_index),
    benchmark: optionalText(result.benchmark),
    purchaseStatus: optionalText(result.purchase_status),
    redeemStatus: optionalText(result.redeem_status),
    regularInvestmentStatus: optionalText(result.regular_investment_status),
    tradeStatusRaw: optionalText(result.trade_status_raw),
    dailyPurchaseLimitRaw: optionalText(result.daily_purchase_limit_raw),
    dailyPurchaseLimitCny: optionalNumber(result.daily_purchase_limit_cny),
    purchaseStartAmountCny: optionalNumber(result.purchase_start_amount_cny),
    regularInvestmentStartAmountCny: optionalNumber(result.regular_investment_start_amount_cny),
    buyConfirmDay: optionalText(result.buy_confirm_day),
    sellConfirmDay: optionalText(result.sell_confirm_day),
    managementFeePct: optionalNumber(result.management_fee_pct),
    custodyFeePct: optionalNumber(result.custody_fee_pct),
    salesServiceFeePct: optionalNumber(result.sales_service_fee_pct),
    totalAnnualFeePct: optionalNumber(result.total_annual_fee_pct),
    maxSubscriptionFeePct: optionalNumber(result.max_subscription_fee_pct),
    subscriptionFeeRaw: optionalText(result.subscription_fee_raw),
    redemptionFeeRaw: optionalText(result.redemption_fee_raw),
    assetSizeRaw: optionalText(result.asset_size_raw),
    assetSizeYi: optionalNumber(result.asset_size_yi),
    assetSizeDate: optionalText(result.asset_size_date),
    shareSizeRaw: optionalText(result.share_size_raw),
    shareSizeYi: optionalNumber(result.share_size_yi),
    shareSizeDate: optionalText(result.share_size_date),
    inceptionDate: optionalText(result.inception_date),
    yearsSinceInception: optionalNumber(result.years_since_inception),
    return1yPct: optionalNumber(result.return_1y_pct),
    return3yPct: optionalNumber(result.return_3y_pct),
    return5yPct: optionalNumber(result.return_5y_pct),
    return10yPct: optionalNumber(result.return_10y_pct),
    returnSinceInceptionPct: optionalNumber(result.return_since_inception_pct),
    maxDrawdown3yPct: optionalNumber(result.max_drawdown_3y_pct),
    maxDrawdown5yPct: optionalNumber(result.max_drawdown_5y_pct),
    maxDrawdown10yPct: optionalNumber(result.max_drawdown_10y_pct),
    returnCurvePreview: (result.return_curve_preview ?? [])
      .map((point) => ({
        date: optionalText(point.date),
        returnPct: optionalNumber(point.return_pct),
      }))
      .filter((point): point is { date: string; returnPct: number } => (
        point.date !== undefined && point.returnPct !== undefined
      )),
    topHoldings: (result.top_holdings ?? []).flatMap((holding) => {
      const name = optionalText(holding.name);
      if (!name) return [];
      return [{
        rank: optionalNumber(holding.rank),
        code: optionalText(holding.code),
        name,
        valuePct: optionalNumber(holding.value_pct),
        shares: optionalText(holding.shares),
        marketValue: optionalText(holding.market_value),
        reportPeriod: optionalText(holding.report_period),
      }];
    }),
    dataSources: result.data_sources ?? [],
    sourceUrls: result.source_urls ?? [],
    fieldSources: result.field_sources ?? {},
    updatedAt: result.updated_at,
    fetchStatus: result.fetch_status,
    fetchError: optionalText(result.fetch_error),
    stale: result.stale ?? false,
  };
}

function normalizeFundFeeData(result: RawFundFeeData): FundFeeData {
  return {
    code: result.code,
    subscriptionFeeRaw: optionalText(result.subscription_fee_raw),
    redemptionFeeRaw: optionalText(result.redemption_fee_raw),
    fieldSources: result.field_sources ?? {},
    dataSources: result.data_sources ?? [],
    sourceUrls: result.source_urls ?? [],
    updatedAt: result.updated_at,
    fetchStatus: result.fetch_status,
    fetchError: optionalText(result.fetch_error),
    stale: result.stale ?? false,
  };
}

export const apiClient = {
  fundCandidates: async (payload: {
    query?: string;
    codes?: string[];
    limit?: number;
    forceRefresh?: boolean;
  } = {}): Promise<FundSearchResult> => {
    const params = new URLSearchParams({
      limit: String(payload.limit ?? 20),
    });
    if (payload.query) params.set("query", payload.query);
    if (payload.forceRefresh) params.set("force_refresh", "true");
    for (const code of payload.codes ?? []) {
      params.append("codes", code);
    }
    const result = await request<RawFundSearchResult>(`/funds/candidates?${params.toString()}`);
    return {
      items: result.items.map(normalizeFundCandidate),
      providerAttempts: result.provider_attempts ?? [],
    };
  },
  fundCandidateDetail: async (code: string, forceRefresh = false): Promise<FundCandidateData> => {
    const params = new URLSearchParams();
    if (forceRefresh) params.set("force_refresh", "true");
    const query = params.toString();
    const result = await request<RawFundCandidateData>(
      `/funds/${encodeURIComponent(code)}${query ? `?${query}` : ""}`,
    );
    return normalizeFundCandidate(result);
  },
  fundCandidateFees: async (code: string, forceRefresh = false): Promise<FundFeeData> => {
    const params = new URLSearchParams();
    if (forceRefresh) params.set("force_refresh", "true");
    const query = params.toString();
    const result = await request<RawFundFeeData>(
      `/funds/${encodeURIComponent(code)}/fees${query ? `?${query}` : ""}`,
    );
    return normalizeFundFeeData(result);
  },
  fundCandidateCodes: async (payload: {
    query?: string;
    codes?: string[];
    offset?: number;
    limit?: number;
  } = {}): Promise<FundCodeSearchResult> => {
    const params = new URLSearchParams({
      limit: String(payload.limit ?? 20),
      offset: String(payload.offset ?? 0),
    });
    if (payload.query) params.set("query", payload.query);
    for (const code of payload.codes ?? []) {
      params.append("codes", code);
    }
    const result = await request<RawFundCodeSearchResult>(`/funds/codes?${params.toString()}`);
    return {
      codes: result.codes,
      totalCount: result.total_count ?? result.codes.length,
      nextOffset: result.next_offset ?? result.codes.length,
      hasMore: result.has_more ?? false,
      providerAttempts: result.provider_attempts ?? [],
    };
  },
  streamFundCandidates: (
    payload: {
      query?: string;
      codes?: string[];
      limit?: number;
      forceRefresh?: boolean;
    },
    handlers: FundCandidateStreamHandlers,
  ): Promise<void> => streamFundCandidates(payload, handlers),
  refreshFundCandidates: async (payload: {
    query?: string;
    codes?: string[];
    limit?: number;
    forceRefresh?: boolean;
  }): Promise<FundSearchResult> => {
    const result = await request<RawFundSearchResult>("/funds/refresh", {
      method: "POST",
      body: {
        query: payload.query,
        codes: payload.codes ?? [],
        limit: payload.limit ?? 20,
        force_refresh: payload.forceRefresh ?? true,
      },
    });
    return {
      items: result.items.map(normalizeFundCandidate),
      providerAttempts: result.provider_attempts ?? [],
    };
  },
};
