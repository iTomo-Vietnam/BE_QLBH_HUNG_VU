import { injectable } from "inversify";
import DatabaseConfig from "@/config/database";
import { DebtSide } from "@/shared/constants/enum";
import { IncomeExpenseStatus, IncomeExpenseType } from "@/database/models/store/IncomeExpense";
import { OrderStatus, OrderType } from "@/database/models/store/Order";
import { AnalysisRange, AnalysisScope, AnalysisSortBy } from "./analysis.types";

const numeric = (value: unknown): number => Number(value || 0);

@injectable()
export class AnalysisRepository {
  private scope(alias: string, scope: AnalysisScope, params: unknown[]): string {
    if (Array.isArray(scope.storeIds)) {
      if (scope.storeIds.length === 0) return " AND 1 = 0";
      params.push(scope.storeIds);
      return ` AND ${alias}."storeId" = ANY($${params.length}::uuid[])`;
    }
    if (scope.branch === "all") return "";
    params.push(scope.branch);
    return ` AND ${alias}."storeId" = $${params.length}`;
  }

  private orderDate(
    alias: string,
    scope: AnalysisScope,
    range: AnalysisRange,
    params: unknown[],
  ): string {
    params.push(scope.timezone, range.startAt, range.endExclusive);
    const tz = params.length - 2;
    return ` AND timezone($${tz}, ${alias}."orderAt")::date >= $${tz + 1}::date AND timezone($${tz}, ${alias}."orderAt")::date < $${tz + 2}::date`;
  }

  private async orderSummary(scope: AnalysisScope, range: AnalysisRange): Promise<Record<string, number>> {
    const params: unknown[] = [OrderStatus.COMPLETED, OrderType.SALE, OrderType.SALE_RETURN];
    const date = this.orderDate("o", scope, range, params);
    const branch = this.scope("o", scope, params);
    const result = await DatabaseConfig.query(
      `SELECT
        COUNT(*) FILTER (WHERE o.type = $2)::int AS "invoiceCount",
        COALESCE(SUM(o."netAmount"), 0)::float AS revenue,
        COALESCE(SUM(o."grossAmount"), 0)::float AS "goodsTotal",
        COALESCE(SUM(o."discountAmount"), 0)::float AS discounts,
        COALESCE(SUM(o."totalAmount"), 0)::float AS "paymentValue",
        COALESCE(SUM(o."returnNetAmount") FILTER (WHERE o.type = $3), 0)::float AS returns,
        COALESCE(SUM(o."totalCost"), 0)::float - COALESCE(SUM(o."returnTotalCost"), 0)::float AS "totalCost",
        COALESCE(SUM(o."netAmount"), 0)::float - COALESCE(SUM(o."returnNetAmount") FILTER (WHERE o.type = $3), 0)::float - COALESCE(SUM(o."totalCost"), 0)::float + COALESCE(SUM(o."returnTotalCost"), 0)::float AS "grossProfit"
       FROM orders o
       WHERE o."deletedAt" IS NULL AND o.status = $1 AND o.type IN ($2, $3) ${date} ${branch}`,
      params,
    );
    return Object.fromEntries(Object.entries(result[0] || {}).map(([key, value]) => [key, numeric(value)]));
  }

  async getSummary(scope: AnalysisScope, range: AnalysisRange): Promise<Record<string, number>> {
    return this.orderSummary(scope, range);
  }

  async getDailySeries(scope: AnalysisScope, range: AnalysisRange): Promise<Record<string, number>[]> {
    const params: unknown[] = [OrderStatus.COMPLETED, OrderType.SALE, OrderType.SALE_RETURN, scope.timezone, range.startAt, range.endExclusive];
    const branch = this.scope("o", scope, params);
    const result = await DatabaseConfig.query(
      `SELECT timezone($4, o."orderAt")::date::text AS day,
        COALESCE(SUM(o."netAmount"), 0)::float AS revenue,
        COALESCE(SUM(o."returnNetAmount") FILTER (WHERE o.type = $3), 0)::float AS returns,
        (COALESCE(SUM(o."totalCost"), 0) - COALESCE(SUM(o."returnTotalCost"), 0))::float AS "totalCost",
        (COALESCE(SUM(o."netAmount"), 0) - COALESCE(SUM(o."returnNetAmount") FILTER (WHERE o.type = $3), 0) - COALESCE(SUM(o."totalCost"), 0) + COALESCE(SUM(o."returnTotalCost"), 0))::float AS "grossProfit"
       FROM orders o
       WHERE o."deletedAt" IS NULL AND o.status = $1 AND o.type IN ($2, $3)
         AND timezone($4, o."orderAt")::date >= $5::date AND timezone($4, o."orderAt")::date < $6::date ${branch}
       GROUP BY day ORDER BY day`,
      params,
    );
    return result.map((row: any) => ({
      day: String(row.day), revenue: numeric(row.revenue), returns: numeric(row.returns),
      totalCost: numeric(row.totalCost), grossProfit: numeric(row.grossProfit),
    }));
  }

