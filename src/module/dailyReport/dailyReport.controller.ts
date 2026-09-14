import { inject, injectable } from "inversify";
import { Request, Response, NextFunction } from "express";
import { BaseController } from "@/shared/base/BaseController";
import { DailyReport } from "@/database/models/DailyReport";
import { DailyReportService } from "./dailyReport.service";
import { DAILY_REPORT_TYPES } from "./dailyReport.types";

@injectable()
export class DailyReportController extends BaseController<DailyReport> {
  protected service: DailyReportService;

  constructor(@inject(DAILY_REPORT_TYPES.Service) service: DailyReportService) {
    super();
    this.service = service;
  }

  getCurrent = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const storeId = req.storeContext?.storeId;
      if (!storeId) return res.status(400).json({ success: false, message: "store.required" });
      const data = await this.service.getCurrent(storeId, undefined);
      return res.json({
        success: true,
        data,
        message: "Fetched successfully",
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  };

  cancel = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await this.service.cancel(req.params.id, this.service.getReqContext(req));
      return res.json({
        success: true,
        data,
        message: "dailyReport.canceled",
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  };
}
