import { z } from "zod";
import {
  BaseCreateSchema,
  BaseParamsSchema,
  BaseQuerySchema,
  BaseUpdateSchema,
} from "@/shared/base/BaseValidator";
import { DailyReportStatus } from "@/database/models/DailyReport";

export const CreateDailyReportSchema = BaseCreateSchema.extend({
  reportDate: z.string().date().optional(),
});

export const UpdateDailyReportSchema = BaseUpdateSchema.extend({
  status: z.enum(DailyReportStatus).optional(),
});

export const DailyReportQuerySchema = BaseQuerySchema.extend({
  reportDate: z.string().date().optional(),
  status: z.enum(DailyReportStatus).optional(),
});

export const DailyReportParamsSchema = BaseParamsSchema;
