import { ContainerModule } from "inversify";
import { DailyReportRepository } from "./dailyReport.repository";
import { DailyReportService } from "./dailyReport.service";
import { DailyReportController } from "./dailyReport.controller";
import { DailyReportRouter } from "./dailyReport.route";
import { DAILY_REPORT_TYPES } from "./dailyReport.types";

export const dailyReportModule = new ContainerModule((bind) => {
  bind(DAILY_REPORT_TYPES.Repository).to(DailyReportRepository).inSingletonScope();
  bind(DAILY_REPORT_TYPES.Service).to(DailyReportService).inSingletonScope();
  bind(DAILY_REPORT_TYPES.Controller).to(DailyReportController).inSingletonScope();
  bind(DAILY_REPORT_TYPES.Router).to(DailyReportRouter).inSingletonScope();
});
