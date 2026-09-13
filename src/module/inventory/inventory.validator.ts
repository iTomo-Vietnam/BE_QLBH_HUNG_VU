import { z } from "zod";
import { InventoryRefType } from "@/database/models/store/InventoryTransaction";

const date = z.coerce.date().optional();
const ids = z.array(z.uuid()).optional();
export const GetStockReportQuerySchema = z.object({
  startAt: date,
  endAt: date,
  page: z.coerce.number().int().positive().optional(),
  size: z.coerce.number().int().positive().optional(),
  keyword: z.string().optional(),
  productIds: ids,
  storeIds: ids,
  storeId: z.uuid().optional(),
  productId: z.uuid().optional(),
});
export const GetTransactionDetailsQuerySchema = z.object({
  startAt: date,
  endAt: date,
  productId: z.uuid(),
  storeId: z.uuid().optional(),
  storeIds: ids,
  refType: z.enum(InventoryRefType).optional(),
  page: z.coerce.number().int().positive().optional(),
  size: z.coerce.number().int().positive().optional(),
});
export type GetStockReportQueryDto = z.infer<typeof GetStockReportQuerySchema>;
export type GetTransactionDetailsQueryDto = z.infer<typeof GetTransactionDetailsQuerySchema>;