  async getBranches(scope: AnalysisScope, range: AnalysisRange, sortBy: AnalysisSortBy = "revenue"): Promise<AnalysisRepositoryBranch[]> {
    const params: unknown[] = [OrderStatus.COMPLETED, OrderType.SALE, OrderType.SALE_RETURN, scope.timezone, range.startAt, range.endExclusive];
    const branch = this.scope("s", scope, params).replace('s."storeId"', "s.id");
    const rows = await DatabaseConfig.query(
      `SELECT s.id AS "storeId", s.name AS branch,
        COALESCE(SUM(o."grossAmount"), 0)::float AS "goodsTotal",
        COALESCE(SUM(o."discountAmount"), 0)::float AS discounts,
        COALESCE(SUM(o."netAmount"), 0)::float AS revenue,
        COALESCE(SUM(o."returnNetAmount") FILTER (WHERE o.type = $3), 0)::float AS returns,
        (COALESCE(SUM(o."netAmount"), 0) - COALESCE(SUM(o."returnNetAmount") FILTER (WHERE o.type = $3), 0))::float AS "netRevenue",
        (COALESCE(SUM(o."totalCost"), 0) - COALESCE(SUM(o."returnTotalCost"), 0))::float AS "totalCost",
        (COALESCE(SUM(o."netAmount"), 0) - COALESCE(SUM(o."returnNetAmount") FILTER (WHERE o.type = $3), 0) - COALESCE(SUM(o."totalCost"), 0) + COALESCE(SUM(o."returnTotalCost"), 0))::float AS "grossProfit",
        COUNT(*) FILTER (WHERE o.type = $2)::int AS "invoiceCount"
       FROM stores s LEFT JOIN orders o ON o."storeId" = s.id AND o."deletedAt" IS NULL AND o.status = $1 AND o.type IN ($2, $3)
         AND timezone($4, o."orderAt")::date >= $5::date AND timezone($4, o."orderAt")::date < $6::date
       WHERE s."deletedAt" IS NULL ${branch}
       GROUP BY o."storeId", s.id, s.name ORDER BY ${({ revenue: "revenue", returns: "returns", netRevenue: '"netRevenue"', grossProfit: '"grossProfit"', invoiceCount: '"invoiceCount"' } as Record<AnalysisSortBy, string>)[sortBy]} DESC`,
      params,
    );
    return rows.map((row: any) => ({
      branch: row.branch, goodsTotal: numeric(row.goodsTotal), discounts: numeric(row.discounts),
      revenue: numeric(row.revenue), returns: numeric(row.returns), netRevenue: numeric(row.netRevenue),
      totalCost: numeric(row.totalCost), grossProfit: numeric(row.grossProfit), invoiceCount: numeric(row.invoiceCount),
    }));
  }

