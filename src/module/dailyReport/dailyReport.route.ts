import { Router } from "express";
import { inject, injectable } from "inversify";
import { permissionMiddleware } from "@/shared/middleware/permission.middleware";
import { zodValidate } from "@/shared/middleware/validation.middleware";
import { DailyReportController } from "./dailyReport.controller";
import { DAILY_REPORT_TYPES } from "./dailyReport.types";
import {
  CreateDailyReportSchema,
  DailyReportParamsSchema,
  DailyReportQuerySchema,
  UpdateDailyReportSchema,
} from "./dailyReport.validator";

@injectable()
export class DailyReportRouter {
  private router = Router();

  constructor(@inject(DAILY_REPORT_TYPES.Controller) controller: DailyReportController) {
    this.router.get(
      "/current",
      permissionMiddleware("dailyReport", "read"),
      controller.getCurrent,
    );
    this.router.get(
      "/",
      zodValidate(DailyReportQuerySchema, "query"),
      permissionMiddleware("dailyReport", "read"),
      controller.getAllWithPagination,
    );
    this.router.get(
      "/:id",
      zodValidate(DailyReportParamsSchema, "params"),
      permissionMiddleware("dailyReport", "read"),
      controller.getById,
    );
    this.router.post(
      "/",
      zodValidate(CreateDailyReportSchema, "body"),
      permissionMiddleware("dailyReport", "create"),
      controller.create,
    );
    this.router.put(
      "/:id",
      zodValidate(DailyReportParamsSchema, "params"),
      zodValidate(UpdateDailyReportSchema, "body"),
      permissionMiddleware("dailyReport", "update"),
      controller.update,
    );
    this.router.post(
      "/:id/cancel",
      zodValidate(DailyReportParamsSchema, "params"),
      permissionMiddleware("dailyReport", "update"),
      controller.cancel,
    );
    this.router.delete(
      "/:id",
      zodValidate(DailyReportParamsSchema, "params"),
      permissionMiddleware("dailyReport", "delete"),
      controller.delete,
    );
  }

  getRouter(): Router {
    return this.router;
  }
}
