import {
  App,
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Progress,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  BarChartOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { apiClient } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import type { FundCandidateData, FundFeeData, FundReturnCurvePoint } from "../types";
import { formatCurrency } from "../utils/format";

type TradeStatusFilter = "open" | "restricted" | "paused";
type FundTableRow = FundCandidateData & {
  isLoadingDetails?: boolean;
};
type ReturnSortKey =
  | "return1yPct"
  | "return3yPct"
  | "return5yPct"
  | "return10yPct"
  | "returnSinceInceptionPct";
type DrawdownSortKey =
  | "maxDrawdown3yPct"
  | "maxDrawdown5yPct"
  | "maxDrawdown10yPct";
type FundSortKey =
  | "name"
  | "fundType"
  | "fundCompany"
  | "assetSizeYi"
  | "yearsSinceInception"
  | ReturnSortKey
  | DrawdownSortKey
  | "dailyPurchaseLimit"
  | "purchaseStatus"
  | "totalAnnualFeePct";
type FundSortDirection = "asc" | "desc";
type FundSortRule = {
  key: FundSortKey;
  direction: FundSortDirection;
};
type CompareDirection = "higher" | "lower";
type CompareCell = {
  display: string;
  score?: number;
};
type CompareRow = {
  label: string;
  direction?: CompareDirection;
  values: Record<string, CompareCell>;
};
const FUND_SEARCH_PAGE_SIZE = 20;
const RETURN_SORT_KEYS: ReturnSortKey[] = [
  "return1yPct",
  "return3yPct",
  "return5yPct",
  "return10yPct",
  "returnSinceInceptionPct",
];
const DRAWDOWN_SORT_KEYS: DrawdownSortKey[] = [
  "maxDrawdown3yPct",
  "maxDrawdown5yPct",
  "maxDrawdown10yPct",
];

export function FundScreenerPage() {
  const { message } = App.useApp();
  const [query, setQuery] = useState("");
  const [tradeStatusFilter, setTradeStatusFilter] = useState<TradeStatusFilter[]>([]);
  const [funds, setFunds] = useState<FundTableRow[]>([]);
  const [progressTotal, setProgressTotal] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const [activeQuery, setActiveQuery] = useState("");
  const [compareCodes, setCompareCodes] = useState<string[]>([]);
  const [selectedFund, setSelectedFund] = useState<FundCandidateData | null>(null);
  const [loadingFundDetailCode, setLoadingFundDetailCode] = useState<string | null>(null);
  const [fundDetailError, setFundDetailError] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadStatusText, setLoadStatusText] = useState("等待搜索");
  const [feeLoadingCodes, setFeeLoadingCodes] = useState<Set<string>>(new Set());
  const [sortRules, setSortRules] = useState<FundSortRule[]>([]);
  const loadRunRef = useRef(0);
  const streamAbortRef = useRef<AbortController | null>(null);
  const detailFetchAttemptedCodesRef = useRef<Set<string>>(new Set());
  const feeFetchAttemptedCodesRef = useRef<Set<string>>(new Set());
  const feeFetchRetryCountsRef = useRef<Map<string, number>>(new Map());
  const feeQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const initialLoadTimer = window.setTimeout(() => {
      void loadFunds({});
    }, 100);
    return () => {
      window.clearTimeout(initialLoadTimer);
      streamAbortRef.current?.abort();
    };
  }, []);

  const compareFunds = useMemo(
    () =>
      compareCodes
        .map((code) => funds.find((fund) => fund.code === code && !fund.isLoadingDetails))
        .filter(Boolean) as FundCandidateData[],
    [compareCodes, funds],
  );

  const visibleFunds = useMemo(
    () => {
      const filtered = funds.filter((fund) => matchesTradeStatusFilter(fund, tradeStatusFilter));
      return filtered.sort((a, b) => compareFundsBySortRules(a, b, sortRules) || sortByPurchaseAvailability(a, b));
    },
    [funds, sortRules, tradeStatusFilter],
  );
  const loadedFundCount = useMemo(() => countLoadedFunds(funds), [funds]);

  function toggleSortRule(key: FundSortKey, defaultDirection: FundSortDirection = "asc") {
    setSortRules((current) => {
      const existingIndex = current.findIndex((rule) => rule.key === key);
      if (existingIndex < 0) {
        return [...current, { key, direction: defaultDirection }];
      }
      const next = [...current];
      const existing = next[existingIndex];
      if (existing.direction === defaultDirection) {
        next[existingIndex] = { ...existing, direction: oppositeSortDirection(defaultDirection) };
        return next;
      }
      return next.filter((rule) => rule.key !== key);
    });
  }

  function sortableTitle(label: string, key: FundSortKey, defaultDirection: FundSortDirection = "asc") {
    const ruleIndex = sortRules.findIndex((rule) => rule.key === key);
    const rule = ruleIndex >= 0 ? sortRules[ruleIndex] : undefined;
    const isActive = Boolean(rule);
    return (
      <button
        type="button"
        onClick={() => toggleSortRule(key, defaultDirection)}
        style={{
          alignItems: "center",
          background: isActive ? "#e6fffb" : "transparent",
          border: isActive ? "1px solid #5cdbd3" : "1px solid transparent",
          borderRadius: 6,
          color: isActive ? "#006d75" : "inherit",
          cursor: "pointer",
          display: "inline-flex",
          font: "inherit",
          fontWeight: isActive ? 700 : 600,
          gap: 6,
          lineHeight: 1.4,
          margin: "-4px 0",
          padding: "3px 6px",
          whiteSpace: "nowrap",
        }}
        title="点击切换排序：升序、降序、取消；多列按点击顺序共同排序"
      >
        <span>{label}</span>
        {rule ? (
          <Tag color="cyan" style={{ marginInlineEnd: 0 }}>
            {ruleIndex + 1}
            {rule.direction === "asc" ? "↑" : "↓"}
          </Tag>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>↕</Typography.Text>
        )}
      </button>
    );
  }

  function sortedCellStyle(key: FundSortKey) {
    const ruleIndex = sortRules.findIndex((rule) => rule.key === key);
    if (ruleIndex < 0) return {};
    return {
      style: {
        background: ruleIndex === 0 ? "#f0fffe" : "#fbffff",
      },
    };
  }

  function appendProgress(text: string) {
    console.info(`[基金筛选] ${text}`);
    setLoadStatusText(text);
  }

  async function loadFunds(options: {
    query?: string;
    forceRefresh?: boolean;
  }) {
    streamAbortRef.current?.abort();
    const streamAbortController = new AbortController();
    streamAbortRef.current = streamAbortController;
    const runId = loadRunRef.current + 1;
    loadRunRef.current = runId;
    feeFetchAttemptedCodesRef.current = new Set();
    feeFetchRetryCountsRef.current = new Map();
    feeQueueRef.current = Promise.resolve();
    setIsLoading(true);
    setFeeLoadingCodes(new Set());
    const searchQuery = options.query ?? "";
    let nextFunds: FundTableRow[] = [];
    let currentOffset = 0;
    let latestTotalCount = 0;
    let shouldContinue = false;
    setFunds([]);
    setProgressTotal(0);
    setTotalMatches(0);
    setActiveQuery(searchQuery);
    setLoadStatusText(searchQuery ? `开始查找：${searchQuery}` : "加载默认候选基金");
    try {
      appendProgress(searchQuery ? `开始查找：${searchQuery}` : "加载默认候选基金");
      do {
        if (loadRunRef.current !== runId) return;
        appendProgress(`读取候选基金代码 offset=${currentOffset}`);
        const codeResult = await apiClient.fundCandidateCodes({
          query: searchQuery,
          offset: currentOffset,
          limit: FUND_SEARCH_PAGE_SIZE,
        });
        if (loadRunRef.current !== runId) return;
        latestTotalCount = codeResult.totalCount;
        shouldContinue = codeResult.hasMore;
        setTotalMatches(codeResult.totalCount);
        setProgressTotal(codeResult.totalCount);
        for (const attempt of codeResult.providerAttempts) {
          appendProgress(attempt);
        }
        if (codeResult.codes.length === 0 && nextFunds.length === 0) {
          message.info("没有找到匹配的基金");
          appendProgress("没有找到匹配的基金");
          return;
        }
        nextFunds = mergeFundRows(nextFunds, codeResult.codes.map(createLoadingFundRow));
        setFunds([...nextFunds]);

        if (codeResult.codes.length > 0) {
          if (loadRunRef.current !== runId) return;
          appendProgress(
            `[${currentOffset + 1}-${currentOffset + codeResult.codes.length}/${codeResult.totalCount}] 流式查询 ${codeResult.codes.length} 只基金`,
          );
          await apiClient.streamFundCandidates(
            {
              codes: codeResult.codes,
              limit: codeResult.codes.length,
              forceRefresh: options.forceRefresh,
            },
            {
              signal: streamAbortController.signal,
              onStart: ({ total }) => {
                appendProgress(`已建立流式连接，本页 ${total} 只基金`);
              },
              onAttempt: appendProgress,
              onItem: (fund, streamProgress) => {
                if (loadRunRef.current !== runId || streamAbortController.signal.aborted) return;
                nextFunds = mergeFundRows(nextFunds, [fund]);
                setFunds([...nextFunds]);
                enqueueFundFeeLoad(fund, runId, false);
                appendProgress(
                  `${fund.code}: 已返回 ${streamProgress.completed} / ${streamProgress.total}`,
                );
              },
            },
          );
          if (loadRunRef.current !== runId) return;
          for (const fund of nextFunds) {
            if (!fund.subscriptionFeeRaw || !fund.redemptionFeeRaw) {
              feeFetchAttemptedCodesRef.current.delete(fund.code);
            }
            enqueueFundFeeLoad(fund, runId, false);
          }
        }

        currentOffset = codeResult.nextOffset;
      } while (shouldContinue);

      if (nextFunds.length === 0) {
        message.info("没有找到匹配的基金");
        appendProgress("没有找到可展示的基金数据");
      } else {
        appendProgress(
          `查找完成，已加载 ${countLoadedFunds(nextFunds)} / ${Math.max(
            latestTotalCount,
            countLoadedFunds(nextFunds),
          )} 只基金`,
        );
        setLoadStatusText("已加载完成");
      }
    } catch (error) {
      appendProgress(error instanceof Error ? `查找失败：${error.message}` : "查找失败");
      message.error(error instanceof Error ? error.message : "基金数据加载失败");
    } finally {
      if (loadRunRef.current === runId) {
        if (streamAbortRef.current === streamAbortController) {
          streamAbortRef.current = null;
        }
        setIsLoading(false);
      }
    }
  }

  function toggleCompare(fund: FundCandidateData) {
    setCompareCodes((current) =>
      current.includes(fund.code)
        ? current.filter((code) => code !== fund.code)
        : [...current, fund.code],
    );
  }

  async function openFundDetail(fund: FundCandidateData) {
    setSelectedFund(fund);
    setFundDetailError(null);
    const shouldFetchDetail =
      fund.fetchProfile !== "detail" ||
      (fund.topHoldings.length === 0 && !detailFetchAttemptedCodesRef.current.has(fund.code));
    if (!shouldFetchDetail) return;
    const forceRefresh = fund.fetchProfile === "detail" && fund.topHoldings.length === 0;
    detailFetchAttemptedCodesRef.current.add(fund.code);
    setLoadingFundDetailCode(fund.code);
    try {
      const detail = await apiClient.fundCandidateDetail(fund.code, forceRefresh);
      setSelectedFund((current) => current?.code === fund.code ? mergeFundRows([current], [detail])[0] : current);
      setFunds((current) => mergeFundRows(current, [detail]));
    } catch (error) {
      detailFetchAttemptedCodesRef.current.delete(fund.code);
      const text = error instanceof Error ? error.message : "基金详情加载失败";
      setFundDetailError(text);
      message.error(text);
    } finally {
      setLoadingFundDetailCode((current) => current === fund.code ? null : current);
    }
  }

  function enqueueFundFeeLoad(fund: FundCandidateData, runId: number, forceRefresh: boolean) {
    if (fund.subscriptionFeeRaw && fund.redemptionFeeRaw && !forceRefresh) return;
    if (feeFetchAttemptedCodesRef.current.has(fund.code)) return;
    feeFetchAttemptedCodesRef.current.add(fund.code);
    setFeeLoadingCodes((current) => new Set(current).add(fund.code));

    feeQueueRef.current = feeQueueRef.current.then(async () => {
      if (loadRunRef.current !== runId) return;
      try {
        const fees = await apiClient.fundCandidateFees(fund.code, forceRefresh);
        if (loadRunRef.current !== runId) return;
        setFunds((current) => mergeFundFeeRows(current, fees));
        setSelectedFund((current) => current?.code === fund.code ? mergeFundFeeRows([current], fees)[0] : current);
      } catch (error) {
        feeFetchAttemptedCodesRef.current.delete(fund.code);
        const retryCount = feeFetchRetryCountsRef.current.get(fund.code) ?? 0;
        if (loadRunRef.current === runId && retryCount < 1) {
          feeFetchRetryCountsRef.current.set(fund.code, retryCount + 1);
          window.setTimeout(() => enqueueFundFeeLoad(fund, runId, false), 1000);
          return;
        }
        if (loadRunRef.current === runId) {
          appendProgress(
            error instanceof Error ? `${fund.code}: 费率加载失败：${error.message}` : `${fund.code}: 费率加载失败`,
          );
        }
      } finally {
        if (loadRunRef.current === runId) {
          setFeeLoadingCodes((current) => {
            const next = new Set(current);
            next.delete(fund.code);
            return next;
          });
        }
      }
    });
  }

  async function copyFundCode(code: string) {
    try {
      await copyTextToClipboard(code);
      message.success(`已复制基金代码 ${code}`);
    } catch {
      message.error("复制基金代码失败");
    }
  }

  const columns: ColumnsType<FundTableRow> = [
    {
      title: sortableTitle("基金", "name"),
      dataIndex: "name",
      width: 260,
      fixed: "left",
      onCell: () => sortedCellStyle("name"),
      render: (_, fund) => (
        <Space direction="vertical" size={2} className="fund-screener-name-cell">
          <Button
            type="link"
            className="fund-screener-name-button"
            style={{ padding: 0, height: "auto" }}
            disabled={fund.isLoadingDetails}
            onClick={() => void openFundDetail(fund)}
          >
            {fund.name ?? `基金 ${fund.code}`}
          </Button>
          <Space size={6} wrap>
            <Tooltip title="点击复制代码">
              <button
                type="button"
                className="fund-screener-code-tag"
                onClick={(event) => {
                  event.stopPropagation();
                  void copyFundCode(fund.code);
                }}
              >
                {fund.code}
              </button>
            </Tooltip>
            {fund.isLoadingDetails ? <Tag color="processing">加载中</Tag> : null}
            {fund.shareClass ? <Tag>{fund.shareClass}</Tag> : null}
            {fund.stale ? <Tag color="gold">缓存</Tag> : null}
          </Space>
        </Space>
      ),
    },
    { title: sortableTitle("类型", "fundType"), dataIndex: "fundType", width: 150, onCell: () => sortedCellStyle("fundType"), render: renderClampedText },
    { title: sortableTitle("公司", "fundCompany"), dataIndex: "fundCompany", width: 130, onCell: () => sortedCellStyle("fundCompany"), render: renderClampedText },
    {
      title: sortableTitle("规模", "assetSizeYi", "desc"),
      dataIndex: "assetSizeYi",
      width: 130,
      onCell: () => sortedCellStyle("assetSizeYi"),
      render: (_, fund) => (
        <Tooltip title={fund.assetSizeRaw}>
          <span className="fund-screener-cell-clamp">
            {fund.assetSizeYi == null ? "-" : `${fund.assetSizeYi} 亿元`}
          </span>
        </Tooltip>
      ),
    },
    {
      title: sortableTitle("年限", "yearsSinceInception", "desc"),
      dataIndex: "yearsSinceInception",
      width: 96,
      onCell: () => sortedCellStyle("yearsSinceInception"),
      render: (value) => (value == null ? "-" : `${value} 年`),
    },
    {
      title: sortableTitle("近1年", "return1yPct", "desc"),
      dataIndex: "return1yPct",
      width: 132,
      align: "right",
      onCell: () => sortedCellStyle("return1yPct"),
      render: (_, fund) => renderReturnCell(fund.return1yPct, fund, "return_1y_pct", 1),
    },
    {
      title: sortableTitle("近3年", "return3yPct", "desc"),
      dataIndex: "return3yPct",
      width: 132,
      align: "right",
      onCell: () => sortedCellStyle("return3yPct"),
      render: (_, fund) => renderReturnCell(fund.return3yPct, fund, "return_3y_pct", 3),
    },
    {
      title: sortableTitle("近5年", "return5yPct", "desc"),
      dataIndex: "return5yPct",
      width: 132,
      align: "right",
      onCell: () => sortedCellStyle("return5yPct"),
      render: (_, fund) => renderReturnCell(fund.return5yPct, fund, "return_5y_pct", 5),
    },
    {
      title: sortableTitle("近10年", "return10yPct", "desc"),
      dataIndex: "return10yPct",
      width: 136,
      align: "right",
      onCell: () => sortedCellStyle("return10yPct"),
      render: (_, fund) => renderReturnCell(fund.return10yPct, fund, "return_10y_pct", 10),
    },
    {
      title: sortableTitle("成立来", "returnSinceInceptionPct", "desc"),
      dataIndex: "returnSinceInceptionPct",
      width: 136,
      align: "right",
      onCell: () => sortedCellStyle("returnSinceInceptionPct"),
      render: (_, fund) => renderReturnCell(fund.returnSinceInceptionPct, fund, "return_since_inception_pct", "all"),
    },
    {
      title: sortableTitle("3年回撤", "maxDrawdown3yPct", "desc"),
      dataIndex: "maxDrawdown3yPct",
      width: 104,
      align: "right",
      onCell: () => sortedCellStyle("maxDrawdown3yPct"),
      render: (_, fund) => renderDrawdownCell(fund.maxDrawdown3yPct, fund, "max_drawdown_3y_pct"),
    },
    {
      title: sortableTitle("5年回撤", "maxDrawdown5yPct", "desc"),
      dataIndex: "maxDrawdown5yPct",
      width: 104,
      align: "right",
      onCell: () => sortedCellStyle("maxDrawdown5yPct"),
      render: (_, fund) => renderDrawdownCell(fund.maxDrawdown5yPct, fund, "max_drawdown_5y_pct"),
    },
    {
      title: sortableTitle("10年回撤", "maxDrawdown10yPct", "desc"),
      dataIndex: "maxDrawdown10yPct",
      width: 108,
      align: "right",
      onCell: () => sortedCellStyle("maxDrawdown10yPct"),
      render: (_, fund) => renderDrawdownCell(fund.maxDrawdown10yPct, fund, "max_drawdown_10y_pct"),
    },
    {
      title: sortableTitle("限购", "dailyPurchaseLimit", "desc"),
      dataIndex: "dailyPurchaseLimitCny",
      width: 150,
      onCell: () => sortedCellStyle("dailyPurchaseLimit"),
      render: (_, fund) => (
        <Tooltip title={fund.tradeStatusRaw}>
          <span className="fund-screener-cell-clamp">
            {fund.dailyPurchaseLimitCny == null
              ? fund.dailyPurchaseLimitRaw ?? "-"
              : formatCurrency(fund.dailyPurchaseLimitCny, "CNY")}
          </span>
        </Tooltip>
      ),
    },
    {
      title: sortableTitle("交易状态", "purchaseStatus"),
      dataIndex: "purchaseStatus",
      width: 180,
      onCell: () => sortedCellStyle("purchaseStatus"),
      render: (_, fund) => (
        <Space size={4} wrap className="fund-screener-status-cell">
          {statusTag(fund.purchaseStatus)}
          {statusTag(fund.redeemStatus)}
          {fund.regularInvestmentStatus ? <Tag>{fund.regularInvestmentStatus}</Tag> : null}
        </Space>
      ),
    },
    {
      title: sortableTitle("年费率", "totalAnnualFeePct"),
      dataIndex: "totalAnnualFeePct",
      width: 110,
      onCell: () => sortedCellStyle("totalAnnualFeePct"),
      render: (_, fund) =>
        fund.totalAnnualFeePct == null ? "-" : (
          <Tooltip title={`管理 ${pct(fund.managementFeePct)} / 托管 ${pct(fund.custodyFeePct)} / 销售 ${pct(fund.salesServiceFeePct)}`}>
            <span className="fund-screener-cell-clamp">{pct(fund.totalAnnualFeePct)}</span>
          </Tooltip>
        ),
    },
    {
      title: "买入费率",
      dataIndex: "subscriptionFeeRaw",
      width: 170,
      render: (_, fund) => renderFeeRule(fund.subscriptionFeeRaw, feeLoadingCodes.has(fund.code)),
    },
    {
      title: "卖出费率",
      dataIndex: "redemptionFeeRaw",
      width: 170,
      render: (_, fund) => renderFeeRule(fund.redemptionFeeRaw, feeLoadingCodes.has(fund.code)),
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_, fund) => (
        <Space>
          <Button
            icon={<BarChartOutlined />}
            disabled={fund.isLoadingDetails}
            onClick={() => toggleCompare(fund)}
          >
            {compareCodes.includes(fund.code) ? "移出比较" : "加入比较"}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="基金筛选"
        description="检索中国场外基金，核对份额类别、规模、费率、交易状态、限购信息、收益和回撤，再加入比较列表。"
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              loading={isLoading}
              onClick={() => loadFunds({ query, forceRefresh: true })}
            >
              刷新数据
            </Button>
            <Button icon={<BarChartOutlined />} disabled={compareFunds.length === 0} onClick={() => setCompareOpen(true)}>
              比较列表 {compareFunds.length}
            </Button>
          </Space>
        }
      />

      <Alert
        showIcon
        type="warning"
        message="开源学习项目，不提供投资建议"
        description="页面中的基金数据、排序、筛选、颜色高亮和比较结果仅用于技术演示与个人研究，不构成买入、卖出、持有、定投、赎回、基金评价或基金销售建议。公开部署前请自行确认数据源授权、备案、隐私和安全要求。"
        style={{ marginBottom: 10 }}
      />

      <Card
        size="small"
        styles={{ body: { padding: "12px 14px" } }}
        style={{ marginBottom: 10 }}
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Space.Compact style={{ width: "100%" }}>
            <Input.Search
              value={query}
              allowClear
              enterButton={
                <Button type="primary" icon={<SearchOutlined />}>
                  搜索
                </Button>
              }
              placeholder="输入代码、简称或关键词；逗号分隔多关键字，例如：纳斯达克,QDII"
              onChange={(event) => setQuery(event.target.value)}
              onSearch={(value) => loadFunds({ query: value })}
            />
            <Select<TradeStatusFilter[]>
              mode="multiple"
              maxTagCount="responsive"
              allowClear
              value={tradeStatusFilter}
              placeholder="全部状态"
              style={{ width: 168 }}
              options={[
                { label: "开放申购", value: "open" },
                { label: "限购/限大额", value: "restricted" },
                { label: "暂停申购", value: "paused" },
              ]}
              onChange={setTradeStatusFilter}
            />
          </Space.Compact>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(180px, auto) minmax(160px, 1fr) auto",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Typography.Text type="secondary" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
              已加载 {loadedFundCount} / 共 {totalMatches || loadedFundCount} 只
              {tradeStatusFilter.length > 0 ? ` · 筛选 ${visibleFunds.length} 只` : ""}
            </Typography.Text>
            <Progress
              percent={progressTotal > 0 ? Math.round((loadedFundCount / progressTotal) * 100) : 0}
              size="small"
              status={isLoading ? "active" : "success"}
              showInfo={false}
              style={{ marginBottom: 0 }}
            />
            <Space size={8}>
              <Typography.Text
                type={isLoading ? "warning" : "secondary"}
                style={{
                  display: "inline-block",
                  fontSize: 12,
                  maxWidth: 360,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={loadStatusText}
              >
                {isLoading ? loadStatusText : activeQuery || totalMatches > 0 ? "已加载完成" : "等待搜索"}
              </Typography.Text>
            </Space>
          </div>
        </Space>
      </Card>

      <Table
        className="fund-screener-table"
        rowKey="code"
        columns={columns}
        dataSource={visibleFunds}
        scroll={{ x: 2620 }}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        locale={{ emptyText: <Empty description="暂无基金数据" /> }}
      />

      <FundDetailDrawer
        fund={selectedFund}
        loading={selectedFund ? loadingFundDetailCode === selectedFund.code : false}
        error={fundDetailError}
        onClose={() => {
          setSelectedFund(null);
          setFundDetailError(null);
        }}
      />
      <CompareDrawer
        funds={compareFunds}
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        onRemove={(code) => setCompareCodes((current) => current.filter((item) => item !== code))}
        onClear={() => setCompareCodes([])}
      />

    </>
  );
}

function FundDetailDrawer({
  fund,
  loading,
  error,
  onClose,
}: {
  fund: FundCandidateData | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <Drawer title={fund?.name ?? "基金详情"} open={Boolean(fund)} width={720} onClose={onClose}>
      {fund ? (
        <Space direction="vertical" size={18} style={{ width: "100%" }}>
          {loading ? (
            <Alert
              type="info"
              showIcon
              message="正在补全详情"
              description="完整费率说明和前十大持仓会在详情页按需抓取。"
            />
          ) : null}
          {error ? <Alert type="warning" showIcon message="详情加载失败" description={error} /> : null}
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="代码">{fund.code}</Descriptions.Item>
            <Descriptions.Item label="份额类别">{fund.shareClass ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="基金类型">{fund.fundType ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="基金公司">{fund.fundCompany ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="托管人">{fund.custodian ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="基金经理">{fund.fundManagers?.join("、") ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="成立日期">{fund.inceptionDate ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="成立年限">{fund.yearsSinceInception == null ? "-" : `${fund.yearsSinceInception} 年`}</Descriptions.Item>
            <Descriptions.Item label="近1年收益">{returnPctText(fund.return1yPct)}</Descriptions.Item>
            <Descriptions.Item label="近3年收益">{returnPctText(fund.return3yPct)}</Descriptions.Item>
            <Descriptions.Item label="近5年收益">{returnPctText(fund.return5yPct)}</Descriptions.Item>
            <Descriptions.Item label="近10年收益">{returnPctText(fund.return10yPct)}</Descriptions.Item>
            <Descriptions.Item label="成立来收益" span={2}>{returnPctText(fund.returnSinceInceptionPct)}</Descriptions.Item>
            <Descriptions.Item label="3年最大回撤">{returnPctText(fund.maxDrawdown3yPct)}</Descriptions.Item>
            <Descriptions.Item label="5年最大回撤">{returnPctText(fund.maxDrawdown5yPct)}</Descriptions.Item>
            <Descriptions.Item label="10年最大回撤" span={2}>{returnPctText(fund.maxDrawdown10yPct)}</Descriptions.Item>
            <Descriptions.Item label="资产规模">{fund.assetSizeRaw ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="份额规模">{fund.shareSizeRaw ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="交易状态" span={2}>{fund.tradeStatusRaw ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="申购起点">{moneyOrText(fund.purchaseStartAmountCny)}</Descriptions.Item>
            <Descriptions.Item label="日限购">
              {fund.dailyPurchaseLimitCny == null
                ? fund.dailyPurchaseLimitRaw ?? "-"
                : formatCurrency(fund.dailyPurchaseLimitCny, "CNY")}
            </Descriptions.Item>
            <Descriptions.Item label="管理费">{pct(fund.managementFeePct)}</Descriptions.Item>
            <Descriptions.Item label="托管费">{pct(fund.custodyFeePct)}</Descriptions.Item>
            <Descriptions.Item label="销售服务费">{pct(fund.salesServiceFeePct)}</Descriptions.Item>
            <Descriptions.Item label="合计年费率">{pct(fund.totalAnnualFeePct)}</Descriptions.Item>
            <Descriptions.Item label="买入费率" span={2}>{fund.subscriptionFeeRaw ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="卖出费率" span={2}>{fund.redemptionFeeRaw ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="跟踪标的" span={2}>{fund.trackingIndex ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="业绩基准" span={2}>{fund.benchmark ?? "-"}</Descriptions.Item>
          </Descriptions>
          <Card size="small" title="收益走势预览">
            {fund.returnCurvePreview.length > 1 ? (
              <div className="fund-screener-detail-chart">
                <ReturnSparkline
                  points={fund.returnCurvePreview}
                  width={640}
                  height={160}
                  stroke={returnColor(fund.returnSinceInceptionPct)}
                />
              </div>
            ) : (
              <Empty description="暂无收益走势数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
          <Card
            size="small"
            title="前十大持仓"
            extra={
              fund.topHoldings[0]?.reportPeriod ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {fund.topHoldings[0].reportPeriod}
                </Typography.Text>
              ) : null
            }
          >
            {loading ? (
              <div style={{ padding: "24px 0", textAlign: "center" }}>
                <Spin />
              </div>
            ) : fund.topHoldings.length > 0 ? (
              <Table
                rowKey={(holding) => `${holding.rank ?? ""}-${holding.code ?? ""}-${holding.name}`}
                size="small"
                pagination={false}
                dataSource={fund.topHoldings}
                columns={[
                  {
                    title: "序号",
                    dataIndex: "rank",
                    width: 64,
                    render: (value) => value ?? "-",
                  },
                  {
                    title: "代码",
                    dataIndex: "code",
                    width: 100,
                    render: (value) => value ? <Typography.Text code>{value}</Typography.Text> : "-",
                  },
                  {
                    title: "名称",
                    dataIndex: "name",
                    render: (value) => <Typography.Text>{value}</Typography.Text>,
                  },
                  {
                    title: "占净值",
                    dataIndex: "valuePct",
                    width: 96,
                    align: "right",
                    render: (value) => pct(value),
                  },
                  {
                    title: "持股数",
                    dataIndex: "shares",
                    width: 110,
                    align: "right",
                    render: (value) => value ?? "-",
                  },
                  {
                    title: "市值",
                    dataIndex: "marketValue",
                    width: 120,
                    align: "right",
                    render: (value) => value ?? "-",
                  },
                ]}
              />
            ) : (
              <Empty
                description={fund.fetchProfile === "detail" ? "暂无持仓披露数据" : "打开详情后加载持仓数据"}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
          </Card>
          <Card size="small" title="数据来源">
            <Space direction="vertical" size={6}>
              {fund.dataSources.map((source) => <Tag key={source}>{source}</Tag>)}
              {fund.sourceUrls.map((url) => (
                <Typography.Link key={url} href={url} target="_blank" rel="noreferrer">
                  {url}
                </Typography.Link>
              ))}
              {fund.fetchError ? <Typography.Text type="warning">抓取提示：{fund.fetchError}</Typography.Text> : null}
            </Space>
          </Card>
        </Space>
      ) : null}
    </Drawer>
  );
}

function CompareDrawer({
  funds,
  open,
  onClose,
  onRemove,
  onClear,
}: {
  funds: FundCandidateData[];
  open: boolean;
  onClose: () => void;
  onRemove: (code: string) => void;
  onClear: () => void;
}) {
  const rows = [
    textCompareRow(funds, "代码", (fund) => fund.code),
    textCompareRow(funds, "份额类别", (fund) => fund.shareClass),
    textCompareRow(funds, "基金类型", (fund) => fund.fundType),
    textCompareRow(funds, "公司", (fund) => fund.fundCompany),
    metricCompareRow(
      funds,
      "资产规模",
      (fund) => fund.assetSizeRaw,
      (fund) => fund.assetSizeYi,
      "higher",
    ),
    metricCompareRow(
      funds,
      "成立年限",
      (fund) => (fund.yearsSinceInception == null ? undefined : `${fund.yearsSinceInception} 年`),
      (fund) => fund.yearsSinceInception,
      "higher",
    ),
    metricCompareRow(funds, "近1年收益", (fund) => returnPctText(fund.return1yPct), (fund) => fund.return1yPct, "higher"),
    metricCompareRow(funds, "近3年收益", (fund) => returnPctText(fund.return3yPct), (fund) => fund.return3yPct, "higher"),
    metricCompareRow(funds, "近5年收益", (fund) => returnPctText(fund.return5yPct), (fund) => fund.return5yPct, "higher"),
    metricCompareRow(funds, "近10年收益", (fund) => returnPctText(fund.return10yPct), (fund) => fund.return10yPct, "higher"),
    metricCompareRow(
      funds,
      "成立来收益",
      (fund) => returnPctText(fund.returnSinceInceptionPct),
      (fund) => fund.returnSinceInceptionPct,
      "higher",
    ),
    metricCompareRow(
      funds,
      "3年最大回撤",
      (fund) => returnPctText(fund.maxDrawdown3yPct),
      (fund) => fund.maxDrawdown3yPct,
      "higher",
    ),
    metricCompareRow(
      funds,
      "5年最大回撤",
      (fund) => returnPctText(fund.maxDrawdown5yPct),
      (fund) => fund.maxDrawdown5yPct,
      "higher",
    ),
    metricCompareRow(
      funds,
      "10年最大回撤",
      (fund) => returnPctText(fund.maxDrawdown10yPct),
      (fund) => fund.maxDrawdown10yPct,
      "higher",
    ),
    metricCompareRow(
      funds,
      "限购",
      (fund) =>
        fund.dailyPurchaseLimitCny == null
          ? fund.dailyPurchaseLimitRaw
          : formatCurrency(fund.dailyPurchaseLimitCny, "CNY"),
      dailyPurchaseLimitScore,
      "higher",
    ),
    textCompareRow(funds, "申购/赎回", (fund) => [fund.purchaseStatus, fund.redeemStatus].filter(Boolean).join(" / ")),
    metricCompareRow(funds, "管理费", (fund) => pct(fund.managementFeePct), (fund) => fund.managementFeePct, "lower"),
    metricCompareRow(funds, "托管费", (fund) => pct(fund.custodyFeePct), (fund) => fund.custodyFeePct, "lower"),
    metricCompareRow(
      funds,
      "销售服务费",
      (fund) => pct(fund.salesServiceFeePct),
      (fund) => fund.salesServiceFeePct,
      "lower",
    ),
    metricCompareRow(
      funds,
      "合计年费率",
      (fund) => pct(fund.totalAnnualFeePct),
      (fund) => fund.totalAnnualFeePct,
      "lower",
    ),
    metricCompareRow(
      funds,
      "最高申购费",
      (fund) => pct(fund.maxSubscriptionFeePct),
      (fund) => fund.maxSubscriptionFeePct,
      "lower",
    ),
    textCompareRow(funds, "买入费率规则", (fund) => fund.subscriptionFeeRaw),
    textCompareRow(funds, "卖出费率规则", (fund) => fund.redemptionFeeRaw),
    textCompareRow(funds, "跟踪标的", (fund) => fund.trackingIndex),
  ];
  const columns = [
    { title: "字段", dataIndex: "label", fixed: "left" as const, width: 120 },
    ...funds.map((fund) => ({
      title: (
        <Space direction="vertical" size={0}>
          <span>{fund.name ?? fund.code}</span>
          <Space size={8}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{fund.code}</Typography.Text>
            <Button type="link" danger size="small" style={{ padding: 0, height: 18 }} onClick={() => onRemove(fund.code)}>
              移除
            </Button>
          </Space>
        </Space>
      ),
      dataIndex: ["values", fund.code],
      width: 220,
      render: (cell: CompareCell | undefined, row: CompareRow) => renderCompareCell(cell, row),
    })),
  ];
  return (
    <Drawer
      title="基金比较列表"
      open={open}
      width="90%"
      extra={
        <Button danger disabled={funds.length === 0} onClick={onClear}>
          清空比较
        </Button>
      }
      onClose={onClose}
    >
      <Table rowKey="label" columns={columns} dataSource={rows} pagination={false} scroll={{ x: 900 }} />
    </Drawer>
  );
}

function textCompareRow(
  funds: FundCandidateData[],
  label: string,
  getter: (fund: FundCandidateData) => string | undefined,
): CompareRow {
  return {
    label,
    values: Object.fromEntries(
      funds.map((fund) => [
        fund.code,
        {
          display: getter(fund) ?? "-",
        },
      ]),
    ),
  };
}

function metricCompareRow(
  funds: FundCandidateData[],
  label: string,
  displayGetter: (fund: FundCandidateData) => string | undefined,
  scoreGetter: (fund: FundCandidateData) => number | undefined,
  direction: CompareDirection,
): CompareRow {
  return {
    label,
    direction,
    values: Object.fromEntries(
      funds.map((fund) => [
        fund.code,
        {
          display: displayGetter(fund) ?? "-",
          score: scoreGetter(fund),
        },
      ]),
    ),
  };
}

function renderCompareCell(cell: CompareCell | undefined, row: CompareRow) {
  const value = cell?.display ?? "-";
  const style = compareCellStyle(cell, row);
  if (!style) return value;
  return (
    <Tooltip title="仅按当前字段数值做相对着色，不代表基金优劣或投资建议">
      <div style={style}>{value}</div>
    </Tooltip>
  );
}

function compareCellStyle(cell: CompareCell | undefined, row: CompareRow): CSSProperties | undefined {
  if (cell?.score === undefined || row.direction === undefined) return undefined;
  const scores = Object.values(row.values)
    .map((value) => value.score)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  if (scores.length < 2) return undefined;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (min === max) return undefined;
  const advantage = row.direction === "higher" ? (cell.score - min) / (max - min) : (max - cell.score) / (max - min);
  const color = compareColorForAdvantage(advantage);
  return {
    background: color.background,
    border: `1px solid ${color.border}`,
    color: color.text,
    borderRadius: 6,
    fontWeight: 600,
    margin: "-3px 0",
    padding: "4px 8px",
  };
}

function compareColorForAdvantage(advantage: number) {
  if (advantage >= 0.75) {
    return { background: "#dcfce7", border: "#86efac", text: "#166534" };
  }
  if (advantage >= 0.5) {
    return { background: "#fef9c3", border: "#fde047", text: "#854d0e" };
  }
  if (advantage >= 0.25) {
    return { background: "#ffedd5", border: "#fdba74", text: "#9a3412" };
  }
  return { background: "#fee2e2", border: "#fca5a5", text: "#991b1b" };
}

function dailyPurchaseLimitScore(fund: FundCandidateData) {
  if (fund.dailyPurchaseLimitCny !== undefined) return fund.dailyPurchaseLimitCny;
  if (fund.dailyPurchaseLimitRaw?.includes("无限额")) return Number.MAX_SAFE_INTEGER;
  return undefined;
}

function compareFundsBySortRules(a: FundTableRow, b: FundTableRow, rules: FundSortRule[]) {
  if (rules.length === 0) return 0;
  const loadingCompare = compareLoadingState(a, b);
  if (loadingCompare !== 0) return loadingCompare;
  for (const rule of rules) {
    const result = compareFundsBySortRule(a, b, rule);
    if (result !== 0) return result;
  }
  return 0;
}

function oppositeSortDirection(direction: FundSortDirection): FundSortDirection {
  return direction === "asc" ? "desc" : "asc";
}

function compareFundsBySortRule(a: FundTableRow, b: FundTableRow, rule: FundSortRule) {
  const direction = rule.direction === "asc" ? 1 : -1;
  if (rule.key === "assetSizeYi") {
    return compareOptionalNumbers(a.assetSizeYi, b.assetSizeYi, direction);
  }
  if (rule.key === "yearsSinceInception") {
    return compareOptionalNumbers(a.yearsSinceInception, b.yearsSinceInception, direction);
  }
  if (rule.key === "dailyPurchaseLimit") {
    return compareOptionalNumbers(dailyPurchaseLimitScore(a), dailyPurchaseLimitScore(b), direction);
  }
  if (rule.key === "totalAnnualFeePct") {
    return compareOptionalNumbers(a.totalAnnualFeePct, b.totalAnnualFeePct, direction);
  }
  if (isReturnSortKey(rule.key)) {
    return compareOptionalNumbers(returnSortValue(a, rule.key), returnSortValue(b, rule.key), direction);
  }
  if (isDrawdownSortKey(rule.key)) {
    return compareOptionalNumbers(drawdownSortValue(a, rule.key), drawdownSortValue(b, rule.key), direction);
  }
  if (rule.key === "purchaseStatus") {
    return comparePurchaseStatus(a, b) * direction;
  }
  return compareOptionalTexts(fundSortText(a, rule.key), fundSortText(b, rule.key)) * direction;
}

function compareLoadingState(a: FundTableRow, b: FundTableRow) {
  if (a.isLoadingDetails === b.isLoadingDetails) return 0;
  return a.isLoadingDetails ? 1 : -1;
}

function compareOptionalNumbers(a: number | undefined, b: number | undefined, direction: 1 | -1) {
  const hasA = a !== undefined && Number.isFinite(a);
  const hasB = b !== undefined && Number.isFinite(b);
  if (!hasA && !hasB) return 0;
  if (!hasA) return 1;
  if (!hasB) return -1;
  return (a - b) * direction;
}

function compareOptionalTexts(a?: string, b?: string) {
  const valueA = a?.trim();
  const valueB = b?.trim();
  if (!valueA && !valueB) return 0;
  if (!valueA) return 1;
  if (!valueB) return -1;
  return valueA.localeCompare(valueB, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

function fundSortText(fund: FundCandidateData, key: FundSortKey) {
  if (key === "name") return fund.name ?? fund.fullName ?? fund.code;
  if (key === "fundType") return fund.fundType;
  if (key === "fundCompany") return fund.fundCompany;
  return undefined;
}

function isReturnSortKey(key: FundSortKey): key is ReturnSortKey {
  return RETURN_SORT_KEYS.includes(key as ReturnSortKey);
}

function isDrawdownSortKey(key: FundSortKey): key is DrawdownSortKey {
  return DRAWDOWN_SORT_KEYS.includes(key as DrawdownSortKey);
}

function returnSortValue(fund: FundCandidateData, key: ReturnSortKey) {
  if (key === "return1yPct") return fund.return1yPct;
  if (key === "return3yPct") return fund.return3yPct;
  if (key === "return5yPct") return fund.return5yPct;
  if (key === "return10yPct") return fund.return10yPct;
  return fund.returnSinceInceptionPct;
}

function drawdownSortValue(fund: FundCandidateData, key: DrawdownSortKey) {
  if (key === "maxDrawdown3yPct") return fund.maxDrawdown3yPct;
  if (key === "maxDrawdown5yPct") return fund.maxDrawdown5yPct;
  return fund.maxDrawdown10yPct;
}

function comparePurchaseStatus(a: FundTableRow, b: FundTableRow) {
  return (
    purchaseAvailabilityRank(a) - purchaseAvailabilityRank(b) ||
    compareOptionalTexts(a.purchaseStatus, b.purchaseStatus) ||
    compareOptionalTexts(a.redeemStatus, b.redeemStatus)
  );
}

function createLoadingFundRow(code: string): FundTableRow {
  return {
    code,
    fetchProfile: "summary",
    dataSources: [],
    sourceUrls: [],
    fieldSources: {},
    returnCurvePreview: [],
    topHoldings: [],
    updatedAt: "",
    fetchStatus: "partial",
    fetchError: undefined,
    stale: false,
    isLoadingDetails: true,
  };
}

function mergeFundRows(current: FundTableRow[], incoming: FundTableRow[]) {
  const rowsByCode = new Map(current.map((fund) => [fund.code, fund]));
  for (const fund of incoming) {
    const existing = rowsByCode.get(fund.code);
    if (!existing || existing.isLoadingDetails || !fund.isLoadingDetails) {
      rowsByCode.set(fund.code, mergeFundRow(existing, fund));
    }
  }
  return Array.from(rowsByCode.values());
}

function mergeFundRow(existing: FundTableRow | undefined, incoming: FundTableRow): FundTableRow {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    subscriptionFeeRaw: incoming.subscriptionFeeRaw ?? existing.subscriptionFeeRaw,
    redemptionFeeRaw: incoming.redemptionFeeRaw ?? existing.redemptionFeeRaw,
    fieldSources: {
      ...existing.fieldSources,
      ...incoming.fieldSources,
    },
    dataSources: Array.from(new Set([...existing.dataSources, ...incoming.dataSources])),
    sourceUrls: Array.from(new Set([...existing.sourceUrls, ...incoming.sourceUrls])),
    isLoadingDetails: incoming.isLoadingDetails ?? false,
  };
}

function mergeFundFeeRows(current: FundTableRow[], fees: FundFeeData) {
  return current.map((fund) => {
    if (fund.code !== fees.code) return fund;
    return {
      ...fund,
      subscriptionFeeRaw: fees.subscriptionFeeRaw ?? fund.subscriptionFeeRaw,
      redemptionFeeRaw: fees.redemptionFeeRaw ?? fund.redemptionFeeRaw,
      fieldSources: {
        ...fund.fieldSources,
        ...fees.fieldSources,
      },
      dataSources: Array.from(new Set([...fund.dataSources, ...fees.dataSources])),
      sourceUrls: Array.from(new Set([...fund.sourceUrls, ...fees.sourceUrls])),
      fetchError: fees.fetchError ?? fund.fetchError,
      stale: fees.stale || fund.stale,
    };
  });
}

function countLoadedFunds(funds: FundTableRow[]) {
  return funds.filter((fund) => !fund.isLoadingDetails).length;
}

function renderText(value: unknown) {
  return value == null || value === "" ? "-" : String(value);
}

function renderClampedText(value: unknown) {
  const text = renderText(value);
  return (
    <Tooltip title={text === "-" ? undefined : text}>
      <span className="fund-screener-cell-clamp">{text}</span>
    </Tooltip>
  );
}

function renderFeeRule(value: string | undefined, loading: boolean) {
  if (loading && !value) {
    return (
      <Space size={6}>
        <Spin size="small" />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>加载中</Typography.Text>
      </Space>
    );
  }
  if (!value) return "-";
  return (
    <Tooltip title={value}>
      <Typography.Text
        className="fund-screener-fee-cell"
        style={{
          display: "-webkit-box",
          fontSize: 12,
          lineHeight: 1.35,
          maxWidth: 150,
          overflow: "hidden",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
        }}
      >
        {value}
      </Typography.Text>
    </Tooltip>
  );
}

function renderReturnCell(
  value: number | undefined,
  fund: FundCandidateData,
  sourceKey: string,
  rangeYears: number | "all",
) {
  const text = returnPctText(value);
  const source = fund.fieldSources[sourceKey];
  const chartPoints = filterCurvePointsByYears(fund.returnCurvePreview, rangeYears);
  const rangeLabel = rangeYears === "all" ? "成立来" : `近${rangeYears}年`;
  return (
    <Tooltip title={returnTooltipTitle(source, chartPoints, rangeLabel)}>
      <div className="fund-screener-return-cell">
        <Typography.Text
          style={{
            color: returnColor(value),
            fontVariantNumeric: "tabular-nums",
            fontWeight: value == null ? 400 : 600,
          }}
        >
          {text}
        </Typography.Text>
        <ReturnSparkline
          points={chartPoints}
          width={76}
          height={18}
          stroke={returnColor(value)}
        />
      </div>
    </Tooltip>
  );
}

function renderDrawdownCell(value: number | undefined, fund: FundCandidateData, sourceKey: string) {
  const source = fund.fieldSources[sourceKey];
  return (
    <Tooltip title={source ? `来源：${source}；最大回撤为区间内峰值到后续低点的最大跌幅` : undefined}>
      <Typography.Text
        className="fund-screener-return-cell"
        style={{
          color: returnColor(value),
          display: "inline-block",
          fontVariantNumeric: "tabular-nums",
          fontWeight: value == null ? 400 : 600,
          minWidth: 72,
        }}
      >
        {returnPctText(value)}
      </Typography.Text>
    </Tooltip>
  );
}

function returnTooltipTitle(
  source: string | undefined,
  points: FundReturnCurvePoint[],
  rangeLabel: string,
) {
  const rangeText = points.length > 1
    ? `${rangeLabel}走势：${points[0].date} 至 ${points[points.length - 1].date}`
    : `${rangeLabel}走势：暂无足够数据`;
  return source ? `${rangeText}；来源：${source}` : rangeText;
}

function filterCurvePointsByYears(points: FundReturnCurvePoint[], years: number | "all") {
  if (years === "all" || points.length < 2) return points;
  const latestTime = Date.parse(points[points.length - 1].date);
  if (!Number.isFinite(latestTime)) return points;
  const cutoffTime = latestTime - years * 365.25 * 24 * 60 * 60 * 1000;
  const filtered = points.filter((point) => {
    const time = Date.parse(point.date);
    return Number.isFinite(time) && time >= cutoffTime;
  });
  return filtered.length >= 2 ? filtered : points;
}

function ReturnSparkline({
  points,
  width,
  height,
  stroke,
}: {
  points: FundReturnCurvePoint[];
  width: number;
  height: number;
  stroke: string;
}) {
  if (points.length < 2) {
    return <span className="fund-screener-sparkline-empty" style={{ width, height }} />;
  }
  const values = points.map((point) => point.returnPct);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const valueRange = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width;
      const y = height - ((point.returnPct - min) / valueRange) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      className="fund-screener-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function returnPctText(value?: number) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function returnColor(value?: number) {
  if (value == null || !Number.isFinite(value) || value === 0) return "#8c8c8c";
  return value > 0 ? "#047857" : "#b42318";
}

function statusTag(status?: string) {
  if (!status) return null;
  const color = status.includes("暂停") ? "red" : status.includes("限") ? "gold" : "green";
  return <Tag color={color}>{status}</Tag>;
}

function matchesTradeStatusFilter(fund: FundTableRow, filter: TradeStatusFilter[]) {
  if (filter.length === 0) return true;
  if (fund.isLoadingDetails) return false;
  return filter.some((item) => {
    if (item === "paused") return isPurchasePaused(fund);
    if (item === "restricted") return isPurchaseRestricted(fund) && !isPurchasePaused(fund);
    if (item === "open") return isPurchaseOpen(fund) && !isPurchaseRestricted(fund);
    return false;
  });
}

function sortByPurchaseAvailability(a: FundTableRow, b: FundTableRow) {
  return purchaseAvailabilityRank(a) - purchaseAvailabilityRank(b) || a.code.localeCompare(b.code);
}

function purchaseAvailabilityRank(fund: FundTableRow) {
  if (fund.isLoadingDetails) return 2;
  if (isPurchasePaused(fund)) return 3;
  if (isPurchaseOpen(fund)) return isPurchaseRestricted(fund) ? 1 : 0;
  return 2;
}

function isPurchasePaused(fund: FundCandidateData) {
  const purchaseStatus = fund.purchaseStatus ?? "";
  const text = tradeText(fund);
  return purchaseStatus.includes("暂停") || text.includes("暂停申购") || text.includes("暂停认购");
}

function isPurchaseOpen(fund: FundCandidateData) {
  const text = tradeText(fund);
  return text.includes("开放申购") || text.includes("限大额") || text.includes("限制大额") || text.includes("限购");
}

function isPurchaseRestricted(fund: FundCandidateData) {
  const text = tradeText(fund);
  return text.includes("限大额") || text.includes("限制大额") || text.includes("限购") || text.includes("单日累计购买上限");
}

function tradeText(fund: FundCandidateData) {
  return [fund.purchaseStatus, fund.tradeStatusRaw, fund.dailyPurchaseLimitRaw].filter(Boolean).join(" ");
}

function pct(value?: number) {
  return value == null ? "-" : `${value}%`;
}

function moneyOrText(value?: number) {
  return value == null ? "-" : formatCurrency(value, "CNY");
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("copy failed");
  }
}
