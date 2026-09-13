import { inject, injectable } from "inversify";
import { Request, Response } from "express";
import { asyncHandler } from "@/shared/utils/controller.utils";
import { ANALYSIS_TYPES } from "./analysis.types";
import { AnalysisService } from "./analysis.service";
import { AnalysisQueryDto } from "./analysis.validator";

@injectable()
export class AnalysisController {
  constructor(@inject(ANALYSIS_TYPES.Service) private service: AnalysisService) {}

  private query(req: Request): AnalysisQueryDto {
    return {
      ...(req.query as unknown as AnalysisQueryDto),
      timezone: typeof req.query.timezone === "string"
        ? req.query.timezone
        : req.headers["x-timezone"] as string | undefined,
    };
  }

  private branch(req: Request, query: AnalysisQueryDto): string | string[] {
    const requested = query.storeIds?.length
      ? query.storeIds
      : query.storeId
        ? [query.storeId]
        : undefined;
    const accessible = req.availableStoreIds;
    if (!requested) return accessible ?? "all";
    return Array.isArray(accessible)
      ? requested.filter((storeId) => accessible.includes(storeId))
      : requested;
  }

  private respond = async (res: Response, callback: () => Promise<unknown>) => res.json({ success: true, statusCode: 200, message: "OK", data: await callback() });

  getSaleOverviewMetrics = asyncHandler(async (req, res) => {
    const query = this.query(req);
    return this.respond(res, () => this.service.getSaleOverviewMetrics(this.branch(req, query), query));
  });

  getSaleBusinessIndicator = asyncHandler(async (req, res) => {
    const query = this.query(req);
    return this.respond(res, () => this.service.getSaleBusinessIndicator(this.branch(req, query), query));
  });

  getSaleTopProductGroups = asyncHandler(async (req, res) => {
    const query = this.query(req);
    return this.respond(res, () => this.service.getSaleOverviewTop(this.branch(req, query), query, "group"));
  });

  getSaleTopProducts = asyncHandler(async (req, res) => {
    const query = this.query(req);
    return this.respond(res, () => this.service.getSaleOverviewTop(this.branch(req, query), query, "product"));
  });

  getSaleTopCustomerGroups = asyncHandler(async (req, res) => {
    const query = this.query(req);
    return this.respond(res, () => this.service.getSaleOverviewTop(this.branch(req, query), query, "customerGroup"));
  });

  getSaleProfitMetrics = asyncHandler(async (req, res) => {
    const query = this.query(req);
    return this.respond(res, () => this.service.getSaleProfitMetrics(this.branch(req, query), query));
  });

  getSaleProfitCostStructure = asyncHandler(async (req, res) => {
    const query = this.query(req);
    return this.respond(res, () => this.service.getSaleProfitCostStructure(this.branch(req, query), query));
  });

  getSaleProfitEffectiveness = asyncHandler(async (req, res) => {
    const query = this.query(req);
    return this.respond(res, () => this.service.getSaleProfitEffectiveness(this.branch(req, query), query));
  });

  getProductOverview = asyncHandler(async (req, res) => { const query = this.query(req); return this.respond(res, () => this.service.getProductOverview(this.branch(req, query), query)); });
  getProductInventory = asyncHandler(async (req, res) => { const query = this.query(req); return this.respond(res, () => this.service.getProductInventory(this.branch(req, query), query)); });
  getProductClassification = asyncHandler(async (req, res) => { const query = this.query(req); return this.respond(res, () => this.service.getProductClassification(this.branch(req, query), query)); });
  getCustomerOverview = asyncHandler(async (req, res) => { const query = this.query(req); return this.respond(res, () => this.service.getCustomerOverview(this.branch(req, query), query)); });
  getCustomerClassification = asyncHandler(async (req, res) => { const query = this.query(req); return this.respond(res, () => this.service.getCustomerClassification(this.branch(req, query), query)); });
  getReceivable = asyncHandler(async (req, res) => { const query = this.query(req); return this.respond(res, () => this.service.getReceivable(this.branch(req, query), query)); });
}
