import { inject, injectable } from "inversify";
import { Router } from "express";
import { permissionMiddleware } from "@/shared/middleware/permission.middleware";
import { zodValidate } from "@/shared/middleware/validation.middleware";
import { DashboardController } from "./dashboard.controller";
import { DASHBOARD_TYPES } from "./dashboard.types";
import {
  DashboardMetricsQuerySchema,
  DashboardRevenueQuerySchema,
  DashboardTopCustomerQuerySchema,
  DashboardTopProductQuerySchema,
} from "./dashboard.validator";

@injectable()
export class DashboardRouter {
  private router = Router();

  constructor(
    @inject(DASHBOARD_TYPES.Controller)
    controller: DashboardController,
  ) {
    this.router.use(permissionMiddleware("dashboard", "read"));
    this.router.get(
      "/metrics",
      zodValidate(DashboardMetricsQuerySchema, "query"),
      controller.getMetrics,
    );
    this.router.get(
      "/revenue",
      zodValidate(DashboardRevenueQuerySchema, "query"),
      controller.getRevenue,
    );
    this.router.get(
      "/top-products",
      zodValidate(DashboardTopProductQuerySchema, "query"),
      controller.getTopProducts,
    );
    this.router.get(
      "/top-customers",
      zodValidate(DashboardTopCustomerQuerySchema, "query"),
      controller.getTopCustomers,
    );
    // this.router.get(
    //   "/",
    //   zodValidate(DashboardMetricsQuerySchema, "query"),
    //   controller.getMetrics,
    // );
  }

  getRouter(): Router {
    return this.router;
  }
}
