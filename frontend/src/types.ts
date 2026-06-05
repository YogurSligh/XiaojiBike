export type Currency = "CNY";

export type FundReturnCurvePoint = {
  date: string;
  returnPct: number;
};

export type FundPortfolioHolding = {
  rank?: number;
  code?: string;
  name: string;
  valuePct?: number;
  shares?: string;
  marketValue?: string;
  reportPeriod?: string;
};

export type FundCandidateData = {
  code: string;
  fetchProfile: "summary" | "detail";
  name?: string;
  fullName?: string;
  fundType?: string;
  shareClass?: string;
  fundCompany?: string;
  fundManagerCompany?: string;
  custodian?: string;
  fundManagers?: string[];
  trackingIndex?: string;
  benchmark?: string;
  purchaseStatus?: string;
  redeemStatus?: string;
  regularInvestmentStatus?: string;
  tradeStatusRaw?: string;
  dailyPurchaseLimitRaw?: string;
  dailyPurchaseLimitCny?: number;
  purchaseStartAmountCny?: number;
  regularInvestmentStartAmountCny?: number;
  buyConfirmDay?: string;
  sellConfirmDay?: string;
  managementFeePct?: number;
  custodyFeePct?: number;
  salesServiceFeePct?: number;
  totalAnnualFeePct?: number;
  maxSubscriptionFeePct?: number;
  subscriptionFeeRaw?: string;
  redemptionFeeRaw?: string;
  assetSizeRaw?: string;
  assetSizeYi?: number;
  assetSizeDate?: string;
  shareSizeRaw?: string;
  shareSizeYi?: number;
  shareSizeDate?: string;
  inceptionDate?: string;
  yearsSinceInception?: number;
  return1yPct?: number;
  return3yPct?: number;
  return5yPct?: number;
  return10yPct?: number;
  returnSinceInceptionPct?: number;
  maxDrawdown3yPct?: number;
  maxDrawdown5yPct?: number;
  maxDrawdown10yPct?: number;
  returnCurvePreview: FundReturnCurvePoint[];
  topHoldings: FundPortfolioHolding[];
  dataSources: string[];
  sourceUrls: string[];
  fieldSources: Record<string, string>;
  updatedAt: string;
  fetchStatus: "success" | "partial" | "failed";
  fetchError?: string;
  stale: boolean;
};

export type FundFeeData = {
  code: string;
  subscriptionFeeRaw?: string;
  redemptionFeeRaw?: string;
  fieldSources: Record<string, string>;
  dataSources: string[];
  sourceUrls: string[];
  updatedAt: string;
  fetchStatus: "success" | "partial" | "failed";
  fetchError?: string;
  stale: boolean;
};

export type FundSearchResult = {
  items: FundCandidateData[];
  providerAttempts: string[];
};

export type FundCodeSearchResult = {
  codes: string[];
  totalCount: number;
  nextOffset: number;
  hasMore: boolean;
  providerAttempts: string[];
};
