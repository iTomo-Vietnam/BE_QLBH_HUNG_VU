import { z } from "zod";
import {
  DashboardTimeView,
  DashboardTypeCal,
  DashboardTypeView,
  DashboardProductTypeCal,
} from "./dashboard.types";

const DashboardQuerySchema = z.object({
  storeIds: z.array(z.uuid()).optional(),
  timeView: z.enum(DashboardTimeView).optional(),
  typeView: z.enum(DashboardTypeView).optional(),
  typeCal: z.enum(DashboardTypeCal).optional(),
  timezone: z.string().trim().optional(),
});

export const DashboardMetricsQuerySchema = DashboardQuerySchema.pick({
  timezone: true,
  storeIds: true,
});
export const DashboardRevenueQuerySchema = DashboardQuerySchema;
export const DashboardTopProductQuerySchema = DashboardQuerySchema.pick({
  timeView: true,
  timezone: true,
  storeIds: true,
}).extend({ typeCal: z.enum(DashboardProductTypeCal).optional() });
export const DashboardTopCustomerQuerySchema = DashboardQuerySchema.pick({
  timeView: true,
  timezone: true,
  storeIds: true,
});

export type DashboardMetricsQueryDto = z.infer<
  typeof DashboardMetricsQuerySchema
>;
export type DashboardRevenueQueryDto = z.infer<
  typeof DashboardRevenueQuerySchema
>;
export type DashboardTopProductQueryDto = z.infer<
  typeof DashboardTopProductQuerySchema
>;
export type DashboardTopCustomerQueryDto = z.infer<
  typeof DashboardTopCustomerQuerySchema
>;
