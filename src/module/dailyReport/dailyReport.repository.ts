import { injectable } from "inversify";
import { BaseRepository } from "@/shared/base/BaseRepository";
import { DailyReport } from "@/database/models/DailyReport";
import {
  DailyReportSelectFull,
  DailyReportSelectList,
} from "./dailyReport.select";

@injectable()
export class DailyReportRepository extends BaseRepository<DailyReport> {
  protected entityClass = DailyReport;
  protected selectedFields = DailyReportSelectFull;
  protected selectedFieldsForList = DailyReportSelectList;
  protected relations = {};
  protected relationsForList = {};
}