  async getTop(scope: AnalysisScope, range: AnalysisRange, previous: AnalysisRange, sortBy: AnalysisSortBy, kind: "product" | "group" | "customerGroup"): Promise<any[]> {
    const params: unknown[] = [OrderStatus.COMPLETED, OrderType.SALE, OrderType.SALE_RETURN, scope.timezone, range.startAt, range.endExclusive, previous.startAt, previous.endExclusive];
    const branch = this.scope("o", scope, params);
    const isCustomerGroup = kind === "customerGroup";
    const entityId = isCustomerGroup ? `COALESCE(p."groupId"::text, 'ungrouped')` : kind === "group" ? `COALESCE(pr."groupId"::text, 'ungrouped')` : `COALESCE(pr.id::text, 'unknown')`;
    const entityName = isCustomerGroup
      ? `COALESCE(g.name, 'ChÆ°a phĂ¢n loáº¡i')`
      : kind === "group" ? `COALESCE(g.name, 'ChÆ°a phĂ¢n loáº¡i')` : `COALESCE(pr.name, 'KhĂ´ng xĂ¡c Ä‘á»‹nh')`;
    const source = isCustomerGroup
      ? `orders o LEFT JOIN partners p ON p.id = o."partnerId" LEFT JOIN attributes g ON g.id = p."groupId"`
      : `order_lines ol INNER JOIN orders o ON o.id = ol."orderId" LEFT JOIN products pr ON pr.id = ol."productId" LEFT JOIN attributes g ON g.id = pr."groupId"`;
    const returnSource = isCustomerGroup
      ? ""
      : ` UNION ALL SELECT o."storeId", CASE WHEN timezone($4, o."orderAt")::date >= $5::date AND timezone($4, o."orderAt")::date < $6::date THEN 'current' ELSE 'previous' END AS period, ${entityId}, ${entityName}, o.id, 0::float, COALESCE(ol."subTotal", 0)::float, 0::float, COALESCE(ol."totalCost", 0)::float, 0::float, COALESCE(ol.quantity, 0)::float FROM orders o INNER JOIN order_lines ol ON ol."returnOrderId" = o.id LEFT JOIN products pr ON pr.id = ol."productId" LEFT JOIN attributes g ON g.id = pr."groupId" WHERE o."deletedAt" IS NULL AND ol."deletedAt" IS NULL AND o.status = $1 AND o.type = $3 AND ((timezone($4, o."orderAt")::date >= $5::date AND timezone($4, o."orderAt")::date < $6::date) OR (timezone($4, o."orderAt")::date >= $7::date AND timezone($4, o."orderAt")::date < $8::date)) ${branch}`;
    const rows = await DatabaseConfig.query(
      `WITH source_rows AS (
        SELECT o."storeId", CASE WHEN timezone($4, o."orderAt")::date >= $5::date AND timezone($4, o."orderAt")::date < $6::date THEN 'current' ELSE 'previous' END AS period,
          ${entityId} AS entity_id, ${entityName} AS entity_name, o.id AS order_id,
          ${isCustomerGroup ? `COALESCE(o."netAmount", 0)` : `COALESCE(ol."subTotal", 0)`}::float AS revenue,
          0::float AS returns, ${isCustomerGroup ? `COALESCE(o."totalCost", 0)` : `COALESCE(ol."totalCost", 0)`}::float AS cost,
          0::float AS return_cost, ${isCustomerGroup ? "1" : "1"}::float AS invoice_count, 0::float AS return_quantity
        FROM ${source}
        WHERE o."deletedAt" IS NULL AND o.status = $1 AND ${isCustomerGroup ? `o.type IN ($2, $3)` : `o.type IN ($2, $3) AND ol."deletedAt" IS NULL`}
          AND ((timezone($4, o."orderAt")::date >= $5::date AND timezone($4, o."orderAt")::date < $6::date) OR (timezone($4, o."orderAt")::date >= $7::date AND timezone($4, o."orderAt")::date < $8::date)) ${branch}
        ${returnSource}
      ), grouped AS (
        SELECT entity_id AS id, MAX(entity_name) AS name,
          COALESCE(SUM(revenue) FILTER (WHERE period = 'current'), 0)::float AS revenue,
          COALESCE(SUM(returns) FILTER (WHERE period = 'current'), 0)::float AS returns,
          (COALESCE(SUM(revenue) FILTER (WHERE period = 'current'), 0) - COALESCE(SUM(returns) FILTER (WHERE period = 'current'), 0))::float AS net_revenue,
          (COALESCE(SUM(cost) FILTER (WHERE period = 'current'), 0) - COALESCE(SUM(return_cost) FILTER (WHERE period = 'current'), 0))::float AS total_cost,
          (COALESCE(SUM(revenue) FILTER (WHERE period = 'current'), 0) - COALESCE(SUM(returns) FILTER (WHERE period = 'current'), 0) - COALESCE(SUM(cost) FILTER (WHERE period = 'current'), 0) + COALESCE(SUM(return_cost) FILTER (WHERE period = 'current'), 0))::float AS gross_profit,
          COUNT(DISTINCT order_id) FILTER (WHERE period = 'current')::float AS invoice_count,
          COALESCE(SUM(return_quantity) FILTER (WHERE period = 'current'), 0)::float AS return_quantity,
          (COALESCE(SUM(revenue) FILTER (WHERE period = 'previous'), 0) - COALESCE(SUM(returns) FILTER (WHERE period = 'previous'), 0))::float AS previous_net_revenue,
          (COALESCE(SUM(revenue) FILTER (WHERE period = 'previous'), 0) - COALESCE(SUM(returns) FILTER (WHERE period = 'previous'), 0) - COALESCE(SUM(cost) FILTER (WHERE period = 'previous'), 0) + COALESCE(SUM(return_cost) FILTER (WHERE period = 'previous'), 0))::float AS previous_gross_profit,
          COALESCE(SUM(returns) FILTER (WHERE period = 'previous'), 0)::float AS previous_returns,
          COUNT(DISTINCT order_id) FILTER (WHERE period = 'previous')::float AS previous_invoice_count,
          COALESCE(SUM(revenue) FILTER (WHERE period = 'previous'), 0)::float AS previous_revenue
        FROM source_rows GROUP BY entity_id
      ) SELECT *, CASE WHEN previous_${sortBy === "returns" ? "revenue" : sortBy === "netRevenue" ? "net_revenue" : sortBy === "grossProfit" ? "gross_profit" : sortBy === "invoiceCount" ? "invoice_count" : "revenue"} = 0 THEN 0 ELSE 0 END AS growth
         FROM grouped WHERE revenue <> 0 OR returns <> 0 ORDER BY ${this.sortExpression(sortBy)} DESC LIMIT 10`,
      params,
    );
    return rows.map((row: any) => {
      const current = sortBy === "returns" ? numeric(row.returns) : sortBy === "netRevenue" ? numeric(row.net_revenue) : sortBy === "grossProfit" ? numeric(row.gross_profit) : sortBy === "invoiceCount" ? numeric(row.invoice_count) : numeric(row.revenue);
      const previousValue = sortBy === "returns" ? numeric(row.previous_returns) : sortBy === "netRevenue" ? numeric(row.previous_net_revenue) : sortBy === "grossProfit" ? numeric(row.previous_gross_profit) : sortBy === "invoiceCount" ? numeric(row.previous_invoice_count) : numeric(row.previous_revenue);
      return {
        id: String(row.id), name: row.name, revenue: numeric(row.revenue), returns: numeric(row.returns),
        netRevenue: numeric(row.net_revenue), grossProfit: numeric(row.gross_profit), totalCost: numeric(row.total_cost),
        invoiceCount: numeric(row.invoice_count), returnQuantity: numeric(row.return_quantity),
        returnRatio: numeric(row.revenue) ? numeric(row.returns) / numeric(row.revenue) * 100 : 0,
        averageOrder: numeric(row.invoice_count) ? numeric(row.net_revenue) / numeric(row.invoice_count) : 0,
        margin: numeric(row.net_revenue) ? numeric(row.gross_profit) / numeric(row.net_revenue) * 100 : 0,
        growth: previousValue === 0 ? (current > 0 ? 100 : 0) : (current - previousValue) / Math.abs(previousValue) * 100,
      };
    });
  }

