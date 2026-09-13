import { z } from "zod";

export const AnalysisQuerySchema = z.object({
  period: z.string().trim().optional(),
  storeId: z.uuid().optional(),
  storeIds: z.array(z.uuid()).optional(),
  sortBy: z.enum(["revenue", "returns", "netRevenue", "grossProfit", "invoiceCount"]).optional(),
  timezone: z.string().trim().optional(),
});

export type AnalysisQueryDto = z.infer<typeof AnalysisQuerySchema>;
