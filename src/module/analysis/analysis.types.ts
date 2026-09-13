export const ANALYSIS_TYPES = {
  Repository: Symbol.for("AnalysisRepository"),
  Service: Symbol.for("AnalysisService"),
  Controller: Symbol.for("AnalysisController"),
  Router: Symbol.for("AnalysisRouter"),
};

export type AnalysisSortBy =
  | "revenue"
  | "returns"
  | "netRevenue"
  | "grossProfit"
  | "invoiceCount";

export type AnalysisGranularity = "day" | "week" | "month";

export interface AnalysisRange {
  token: string;
  startAt: string;
  endAt: string;
  endExclusive: string;
  days: number;
  granularity: AnalysisGranularity;
  labels: string[];
}

export interface AnalysisScope {
  branch: string;
  timezone: string;
  storeIds?: string[];
}

export interface AnalysisQuery {
  period?: string;
  storeId?: string;
  storeIds?: string[];
  sortBy?: AnalysisSortBy;
  timezone?: string;
}

export interface AnalysisMetric {
  value: number;
  averagePerDay: number;
  growth: number;
}

export interface AnalysisTopRow {
  id: string;
  name: string;
  revenue: number;
  returns: number;
  netRevenue: number;
  grossProfit: number;
  invoiceCount: number;
  returnQuantity: number;
  returnRatio: number;
  averageOrder: number;
  margin: number;
  growth: number;
}

export interface AnalysisBranchRow {
  branch: string;
  revenue: number;
  returns: number;
  netRevenue: number;
  totalCost: number;
  grossProfit: number;
  invoiceCount: number;
}

export interface AnalysisSeries {
  name: string;
  data: number[];
}

export interface SaleOverviewData {
  range: AnalysisRange;
  metrics: {
    invoiceCount: AnalysisMetric;
    revenue: AnalysisMetric;
    paymentValue: AnalysisMetric;
    netRevenue: AnalysisMetric;
    totalCost: AnalysisMetric;
    grossProfit: AnalysisMetric;
  };
  chart: { labels: string[]; series: AnalysisSeries[] };
  branches: AnalysisBranchRow[];
  sortBy: AnalysisSortBy;
  topProductGroups: AnalysisTopRow[];
  topProducts: AnalysisTopRow[];
  topCustomerGroups: AnalysisTopRow[];
}

export interface SaleOverviewMetricsData {
  range: AnalysisRange;
  metrics: SaleOverviewData["metrics"];
}

export interface SaleBusinessIndicatorData {
  range: AnalysisRange;
  businessIndicator: { labels: string[]; series: AnalysisSeries[] };
  branches: AnalysisBranchRow[];
}

export interface AnalysisTopData {
  range: AnalysisRange;
  sortBy: AnalysisSortBy;
  rows: AnalysisTopRow[];
}

export interface CostStructureRow {
  name: string;
  total: number;
  percent: number;
  branchData: { branch: string; value: number }[];
}

export interface ProfitDetailRow {
  key: string;
  name: string;
  total: number;
  branchData?: { branch: string; value: number }[];
}

export interface SaleProfitData {
  range: AnalysisRange;
  metrics: {
    netRevenue: AnalysisMetric;
    grossProfit: AnalysisMetric;
    totalCost: AnalysisMetric;
    otherIncome: AnalysisMetric;
    netProfit: AnalysisMetric;
    averageCostPerDay: AnalysisMetric;
    costRevenueRatio: AnalysisMetric;
  };
  costStructure: CostStructureRow[];
  effectiveness: ProfitDetailRow[];
}

export interface SaleProfitMetricsData {
  range: AnalysisRange;
  metrics: SaleProfitData["metrics"];
}

export interface SaleProfitCostStructureData {
  range: AnalysisRange;
  costStructure: CostStructureRow[];
}

export interface SaleProfitEffectivenessData {
  range: AnalysisRange;
  effectiveness: ProfitDetailRow[];
}

export interface ProductAnalysisData {
  range: AnalysisRange;
  metrics: Record<string, AnalysisMetric>;
  rows: Record<string, unknown>[];
}

export interface CustomerAnalysisData {
  range: AnalysisRange;
  metrics: Record<string, AnalysisMetric>;
  rows: Record<string, unknown>[];
}

export interface ReceivableAnalysisData {
  range: AnalysisRange;
  metrics: Record<string, AnalysisMetric>;
  rows: Record<string, unknown>[];
}