  private sortExpression(sortBy: AnalysisSortBy): string {
    return ({ revenue: "revenue", returns: "returns", netRevenue: "net_revenue", grossProfit: "gross_profit", invoiceCount: "invoice_count" } as Record<AnalysisSortBy, string>)[sortBy];
  }

  async getCostStructure(scope: AnalysisScope, range: AnalysisRange): Promise<any[]> {
    const params: unknown[] = [IncomeExpenseStatus.COMPLETED, IncomeExpenseType.EXPENSE, scope.timezone, range.startAt, range.endExclusive];
    const branch = this.scope("ie", scope, params);
    return DatabaseConfig.query(
      `SELECT COALESCE(category.name, 'ChÆ°a phĂ¢n loáº¡i') AS name, SUM(ie.amount)::float AS total, ie."storeId", COALESCE(s.name, 'KhĂ´ng xĂ¡c Ä‘á»‹nh') AS branch
       FROM income_expenses ie
       LEFT JOIN attributes category ON category.id = ie."categoryId"
       LEFT JOIN stores s ON s.id = ie."storeId"
       WHERE ie."deletedAt" IS NULL AND ie.status = $1 AND ie.type = $2 AND ie."partnerId" IS NULL
         AND COALESCE(category.name, '') <> 'Ná»™p thuáº¿ VAT'
         AND timezone($3, ie."occurredAt")::date >= $4::date AND timezone($3, ie."occurredAt")::date < $5::date ${branch}
       GROUP BY category.name, ie."storeId", s.name ORDER BY total DESC`,
      params,
    ).then((rows: any[]) => rows.map((row) => ({ name: row.name, total: numeric(row.total), branch: row.branch, storeId: row.storeId })));
  }

  async getProfitComponents(scope: AnalysisScope, range: AnalysisRange): Promise<Record<string, number>> {
    const params: unknown[] = [IncomeExpenseStatus.COMPLETED, IncomeExpenseType.INCOME, IncomeExpenseType.EXPENSE, scope.timezone, range.startAt, range.endExclusive];
    const branch = this.scope("ie", scope, params);
    const rows = await DatabaseConfig.query(
      `SELECT
        COALESCE(SUM(ie.amount) FILTER (WHERE ie.type = $3 AND ie."partnerId" IS NULL AND COALESCE(category.name, '') <> 'Ná»™p thuáº¿ VAT'), 0)::float AS "otherCost",
        COALESCE(SUM(ie.amount) FILTER (WHERE ie.type = $2 AND ie."partnerId" IS NULL), 0)::float AS "otherIncome"
       FROM income_expenses ie
       LEFT JOIN attributes category ON category.id = ie."categoryId"
       WHERE ie."deletedAt" IS NULL AND ie.status = $1
         AND timezone($4, ie."occurredAt")::date >= $5::date AND timezone($4, ie."occurredAt")::date < $6::date ${branch}`,
      params,
    );
    const row = rows[0] || {};
    return { otherCost: numeric(row.otherCost), otherIncome: numeric(row.otherIncome) };
  }

  async getProfitComponentsByBranch(scope: AnalysisScope, range: AnalysisRange): Promise<AnalysisProfitComponentsBranch[]> {
    const params: unknown[] = [IncomeExpenseStatus.COMPLETED, IncomeExpenseType.INCOME, IncomeExpenseType.EXPENSE, scope.timezone, range.startAt, range.endExclusive];
    const branch = this.scope("ie", scope, params);
    const rows = await DatabaseConfig.query(
      `SELECT COALESCE(s.name, 'KhĂ´ng xĂ¡c Ä‘á»‹nh') AS branch,
        COALESCE(SUM(ie.amount) FILTER (WHERE ie.type = $3 AND ie."partnerId" IS NULL AND COALESCE(category.name, '') <> 'Ná»™p thuáº¿ VAT'), 0)::float AS "otherCost",
        COALESCE(SUM(ie.amount) FILTER (WHERE ie.type = $2 AND ie."partnerId" IS NULL), 0)::float AS "otherIncome"
       FROM income_expenses ie
       LEFT JOIN attributes category ON category.id = ie."categoryId"
       LEFT JOIN stores s ON s.id = ie."storeId"
       WHERE ie."deletedAt" IS NULL AND ie.status = $1
         AND timezone($4, ie."occurredAt")::date >= $5::date AND timezone($4, ie."occurredAt")::date < $6::date ${branch}
       GROUP BY ie."storeId", s.name`,
      params,
    );
    return rows.map((row: any) => ({
      branch: row.branch,
      otherCost: numeric(row.otherCost),
      otherIncome: numeric(row.otherIncome),
    }));
  }

