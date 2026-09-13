import { inject, injectable } from "inversify";
import { Request, Response } from "express";
import { asyncHandler } from "@/shared/utils/controller.utils";
import { DashboardService } from "./dashboard.service";
import { DASHBOARD_TYPES } from "./dashboard.types";
import {
  DashboardMetricsQueryDto,
  DashboardRevenueQueryDto,
  DashboardTopCustomerQueryDto,
  DashboardTopProductQueryDto,
} from "./dashboard.validator";

const getTimezone = (req: Request, queryTimezone?: string): string | undefined =>
  queryTimezone || (req.headers["x-timezone"] as string | undefined);

const getStoreIds = (req: Request, requested?: string[]): string[] | undefined => {
  if (requested) {
    return Array.isArray(req.availableStoreIds)
      ? requested.filter((storeId) => req.availableStoreIds!.includes(storeId))
      : requested;
  }
  return req.availableStoreIds;
};

@injectable()
export class DashboardController {
  constructor(
    @inject(DASHBOARD_TYPES.Service)
    private service: DashboardService,
  ) {}

  getMetrics = asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as DashboardMetricsQueryDto;
    const data = await this.service.getMetrics(
      undefined,
      getTimezone(req, query.timezone),
      getStoreIds(req, query.storeIds),
    );
    res.json({ success: true, statusCode: 200, message: "OK", data });
  });

  getRevenue = asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as DashboardRevenueQueryDto;
    const data = await this.service.getRevenue(
      undefined,
      getTimezone(req, query.timezone),
      query.timeView,
      query.typeView,
      query.typeCal,
      getStoreIds(req, query.storeIds),
    );
    res.json({ success: true, statusCode: 200, message: "OK", data });
  });

  getTopProducts = asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as DashboardTopProductQueryDto;
    const data = await this.service.getTopProducts(
      undefined,
      getTimezone(req, query.timezone),
      query.timeView,
      query.typeCal,
      getStoreIds(req, query.storeIds),
    );
    res.json({ success: true, statusCode: 200, message: "OK", data });
  });

  getTopCustomers = asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as DashboardTopCustomerQueryDto;
    const data = await this.service.getTopCustomers(
      undefined,
      getTimezone(req, query.timezone),
      query.timeView,
      getStoreIds(req, query.storeIds),
    );
    res.json({ success: true, statusCode: 200, message: "OK", data });
  });
}
