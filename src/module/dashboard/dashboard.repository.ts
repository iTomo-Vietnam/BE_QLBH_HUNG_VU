import { injectable } from "inversify";
import DatabaseConfig from "@/config/database";
import { OrderStatus, OrderType } from "@/database/models/store/Order";
import {
  DashboardMetrics,
  DashboardRequestContext,
  DashboardTopCustomer,
  DashboardTopProduct,
  DashboardProductTypeCal,
  DashboardTypeCal,
  DashboardTypeView,
} from "./dashboard.types";
import { DashboardDateRange } from "./dashboard.util";

interface RevenueRow {
  storeId: string;
  branch: string;
  label: string;
  value: number | string;
}

interface BranchRow {
  id: string;
  name: string;
}

const numeric = (value: unknown): number => Number(value || 0);

@injectable()
export class DashboardRepository {
  private scopedCondition(
    alias: string,
    context: DashboardRequestContext,
    params: unknown[],
  ): string {
    if (Array.isArray(context.storeIds)) {
      if (context.storeIds.length === 0) return `AND 1 = 0`;
      params.push(context.storeIds);
      return `AND ${alias}."storeId" = ANY($${params.length}::uuid[])`;
    }
    if (!context.storeId) return "";
    params.push(context.storeId);
    return `AND ${alias}."storeId" = $${params.length}`;
  }

  private orderRangeCondition(
    alias: string,
    context: DashboardRequestContext,
    range: DashboardDateRange,
    params: unknown[],
  ): string {
    params.push(context.timezone, range.startDate, range.endDate);
    return `
      AND timezone($${params.length - 2}, ${alias}."orderAt")::date >= $${params.length - 1}::date
      AND timezone($${params.length - 2}, ${alias}."orderAt")::date < $${params.length}::date`;
  }

  private getBaseOrderParams(): unknown[] {
    return [OrderStatus.COMPLETED, OrderType.SALE, OrderType.SALE_RETURN];
  }

  async getMetrics(
    context: DashboardRequestContext,
    range: DashboardDateRange,
  ): Promise<Omit<DashboardMetrics, "revenueGrowthYesterday" | "revenueGrowthLastMonth">> {
    const params = this.getBaseOrderParams();
    const dateCondition = this.orderRangeCondition("o", context, range, params);
    const storeCondition = this.scopedCondition("o", context, params);
    const result = await DatabaseConfig.query(
      `
        SELECT
          COALESCE(SUM(o."netAmount") FILTER (WHERE o.type IN ($2, $3)), 0)::float AS revenue,
          COALESCE(SUM(o."netAmount" + COALESCE(o."taxAmount", 0)) FILTER (WHERE o.type IN ($2, $3)), 0)::float AS "revenueAfterTax",
          COUNT(o.id) FILTER (WHERE o.type = $2)::int AS "salesOrderCount",
          COUNT(o.id) FILTER (WHERE o.type = $3 AND COALESCE(o."netAmount", 0) > 0)::int AS "exchangeOrderCount",
          COALESCE(SUM(o."returnNetAmount") FILTER (WHERE o.type = $3), 0)::float AS "returnedGoodsRevenue",
          COALESCE(SUM(o."returnTotalAmount") FILTER (WHERE o.type = $3), 0)::float AS "returnedRevenue",
          COUNT(o.id) FILTER (WHERE o.type = $3)::int AS "returnOrderCount"
        FROM orders o
        WHERE o."deletedAt" IS NULL
          AND o.status = $1
          ${dateCondition}
          ${storeCondition}
      `,
      params,
    );
    const row = result[0] || {};
    return {
      revenue: numeric(row.revenue),
      revenueAfterTax: numeric(row.revenueAfterTax),
      salesOrderCount: numeric(row.salesOrderCount),
      exchangeOrderCount: numeric(row.exchangeOrderCount),
      returnedGoodsRevenue: numeric(row.returnedGoodsRevenue),
      returnedRevenue: numeric(row.returnedRevenue),
      returnOrderCount: numeric(row.returnOrderCount),
    };
  }