  async getAdjustments(scope: AnalysisScope, range: AnalysisRange): Promise<Record<string, number>> {
    const params: unknown[] = [scope.timezone, range.startAt, range.endExclusive];
    const inventoryBranch = this.scope("ia", scope, params);
    const fundBranch = this.scope("fund", scope, params);
    const result = await DatabaseConfig.query(
      `SELECT
        (SELECT COALESCE(SUM(ia."totalAdjustmentAmount"), 0) FROM inventory_adjustments ia WHERE ia."deletedAt" IS NULL AND ia."isInitial" IS NOT TRUE AND timezone($1, ia."occurredAt")::date >= $2::date AND timezone($1, ia."occurredAt")::date < $3::date ${inventoryBranch}) AS inventory,
        (SELECT COALESCE(SUM(f."deltaAmount"), 0) FROM fund_adjustments f LEFT JOIN funds fund ON fund.id = f."fundId" WHERE f."deletedAt" IS NULL AND f."isInitial" IS NOT TRUE AND timezone($1, f."occurredAt")::date >= $2::date AND timezone($1, f."occurredAt")::date < $3::date ${fundBranch}) AS fund,
        (SELECT COALESCE(SUM(v."deltaAmount"), 0) FROM vat_adjustments v WHERE v."deletedAt" IS NULL AND v."isInitial" IS NOT TRUE AND timezone($1, v."occurredAt")::date >= $2::date AND timezone($1, v."occurredAt")::date < $3::date) AS vat,
        (SELECT COALESCE(SUM(d."deltaAmount") FILTER (WHERE d.side = '${DebtSide.RECEIVABLE}'), 0) - COALESCE(SUM(d."deltaAmount") FILTER (WHERE d.side = '${DebtSide.PAYABLE}'), 0) FROM debt_adjustments d WHERE d."deletedAt" IS NULL AND d."isInitial" IS NOT TRUE AND timezone($1, d."occurredAt")::date >= $2::date AND timezone($1, d."occurredAt")::date < $3::date) AS debt`,
      params,
    );
    const row = result[0] || {};
    return { inventory: numeric(row.inventory), fund: numeric(row.fund), vat: numeric(row.vat), debt: numeric(row.debt) };
  }

  /**
   * Cost variances are kept outside order gross profit because they do not
   * represent sales revenue:
   * - value-only inventory transactions from price histories;
   * - supplier return value minus the cost removed from inventory;
   * - the difference between source transfer cost and receiving-store cost.
   */
  async getCostDifference(scope: AnalysisScope, range: AnalysisRange): Promise<number> {
    const params: unknown[] = [scope.timezone, range.startAt, range.endExclusive];
    const priceBranch = this.scope("it", scope, params);
    const purchaseBranch = this.scope("o", scope, params);
    let transferBranch = "";
    if (Array.isArray(scope.storeIds)) {
      if (!scope.storeIds.length) transferBranch = " AND 1 = 0";
      else {
        params.push(scope.storeIds);
        transferBranch = ` AND (st."fromStoreId" = ANY($${params.length}::uuid[]) OR st."toStoreId" = ANY($${params.length}::uuid[]))`;
      }
    } else if (scope.branch !== "all") {
      params.push(scope.branch);
      transferBranch = ` AND (st."fromStoreId" = $${params.length} OR st."toStoreId" = $${params.length})`;
    }
    const rows = await DatabaseConfig.query(
      `SELECT
        COALESCE((
          SELECT SUM(CASE WHEN it.type = 'in' THEN ABS(it.amount) ELSE -ABS(it.amount) END)
          FROM inventory_transactions it
          WHERE it."deletedAt" IS NULL AND it."refType" = 'product_price_update'
            AND timezone($1, it."occurredAt")::date >= $2::date
            AND timezone($1, it."occurredAt")::date < $3::date ${priceBranch}
        ), 0)
        + COALESCE((
          SELECT SUM(COALESCE(o."totalAmount", 0) - COALESCE(o."totalCost", 0))
          FROM orders o
          WHERE o."deletedAt" IS NULL AND o.status = 'completed' AND o.type = 'purchase_return'
            AND timezone($1, COALESCE(o."occurredAt", o."orderAt"))::date >= $2::date
            AND timezone($1, COALESCE(o."occurredAt", o."orderAt"))::date < $3::date ${purchaseBranch}
        ), 0)
        + COALESCE((
          SELECT SUM(COALESCE(destination.amount, 0) - COALESCE(source.amount, 0))
          FROM store_transfers st
          INNER JOIN store_transfer_lines stl ON stl."transferId" = st.id AND stl."deletedAt" IS NULL
          LEFT JOIN inventory_transactions source
            ON source."refType" = 'transfer' AND source."refId" = st.id
           AND source."storeId" = st."fromStoreId" AND source.type = 'out'
           AND source."productId" = stl."productId"
           AND source."deletedAt" IS NULL
          LEFT JOIN inventory_transactions destination
            ON destination."refType" = 'transfer' AND destination."refId" = st.id
           AND destination."storeId" = st."toStoreId" AND destination.type = 'in'
           AND destination."productId" = stl."productId"
           AND destination."deletedAt" IS NULL
          WHERE st."deletedAt" IS NULL AND st.status = 'imported'
            AND source.id IS NOT NULL AND destination.id IS NOT NULL
            AND timezone($1, st."importedAt")::date >= $2::date
            AND timezone($1, st."importedAt")::date < $3::date ${transferBranch}
        ), 0)::float AS "costDifference"`,
      params,
    );
    return numeric(rows[0]?.costDifference);
  }

