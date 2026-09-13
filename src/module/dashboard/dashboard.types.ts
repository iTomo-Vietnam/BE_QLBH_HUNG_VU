export const DASHBOARD_TYPES = {
  Repository: Symbol.for("DashboardRepository"),
  Service: Symbol.for("DashboardService"),
  Controller: Symbol.for("DashboardController"),
  Router: Symbol.for("DashboardRouter"),
};

export enum DashboardTimeView {
  YESTERDAY = "yesterday",
  TODAY = "today",
  LAST_7_DAYS = "last7Days",
  THIS_MONTH = "thisMonth",
  LAST_MONTH = "lastMonth",
}

export enum DashboardTypeView {
  DAY = "day",
  HOUR = "hour",
  WEEKDAY = "weekday",
}

export enum DashboardTypeCal {
  BEFORE_TAX = "beforeTax",
  AFTER_TAX = "afterTax",
}

export enum DashboardProductTypeCal {
  REVENUE = "revenue",
  QUANTITY = "quantity",
}

export interface DashboardRequestContext {
  storeId?: string;
  storeIds?: string[];
  timezone?: string;
}

export interface DashboardMetrics {
  revenue: number;
  revenueAfterTax: number;
  salesOrderCount: number;
  exchangeOrderCount: number;
  returnedGoodsRevenue: number;
  returnedRevenue: number;
  returnOrderCount: number;
  revenueGrowthYesterday: number;
  revenueGrowthLastMonth: number;
}

export interface DashboardBranchData {
  label: string;
  value: number;
}

export interface DashboardRevenueBranch {
  branch: string;
  data: DashboardBranchData[];
}

export interface DashboardTopProduct {
  productId: string;
  productName: string;
  quantity: number;
  revenue: number;
}

export interface DashboardTopCustomer {
  customerId: string;
  customerName: string;
  orderCount: number;
  revenue: number;
}