  async getRevenueTotal(
    context: DashboardRequestContext,
    range: DashboardDateRange,
  ): Promise<number> {
    const params = this.getBaseOrderParams();
    const dateCondition = this.orderRangeCondition("o", context, range, params);
    const storeCondition = this.scopedCondition("o", context, params);
    const result = await DatabaseConfig.query(
      `
        SELECT COALESCE(SUM(o."netAmount"), 0)::float AS value
        FROM orders o
        WHERE o."deletedAt" IS NULL
          AND o.status = $1
          AND o.type IN ($2, $3)
          ${dateCondition}
          ${storeCondition}
      `,
      params,
    );
    return numeric(result[0]?.value);
  }

  async getBranches(context: DashboardRequestContext): Promise<BranchRow[]> {
    const params: unknown[] = [];
    let condition = `WHERE s."deletedAt" IS NULL`;
    if (Array.isArray(context.storeIds)) {
      if (context.storeIds.length === 0) return [];
      params.push(context.storeIds);
      condition += ` AND s.id = ANY($1::uuid[])`;
    } else if (context.storeId) {
      params.push(context.storeId);
      condition += ` AND s.id = $1`;
    }
    return DatabaseConfig.query(
      `SELECT s.id, s.name FROM stores s ${condition} ORDER BY s.name ASC`,
      params,
    );
  }

  async getHourRange(
    context: DashboardRequestContext,
    range: DashboardDateRange,
  ): Promise<{ minHour: number; maxHour: number } | null> {
    const params = this.getBaseOrderParams();
    const dateCondition = this.orderRangeCondition("o", context, range, params);
    const storeCondition = this.scopedCondition("o", context, params);
    const result = await DatabaseConfig.query(
      `
        SELECT
          MIN(EXTRACT(HOUR FROM timezone($4, o."orderAt")))::int AS "minHour",
          MAX(EXTRACT(HOUR FROM timezone($4, o."orderAt")))::int AS "maxHour"
        FROM orders o
        WHERE o."deletedAt" IS NULL
          AND o.status = $1
          AND o.type IN ($2, $3)
          ${dateCondition}
          ${storeCondition}
      `,
      params,
    );
    if (result[0]?.minHour == null || result[0]?.maxHour == null) return null;
    return {
      minHour: numeric(result[0].minHour),
      maxHour: numeric(result[0].maxHour),
    };
  }

  async getRevenueRows(
    context: DashboardRequestContext,
    range: DashboardDateRange,
    typeView: DashboardTypeView,
    typeCal: DashboardTypeCal,
  ): Promise<RevenueRow[]> {
    const params = this.getBaseOrderParams();
    const dateCondition = this.orderRangeCondition("o", context, range, params);
    const storeCondition = this.scopedCondition("o", context, params);
    const valueExpression =
      typeCal === DashboardTypeCal.AFTER_TAX
        ? `o."netAmount" + COALESCE(o."taxAmount", 0)`
        : `o."netAmount"`;
    const bucketExpression =
      typeView === DashboardTypeView.HOUR
        ? `to_char(timezone($4, o."orderAt"), 'HH24:00')`
        : typeView === DashboardTypeView.WEEKDAY
          ? `EXTRACT(ISODOW FROM timezone($4, o."orderAt"))::int::text`
          : `to_char(timezone($4, o."orderAt"), 'YYYY-MM-DD')`;
    return DatabaseConfig.query(
      `
        SELECT
          o."storeId" AS "storeId",
          s.name AS branch,
          ${bucketExpression} AS label,
          COALESCE(SUM(${valueExpression}), 0)::float AS value
        FROM orders o
        INNER JOIN stores s ON s.id = o."storeId"
        WHERE o."deletedAt" IS NULL
          AND o.status = $1
          AND o.type IN ($2, $3)
          ${dateCondition}
          ${storeCondition}
        GROUP BY o."storeId", s.name, ${bucketExpression}
        ORDER BY o."storeId", label
      `,
      params,
    );
  }

