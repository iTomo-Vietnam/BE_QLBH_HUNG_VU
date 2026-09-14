import { FindOptionsSelect } from "typeorm";
import { BaseSelect } from "@/shared/base/BaseSelect";
import { DailyReport } from "@/database/models/DailyReport";

export const DailyReportSelectList: FindOptionsSelect<DailyReport> = {
  ...BaseSelect,
  storeId: true,
  reportDate: true,
  status: true,
  summary: true,
  capturedAt: true,
  canceledAt: true,
};

export const DailyReportSelectFull: FindOptionsSelect<DailyReport> = {
  ...DailyReportSelectList,
  orderSnapshots: true,
  expenseSnapshots: true,
  debtIncomeSnapshots: true,
  transferNoteSnapshots: true,
} as any;
