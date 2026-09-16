import { inject, injectable } from "inversify";
import dayjs from "dayjs";
import { AnalysisRepository } from "./analysis.repository";
import { ANALYSIS_TYPES, AnalysisMetric, AnalysisQuery, AnalysisScope, AnalysisSortBy, SaleOverviewData, SaleProfitData } from "./analysis.types";
import { normalizeTimezone, numeric, resolveAnalysisRange, resolvePreviousRange } from "./analysis.util";

const defaultSort: AnalysisSortBy = "revenue";

@injectable()
export class AnalysisService {
  constructor(@inject(ANALYSIS_TYPES.Repository) private repository: AnalysisRepository) {}

  private scope(branch: string | string[], query: AnalysisQuery): AnalysisScope {
    const storeIds = Array.isArray(branch) ? branch : branch === "all" ? undefined : [branch];
    return {
      branch: storeIds?.length === 1 ? storeIds[0] : "all",
      storeIds,
      timezone: normalizeTimezone(query.timezone),
    };
  }

  private metric(value: number, previous: number, days: number): AnalysisMetric {
    return { value, averagePerDay: days ? value / days : 0, growth: previous === 0 ? (value > 0 ? 100 : 0) : (value - previous) / Math.abs(previous) * 100 };
  }

  private aggregateSeries(rows: Record<string, number>[], range: ReturnType<typeof resolveAnalysisRange>) {
    const map = new Map(rows.map((row: any) => [row.day, row]));
    const series = ["revenue", "returns", "totalCost", "grossProfit"].map((key) => ({
      name: key,
      data: range.labels.map((label) => {
        if (range.granularity === "month") {
          const [month, year] = label.split("/");
          return rows.filter((row: any) => row.day.startsWith(`${year}-${month}`)).reduce((sum, row: any) => sum + numeric(row[key]), 0);
        }
        if (range.granularity === "week") {
          const [start, end] = label.split("-");
          const [day, month] = start.split("/");
          const [endDay, endMonth] = end.split("/");
          const year = dayjs(range.startAt).year();
          const startDate = dayjs(`${year}-${month}-${day}`);
          const endDate = dayjs(`${year + (Number(endMonth) < Number(month) ? 1 : 0)}-${endMonth}-${endDay}`);
          return rows.filter((row: any) => !dayjs(row.day).isBefore(startDate, "day") && !dayjs(row.day).isAfter(endDate, "day")).reduce((sum, row: any) => sum + numeric(row[key]), 0);
        }
        const [day, month] = label.split("/");
        const row = map.get(`${dayjs(range.startAt).year()}-${month}-${day}`) as any;
        return numeric(row?.[key]);
      }),
    }));
    return { labels: range.labels, series };
  }

  private overviewMetrics(current: Record<string, number>, previous: Record<string, number>, days: number) {
    return {
      invoiceCount: this.metric(numeric(current.invoiceCount), numeric(previous.invoiceCount), days),
      revenue: this.metric(numeric(current.revenue), numeric(previous.revenue), days),
      paymentValue: this.metric(numeric(current.paymentValue), numeric(previous.paymentValue), days),
      netRevenue: this.metric(numeric(current.revenue) - numeric(current.returns), numeric(previous.revenue) - numeric(previous.returns), days),
      totalCost: this.metric(numeric(current.totalCost), numeric(previous.totalCost), days),
      grossProfit: this.metric(numeric(current.grossProfit), numeric(previous.grossProfit), days),
    };
  }

  async getSaleOverviewMetrics(branch: string | string[], query: AnalysisQuery) {
    const range = resolveAnalysisRange(query.period);
    const previous = resolvePreviousRange(range);
    const scope = this.scope(branch, query);
    const [current, previousData] = await Promise.all([
      this.repository.getSummary(scope, range),
      this.repository.getSummary(scope, previous),
    ]);
    return { range, metrics: this.overviewMetrics(current, previousData, range.days) };
  }

  async getSaleBusinessIndicator(branch: string | string[], query: AnalysisQuery) {
    const range = resolveAnalysisRange(query.period);
    const scope = this.scope(branch, query);
    const [daily, branches] = await Promise.all([
      this.repository.getDailySeries(scope, range),
      this.repository.getBranches(scope, range, query.sortBy || defaultSort),
    ]);
    return { range, businessIndicator: this.aggregateSeries(daily, range), branches };
  }