  async getCostDifferenceByBranch(
    scope: AnalysisScope,
    range: AnalysisRange,
  ): Promise<AnalysisBranchValue[]> {
    const params: unknown[] = [scope.timezone, range.startAt, range.endExclusive];
    const priceBranch = this.scope("it", scope, params);
    const purchaseBranch = this.scope("o", scope, params);
    let transferBranch = "";
    if (Array.isArray(scope.storeIds)) {
      if (!scope.storeIds.length) transferBranch = " AND 1 = 0";
      else {
        params.push(scope.storeIds);
        transferBranch = ` AND (st."fromStoreId" = ANY($${params.length}::uuid[]) OR st."toStoreId" = ANY($${params.length}::uuid[]))`;
      }
    } else if (scope.branch !== "all") {
      params.push(scope.branch);
      transferBranch = ` AND (st."fromStoreId" = $${params.length} OR st."toStoreId" = $${params.length})`;
    }
    const rows = await DatabaseConfig.query(
      `SELECT branch, SUM(value)::float AS value
       FROM (
         SELECT COALESCE(s.name, 'Khong xac dinh') AS branch,
           SUM(CASE WHEN it.type = 'in' THEN ABS(it.amount) ELSE -ABS(it.amount) END)::float AS value
         FROM inventory_transactions it
         LEFT JOIN stores s ON s.id = it."storeId"
         WHERE it."deletedAt" IS NULL AND it."refType" = 'product_price_update'
           AND timezone($1, it."occurredAt")::date >= $2::date
           AND timezone($1, it."occurredAt")::date < $3::date ${priceBranch}
         GROUP BY s.name
         UNION ALL
         SELECT COALESCE(s.name, 'Khong xac dinh') AS branch,
           SUM(COALESCE(o."totalAmount", 0) - COALESCE(o."totalCost", 0))::float AS value
         FROM orders o
         LEFT JOIN stores s ON s.id = o."storeId"
         WHERE o."deletedAt" IS NULL AND o.status = 'completed' AND o.type = 'purchase_return'
           AND timezone($1, COALESCE(o."occurredAt", o."orderAt"))::date >= $2::date
           AND timezone($1, COALESCE(o."occurredAt", o."orderAt"))::date < $3::date ${purchaseBranch}
         GROUP BY s.name
         UNION ALL
         SELECT 'Toan he thong' AS branch,
           SUM(COALESCE(destination.amount, 0) - COALESCE(source.amount, 0))::float AS value
         FROM store_transfers st
         INNER JOIN store_transfer_lines stl ON stl."transferId" = st.id AND stl."deletedAt" IS NULL
         LEFT JOIN inventory_transactions source
           ON source."refType" = 'transfer' AND source."refId" = st.id
          AND source."storeId" = st."fromStoreId" AND source.type = 'out'
          AND source."productId" = stl."productId"
          AND source."deletedAt" IS NULL
         LEFT JOIN inventory_transactions destination
           ON destination."refType" = 'transfer' AND destination."refId" = st.id
          AND destination."storeId" = st."toStoreId" AND destination.type = 'in'
          AND destination."productId" = stl."productId"
          AND destination."deletedAt" IS NULL
         WHERE st."deletedAt" IS NULL AND st.status = 'imported'
           AND source.id IS NOT NULL AND destination.id IS NOT NULL
           AND timezone($1, st."importedAt")::date >= $2::date
           AND timezone($1, st."importedAt")::date < $3::date ${transferBranch}
       ) cost_difference_rows
       GROUP BY branch
       HAVING SUM(value) <> 0`,
      params,
    );
    return rows.map((row: any) => ({
      branch: row.branch,
      value: numeric(row.value),
    }));
  }

  async getAdjustmentsByBranch(scope: AnalysisScope, range: AnalysisRange): Promise<AnalysisBranchValue[]> {
    const params: unknown[] = [scope.timezone, range.startAt, range.endExclusive];
    const inventoryBranch = this.scope("ia", scope, params);
    const fundBranch = this.scope("fund", scope, params);
    const rows = await DatabaseConfig.query(
      `SELECT branch, COALESCE(SUM(value), 0)::float AS value
       FROM (
         SELECT COALESCE(s.name, 'Khong xac dinh') AS branch, COALESCE(SUM(ia."totalAdjustmentAmount"), 0)::float AS value
         FROM inventory_adjustments ia
         LEFT JOIN stores s ON s.id = ia."storeId"
         WHERE ia."deletedAt" IS NULL AND ia."isInitial" IS NOT TRUE
           AND timezone($1, ia."occurredAt")::date >= $2::date AND timezone($1, ia."occurredAt")::date < $3::date ${inventoryBranch}
         GROUP BY ia."storeId", s.name
         UNION ALL
         SELECT COALESCE(s.name, 'Khong xac dinh') AS branch, COALESCE(SUM(f."deltaAmount"), 0)::float AS value
         FROM fund_adjustments f
         LEFT JOIN funds fund ON fund.id = f."fundId"
         LEFT JOIN stores s ON s.id = fund."storeId"
         WHERE f."deletedAt" IS NULL AND f."isInitial" IS NOT TRUE
           AND timezone($1, f."occurredAt")::date >= $2::date AND timezone($1, f."occurredAt")::date < $3::date ${fundBranch}
         GROUP BY fund."storeId", s.name
         UNION ALL
         SELECT 'Toan he thong' AS branch, COALESCE(SUM(v."deltaAmount"), 0)::float AS value
         FROM vat_adjustments v
         WHERE v."deletedAt" IS NULL AND v."isInitial" IS NOT TRUE
           AND timezone($1, v."occurredAt")::date >= $2::date AND timezone($1, v."occurredAt")::date < $3::date
         UNION ALL
         SELECT 'Toan he thong' AS branch,
           (COALESCE(SUM(d."deltaAmount") FILTER (WHERE d.side = '${DebtSide.RECEIVABLE}'), 0)
             - COALESCE(SUM(d."deltaAmount") FILTER (WHERE d.side = '${DebtSide.PAYABLE}'), 0))::float AS value
         FROM debt_adjustments d
         WHERE d."deletedAt" IS NULL AND d."isInitial" IS NOT TRUE
           AND timezone($1, d."occurredAt")::date >= $2::date AND timezone($1, d."occurredAt")::date < $3::date
       ) adjustment_rows
       GROUP BY branch
       HAVING COALESCE(SUM(value), 0) <> 0`,
      params,
    );
    return rows.map((row: any) => ({ branch: row.branch, value: numeric(row.value) }));
  }

