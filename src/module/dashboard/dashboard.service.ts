import { inject, injectable } from "inversify";
import { DashboardRepository } from "./dashboard.repository";
import {
  DASHBOARD_TYPES,
  DashboardMetrics,
  DashboardRequestContext,
  DashboardRevenueBranch,
  DashboardTimeView,
  DashboardTopCustomer,
  DashboardTopProduct,
  DashboardProductTypeCal,
  DashboardTypeCal,
  DashboardTypeView,
} from "./dashboard.types";
import {
  getRevenueLabels,
  resolveDateRange,
  normalizeTimezone,
  resolvePreviousDay,
  resolvePreviousMonthSameDay,
} from "./dashboard.util";

const numeric = (value: unknown): number => Number(value || 0);

@injectable()
export class DashboardService {
  constructor(
    @inject(DASHBOARD_TYPES.Repository)
    private repository: DashboardRepository,
  ) {}

  private getContext(
    storeId?: string,
    timezone?: string,
    storeIds?: string[],
  ): DashboardRequestContext {
    return { storeId, storeIds, timezone: normalizeTimezone(timezone) };
  }

  private calculateGrowth(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / Math.abs(previous)) * 100;
  }

  async getMetrics(
    storeId?: string,
    timezone?: string,
    storeIds?: string[],
  ): Promise<DashboardMetrics> {
    const context = this.getContext(storeId, timezone, storeIds);
    const today = resolveDateRange(DashboardTimeView.TODAY, timezone);
    const [metrics, yesterday, previousMonth] = await Promise.all([
      this.repository.getMetrics(context, today),
      this.repository.getRevenueTotal(context, resolvePreviousDay(timezone)),
      this.repository.getRevenueTotal(
        context,
        resolvePreviousMonthSameDay(timezone),
      ),
    ]);
    return {
      ...metrics,
      revenueGrowthYesterday: this.calculateGrowth(metrics.revenue, yesterday),
      revenueGrowthLastMonth: this.calculateGrowth(metrics.revenue, previousMonth),
    };
  }

  async getRevenue(
    storeId: string | undefined,
    timezone: string | undefined,
    timeView?: DashboardTimeView,
    typeView: DashboardTypeView = DashboardTypeView.DAY,
    typeCal: DashboardTypeCal = DashboardTypeCal.BEFORE_TAX,
    storeIds?: string[],
  ): Promise<DashboardRevenueBranch[]> {
    const context = this.getContext(storeId, timezone, storeIds);
    const range = resolveDateRange(timeView, timezone);
    const hourRange =
      typeView === DashboardTypeView.HOUR
        ? await this.repository.getHourRange(context, range)
        : null;
    const labels = getRevenueLabels(typeView, range, hourRange);
    const rows = await this.repository.getRevenueRows(
      context,
      range,
      typeView,
      typeCal,
    );
    const branches = await this.repository.getBranches(context);
    const valuesByBranch = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const values = valuesByBranch.get(row.storeId) || new Map<string, number>();
      const label =
        typeView === DashboardTypeView.WEEKDAY
          ? ["T2", "T3", "T4", "T5", "T6", "T7", "CN"][numeric(row.label) - 1]
          : row.label;
      values.set(label, numeric(row.value));
      valuesByBranch.set(row.storeId, values);
    }

    return (branches.length ? branches : [{ id: "unknown", name: "Không xác định" }]).map(
      (branch) => {
        const values = valuesByBranch.get(branch.id) || new Map<string, number>();
        return {
          branch: branch.name,
          data: labels.map((label) => ({ label, value: values.get(label) || 0 })),
        };
      },
    );
  }

  async getTopProducts(
    storeId: string | undefined,
    timezone: string | undefined,
    timeView?: DashboardTimeView,
    typeCal?: DashboardProductTypeCal,
    storeIds?: string[],
  ): Promise<DashboardTopProduct[]> {
    return this.repository.getTopProducts(
      this.getContext(storeId, timezone, storeIds),
      resolveDateRange(timeView, timezone),
      typeCal,
    );
  }

  async getTopCustomers(
    storeId: string | undefined,
    timezone: string | undefined,
    timeView?: DashboardTimeView,
    storeIds?: string[],
  ): Promise<DashboardTopCustomer[]> {
    return this.repository.getTopCustomers(
      this.getContext(storeId, timezone, storeIds),
      resolveDateRange(timeView, timezone),
    );
  }
}