  async getSaleOverviewTop(
    branch: string | string[],
    query: AnalysisQuery,
    kind: "product" | "group" | "customerGroup",
  ) {
    const range = resolveAnalysisRange(query.period);
    const previous = resolvePreviousRange(range);
    const sortBy = query.sortBy || defaultSort;
    const rows = await this.repository.getTop(this.scope(branch, query), range, previous, sortBy, kind);
    return { range, sortBy, rows };
  }

  async getSaleOverview(branch: string | string[], query: AnalysisQuery): Promise<SaleOverviewData> {
    const [metrics, indicator, productGroups, products, customerGroups] = await Promise.all([
      this.getSaleOverviewMetrics(branch, query),
      this.getSaleBusinessIndicator(branch, query),
      this.getSaleOverviewTop(branch, query, "group"),
      this.getSaleOverviewTop(branch, query, "product"),
      this.getSaleOverviewTop(branch, query, "customerGroup"),
    ]);
    return {
      range: metrics.range,
      metrics: metrics.metrics,
      chart: indicator.businessIndicator,
      branches: indicator.branches,
      sortBy: query.sortBy || defaultSort,
      topProductGroups: productGroups.rows,
      topProducts: products.rows,
      topCustomerGroups: customerGroups.rows,
    };
  }

  private async getProfitParts(branch: string | string[], query: AnalysisQuery) {
    const range = resolveAnalysisRange(query.period);
    const previous = resolvePreviousRange(range);
    const scope = this.scope(branch, query);
    const [summary, previousSummary, components, previousComponents, adjustments, previousAdjustments, costDifference, previousCostDifference, shipping, previousShipping] = await Promise.all([
      this.repository.getSummary(scope, range),
      this.repository.getSummary(scope, previous),
      this.repository.getProfitComponents(scope, range),
      this.repository.getProfitComponents(scope, previous),
      this.repository.getAdjustments(scope, range),
      this.repository.getAdjustments(scope, previous),
      this.repository.getCostDifference(scope, range),
      this.repository.getCostDifference(scope, previous),
      this.repository.getFreeShippingAndInternalExport(scope, range),
      this.repository.getFreeShippingAndInternalExport(scope, previous),
    ]);
    return { range, previous, scope, summary, previousSummary, components, previousComponents, adjustments, previousAdjustments, costDifference, previousCostDifference, shipping, previousShipping };
  }

  private profitMetricData(parts: Awaited<ReturnType<AnalysisService["getProfitParts"]>>) {
    const { range, summary, previousSummary, components, previousComponents, adjustments, previousAdjustments, costDifference, previousCostDifference, shipping, previousShipping } = parts;
    const netRevenue = numeric(summary.revenue) - numeric(summary.returns);
    const previousNetRevenue = numeric(previousSummary.revenue) - numeric(previousSummary.returns);
    const otherCost = numeric(components.otherCost);
    const previousOtherCost = numeric(previousComponents.otherCost);
    const otherIncome = numeric(components.otherIncome);
    const previousOtherIncome = numeric(previousComponents.otherIncome);
    const adjustment = numeric(adjustments.inventory) + numeric(adjustments.fund) + numeric(adjustments.vat) + numeric(adjustments.debt);
    const previousAdjustment = numeric(previousAdjustments.inventory) + numeric(previousAdjustments.fund) + numeric(previousAdjustments.vat) + numeric(previousAdjustments.debt);
    const netProfit = numeric(summary.grossProfit) - shipping - otherCost + otherIncome + adjustment + costDifference;
    const previousNetProfit = numeric(previousSummary.grossProfit) - numeric(previousShipping) - previousOtherCost + previousOtherIncome + previousAdjustment + previousCostDifference;
    const metric = (value: number, previousValue: number) => this.metric(value, previousValue, range.days);

    return {
      netRevenue: metric(netRevenue, previousNetRevenue),
      grossProfit: metric(numeric(summary.grossProfit), numeric(previousSummary.grossProfit)),
      totalCost: metric(otherCost + shipping, previousOtherCost + numeric(previousShipping)),
      otherIncome: metric(otherIncome, previousOtherIncome),
      netProfit: metric(netProfit, previousNetProfit),
      averageCostPerDay: metric(
        range.days ? (otherCost + shipping) / range.days : 0,
        range.days ? (previousOtherCost + numeric(previousShipping)) / range.days : 0,
      ),
      costRevenueRatio: metric(
        netRevenue ? (otherCost + shipping) / netRevenue * 100 : 0,
        previousNetRevenue ? (previousOtherCost + numeric(previousShipping)) / previousNetRevenue * 100 : 0,
      ),
    };
  }