  async getFreeShippingAndInternalExport(scope: AnalysisScope, range: AnalysisRange): Promise<number> {
    const params: unknown[] = [OrderStatus.COMPLETED, OrderType.SALE, scope.timezone, range.startAt, range.endExclusive];
    const branch = this.scope("o", scope, params);
    const inventoryBranch = this.scope("it", scope, params);
    const result = await DatabaseConfig.query(
      `SELECT (
         COALESCE(SUM(CASE WHEN o."isFreeShipping" THEN COALESCE(o."shippingFee", 0) ELSE 0 END), 0)
         + COALESCE((SELECT SUM(it.amount) FROM inventory_transactions it
             WHERE it."deletedAt" IS NULL AND it."refType" = 'internal_export' AND it.type = 'out'
               AND timezone($3, it."occurredAt")::date >= $4::date AND timezone($3, it."occurredAt")::date < $5::date ${inventoryBranch}), 0)
       )::float AS shipping
       FROM orders o WHERE o."deletedAt" IS NULL AND o.status = $1 AND o.type = $2
       AND timezone($3, o."orderAt")::date >= $4::date AND timezone($3, o."orderAt")::date < $5::date ${branch}`,
      params,
    );
    return numeric(result[0]?.shipping);
  }

  async getFreeShippingAndInternalExportByBranch(scope: AnalysisScope, range: AnalysisRange): Promise<AnalysisBranchValue[]> {
    const params: unknown[] = [OrderStatus.COMPLETED, OrderType.SALE, scope.timezone, range.startAt, range.endExclusive];
    const orderBranch = this.scope("o", scope, params);
    const inventoryBranch = this.scope("it", scope, params);
    const rows = await DatabaseConfig.query(
      `SELECT branch, COALESCE(SUM(value), 0)::float AS value
       FROM (
         SELECT COALESCE(s.name, 'KhĂ´ng xĂ¡c Ä‘á»‹nh') AS branch,
           COALESCE(SUM(CASE WHEN o."isFreeShipping" THEN COALESCE(o."shippingFee", 0) ELSE 0 END), 0)::float AS value
         FROM orders o
         LEFT JOIN stores s ON s.id = o."storeId"
         WHERE o."deletedAt" IS NULL AND o.status = $1 AND o.type = $2
           AND timezone($3, o."orderAt")::date >= $4::date AND timezone($3, o."orderAt")::date < $5::date ${orderBranch}
         GROUP BY o."storeId", s.name
         UNION ALL
         SELECT COALESCE(s.name, 'KhĂ´ng xĂ¡c Ä‘á»‹nh') AS branch, COALESCE(SUM(it.amount), 0)::float AS value
         FROM inventory_transactions it
         LEFT JOIN stores s ON s.id = it."storeId"
         WHERE it."deletedAt" IS NULL AND it."refType" = 'internal_export' AND it.type = 'out'
           AND timezone($3, it."occurredAt")::date >= $4::date AND timezone($3, it."occurredAt")::date < $5::date ${inventoryBranch}
         GROUP BY it."storeId", s.name
       ) shipping_rows
       GROUP BY branch`,
      params,
    );
    return rows.map((row: any) => ({ branch: row.branch, value: numeric(row.value) }));
  }

  async getProductData(scope: AnalysisScope, range: AnalysisRange): Promise<Record<string, unknown>[]> {
    const params: unknown[] = [Array.isArray(scope.storeIds) ? scope.storeIds : scope.branch === "all" ? null : [scope.branch]];
    return DatabaseConfig.query(
      `SELECT p.id, p.name, COALESCE(a.name, 'ChÆ°a phĂ¢n loáº¡i') AS group, COALESCE((p."stockMetadata"->'total'->>'quantity')::float, 0) AS quantity, COALESCE((p."stockMetadata"->'total'->>'value')::float, 0) AS value
       FROM products p LEFT JOIN attributes a ON a.id = p."groupId" WHERE p."deletedAt" IS NULL AND ($1::uuid[] IS NULL OR EXISTS (SELECT 1 FROM store_products sp WHERE sp."productId" = p.id AND sp."storeId" = ANY($1::uuid[]))) ORDER BY value DESC LIMIT 100`,
      params,
    );
  }