  async getTopProducts(
    context: DashboardRequestContext,
    range: DashboardDateRange,
    typeCal: DashboardProductTypeCal = DashboardProductTypeCal.REVENUE,
  ): Promise<DashboardTopProduct[]> {
    const params = this.getBaseOrderParams();
    params.push(context.timezone, range.startDate, range.endDate);
    const dateCondition = `
      AND timezone($4, o."orderAt")::date >= $5::date
      AND timezone($4, o."orderAt")::date < $6::date`;
    const storeCondition = this.scopedCondition("o", context, params);
    const result = await DatabaseConfig.query(
      `
        WITH product_sales AS (
          SELECT
            o."storeId",
            ol."productId",
            ol."productSnapshot",
            ol.quantity::float AS quantity,
            ol."subTotal"::float AS revenue
          FROM order_lines ol
          INNER JOIN orders o ON o.id = ol."orderId"
          WHERE o."deletedAt" IS NULL
            AND ol."deletedAt" IS NULL
            AND o.status = $1
            AND o.type IN ($2, $3)
            ${dateCondition}
            ${storeCondition}
          UNION ALL
          SELECT
            o."storeId",
            ol."productId",
            ol."productSnapshot",
            -ol.quantity::float AS quantity,
            -ol."subTotal"::float AS revenue
          FROM order_lines ol
          INNER JOIN orders o ON o.id = ol."returnOrderId"
          WHERE o."deletedAt" IS NULL
            AND ol."deletedAt" IS NULL
            AND o.status = $1
            AND o.type = $3
            ${dateCondition}
            ${storeCondition}
        )
        SELECT
          COALESCE(ps."productId"::text, 'unknown') AS "productId",
          COALESCE(p.name, ps."productSnapshot"->>'name', 'Không xác định') AS "productName",
          COALESCE(SUM(ps.quantity), 0)::float AS quantity,
          COALESCE(SUM(ps.revenue), 0)::float AS revenue
        FROM product_sales ps
        LEFT JOIN products p ON p.id = ps."productId"
        GROUP BY ps."productId", p.name, ps."productSnapshot"->>'name'
        HAVING COALESCE(SUM(ps.${typeCal === DashboardProductTypeCal.QUANTITY ? "quantity" : "revenue"}), 0) > 0
        ORDER BY ${typeCal === DashboardProductTypeCal.QUANTITY ? "quantity" : "revenue"} DESC
        LIMIT 10
      `,
      params,
    );
    return result.map((row: any) => ({
      productId: String(row.productId),
      productName: row.productName,
      quantity: numeric(row.quantity),
      revenue: numeric(row.revenue),
    }));
  }

  async getTopCustomers(
    context: DashboardRequestContext,
    range: DashboardDateRange,
  ): Promise<DashboardTopCustomer[]> {
    const params = this.getBaseOrderParams();
    const dateCondition = this.orderRangeCondition("o", context, range, params);
    const storeCondition = this.scopedCondition("o", context, params);
    const result = await DatabaseConfig.query(
      `
        SELECT
          COALESCE(o."partnerId"::text, 'unknown') AS "customerId",
          COALESCE(p.name, o."partnerSnapshot"->>'name', 'Khách lẻ') AS "customerName",
          COUNT(o.id)::int AS "orderCount",
          COALESCE(SUM(o."netAmount"), 0)::float AS revenue
        FROM orders o
        LEFT JOIN partners p ON p.id = o."partnerId"
        WHERE o."deletedAt" IS NULL
          AND o.status = $1
          AND o.type IN ($2, $3)
          ${dateCondition}
          ${storeCondition}
        GROUP BY o."partnerId", p.name, o."partnerSnapshot"->>'name'
        HAVING COALESCE(SUM(o."netAmount"), 0) > 0
        ORDER BY revenue DESC
        LIMIT 10
      `,
      params,
    );
    return result.map((row: any) => ({
      customerId: String(row.customerId),
      customerName: row.customerName,
      orderCount: numeric(row.orderCount),
      revenue: numeric(row.revenue),
    }));
  }
}