  async getSaleProfitMetrics(branch: string | string[], query: AnalysisQuery) {
    const parts = await this.getProfitParts(branch, query);
    return { range: parts.range, metrics: this.profitMetricData(parts) };
  }

  async getSaleProfitCostStructure(branch: string | string[], query: AnalysisQuery) {
    const range = resolveAnalysisRange(query.period);
    const scope = this.scope(branch, query);
    const [costs, summary] = await Promise.all([
      this.repository.getCostStructure(scope, range),
      this.repository.getSummary(scope, range),
    ]);
    const netRevenue = numeric(summary.revenue) - numeric(summary.returns);
    const costStructure = costs.reduce((result: any[], row: any) => {
      let item = result.find((entry) => entry.name === row.name);
      if (!item) {
        item = { name: row.name, total: 0, percent: 0, branchData: [] };
        result.push(item);
      }
      item.total += numeric(row.total);
      item.branchData.push({ branch: row.branch, value: numeric(row.total) });
      item.percent = netRevenue ? item.total / netRevenue * 100 : 0;
      return result;
    }, []);
    return { range, costStructure };
  }

  async getSaleProfitEffectiveness(branch: string | string[], query: AnalysisQuery) {
    const range = resolveAnalysisRange(query.period);
    const scope = this.scope(branch, query);
    const [summary, componentsByBranch, adjustmentsByBranch, costDifferenceByBranch, shippingByBranch, branches, costs] = await Promise.all([
      this.repository.getSummary(scope, range),
      this.repository.getProfitComponentsByBranch(scope, range),
      this.repository.getAdjustmentsByBranch(scope, range),
      this.repository.getCostDifferenceByBranch(scope, range),
      this.repository.getFreeShippingAndInternalExportByBranch(scope, range),
      this.repository.getBranches(scope, range),
      this.repository.getCostStructure(scope, range),
    ]);
    const goodsTotal = numeric(summary.goodsTotal || summary.revenue);
    const discounts = numeric(summary.discounts);
    const otherCost = componentsByBranch.reduce((sum, item) => sum + numeric(item.otherCost), 0);
    const otherIncome = componentsByBranch.reduce((sum, item) => sum + numeric(item.otherIncome), 0);
    const adjustment = adjustmentsByBranch.reduce((sum, item) => sum + numeric(item.value), 0);
    const costDifference = costDifferenceByBranch.reduce((sum, item) => sum + numeric(item.value), 0);
    const shipping = shippingByBranch.reduce((sum, item) => sum + numeric(item.value), 0);
    const netProfit = numeric(summary.grossProfit) - shipping - otherCost + otherIncome + adjustment + costDifference;
    const branchNames = Array.from(new Set([
      ...branches.map((item) => item.branch),
      ...costs.map((item) => item.branch),
      ...componentsByBranch.map((item) => item.branch),
      ...adjustmentsByBranch.map((item) => item.branch),
      ...costDifferenceByBranch.map((item) => item.branch),
      ...shippingByBranch.map((item) => item.branch),
    ]));
    const branchData = (key: string) => {
      if (branch !== "all") return undefined;
      return branchNames.map((branchName) => {
        const sales = branches.find((item) => item.branch === branchName);
        const component = componentsByBranch.find((item) => item.branch === branchName);
        const adjustmentValue = adjustmentsByBranch.find((item) => item.branch === branchName)?.value || 0;
        const costDifferenceValue = costDifferenceByBranch.find((item) => item.branch === branchName)?.value || 0;
        const shippingValue = shippingByBranch.find((item) => item.branch === branchName)?.value || 0;
        const otherCostValue = costs
          .filter((cost) => cost.branch === branchName)
          .reduce((sum, cost) => sum + numeric(cost.total), 0);
        const grossProfit = numeric(sales?.grossProfit);
        const value = key === "goods" ? numeric(sales?.goodsTotal)
          : key === "reductions" ? numeric(sales?.returns) + numeric(sales?.discounts)
          : key === "netRevenue" ? numeric(sales?.netRevenue)
          : key === "cost" ? numeric(sales?.totalCost)
          : key === "grossProfit" ? grossProfit
          : key === "costs" ? numeric(shippingValue)
          : key === "otherCost" ? numeric(component?.otherCost ?? otherCostValue)
          : key === "otherIncome" ? numeric(component?.otherIncome)
          : key === "adjustment" ? numeric(adjustmentValue)
          : key === "costDifference" ? numeric(costDifferenceValue)
          : key === "netProfit" ? grossProfit - numeric(shippingValue) - numeric(component?.otherCost ?? otherCostValue) + numeric(component?.otherIncome) + numeric(adjustmentValue) + numeric(costDifferenceValue)
          : 0;
        return { branch: branchName, value };
      });
    };
    const effectiveness = [
      ["goods", "Tổng tiền hàng", goodsTotal],
      ["reductions", "Giảm trừ doanh thu", numeric(summary.returns) + discounts],
      ["netRevenue", "Doanh thu thuần", goodsTotal - numeric(summary.returns) - discounts],
      ["cost", "Giá vốn hàng bán", numeric(summary.totalCost)],
      ["grossProfit", "Lợi nhuận gộp", numeric(summary.grossProfit)],
      ["costs", "Chi phí", shipping],
      ["otherCost", "Chi phí khác", otherCost],
      ["otherIncome", "Thu nhập khác", otherIncome],
      ["adjustment", "Điều chỉnh", adjustment],
      ["costDifference", "Chênh lệch giá vốn", costDifference],
      ["netProfit", "Lợi nhuận ròng", netProfit],
    ].map(([key, name, total]) => ({
      key: String(key),
      name: String(name),
      total: numeric(total),
      ...(branch === "all" ? { branchData: branchData(String(key)) } : {}),
    }));
    return { range, effectiveness };
  }