  async getInventoryData(scope: AnalysisScope, range: AnalysisRange): Promise<Record<string, unknown>[]> {
    const params: unknown[] = [scope.timezone, range.startAt, range.endExclusive];
    const branch = this.scope("it", scope, params);
    return DatabaseConfig.query(
      `SELECT it."productId" AS id, COALESCE(p.name, 'KhĂ´ng xĂ¡c Ä‘á»‹nh') AS name,
        COALESCE(SUM(CASE WHEN it.type = 'in' THEN ABS(it.quantity) ELSE -ABS(it.quantity) END), 0)::float AS quantity,
        COALESCE(SUM(CASE WHEN it.type = 'in' THEN ABS(it.amount) ELSE -ABS(it.amount) END), 0)::float AS value,
        MAX(it."quantityAfter")::float AS "closingQuantity", MAX(it."inventoryValueAfter")::float AS "closingValue"
       FROM inventory_transactions it LEFT JOIN products p ON p.id = it."productId"
       WHERE it."deletedAt" IS NULL AND timezone($1, it."occurredAt")::date >= $2::date AND timezone($1, it."occurredAt")::date < $3::date ${branch}
       GROUP BY it."productId", p.name ORDER BY value DESC LIMIT 100`,
      params,
    );
  }

  async getProductClassificationData(scope: AnalysisScope): Promise<Record<string, unknown>[]> {
    const params: unknown[] = [Array.isArray(scope.storeIds) ? scope.storeIds : scope.branch === "all" ? null : [scope.branch]];
    return DatabaseConfig.query(
      `SELECT COALESCE(a.name, 'ChÆ°a phĂ¢n loáº¡i') AS group, COUNT(*)::int AS count,
        COALESCE(SUM(CASE WHEN $1::uuid IS NULL THEN (p."stockMetadata"->'total'->>'value')::float ELSE (p."stockMetadata"->'byStore'->($1::text)->>'value')::float END), 0)::float AS value
       FROM products p LEFT JOIN attributes a ON a.id = p."groupId"
       WHERE p."deletedAt" IS NULL AND ($1::uuid[] IS NULL OR EXISTS (SELECT 1 FROM store_products sp WHERE sp."productId" = p.id AND sp."storeId" = ANY($1::uuid[])))
       GROUP BY a.name ORDER BY value DESC`,
      params,
    );
  }

  async getCustomerOverviewData(scope: AnalysisScope, range: AnalysisRange): Promise<Record<string, unknown>[]> {
    const params: unknown[] = [OrderStatus.COMPLETED, OrderType.SALE, OrderType.SALE_RETURN];
    const date = this.orderDate("o", scope, range, params);
    const branch = this.scope("o", scope, params);
    return DatabaseConfig.query(
      `SELECT p.id, p.name, COUNT(o.id)::int AS "invoiceCount", COALESCE(SUM(o."netAmount"), 0)::float AS revenue
       FROM partners p LEFT JOIN orders o ON o."partnerId" = p.id AND o."deletedAt" IS NULL AND o.status = $1 AND o.type IN ($2, $3) ${date} ${branch}
       WHERE p."deletedAt" IS NULL AND p.type = 'customer'
       GROUP BY p.id, p.name ORDER BY revenue DESC LIMIT 100`,
      params,
    );
  }

  async getCustomerData(scope: AnalysisScope): Promise<Record<string, unknown>[]> {
    const params: unknown[] = [];
    const branch = Array.isArray(scope.storeIds)
      ? scope.storeIds.length === 0
        ? " AND 1 = 0"
        : (params.push(scope.storeIds), ` AND EXISTS (SELECT 1 FROM orders o WHERE o."partnerId" = p.id AND o."storeId" = ANY($${params.length}::uuid[]))`)
      : scope.branch === "all" ? "" : (params.push([scope.branch]), ` AND EXISTS (SELECT 1 FROM orders o WHERE o."partnerId" = p.id AND o."storeId" = ANY($1::uuid[]))`);
    return DatabaseConfig.query(`SELECT COALESCE(g.name, 'ChÆ°a phĂ¢n loáº¡i') AS group, COUNT(*)::int AS count FROM partners p LEFT JOIN attributes g ON g.id = p."groupId" WHERE p."deletedAt" IS NULL AND p.type = 'customer' ${branch} GROUP BY g.name ORDER BY count DESC`, params);
  }

  async getReceivable(scope: AnalysisScope, range: AnalysisRange): Promise<Record<string, unknown>[]> {
    const params: unknown[] = [scope.timezone, range.endExclusive];
    return DatabaseConfig.query(`SELECT d."partnerId" AS id, COALESCE(p.name, 'KhĂ´ng xĂ¡c Ä‘á»‹nh') AS name, COALESCE(SUM(CASE WHEN d.type = 'in' THEN d.amount ELSE -d.amount END), 0)::float AS amount FROM debt_transactions d LEFT JOIN partners p ON p.id = d."partnerId" WHERE d."deletedAt" IS NULL AND d.side = '${DebtSide.RECEIVABLE}' AND timezone($1, d."occurredAt")::date < $2::date GROUP BY d."partnerId", p.name ORDER BY amount DESC LIMIT 100`, params);
  }
}

export interface AnalysisRepositoryBranch {
  branch: string;
  goodsTotal: number;
  discounts: number;
  revenue: number;
  returns: number;
  netRevenue: number;
  totalCost: number;
  grossProfit: number;
  invoiceCount: number;
}

export interface AnalysisProfitComponentsBranch {
  branch: string;
  otherCost: number;
  otherIncome: number;
}

export interface AnalysisBranchValue {
  branch: string;
  value: number;
}