  async getSaleProfit(branch: string | string[], query: AnalysisQuery): Promise<SaleProfitData> {
    const [metrics, costStructure, effectiveness] = await Promise.all([
      this.getSaleProfitMetrics(branch, query),
      this.getSaleProfitCostStructure(branch, query),
      this.getSaleProfitEffectiveness(branch, query),
    ]);
    return { range: metrics.range, metrics: metrics.metrics, costStructure: costStructure.costStructure, effectiveness: effectiveness.effectiveness };
  }

  async getProductOverview(branch: string | string[], query: AnalysisQuery) { const range = resolveAnalysisRange(query.period); const previous = resolvePreviousRange(range); return { range, metrics: {}, rows: await this.repository.getTop(this.scope(branch, query), range, previous, query.sortBy || defaultSort, "product") }; }
  async getProductInventory(branch: string | string[], query: AnalysisQuery) { const range = resolveAnalysisRange(query.period); return { range, metrics: {}, rows: await this.repository.getInventoryData(this.scope(branch, query), range) }; }
  async getProductClassification(branch: string | string[], query: AnalysisQuery) { const range = resolveAnalysisRange(query.period); return { range, metrics: {}, rows: await this.repository.getProductClassificationData(this.scope(branch, query)) }; }
  async getCustomerOverview(branch: string | string[], query: AnalysisQuery) { const range = resolveAnalysisRange(query.period); return { range, metrics: {}, rows: await this.repository.getCustomerOverviewData(this.scope(branch, query), range) }; }
  async getCustomerClassification(branch: string | string[], query: AnalysisQuery) { const range = resolveAnalysisRange(query.period); return { range, metrics: {}, rows: await this.repository.getCustomerData(this.scope(branch, query)) }; }
  async getReceivable(branch: string | string[], query: AnalysisQuery) { const range = resolveAnalysisRange(query.period); return { range, metrics: {}, rows: await this.repository.getReceivable(this.scope(branch, query), range) }; }
}
